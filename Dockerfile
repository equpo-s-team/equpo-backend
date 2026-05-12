# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder

WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
  && find dist -name "*.d.ts" -delete \
  && find dist -name "*.js.map" -delete

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER node
EXPOSE 8080

CMD ["node", "dist/index.js"]
