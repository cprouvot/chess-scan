from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import logging

from app.schemas import ScanResponse, BoardBox, ErrorResponse
from app.vision import find_and_warp_board, classify_board_to_fen

# Initialisation de l'application FastAPI
app = FastAPI(
    title="Chess Scan API",
    description="API de vision par ordinateur pour la détection de positions d'échecs sur capture d'écran",
    version="1.0.0"
)

# Configuration du CORS pour autoriser le frontend (React / Vite)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # À restreindre en production (ex. l'URL du frontend)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logger de l'application
logger = logging.getLogger("chess-scan")
logging.basicConfig(level=logging.INFO)

@app.get("/api/health")
async def health_check():
    """
    Endpoint de santé simple pour vérifier le statut de l'API.
    """
    return {"status": "ok", "message": "Le serveur Chess Scan est opérationnel."}

@app.post("/api/scan", response_model=ScanResponse, responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def scan_chessboard(file: UploadFile = File(...)):
    """
    Reçoit une image d'un échiquier, détecte le plateau, classifie les pièces et retourne le FEN.
    """
    # 1. Vérification de l'extension du fichier
    if not file.content_type.startswith("image/"):
        logger.warning(f"Type de fichier invalide rejeté : {file.content_type}")
        raise HTTPException(
            status_code=400, 
            detail="Le fichier fourni n'est pas une image valide."
        )
        
    try:
        # 2. Lecture du fichier en bytes
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            logger.error("Décodage de l'image échoué.")
            raise HTTPException(
                status_code=400,
                detail="Impossible de décoder l'image. Le fichier est peut-être corrompu."
            )
            
        logger.info(f"Image reçue avec succès. Dimensions : {img.shape}")
        
        # 3. Détection et redressement de l'échiquier
        cv2.imwrite("/app/last_upload.png", img) # Sauvegarde pour diagnostic
        warped_board, bbox_coords = find_and_warp_board(img)
        
        # 4. Classification des cases et génération du FEN
        fen, is_flipped = classify_board_to_fen(warped_board)
        
        logger.info(f"FEN généré avec succès : {fen} (Flipped: {is_flipped})")
        
        # 5. Construction de la réponse
        board_box = BoardBox(
            x=bbox_coords["x"],
            y=bbox_coords["y"],
            w=bbox_coords["w"],
            h=bbox_coords["h"]
        )
        
        return ScanResponse(
            success=True,
            fen=fen,
            board_box=board_box,
            message="Image analysée avec succès.",
            is_flipped=is_flipped
        )
        
    except HTTPException as he:
        # Propager les HTTPExceptions
        raise he
    except Exception as e:
        logger.error(f"Erreur interne lors du traitement de l'image : {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Une erreur interne est survenue lors de l'analyse de l'image: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
