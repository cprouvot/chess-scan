# Étape 1 : Construction de l'application React
FROM node:22-alpine AS builder

WORKDIR /app

# Copier les configurations d'installation
COPY package*.json ./

# Installer les dépendances en utilisant le cache local
RUN npm install --cache ./npm_cache --force

# Copier le code source
COPY . .

# Compiler le projet
RUN npm run build

# Étape 2 : Serveur web Nginx léger pour servir les fichiers statiques et faire le proxy
FROM nginx:alpine

# Copier les fichiers compilés de l'étape précédente
COPY --from=builder /app/dist /usr/share/nginx/html

# Copier la configuration Nginx de Docker
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
