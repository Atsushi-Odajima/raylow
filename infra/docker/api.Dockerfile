# RayLaw API (Fastify BFF)
FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc tsconfig.base.json tsconfig.build.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --ignore-scripts
RUN npx tsc -b packages/japanese-text packages/template-schema packages/domain packages/contracts apps/api

FROM node:22.22.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -r raylow && useradd -r -g raylow -d /app raylow
COPY --from=build /app/package.json /app/package-lock.json /app/.npmrc ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY templates ./templates
COPY workers/documents ./workers/documents
RUN mkdir -p /app/.data && chown -R raylow:raylow /app/.data
USER raylow
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
