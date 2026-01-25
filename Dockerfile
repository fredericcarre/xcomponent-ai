# Multi-stage Dockerfile for xcomponent-ai
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src
COPY public ./public
COPY examples ./examples

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/examples ./examples

# Expose port
EXPOSE 3000

# Default command
CMD ["node", "dist/cli.js", "serve", "examples/simple-xcomponent-demo.yaml", "--port", "3000"]

# Development stage
FROM node:20-alpine AS development

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy configuration
COPY tsconfig.json ./

# Copy source code
COPY src ./src
COPY public ./public
COPY examples ./examples

# Expose port
EXPOSE 3000

# Development command with hot reload
CMD ["npm", "run", "dev"]
