FROM node:20-bookworm-slim

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
    && rm -rf /var/lib/apt/lists/*


# Create wg-api user
RUN useradd -m -s /bin/bash wg-api

# Setup sudoers - Allow wg-api to run ONLY specific scripts and network binaries
# SECURITY: Bare binaries (rm, ls, tee, test) are STRICTLY removed to prevent privilege escalation.
# I/O operations are handled through wg-file-proxy.sh
RUN echo "wg-api ALL=(ALL) NOPASSWD: /usr/local/bin/*.sh, /app/core-vpn/scripts/*.sh, /usr/bin/wg, /usr/bin/wg-quick, /usr/sbin/ufw, /usr/sbin/sysctl, /sbin/ip" > /etc/sudoers.d/wg-api && \
    chmod 0440 /etc/sudoers.d/wg-api


# Set working directory
WORKDIR /app

# Copy package files and install production dependencies only
# --omit=dev exclut drizzle-kit/esbuild (devDependencies) qui causent ETXTBSY dans le container
# npm install (pas npm ci) utilise prebuild-install pour better-sqlite3 (binaire précompilé = pas besoin de make/g++)
COPY api-service/package*.json ./
RUN npm install --omit=dev

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

# Start as root to handle network commands directly
# Start via entrypoint to handle interface setup
CMD ["/app/entrypoint.sh"]
