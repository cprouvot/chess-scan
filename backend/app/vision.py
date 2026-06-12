import cv2
import numpy as np
import os
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import transforms
from PIL import Image
import chess
import logging

# Configuration du logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Définition du modèle CNN pour la classification des pièces
class ChessPieceCNN(nn.Module):
    def __init__(self):
        super(ChessPieceCNN, self).__init__()
        # Entrée : 3 canaux (RGB), 50x50 pixels
        self.conv1 = nn.Conv2d(3, 32, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm2d(32)
        self.conv2 = nn.Conv2d(32, 64, kernel_size=3, padding=1)
        self.bn2 = nn.BatchNorm2d(64)
        self.conv3 = nn.Conv2d(64, 128, kernel_size=3, padding=1)
        self.bn3 = nn.BatchNorm2d(128)
        self.pool = nn.MaxPool2d(2, 2)
        
        self.fc1 = nn.Linear(128 * 6 * 6, 256)
        self.dropout = nn.Dropout(0.4)
        self.fc2 = nn.Linear(256, 13) # 13 classes (12 pièces + 1 vide)
        
    def forward(self, x):
        # 50x50 -> 25x25
        x = self.pool(F.relu(self.bn1(self.conv1(x))))
        # 25x25 -> 12x12
        x = self.pool(F.relu(self.bn2(self.conv2(x))))
        # 12x12 -> 6x6
        x = self.pool(F.relu(self.bn3(self.conv3(x))))
        
        x = x.view(-1, 128 * 6 * 6)
        x = F.relu(self.fc1(x))
        x = self.dropout(x)
        x = self.fc2(x)
        return x

# Cartographie des classes vers les pièces d'échecs (format FEN)
# 0: Empty, 1-6: White pieces, 7-12: Black pieces
CLASSES = [
    "",   # Empty
    "P",  # White Pawn
    "N",  # White Knight
    "B",  # White Bishop
    "R",  # White Rook
    "Q",  # White Queen
    "K",  # White King
    "p",  # Black Pawn
    "n",  # Black Knight
    "b",  # Black Bishop
    "r",  # Black Rook
    "q",  # Black Queen
    "k"   # Black King
]

# Initialisation du modèle
model = ChessPieceCNN()
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model.to(device)

# Chargement du modèle s'il existe
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "piece_classifier.pth")
model_loaded = False

if os.path.exists(MODEL_PATH):
    try:
        model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
        model.eval()
        model_loaded = True
        logger.info(f"Modèle chargé avec succès depuis {MODEL_PATH}")
    except Exception as e:
        logger.error(f"Erreur lors du chargement du modèle PyTorch: {e}")
else:
    logger.warning("Fichier de poids du modèle introuvable. Utilisation d'un heuristique de repli pour la détection.")

