FROM node:20-bookworm-slim

# Create app directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies - npm may report false errors but packages install anyway
# Verify critical modules are actually present
RUN npm install --legacy-peer-deps --no-audit --no-fund 2>&1 || true \
    && test -d node_modules/express || npm install express --legacy-peer-deps \
    && node -e "require('express'); console.log('✓ express OK')" \
    && node -e "require('mysql2'); console.log('✓ mysql2 OK')" \
    && node -e "require('better-sqlite3'); console.log('✓ better-sqlite3 OK')"

# Copy rest of app source
COPY . .

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


