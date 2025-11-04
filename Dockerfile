# ✅ Use Puppeteer official image (includes Chromium)
FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Set working directory
WORKDIR /usr/src/app

# Copy dependency files first
COPY package*.json ./

# ✅ Install dependencies as root (avoids permission issues)
RUN npm install --omit=dev

# ✅ Copy the rest of your app and give ownership to pptruser
COPY . .
RUN chown -R pptruser:pptruser /usr/src/app

# Puppeteer environment setup
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV CHROME_PATH=/usr/bin/google-chrome-stable
ENV PORT=4000

EXPOSE 4000

# ✅ Switch to non-root user for runtime
USER pptruser

# Run the app
CMD ["node", "index.js"]
