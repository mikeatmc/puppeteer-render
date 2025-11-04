# Use Node 20 slim base
FROM node:20-slim

# Install Chromium + dependencies
RUN apt-get update && apt-get install -y \
  chromium \
  chromium-browser \
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

# Working directory
WORKDIR /usr/src/app

# Copy dependencies and install
COPY package*.json ./
RUN npm install --omit=dev

# Copy app code
COPY . .

# Puppeteer environment
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium-browser
ENV TMPDIR=/usr/src/app/tmp
RUN mkdir -p /usr/src/app/tmp
ENV PORT=4000
EXPOSE 4000

# Start app
CMD ["node", "index.js"]
