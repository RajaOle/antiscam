FROM node:20-bookworm-slim

# Create app directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (we'll prune dev deps after if needed)
# Using --legacy-peer-deps and --no-audit to avoid npm issues
RUN npm install --legacy-peer-deps --no-audit --no-fund

# Copy rest of app source
COPY . .

# Remove dev dependencies to reduce image size (optional but recommended)
RUN npm prune --production

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


