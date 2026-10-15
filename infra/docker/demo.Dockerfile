# RayLaw 単一コンテナ（デモ/検証配備用）: API + render worker + web(dist) 配信を 1 コンテナで動かす。
# Render 等「1 サービス = 1 コンテナ」の PaaS 向け。DB は外部 Postgres（Supabase 等）、原本は BLOB_STORE=postgres を想定。
# 本番構成は docker-compose.yml（api / document-worker / web(Caddy TLS) / scanner(ClamAV) を分離）を使う。
# このイメージには ClamAV を含まない。DEV_ALLOW_UNSCANNED を使う配備は「検査なし」であり本番ではない。
FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc tsconfig.base.json tsconfig.build.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --ignore-scripts
COPY apps ./apps
COPY assets ./assets
RUN npx tsc -b packages/japanese-text packages/template-schema packages/domain packages/contracts apps/api apps/worker \
 && npm run build -w apps/web

FROM node:22.22.0-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
# LibreOffice は Debian bookworm の固定版（apt pin）。変換結果の再現性のためイメージを固定して配布する。
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-core python3 python3-pip python3-venv fontconfig ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/py && /opt/py/bin/pip install --no-cache-dir lxml==6.1.3 pypdf==6.17.0 pillow==12.3.0 python-docx==1.2.0 fonttools==4.60.1
WORKDIR /app
RUN groupadd -r raylow && useradd -r -g raylow -d /app raylow
COPY --from=build /app/package.json /app/package-lock.json /app/.npmrc ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY templates ./templates
COPY workers/documents ./workers/documents
COPY assets/fonts ./assets/fonts
COPY assets/licenses ./assets/licenses
COPY supabase/migrations ./supabase/migrations
COPY scripts/build_static_fonts.py scripts/db-lib.mjs scripts/db-migrate.mjs ./scripts/
COPY infra/docker/demo-entrypoint.sh /usr/local/bin/raylow-entrypoint
# 可変フォント → 静的インスタンス（LibreOffice の Type3 書き出し回避）
RUN /opt/py/bin/python -I scripts/build_static_fonts.py && fc-cache -f \
 && chmod 0755 /usr/local/bin/raylow-entrypoint \
 && mkdir -p /app/.data && chown -R raylow:raylow /app/.data
# seed が呼ぶ python3 も venv（lxml 等入り）に解決させる
ENV PATH=/opt/py/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PYTHON_BIN=/opt/py/bin/python SOFFICE_BIN=soffice FONTS_DIR=/app/assets/fonts DOCUMENT_WORKER_DIR=/app/workers/documents \
    RENDER_TMP_DIR=/app/.data/tmp BLOB_LOCAL_DIR=/app/.data/blobs WEB_DIST_DIR=/app/apps/web/dist API_HOST=0.0.0.0
USER raylow
EXPOSE 10000
ENTRYPOINT ["/usr/local/bin/raylow-entrypoint"]
