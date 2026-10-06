# RayLaw document worker: Node render worker + Python 検査 + LibreOffice headless（固定版）+ 同梱フォント
# network-off / nonroot で実行する（compose 側で network_mode: none ではなく internal network + DB のみ到達）
FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc tsconfig.base.json tsconfig.build.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --ignore-scripts
RUN npx tsc -b packages/japanese-text packages/template-schema packages/domain packages/contracts apps/worker

FROM node:22.22.0-bookworm-slim
ENV NODE_ENV=production DEBIAN_FRONTEND=noninteractive
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
COPY --from=build /app/apps/worker ./apps/worker
COPY workers/documents ./workers/documents
COPY assets/fonts ./assets/fonts
COPY assets/licenses ./assets/licenses
COPY scripts/build_static_fonts.py ./scripts/build_static_fonts.py
# 可変フォント → 静的インスタンス（LibreOffice の Type3 書き出し回避）
RUN /opt/py/bin/python -I scripts/build_static_fonts.py && fc-cache -f
RUN mkdir -p /app/.data && chown -R raylow:raylow /app/.data
ENV PYTHON_BIN=/opt/py/bin/python SOFFICE_BIN=soffice FONTS_DIR=/app/assets/fonts DOCUMENT_WORKER_DIR=/app/workers/documents RENDER_TMP_DIR=/app/.data/tmp
USER raylow
CMD ["node", "apps/worker/dist/index.js"]
