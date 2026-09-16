# ===================================================
# Stage 1: Build React/Vite Frontend
# ===================================================
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts index.html postcss.config.js tailwind.config.js ./
COPY public ./public/
COPY src ./src/

RUN npm run build

# ===================================================
# Stage 2: Serve with Lightweight Nginx Alpine
# ===================================================
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