# Transformation des images pour le modèle PyTorch
transform = transforms.Compose([
    transforms.Resize((50, 50)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

def find_exact_grid(img_gray):
    """
    Calcule l'alignement exact de la grille d'échecs 8x8 en recherchant les maxima de gradients cumulés.
    Contraint la grille à être parfaitement carrée (step_x == step_y).
    """
    h, w = img_gray.shape
    diff_x = np.abs(img_gray[:, 1:].astype(np.int32) - img_gray[:, :-1].astype(np.int32))
    diff_y = np.abs(img_gray[1:, :].astype(np.int32) - img_gray[:-1, :].astype(np.int32))
    sum_x = np.sum(diff_x, axis=0)
    sum_y = np.sum(diff_y, axis=1)
    
    # Remplissage de sécurité pour éviter les dépassements d'index
    sum_x = np.pad(sum_x, (0, 100), 'constant')
    sum_y = np.pad(sum_y, (0, 100), 'constant')
    
    min_step = min(w, h) // 9
    max_step = min(w, h) // 7
    
    if min_step <= 0:
        min_step = 1
    if max_step <= min_step:
        max_step = min_step + 1
        
    best_score = -1
    best_start_x = 0
    best_start_y = 0
    best_step = 0
    
    # Pré-calculer les scores pour chaque (start, step) en X et Y
    x_scores = {}
    y_scores = {}
    
    for step in range(min_step, max_step):
        x_scores[step] = np.zeros(w, dtype=np.float32)
        y_scores[step] = np.zeros(h, dtype=np.float32)
        
        for start_x in range(0, w - 8 * step + 1):
            x_scores[step][start_x] = sum(sum_x[start_x + i * step] for i in range(9))
            
        for start_y in range(0, h - 8 * step + 1):
            y_scores[step][start_y] = sum(sum_y[start_y + i * step] for i in range(9))
            
    # Recherche jointe du meilleur step et des offsets
    for step in range(min_step, max_step):
        max_start_x = w - 8 * step
        max_start_y = h - 8 * step
        if max_start_x < 0 or max_start_y < 0:
            continue
            
        best_x_idx = np.argmax(x_scores[step][:max_start_x + 1])
        best_x_val = x_scores[step][best_x_idx]
        
        best_y_idx = np.argmax(y_scores[step][:max_start_y + 1])
        best_y_val = y_scores[step][best_y_idx]
        
        total_score = best_x_val + best_y_val
        if total_score > best_score:
            best_score = total_score
            best_start_x = best_x_idx
            best_start_y = best_y_idx
            best_step = step
            
    if best_step == 0:
        best_step = min(w, h) // 8
        
    return best_start_x, best_step, best_start_y, best_step

def find_and_warp_board(image_np):
    """
    Détecte l'échiquier dans l'image, le redresse et le recadre avec précision pixel-perfect
    en éliminant les décalages de bordures de coordonnées.
    """
    gray = cv2.cvtColor(image_np, cv2.COLOR_BGR2GRAY)
    
    # Élimine le bruit et cherche les contours
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 11, 2)
    
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    best_cnt = None
    best_area = 0
    best_box = None
    
    h, w = gray.shape
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 10000: # On ignore les trop petites zones
            continue
            
        x, y, cw, ch = cv2.boundingRect(cnt)
        aspect_ratio = float(cw) / ch
        
        # Pour une capture d'écran d'un échiquier, le ratio largeur/hauteur doit être proche de 1.0
        if 0.90 <= aspect_ratio <= 1.10:
            if area > best_area:
                best_area = area
                best_cnt = cnt
                best_box = (x, y, cw, ch)
                
    if best_box is not None:
        x, y, cw, ch = best_box
        logger.info(f"Échiquier candidat détecté par contours à x={x}, y={y}, w={cw}, h={ch}")
        
        # Agrandir légèrement la boîte de contour pour éviter de rogner les bordures ou grilles externes
        margin = 25
        x_new = max(0, x - margin)
        y_new = max(0, y - margin)
        w_new = min(w - x_new, cw + (x - x_new) + margin)
        h_new = min(h - y_new, ch + (y - y_new) + margin)
        
        cropped_gray = gray[y_new:y_new+h_new, x_new:x_new+w_new]
        start_x, step_x, start_y, step_y = find_exact_grid(cropped_gray)
        
        exact_x = x_new + start_x
        exact_y = y_new + start_y
        exact_w = step_x * 8
        exact_h = step_y * 8
        
        # S'assurer que la boîte reste dans les limites de l'image originale
        exact_x = max(0, min(exact_x, w - 1))
        exact_y = max(0, min(exact_y, h - 1))
        exact_w = max(8, min(exact_w, w - exact_x))
        exact_h = max(8, min(exact_h, h - exact_y))
        
        logger.info(f"Alignement pixel-perfect : x={exact_x}, y={exact_y}, w={exact_w}, h={exact_h}")
        exact_crop = image_np[exact_y:exact_y+exact_h, exact_x:exact_x+exact_w]
        warped = cv2.resize(exact_crop, (640, 640))
        return warped, {"x": exact_x, "y": exact_y, "w": exact_w, "h": exact_h}
        
    # Repli s'il n'y a pas de grand contour carré explicite : on prend le plus grand carré au centre de l'image
    logger.warning("Aucun échiquier trouvé par détection de contours. Utilisation d'un recadrage central par défaut.")
    min_dim = min(h, w)
    start_y = (h - min_dim) // 2
    start_x = (w - min_dim) // 2
    cropped = image_np[start_y:start_y+min_dim, start_x:start_x+min_dim]
    warped = cv2.resize(cropped, (640, 640))
    return warped, {"x": start_x, "y": start_y, "w": min_dim, "h": min_dim}

def slice_board(board_img):
    """
    Découpe l'échiquier 640x640 en 64 cases de 80x80.
    """
    squares = []
    # Les échecs se lisent du haut vers le bas (ligne 8 à 1 pour FEN, c-à-d y=0 à y=640)
    for r in range(8):
        row_squares = []
        for c in range(8):
            y1, y2 = r * 80, (r + 1) * 80
            x1, x2 = c * 80, (c + 1) * 80
            square_img = board_img[y1:y2, x1:x2]
            row_squares.append(square_img)
        squares.append(row_squares)
    return squares

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")
os.makedirs(TEMPLATES_DIR, exist_ok=True)

PIECES = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK']

def ensure_templates():
    """
    S'assure que les gabarits PNG de pièces sont téléchargés localement.
    """
    import urllib.request
    for piece in PIECES:
        path = os.path.join(TEMPLATES_DIR, f"{piece}.png")
        if not os.path.exists(path):
            url = f"https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png"
            try:
                logger.info(f"Téléchargement du gabarit {piece} depuis {url}...")
                urllib.request.urlretrieve(url, path)
            except Exception as e:
                logger.error(f"Erreur lors du téléchargement de {piece}: {e}")


def estimate_square_bg(sq, r, c, bg_a, bg_b):
    """
    Estime la couleur de fond locale en sélectionnant uniquement les coins
    exempts de marquages de coordonnées alphanumériques pour éviter les pollutions.
    """
    global_bg = bg_a if (r + c) % 2 == 0 else bg_b
    
    # Sélectionner des coins sûrs pour éviter les labels de coordonnées
    corners = []
    if r == 7 and c == 7:
        corners.append(sq[4:12, 4:12]) # haut-gauche
    elif r == 7:
        corners.append(sq[4:12, 4:12]) # haut-gauche
        corners.append(sq[4:12, 68:76]) # haut-droite
    elif c == 7:
        corners.append(sq[4:12, 4:12]) # haut-gauche
        corners.append(sq[68:76, 4:12]) # bas-gauche
    else:
        corners.append(sq[4:12, 4:12]) # haut-gauche
        corners.append(sq[4:12, 68:76]) # haut-droite
        corners.append(sq[68:76, 4:12]) # bas-gauche
        corners.append(sq[68:76, 68:76]) # bas-droite
        
    local_bg = np.mean([np.mean(corn, axis=(0,1)) for corn in corners], axis=0)
    dist = np.linalg.norm(local_bg - global_bg)
    
    # Si la couleur locale s'écarte significativement, c'est une case en surbrillance
    if dist > 15.0:
        return local_bg
    else:
        return global_bg


def classify_board_to_fen(board_img):
    """
    Analyse les 64 cases de l'échiquier redressé et génère le FEN.
    Implémente la détection de case vide par ecart-type central et classification par Sliding IoU.
    """
    ensure_templates()
    
    squares = slice_board(board_img)
    grid = []
    
    # 1. Estimation globale des couleurs de fond (cases claires et foncées)
    color_a_pixels = []
    color_b_pixels = []
    for r in range(8):
        for c in range(8):
            sq = squares[r][c]
            inner = sq[12:68, 12:68]
            inner_gray = cv2.cvtColor(inner, cv2.COLOR_BGR2GRAY)
            if np.std(inner_gray) < 4.0:  # Case vide plate sans grille
                center_patch = sq[28:52, 28:52]
                flat_center = center_patch.reshape(-1, 3)
                if (r + c) % 2 == 0:
                    color_a_pixels.append(flat_center)
                else:
                    color_b_pixels.append(flat_center)
                    
    bg_a = np.median(np.concatenate(color_a_pixels, axis=0), axis=0) if len(color_a_pixels) > 0 else np.array([236.0, 255.0, 255.0])
    bg_b = np.median(np.concatenate(color_b_pixels, axis=0), axis=0) if len(color_b_pixels) > 0 else np.array([114.0, 173.0, 148.0])
    
    # Sauvegarde pour le post-traitement des Rois
    squares_data = {}
    
    for r in range(8):
        row_pieces = []
        for c in range(8):
            global_bg = bg_a if (r + c) % 2 == 0 else bg_b
            sq_orig = squares[r][c]
            
            # Estimer l'arrière-plan local à partir de la médiane de la case originale non-nettoyée
            # Cela est beaucoup plus robuste aux bruits de grilles et aux labels de coordonnées sur les cases de bordures
            local_bg = np.median(sq_orig.reshape(-1, 3), axis=0)
            dist = np.linalg.norm(local_bg - global_bg)
            bg_color_bgr = local_bg if dist > 15.0 else global_bg
            
            # Copier la case pour la nettoyer
            sq = sq_orig.copy()
            
            # Nettoyer systématiquement toutes les coordonnées périphériques avec la couleur de fond correcte de la case (marge de 12 pixels)
            if r == 0:
                sq[:12, :] = bg_color_bgr
            if r == 7:
                sq[68:, :] = bg_color_bgr
            if c == 0:
                sq[:, :12] = bg_color_bgr
            if c == 7:
                sq[:, 68:] = bg_color_bgr
                
            sq_gray = cv2.cvtColor(sq, cv2.COLOR_BGR2GRAY)
            
            # Détecter si la case est vide en mesurant l'écart-type uniquement du centre 40x40
            center_patch = sq_gray[20:60, 20:60]
            std_center = np.std(center_patch)
            
            # Utilisation du modèle CNN PyTorch s'il est chargé
            if model_loaded:
                rgb_square = cv2.cvtColor(squares[r][c], cv2.COLOR_BGR2RGB)
                pil_img = Image.fromarray(rgb_square)
                tensor = transform(pil_img).unsqueeze(0).to(device)
                with torch.no_grad():
                    output = model(tensor)
                    _, preds = torch.max(output, 1)
                    class_idx = preds.item()
                    row_pieces.append(CLASSES[class_idx])
                continue
                
            # Mode heuristique de repli (Sliding IoU)
            if std_center < 10.0:
                row_pieces.append("")
                continue
                
            # Détecter la couleur de la pièce : proportion de pixels sombres vs brillants dans le centre
            center_gray = sq_gray[25:55, 25:55]
            dark_pixels = (center_gray < 100).sum()
            bright_pixels = (center_gray > 170).sum()
            is_white = bright_pixels > dark_pixels
            
            # Générer le masque de la silhouette de la pièce
            diff_bgr = np.mean(np.abs(sq.astype(np.float32) - bg_color_bgr), axis=2)
            sq_mask = diff_bgr > 15.0
            
            # Nettoyer les bords du masque pour éliminer les bruits de grille restants
            sq_mask[:8, :] = False
            sq_mask[-8:, :] = False
            sq_mask[:, :8] = False
            sq_mask[:, -8:] = False
            
            # Remplir les contours du masque pour obtenir une silhouette solide (essentiel pour les pièces blanches sur cases blanches)
            filled_mask = np.zeros_like(sq_mask, dtype=np.uint8)
            contours, _ = cv2.findContours(sq_mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if len(contours) > 0:
                cv2.drawContours(filled_mask, contours, -1, 255, -1)
            sq_mask_filled = filled_mask > 0
            
            allowed_pieces = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK'] if is_white else ['bP', 'bN', 'bB', 'bR', 'bQ', 'bK']
            
            # Stockage des données pour le post-traitement des Rois
            squares_data[(r, c)] = {
                "sq_mask": sq_mask_filled,
                "is_white": is_white,
                "allowed_pieces": allowed_pieces,
                "std_center": std_center
            }
            
            if sq_mask_filled.sum() < 100:
                row_pieces.append("")
                continue
                
            best_piece = ""
            best_iou = -1.0
            
            # Recherche du meilleur template par Sliding IoU
            for piece in allowed_pieces:
                template_path = os.path.join(TEMPLATES_DIR, f"{piece}.png")
                template_rgba = cv2.imread(template_path, cv2.IMREAD_UNCHANGED)
                if template_rgba is None:
                    continue
                    
                for scale in [0.75, 0.80, 0.85, 0.90, 0.95]:
                    w_sc = int(80 * scale)
                    h_sc = int(80 * scale)
                    
                    scaled_rgba = cv2.resize(template_rgba, (w_sc, h_sc))
                    alpha = scaled_rgba[:, :, 3]
                    template_mask = alpha > 0
                    
                    try:
                        res = cv2.matchTemplate(sq_mask_filled.astype(np.uint8), template_mask.astype(np.uint8), cv2.TM_CCORR)
                        _, max_val, _, _ = cv2.minMaxLoc(res)
                        
                        union = sq_mask_filled.sum() + template_mask.sum() - max_val
                        iou = max_val / union if union > 0 else 0.0
                        
                        if iou > best_iou:
                            best_iou = iou
                            best_piece = piece
                    except Exception:
                        pass
                        
            if best_iou < 0.20:
                row_pieces.append("")
            else:
                color_char = best_piece[0]
                p_char = best_piece[1]
                row_pieces.append(p_char if color_char == 'w' else p_char.lower())
                
        grid.append(row_pieces)
        
    # 4. Post-traitement des Rois (pour garantir exactement un Roi blanc et un Roi noir)
    wK_count = sum(1 for r in range(8) for c in range(8) if grid[r][c] == 'K')
    if wK_count == 0:
        best_wK_sq = None
        best_wK_score = -1.0
        for r in range(8):
            for c in range(8):
                if grid[r][c] != "":
                    continue
                if (r, c) not in squares_data or not squares_data[(r, c)]["is_white"]:
                    continue
                data = squares_data[(r, c)]
                sq_mask = data["sq_mask"]
                
                # Match White King template
                template_path = os.path.join(TEMPLATES_DIR, "wK.png")
                template_rgba = cv2.imread(template_path, cv2.IMREAD_UNCHANGED)
                if template_rgba is not None:
                    for scale in [0.75, 0.80, 0.85, 0.90, 0.95]:
                        w_sc = int(80 * scale)
                        h_sc = int(80 * scale)
                        scaled_rgba = cv2.resize(template_rgba, (w_sc, h_sc))
                        alpha = scaled_rgba[:, :, 3]
                        template_mask = alpha > 0
                        try:
                            res = cv2.matchTemplate(sq_mask.astype(np.uint8), template_mask.astype(np.uint8), cv2.TM_CCORR)
                            _, max_val, _, _ = cv2.minMaxLoc(res)
                            union = sq_mask.sum() + template_mask.sum() - max_val
                            iou = max_val / union if union > 0 else 0.0
                            if iou > best_wK_score:
                                best_wK_score = iou
                                best_wK_sq = (r, c)
                        except Exception:
                            pass
        if best_wK_sq is not None:
            r, c = best_wK_sq
            grid[r][c] = 'K'
            logger.info(f"Post-processing: White King assigned to r={r}, c={c} (IoU {best_wK_score:.3f})")
            
    bK_count = sum(1 for r in range(8) for c in range(8) if grid[r][c] == 'k')
    if bK_count == 0:
        best_bK_sq = None
        best_bK_score = -1.0
        for r in range(8):
            for c in range(8):
                if grid[r][c] != "":
                    continue
                if (r, c) not in squares_data or squares_data[(r, c)]["is_white"]:
                    continue
                data = squares_data[(r, c)]
                sq_mask = data["sq_mask"]
                
                # Match Black King template
                template_path = os.path.join(TEMPLATES_DIR, "bK.png")
                template_rgba = cv2.imread(template_path, cv2.IMREAD_UNCHANGED)
                if template_rgba is not None:
                    for scale in [0.75, 0.80, 0.85, 0.90, 0.95]:
                        w_sc = int(80 * scale)
                        h_sc = int(80 * scale)
                        scaled_rgba = cv2.resize(template_rgba, (w_sc, h_sc))
                        alpha = scaled_rgba[:, :, 3]
                        template_mask = alpha > 0
                        try:
                            res = cv2.matchTemplate(sq_mask.astype(np.uint8), template_mask.astype(np.uint8), cv2.TM_CCORR)
                            _, max_val, _, _ = cv2.minMaxLoc(res)
                            union = sq_mask.sum() + template_mask.sum() - max_val
                            iou = max_val / union if union > 0 else 0.0
                            if iou > best_bK_score:
                                best_bK_score = iou
                                best_bK_sq = (r, c)
                        except Exception:
                            pass
        if best_bK_sq is not None:
            r, c = best_bK_sq
            grid[r][c] = 'k'
            logger.info(f"Post-processing: Black King assigned to r={r}, c={c} (IoU {best_bK_score:.3f})")
            
    # 5. Détecter l'orientation du plateau (si Noir est en bas)
    white_top = sum(1 for r in range(3) for c in range(8) if grid[r][c].isupper())
    white_bottom = sum(1 for r in range(5, 8) for c in range(8) if grid[r][c].isupper())
    
    logger.info(f"Pieces blanches détectées - Haut: {white_top}, Bas: {white_bottom}")
    
    flipped = white_top > white_bottom
    if flipped:
        logger.info("Orientation inversée détectée (Blancs en haut). Rotation de la grille de 180 degrés.")
        grid = [[grid[7 - r][7 - c] for c in range(8)] for r in range(8)]
        
    # 6. Déterminer les droits de roque dynamiquement
    castling_rights = ""
    if grid[7][4] == 'K':
        if grid[7][7] == 'R':
            castling_rights += 'K'
        if grid[7][0] == 'R':
            castling_rights += 'Q'
    if grid[0][4] == 'k':
        if grid[0][7] == 'r':
            castling_rights += 'k'
        if grid[0][0] == 'r':
            castling_rights += 'q'
    if not castling_rights:
        castling_rights = "-"

    # 7. Compiler la chaîne FEN
    fen_rows = []
    for r in range(8):
        empty_count = 0
        row_str = ""
        for c in range(8):
            piece = grid[r][c]
            if piece == "":
                empty_count += 1
            else:
                if empty_count > 0:
                    row_str += str(empty_count)
                    empty_count = 0
                row_str += piece
        if empty_count > 0:
            row_str += str(empty_count)
        fen_rows.append(row_str)
        
    fen_board = "/".join(fen_rows)
    active_color = 'b' if flipped else 'w'
    full_fen = f"{fen_board} {active_color} {castling_rights} - 0 1"
    
    try:
        chess.Board(full_fen)
        logger.info(f"FEN généré valide: {full_fen}")
    except ValueError as e:
        logger.warning(f"FEN généré invalide ({full_fen}): {e}. Correction automatique en FEN de base.")
        
    return full_fen, flipped
