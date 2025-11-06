FROM node:20-bookworm-slim

# Update npm to latest version to avoid known bugs
RUN npm install -g npm@latest

# Create app directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies - ignore exit code from npm bug, verify installation instead
RUN npm install --legacy-peer-deps --no-audit --no-fund || true \
    && ls -la node_modules/express || (echo "express not installed, retrying..." && npm install express --legacy-peer-deps) \
    && node -e "require('express'); console.log('✓ express verified')" \
    && node -e "require('mysql2'); console.log('✓ mysql2 verified')" \
    && node -e "require('better-sqlite3'); console.log('✓ better-sqlite3 verified')"

# Copy rest of app source
COPY . .

# Remove dev dependencies to reduce image size
RUN npm prune --omit=dev || true

# Ensure runtime dirs exist and set proper permissions
RUN mkdir -p uploads static \
    && chown -R node:node /app

# Runtime env
ENV NODE_ENV=production
ENV PORT=3000

# Drop privileges
USER node

EXPOSE 3000

# Start the server
CMD ["npm", "start"]


