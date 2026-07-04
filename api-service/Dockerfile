# node:20-bookworm-slim — pinné par digest pour empêcher un retag malveillant
# du tag mutable de rejouer une image différente à l'insu du build.
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wireguard-tools \
    iptables \
    iproute2 \
    sudo \
    qrencode \
    curl \
    ca-certificates \
    procps \
    net-tools \
    sqlite3 \
    speedtest-cli \
    bc \
    iputils-ping \
    ufw \
    openresolv \
    build-essential \
    python3 \
    git \
    && rm -rf /var/lib/apt/lists/*


# Create wg-api user
RUN useradd -m -s /bin/bash wg-api

# Setup sudoers - Allow wg-api to run ONLY specific scripts and network binaries
# SECURITY: Bare binaries (rm, ls, tee, test) are STRICTLY removed to prevent privilege escalation.
# I/O operations are handled through wg-file-proxy.sh
RUN printf '%s\n' \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-apply-qos.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-backup.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-check-expiry.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-create-client.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-create-container.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-enforcer.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-file-proxy.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-harden.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-health.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-move-client.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-optimize.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-postdown.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-postup.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-remove-client.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-remove-container.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-speedtest.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-stats.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-sync-peers.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /app/core-vpn/scripts/wg-toggle.sh" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /usr/bin/wg" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /usr/bin/wg-quick" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /usr/sbin/ufw" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /usr/sbin/sysctl" \
    "wg-api ALL=(ALL) SETENV:NOPASSWD: /sbin/ip" \
    > /etc/sudoers.d/wg-api && \
    chmod 0440 /etc/sudoers.d/wg-api


# Set working directory
WORKDIR /app

# Copy package files and install production dependencies only
# --omit=dev exclut drizzle-kit/esbuild (devDependencies) qui causent ETXTBSY dans le container
# npm ci respecte STRICTEMENT package-lock.json (contrairement à npm install qui peut
# récupérer une version supérieure au lock) — better-sqlite3 utilise toujours
# prebuild-install pour son binaire précompilé, npm ci exécute les mêmes install scripts.
COPY api-service/package*.json ./
RUN npm ci --omit=dev

# Copy API source
COPY api-service/db ./db
COPY api-service/src ./src
COPY api-service/server.js ./

# Copy scripts to /usr/local/bin/
COPY core-vpn/scripts/wg-*.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/wg-*.sh

# Copy and setup entrypoint
COPY api-service/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create necessary directories and set permissions
RUN mkdir -p /app/data /etc/wireguard/clients && \
    touch /var/log/wg-speedtest.log /var/log/wg-enforcer.log && \
    chown -R wg-api:wg-api /app/data /etc/wireguard/clients /var/log/wg-speedtest.log /var/log/wg-enforcer.log && \
    chmod 0644 /var/log/wg-speedtest.log /var/log/wg-enforcer.log

# Environment defaults
ENV WG_INTERFACE=wg0
ENV PORT=3000
ENV NODE_ENV=production
# JWT_SECRET must be provided via environment variables (.env)

EXPOSE 3000

# Start via entrypoint to handle interface setup
ENTRYPOINT ["/app/entrypoint.sh"]
