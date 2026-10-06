# RayLaw web（静的 build）を Caddy（reverse proxy + TLS）で配信。/api は api へ同一 origin で proxy。
FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc tsconfig.base.json tsconfig.build.json ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY assets ./assets
RUN npm ci --ignore-scripts
RUN npx tsc -b packages/japanese-text packages/template-schema packages/domain packages/contracts && npm run build -w apps/web

FROM caddy:2.10.2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv/web
