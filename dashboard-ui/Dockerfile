FROM node:20-alpine AS builder
WORKDIR /app
COPY dashboard-ui/package.json dashboard-ui/package-lock.json ./
RUN npm ci --silent
COPY dashboard-ui/ .
RUN npm run build --silent

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
RUN echo "server { \
    listen 80; \
    add_header X-Frame-Options DENY always; \
    add_header X-Content-Type-Options nosniff always; \
    add_header Referrer-Policy strict-origin-when-cross-origin always; \
    add_header Permissions-Policy \"camera=(), microphone=(), geolocation=()\" always; \
    add_header Content-Security-Policy \"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://eu.posthog.com ws: wss:; img-src 'self' data:; frame-ancestors 'none';\" always; \
    location / { \
    root /usr/share/nginx/html; \
    index index.html; \
    try_files \$uri \$uri/ /index.html; \
    } \
}" > /etc/nginx/conf.d/default.conf
EXPOSE 80
ENTRYPOINT ["nginx", "-g", "daemon off;"]
