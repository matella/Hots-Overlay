FROM node:18-alpine AS build
WORKDIR /app

# better-sqlite3 needs build tools for native compilation
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# --- Production stage (no build tools) ---
FROM node:18-alpine
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p /app/data /app/replays

# Default env vars for Docker (override via Azure App Settings or docker-compose)
# For Azure: set WEBSITES_ENABLE_APP_SERVICE_STORAGE=true in App Settings,
# then override REPLAY_DIR=/home/replays and DB_PATH=/home/data/overlay.db
# so data persists across container restarts.
ENV PORT=8080
ENV REPLAY_DIR=/app/replays
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

CMD ["node", "server.js"]
