FROM mcr.microsoft.com/playwright:v1.60.0-noble

ENV NODE_ENV=production
ENV HEADLESS=true
ENV VIEWER_RUNTIME=docker
ENV VIEWER_PLATFORM=linux
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY viewer-headless/package*.json ./viewer-headless/

WORKDIR /app/viewer-headless
RUN npm install --omit=dev

WORKDIR /app
COPY viewer-headless ./viewer-headless
COPY electron/viewer-core ./electron/viewer-core

WORKDIR /app/viewer-headless

CMD ["npm", "start"]
