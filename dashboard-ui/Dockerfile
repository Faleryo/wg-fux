# Multi-stage build for Vibe-OS Dashboard
# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /app
ENV NODE_OPTIONS="--max-old-space-size=2048"
COPY dashboard-ui/package*.json ./
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set strict-ssl false && \
    npm install --no-audit --no-fund
COPY dashboard-ui/ .
RUN npm run build

# Stage 2: Production
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# Custom nginx config for SPA routing
RUN echo "server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html; \
        try_files \$uri \$uri/ /index.html; \
    } \
}" > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
