# infra（Docker / reverse proxy）

| ファイル | 内容 |
|---|---|
| ../docker-compose.yml | scanner(ClamAV) / document-worker（Node render worker + Python 検査 + LibreOffice 固定版）/ api / web(Caddy, TLS) |
| docker/api.Dockerfile | Fastify BFF（nonroot） |
| docker/worker.Dockerfile | worker（nonroot、internal network のみ、静的フォント生成込み） |
| docker/web.Dockerfile | Vite build → Caddy 配信、/api を api へ同一 origin proxy |
| caddy/Caddyfile | HTTPS 自動取得（RAYLOW_DOMAIN）、セキュリティヘッダ、API no-store |

## 設計メモ
- 仕様 §5.1 の「PDF は別の LibreOffice headless 固定コンテナ」は、初版では document-worker イメージに LibreOffice を同梱する構成で実装した（Node worker が同一コンテナ内で `soffice --headless` を job ごとの一時プロファイルで起動）。LibreOffice を別コンテナへ分離する場合は変換 RPC を追加する必要がある（HANDOFF の残作業）。
- DB は compose に含めない。Supabase local（`npx supabase start`）または利用者管理下の Postgres を `.env` の DATABASE_URL_* で指定する。Docker 内からホストの Supabase local へ接続する場合は `DATABASE_URL_SERVICE_DOCKER=postgresql://authenticator:...@host.docker.internal:54322/postgres` を設定する。
- document-worker は internal network のみで外部へ出られない（scanner と DB のみ到達）。
- このリポジトリの開発コンテナでは Docker デーモンが利用できなかったため、compose/Dockerfile は構文確認のみで、ビルド・起動は未検証（HANDOFF 参照）。
