FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV PORT=4000
EXPOSE 4000

CMD ["npm", "start"]
