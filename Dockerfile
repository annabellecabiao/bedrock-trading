# =========================================================================
# BEDROCK CONSUMER GOODS TRADING - PRODUCTION DOCKERFILE
# =========================================================================

# Stage 1: Build native dependencies (better-sqlite3)
FROM node:22-alpine AS builder

WORKDIR /app

# Install native build tools needed by better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# -------------------------------------------------------------------------
# Stage 2: Minimal Production Runtime
FROM node:22-alpine

WORKDIR /app

# Set production environment and default Azure port
ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/app/data/bedrock.db

# Create persistent storage directory for SQLite database
RUN mkdir -p /app/data

# Copy application source code
COPY . .

# Copy built node_modules from builder stage (placed AFTER COPY . . to guarantee native Alpine binaries)
COPY --from=builder /app/node_modules ./node_modules

# Expose port (Azure App Service / Container Apps default is 8080)
EXPOSE 8080

# Health check probe for container orchestrators (Azure / Docker) using native Alpine wget
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT:-8080}/health || exit 1

# Start the Node.js server
CMD ["node", "server.js"]
