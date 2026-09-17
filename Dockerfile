FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 4747

CMD ["npm", "run", "ui"]