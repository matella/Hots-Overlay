FROM node:24-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# --- Production stage (no build tools) ---
FROM node:24-slim
WORKDIR /app

# wget for health check
RUN apt-get update && apt-get install -y wget && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p /app/data /app/replays && \
    addgroup --system overlay && adduser --system --ingroup overlay overlay && \
    chown -R overlay:overlay /app/data /app/replays

# Default env vars for Docker (override via Azure App Settings or docker-compose)
# For Azure: set WEBSITES_ENABLE_APP_SERVICE_STORAGE=true in App Settings,
# then override REPLAY_DIR=/home/replays so data persists across container restarts.
ENV PORT=8080
ENV REPLAY_DIR=/app/replays
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

CMD ["node", "server.js"]
