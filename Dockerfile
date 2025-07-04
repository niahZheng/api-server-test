# Multi-stage build - Build stage
FROM --platform=$BUILDPLATFORM node:20-alpine as base

FROM base as builder

# Set npm configuration
RUN npm config set unsafe-perm true

WORKDIR /code

# Layer copying: Copy package files first to leverage cache
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Multi-stage build - Production stage
FROM node:20-alpine

# Set production environment
ENV NODE_ENV production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /home/app

# Copy only production-required files
COPY --from=builder /code/package*.json ./
COPY --from=builder /code/node_modules ./node_modules
COPY --from=builder /code/index.js ./

# Set environment variables
ENV HOME="/home/app"

# Expose port
EXPOSE 8000

# Health check (optional - use K8s probes instead for K8s deployment)
# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#   CMD node -e "require('http').get('http://localhost:8000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Switch to non-root user
USER nodejs

# Start application
CMD ["node", "index.js"]
