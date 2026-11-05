FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_FILE=/app/data/db.json

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public

# Datenordner gehört dem node-Benutzer, damit ein Coolify-Volume dort beschreibbar ist.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
