FROM node:20-bookworm-slim

# Create app directory
WORKDIR /app

# Install dependencies first (leverage Docker layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Ensure runtime dirs exist (persist these via a volume in your platform)
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


