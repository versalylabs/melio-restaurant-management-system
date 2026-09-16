# ====================================================================
# UNIFIED ALL-IN-ONE RESTAURANT MANAGEMENT SYSTEM DOCKERFILE
# Builds both Client (Vite React) and Server (Express + Prisma) into
# a single production container for simple 1-click cloud deployments.
# ====================================================================

# Stage 1: Build Frontend SPA
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build Backend API
FROM node:20-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
COPY server/prisma ./prisma/
RUN npm ci
COPY server/ ./
RUN npx prisma generate
RUN npm run build

# Stage 3: Production Runtime
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Install production dependencies for server
COPY server/package*.json ./
COPY server/prisma ./prisma/
RUN npm ci --only=production && \
    npx prisma generate && \
    npm cache clean --force

# Copy compiled backend output
COPY --from=server-builder /app/server/dist ./dist

# Copy built frontend assets into location served by Express static handler
COPY --from=client-builder /app/client/dist /app/client/dist

# Security: Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 rmsuser && \
    chown -R rmsuser:nodejs /app

USER rmsuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

CMD ["node", "dist/index.js"]
