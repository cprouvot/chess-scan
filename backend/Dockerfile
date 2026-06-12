FROM python:3.11-slim

# Évite l'écriture de fichiers .pyc et configure le buffering pour les logs Docker
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Installer les dépendances système requises par OpenCV en mode Headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copier et installer les dépendances python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copier le code du backend
COPY app/ ./app/
# Créer le répertoire models pour les poids (si existant localement, il sera copié)
COPY models/ ./models/

EXPOSE 8000

# Lancer FastAPI avec Uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
