FROM node:20-alpine

WORKDIR /app

# 패키지 먼저 복사 (레이어 캐시 최적화)
COPY package*.json ./
RUN npm ci --only=production

# 소스 복사
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
