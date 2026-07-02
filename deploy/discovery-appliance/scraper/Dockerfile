# Playwright's official image ships Chromium + all system deps, so no browser install dance.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV PORT=3002
EXPOSE 3002
CMD ["node", "server.js"]
