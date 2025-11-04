# Use official Puppeteer image (includes Chrome)
FROM ghcr.io/puppeteer/puppeteer:21.5.0

WORKDIR /usr/src/app

COPY package*.json ./

USER root

RUN chmod -R 777 /usr/src/app && npm install --omit=dev

COPY . .

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=4000

EXPOSE 4000

RUN chown -R pptruser:pptruser /usr/src/app
USER pptruser

CMD ["node", "index.js"]
