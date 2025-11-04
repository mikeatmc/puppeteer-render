# ✅ Puppeteer base image (Chromium preinstalled)
FROM ghcr.io/puppeteer/puppeteer:latest

# Set working directory
WORKDIR /usr/src/app

# Copy dependency files
COPY package*.json ./

# ✅ Set environment variables
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=4000

# ✅ Permissions
USER root
RUN chown -R pptruser:pptruser /usr/src/app

# Switch to non-root Puppeteer user
USER pptruser

# ✅ Install only production dependencies
RUN npm install --production --no-audit --no-fund

# Copy the rest of the app
COPY --chown=pptruser:pptruser . .

# Expose port (for Render/Railway)
EXPOSE 4000

# ✅ Log Chromium path for debugging
RUN echo "Using Chromium at: $CHROME_PATH"

# ✅ Start the app
CMD ["npm", "start"]
