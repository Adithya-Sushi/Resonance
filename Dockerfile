FROM node:24.11.0-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["npm","run","start","-w","@resonance/api"]
