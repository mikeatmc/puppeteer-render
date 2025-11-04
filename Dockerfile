# ✅ Use Puppeteer base image (Chromium preinstalled)
FROM ghcr.io/puppeteer/puppeteer:latest

# Set working directory
WORKDIR /usr/src/app

# Copy dependency files
COPY package*.json ./

# ✅ Give permissions to pptruser (non-root Puppeteer user)
USER root
RUN chown -R pptruser:pptruser /usr/src/app

# Switch to Puppeteer’s safe user
USER pptruser

# ✅ Install dependencies (no dev deps)
RUN npm install --omit=dev --no-audit --no-fund

# Copy the rest of the app
COPY --chown=pptruser:pptruser . .

# Expose the port for Render or Railway
ENV PORT=4000
EXPOSE 4000

# ✅ Start the app
CMD ["npm", "start"]
