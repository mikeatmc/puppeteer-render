# Puppeteer base image with Chromium preinstalled
FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --production --no-audit --no-fund

# Copy app files
COPY . .

# Expose port for Railway
EXPOSE 4000

# Start the server
CMD ["node", "index.js"]
