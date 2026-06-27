FROM node:20-alpine AS builder
WORKDIR /app
COPY dashboard-ui/package.json dashboard-ui/package-lock.json ./
RUN npm ci --silent
COPY dashboard-ui/ .
RUN npm run build --silent

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY dashboard-ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
ENTRYPOINT ["nginx", "-g", "daemon off;"]
