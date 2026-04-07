# Optimized Nginx-only Dockerfile for 458MB RAM VPS
# Build must be performed locally and synced to the VPS
FROM nginx:alpine

# Copy pre-built assets from the workspace build
COPY dashboard-ui/dist /usr/share/nginx/html

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
