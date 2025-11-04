# Use official Node LTS image
FROM node:20-slim

# Install Chromium dependencies
RUN apt-get update && apt-get install -y \
  chromium \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libgtk-3-0 \
  wget \
  gnupg \
  --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /usr/src/app

# Copy files
COPY package*.json ./
RUN npm install --omit=dev

# Copy app source
COPY . .

# Puppeteer setup
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=4000
EXPOSE 4000

# Run the app
CMD ["node", "index.js"]
