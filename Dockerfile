# ✅ Use Puppeteer's official base image (includes Chromium)
FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Set working directory
WORKDIR /usr/src/app

# Copy dependencies and install
COPY package*.json ./
RUN npm install --omit=dev

# Copy app code
COPY . .

# Puppeteer environment
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV CHROME_PATH=/usr/bin/google-chrome-stable
ENV PORT=4000

EXPOSE 4000

# Run your app
CMD ["node", "index.js"]
