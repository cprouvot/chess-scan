# ♟️ Chess Scan

**Chess Scan** est une application web moderne de vision par ordinateur conçue pour analyser des captures d'écran d'échiquiers, en extraire la position sous forme de code FEN, et proposer des suggestions de coups en temps réel à l'aide du moteur d'analyse Stockfish.

L'application est découpée en deux parties :
* **Backend** : FastAPI (Python) utilisant OpenCV et PyTorch pour la détection du plateau de jeu et la reconnaissance des pièces.
* **Frontend** : React / Vite.js (JavaScript) pour l'interface utilisateur responsive, avec intégration du moteur d'analyse Stockfish en WebAssembly (WASM).

---

## 🚀 Options de déploiement sur VPS (ex: OVH Cloud, Debian/Ubuntu)

Nous proposons deux méthodes pour installer Chess Scan sur votre VPS. La méthode **Docker Compose** est la plus simple et isolée, tandis que la méthode **Manuelle** offre une exécution native.

---

### 🐳 Méthode A : Déploiement avec Docker Compose (Recommandée)

Cette méthode ne requiert aucune installation de dépendances logicielles (Python, Node.js, compilateurs) sur votre VPS, à l'exception de Docker.

#### 1. Prérequis sur le VPS
Connectez-vous à votre VPS en SSH et installez Docker et Docker Compose :
```bash
# Mettre à jour le système
sudo apt update && sudo apt upgrade -y

# Installer Docker
sudo apt install -y docker.io docker-compose
```

#### 2. Lancement de l'application
Transférez le dossier du projet sur votre VPS, puis lancez la construction et le démarrage des conteneurs en tâche de fond :
```bash
# Aller dans le répertoire du projet
cd chess-scan

# Lancer la construction et l'exécution
sudo docker-compose up -d --build
```
L'application est maintenant accessible sur le port **8080** de votre VPS (ex: `http://<IP_DU_VPS>:8080`).

#### 3. Configuration d'Nginx en Reverse Proxy (Optionnel - Pour le domaine et HTTPS)
Pour lier l'application à un nom de domaine et activer HTTPS, installez Nginx sur la machine hôte :
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Créez un fichier de configuration Nginx (ex: `/etc/nginx/sites-available/chess-scan`) :
```nginx
server {
    listen 80;
    server_name chess-scan.votre-domaine.com; # Remplacez par votre domaine

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Activez le site et rechargez Nginx :
```bash
sudo ln -s /etc/nginx/sites-available/chess-scan /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Générez le certificat SSL avec Certbot :
```bash
sudo certbot --nginx -d chess-scan.votre-domaine.com
```

---

### 🛠️ Méthode B : Installation Manuelle (NATIVE)

Si vous préférez installer l'application directement sur le système sans passer par Docker, suivez les instructions détaillées dans le dossier de déploiement :

👉 Consultez le [Guide de Déploiement Manuel (deployment/README_DEPLOY.md)](file:///Users/Akabia/Downloads/--Sites%20local/chess-scan/deployment/README_DEPLOY.md)

Ce guide couvre :
1. La configuration de l'environnement virtuel Python (`venv`) pour le backend FastAPI.
2. L'installation des paquets système indispensables pour la vision par ordinateur (`libgl1-mesa-glx` et `libglib2.0-0`).
3. La configuration du service système `Systemd` pour le backend FastAPI (`chess-scan-backend.service`).
4. L'installation de Node.js, l'installation des dépendances npm et la compilation en production (`npm run build`) du frontend React.
5. La configuration d'Nginx pour servir les fichiers statiques compilés et faire office de reverse proxy pour l'API.
6. La mise en place de certificats SSL avec Certbot Let's Encrypt.

---

## 🔧 Structure épurée du Projet
Le projet a été nettoyé de tous ses fichiers de test et scripts temporaires. Voici la structure actuelle :
```text
chess-scan/
├── backend/
│   ├── app/
│   │   ├── main.py        # Point d'entrée de l'API FastAPI
│   │   ├── schemas.py     # Schémas de données Pydantic
│   │   └── vision.py      # Traitement d'image et extraction FEN
│   ├── models/            # Dossier réservé aux poids neuronaux
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── Chessboard.jsx  # Composant interactif d'échiquier
│   │   ├── App.jsx        # Logique globale et intégration Stockfish
│   │   ├── index.css      # Design system et responsive CSS
│   │   └── main.jsx
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── deployment/
│   ├── README_DEPLOY.md   # Guide de déploiement natif étape par étape
│   ├── nginx.conf         # Configuration Nginx hôte
│   └── chess-scan-backend.service # Service Systemd hôte
└── docker-compose.yml
```

---

## ⚙️ Développement local

### Lancement avec Docker en local
```bash
docker-compose up --build
```
L'application est disponible localement à l'adresse `http://localhost:8080`.

### Lancement sans Docker en local
1. **Backend** :
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # Sur macOS/Linux
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```
2. **Frontend** :
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   L'interface web se lancera sur `http://localhost:8080` (ou le port spécifié dans votre console Vite).
