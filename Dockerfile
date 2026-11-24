# ====================================================================
# UNIFIED ALL-IN-ONE RESTAURANT MANAGEMENT SYSTEM DOCKERFILE
# Builds both Client (Vite React) and Server (Express + Prisma) into
# a single production container for simple 1-click cloud deployments.
#
# The repo is an npm workspace with one lockfile at the root, so every
# install runs from the root with that lockfile.
# ====================================================================

# Stage 1: All dependencies (client + server), from the root lockfile
FROM node:20-alpine AS deps
# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY client/package.json ./client/
COPY server/package.json ./server/
# The server's postinstall runs `prisma generate`, which needs the schema.
COPY server/prisma ./server/prisma/
RUN npm ci

# Stage 2: Build Frontend SPA
FROM deps AS client-builder
COPY client/ ./client/
RUN npm run build -w client

# Stage 3: Build Backend API
FROM deps AS server-builder
COPY server/ ./server/
RUN npm run build -w server

# Stage 4: Production Runtime
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Production dependencies for the server only (postinstall generates the Prisma client)
COPY package.json package-lock.json .npmrc ./
COPY server/package.json ./server/
COPY server/prisma ./server/prisma/
RUN npm ci --omit=dev -w server && npm cache clean --force

# Compiled backend, and the built frontend where the server looks for it (../../client/dist from server/dist)
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=client-builder /app/client/dist ./client/dist

# Security: Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 rmsuser && \
    chown -R rmsuser:nodejs /app

USER rmsuser
WORKDIR /app/server

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

CMD ["node", "dist/index.js"]
