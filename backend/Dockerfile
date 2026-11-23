# NestJS API. Chrome is not installed; visual checks stay on the configured mode.
FROM node:22-bookworm-slim AS build

WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROME_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROME_HEADLESS_SHELL_DOWNLOAD=true

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

# grok --sandbox read-only refuses to start unless bwrap can enforce the deny list.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROME_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROME_HEADLESS_SHELL_DOWNLOAD=true

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm install -g @xai-official/grok@1.0.92 \
    && grok --version \
    && npm cache clean --force \
    && mkdir -p /var/lib/qa/workdir /home/node/.grok \
    && chown node:node /var/lib/qa/workdir \
    && chown -R node:node /home/node/.grok

COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
