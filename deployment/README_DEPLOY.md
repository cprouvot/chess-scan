# Guide de Déploiement sur VPS Debian (ex: OVH Cloud)

Ce guide décrit étape par étape comment déployer l'application **Chess Scan** sur un serveur Debian 11/12.

---

## Prérequis système

Connectez-vous à votre serveur VPS en SSH en tant que `root` (ou utilisateur avec droits `sudo`) :
```bash
ssh root@<IP_DU_VPS>
```

Mettez à jour les paquets système et installez les outils nécessaires :
```bash
apt update && apt upgrade -y
apt install -y git python3 python3-pip python3-venv nginx curl libgl1-mesa-glx libglib2.0-0
```
> [!IMPORTANT]
> `libgl1-mesa-glx` et `libglib2.0-0` sont requis pour faire fonctionner OpenCV en mode Headless (sans écran physique) sur Linux.

---

## 1. Structure du projet sur le serveur

Créez le répertoire de l'application et attribuez les droits au serveur web `www-data` :
```bash
mkdir -p /var/www/chess-scan
chown -R www-data:www-data /var/www/chess-scan
```

Clonez ou transférez vos fichiers locaux dans `/var/www/chess-scan`.

---

## 2. Déploiement du Backend (FastAPI)

Basculez sous l'utilisateur `www-data` pour installer l'environnement Python en toute sécurité :
```bash
su -s /bin/bash www-data
cd /var/www/chess-scan/backend
```

Créez l'environnement virtuel et installez les dépendances :
```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
exit # Retour en root
```

### Installation du service Systemd

Copiez le fichier de service systemd fourni vers l'emplacement système :
```bash
cp /var/www/chess-scan/deployment/chess-scan-backend.service /etc/systemd/system/
```

Rechargez les démons, puis activez et lancez le service :
```bash
systemctl daemon-reload
systemctl enable chess-scan-backend.service
systemctl start chess-scan-backend.service
```

Vérifiez que le service fonctionne correctement :
```bash
systemctl status chess-scan-backend.service
```
Vous pouvez visualiser les logs en temps réel via :
```bash
journalctl -u chess-scan-backend.service -f
```

---

## 3. Déploiement du Frontend (React / Vite.js)

### Installation de Node.js
Si Node.js n'est pas encore installé sur votre VPS, utilisez le dépôt officiel NodeSource :
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs
```

### Compilation du build de production
Basculez sous l'utilisateur `www-data` :
```bash
su -s /bin/bash www-data
cd /var/www/chess-scan/frontend
```

Installez les dépendances et lancez la compilation :
```bash
npm install --cache ./npm_cache
npm run build
exit # Retour en root
```
Cela génère le dossier `/var/www/chess-scan/frontend/dist` contenant les fichiers HTML/CSS/JS compilés et optimisés.

---

## 4. Configuration d'Nginx (Reverse Proxy)

Copiez le fichier de configuration Nginx dans les sites disponibles :
```bash
cp /var/www/chess-scan/deployment/nginx.conf /etc/nginx/sites-available/chess-scan
```

Modifiez le fichier pour y mettre votre nom de domaine ou IP :
```bash
nano /etc/nginx/sites-available/chess-scan
```
> Modifiez la ligne : `server_name chess-scan.akabia.fr;` par votre nom de domaine ou l'adresse IP de votre VPS.

Activez le site en créant un lien symbolique vers `sites-enabled` :
```bash
ln -s /etc/nginx/sites-available/chess-scan /etc/nginx/sites-enabled/
```

Supprimez la configuration par défaut d'Nginx si elle entre en conflit :
```bash
rm /etc/nginx/sites-enabled/default
```

Testez la syntaxe Nginx et rechargez le serveur :
```bash
nginx -t
systemctl reload nginx
```

---

## 5. Sécurisation avec SSL (HTTPS via Let's Encrypt)

Il est fortement recommandé d'activer le protocole HTTPS. Installez Certbot pour Nginx :
```bash
apt install -y certbot python3-certbot-nginx
```

Générez le certificat SSL pour votre domaine :
```bash
certbot --nginx -d votre-domaine.com
```
Suivez les instructions à l'écran. Certbot mettra à jour automatiquement votre fichier Nginx pour forcer les redirections HTTPS et gérer le renouvellement automatique des certificats SSL (cron job).

---

## Annexe : Résolution de Problèmes (Troubleshooting)

### OpenCV se plaint de `libGL.so.1`
C'est que vous avez oublié d'installer la dépendance graphique OpenGL sur votre serveur Linux headless. Exécutez :
```bash
apt install -y libgl1-mesa-glx
```

### Problème de CORS en production
Dans `backend/app/main.py`, assurez-vous d'avoir configuré le CORS correctement ou d'exposer le frontend et le backend sous le même domaine (géré par Nginx via le reverse proxy `/api`), ce qui évite les requêtes cross-origin.
Le fichier Nginx configuré ci-dessus est prévu pour que `/api` pointe directement vers le backend, éliminant tout blocage CORS en production.
Dans votre frontend (`vite.config.js` ou variable d'environnement), configurez l'URL cible de l'API sur `/api` pour les requêtes relatives si vous utilisez le même domaine.
