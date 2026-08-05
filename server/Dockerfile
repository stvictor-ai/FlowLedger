FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts

USER node
EXPOSE 8787

CMD ["node", "src/server.js"]
