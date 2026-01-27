# xcomponent-ai Monolith - Single process with optional PostgreSQL
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (ignore prepare script - we'll build manually)
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY examples ./examples

# Build TypeScript
RUN npm run build 2>/dev/null || npx tsc

# Prune dev deps but keep pg and yaml needed for monolith mode
RUN npm prune --omit=dev && npm install --no-save pg yaml

# Expose dashboard port
EXPOSE 3000

# Start monolith
CMD ["node", "examples/monolith-postgres/runtime.js"]
