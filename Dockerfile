# Use Puppeteer’s official base image with Chrome preinstalled
FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Work directory
WORKDIR /usr/src/app

# Copy package files first
COPY package*.json ./

# ✅ Ensure we are root before installing
USER root

# Fix permissions and install deps
RUN chmod -R 777 /usr/src/app && npm install --omit=dev

# Copy the rest of the app
COPY . .

# Puppeteer & environment configuration
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV CHROME_PATH=/usr/bin/google-chrome-stable
ENV PORT=4000

EXPOSE 4000

# ✅ Hand ownership to non-root user for runtime
RUN chown -R pptruser:pptruser /usr/src/app
USER pptruser

# Start app
CMD ["node", "index.js"]
