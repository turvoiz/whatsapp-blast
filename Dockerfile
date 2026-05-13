# Dockerfile untuk Grosenia WA Blast Service
# Backend Node.js pakai Baileys — TANPA Chromium, image super ringan (~100MB)

# Build stage — install deps
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Production stage
FROM node:20-alpine

# Install minimal runtime utility:
# - wget   : untuk Docker healthcheck
# - tini   : init process untuk handle SIGTERM dengan benar
# - dumb-init alternative
RUN apk add --no-cache wget tini

ENV NODE_ENV=production

# Non-root user
RUN addgroup -S nodejs && \
    adduser -S -G nodejs -h /home/wablast wablast

WORKDIR /app

COPY --from=builder --chown=wablast:nodejs /app/node_modules ./node_modules
COPY --chown=wablast:nodejs package*.json ./
COPY --chown=wablast:nodejs src ./src

# Folder untuk session Baileys (di-mount dari Docker volume di production)
RUN mkdir -p /app/auth_info_baileys && \
    chown -R wablast:nodejs /app

USER wablast

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3010/api/wa/health || exit 1

# tini handles SIGTERM untuk graceful shutdown
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
