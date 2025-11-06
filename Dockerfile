FROM node:20-bookworm-slim

# Create app directory
WORKDIR /app

# Copy app source first (ensures install sees any optional files)
COPY . .

# Install production dependencies and verify installation
RUN npm cache clean --force \
    && (npm ci --omit=dev || npm install --omit=dev) \
    && node -e "require('express'); console.log('express ok')"

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


