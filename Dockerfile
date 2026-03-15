FROM node:24-slim AS build
WORKDIR /app

# better-sqlite3 needs build tools for native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# --- Production stage (no build tools) ---
FROM node:24-slim
WORKDIR /app

# wget for health check, libstdc++ for better-sqlite3 native module, openssh-server for SSH access
RUN apt-get update && apt-get install -y wget libstdc++6 openssh-server && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/

# Configure SSH for Azure App Service (port 2222, root/Docker!)
RUN mkdir -p /var/run/sshd && \
    echo 'root:Docker!' | chpasswd && \
    sed -i 's/#Port 22/Port 2222/' /etc/ssh/sshd_config && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/data /app/replays && \
    addgroup --system overlay && adduser --system --ingroup overlay overlay && \
    chown -R overlay:overlay /app/data /app/replays

# Default env vars for Docker (override via Azure App Settings or docker-compose)
# For Azure: set WEBSITES_ENABLE_APP_SERVICE_STORAGE=true in App Settings,
# then override REPLAY_DIR=/home/replays and DB_PATH=/home/data/overlay.db
# so data persists across container restarts.
ENV PORT=8080
ENV REPLAY_DIR=/app/replays
EXPOSE 8080 2222

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
