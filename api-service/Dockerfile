FROM node:20-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
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
    && rm -rf /var/lib/apt/lists/*


# Create wg-api user
RUN useradd -m -s /bin/bash wg-api

# Setup sudoers - Allow wg-api to run our specific scripts
# Note: we use /usr/local/bin to isolate the scripts
RUN echo "wg-api ALL=(ALL) NOPASSWD: /usr/local/bin/wg-*.sh" > /etc/sudoers.d/wg-api && \
    chmod 0440 /etc/sudoers.d/wg-api

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY api-service/package*.json ./
RUN npm install

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
    chown -R wg-api:wg-api /app/data /etc/wireguard/clients

# Environment defaults
ENV WG_INTERFACE=wg0
ENV PORT=3000
ENV NODE_ENV=production
# JWT_SECRET must be provided via environment variables (.env)

EXPOSE 3000

# Start as root to handle network commands directly
# Start via entrypoint to handle interface setup
CMD ["/app/entrypoint.sh"]
