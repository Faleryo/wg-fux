# Images pinnées par digest — un tag mutable (:alpine) peut être retaggué vers
# une image différente sans avertissement à la prochaine build.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
WORKDIR /app
COPY dashboard-ui/package.json dashboard-ui/package-lock.json ./
RUN npm ci --silent
COPY dashboard-ui/ .
RUN npm run build --silent

FROM nginx:alpine@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa
COPY --from=builder /app/dist /usr/share/nginx/html
COPY dashboard-ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
ENTRYPOINT ["nginx", "-g", "daemon off;"]
