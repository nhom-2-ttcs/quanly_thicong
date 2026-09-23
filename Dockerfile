FROM node:18-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm install --production

COPY backend/ ./
COPY frontend/ ../frontend/

EXPOSE 5000

CMD ["node", "server.js"]
