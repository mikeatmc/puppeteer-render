# Puppeteer base image with Chromium
FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies as root
USER root
RUN npm install --production --no-audit --no-fund

# Copy the rest of the app
COPY . .

# Fix permissions for Puppeteer user
RUN chown -R pptruser:pptruser /usr/src/app

# Switch to Puppeteer user
USER pptruser
RUN mkdir -p /home/pptruser/.cache/puppeteer && \
    npx puppeteer browsers install chrome --path=/home/pptruser/.cache/puppeteer

# Expose port
EXPOSE 4000

# Start the server
CMD ["node", "index.js"]
