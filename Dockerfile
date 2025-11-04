# ✅ Puppeteer official image (includes Chromium)
FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Set working directory
WORKDIR /usr/src/app

# Ensure pptruser owns the working directory
USER root
RUN mkdir -p /usr/src/app && chown -R pptruser:pptruser /usr/src/app

# Copy dependency files first (better caching)
COPY package*.json ./

# Switch to pptruser before npm install
USER pptruser

# Install dependencies (no dev deps)
RUN npm install --omit=dev

# Copy the rest of the app
COPY --chown=pptruser:pptruser . .

# Puppeteer environment variables
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV CHROME_PATH=/usr/bin/google-chrome-stable
ENV PORT=4000

EXPOSE 4000

# Run the app
CMD ["node", "index.js"]
