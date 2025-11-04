# ---- Base image ----
FROM node:20-slim

# ---- Install Chromium and dependencies ----
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

# ---- Set work directory ----
WORKDIR /usr/src/app

# ---- Copy dependency files ----
COPY package*.json ./
RUN npm install --omit=dev

# ---- Copy source ----
COPY . .

# ---- Environment variables ----
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=4000

# ---- Expose and run ----
EXPOSE 4000
CMD ["node", "index.js"]
