# RayLaw デモ公開手順（単一コンテナ: Render + Supabase Postgres）

本書は「動くものを外から見られるようにする」ためのデモ/検証配備の手順です。**本番配備ではありません。**
本番は docker-compose.yml（api / document-worker / web(Caddy TLS) / scanner(ClamAV) 分離、利用者管理下のホスト）を使い、README.txt §4・docs/operations.md に従ってください。

## 0. 構成と割り切り

| 要素 | デモ構成 | 本番構成との差 |
| --- | --- | --- |
| コンテナ | `infra/docker/demo.Dockerfile` 1 つ（API + render worker + web(dist) 配信） | 本番は 4 コンテナ分離。worker は network-off |
| DB | Supabase Postgres（無料枠）。session pooler（IPv4、5432）経由 | 同じ migration。ロールは `authenticated` / `service_role` を既存のものに接続 |
| 原本（DOCX/PDF/ZIP） | `BLOB_STORE=postgres`（`private.blobs` bytea、INSERT のみ） | 本番は FS ボリュームまたは Supabase Storage |
| ウイルス検査 | **なし**（`DEV_ALLOW_UNSCANNED=true`、`NODE_ENV=development`）。検査報告には `skipped_dev_unscanned` が記録される | 本番は ClamAV 必須（scanner 停止＝fail closed） |
| TLS | Render が終端（`*.onrender.com`）。cookie は Secure、HSTS 付与 | Caddy + 利用者ドメイン |
| 資格情報 | 6 デモユーザーに同じパスワード/TOTP secret（`SEED_DEMO_*`、配備時に生成） | ユーザーごとに生成・一度だけ表示 |
| データ | 架空データのみ。**実在の顧客・弁護士情報を入力しないこと** | — |
| 稼働 | Render 無料枠は 15 分無操作でスリープ（初回アクセスが遅い）。Supabase 無料枠は 1 週間無操作で一時停止（ダッシュボードで再開） | — |

20 書式はすべて `sample_only`（監修済みではない）。デモ上の表示もそのままです。

## 1. Supabase 側（SQL は MCP または SQL エディタで `postgres` として実行）

1. プロジェクト作成（リージョンは Render と同じ Singapore = `ap-southeast-1` 推奨）。
2. **先に** デフォルト権限を外す（Supabase は新規テーブルに anon/authenticated/service_role へ ALL を自動付与するため、migration の最小権限が崩れる）:
   ```sql
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
   ```
3. `supabase/migrations/*.sql` を名前順に適用し、`public._raylow_migrations(name, applied_at)` に適用済みとして記録する（`npm run db:migrate` と同じ台帳）。
4. アプリ用ログインロールを作る（パスワードは配備時に生成。repo に書かない）:
   ```sql
   CREATE ROLE raylow_app LOGIN NOINHERIT PASSWORD '<生成値>';
   GRANT anon, authenticated, service_role TO raylow_app;
   GRANT USAGE ON SCHEMA public, app, private TO raylow_app;
   ```
   `GRANT ... TO raylow_app` が ADMIN 権限不足で失敗する場合は、`postgres` ロールで接続する（`ALTER ROLE postgres PASSWORD '<生成値>'`）。
5. PostgREST（anon key）から public を読まれないよう `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;` を実行。ダッシュボードで Auth のサインアップを無効にすることも推奨（本アプリは Supabase Auth を使わない）。
6. 接続文字列（session pooler）: `postgresql://raylow_app.<project-ref>:<pw>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require`
   （`aws-1-...` の場合あり。ダッシュボード「Connect」→ Session pooler の表示に合わせる）

## 2. Render 側

Web Service を作成: runtime = Docker、repo = このリポジトリ、branch = `main`、Dockerfile = `infra/docker/demo.Dockerfile`、region = Singapore、plan = free（LibreOffice を動かすため starter 以上を推奨。free は 512MB/共有 CPU で PDF 生成が遅い）。

環境変数（値は配備時に生成し、Render の環境変数にだけ置く）:

| 変数 | 値 |
| --- | --- |
| `NODE_ENV` | `development`（ClamAV 無しのため。本番は `production`） |
| `DATABASE_URL_APP` / `DATABASE_URL_SERVICE` | §1-6 の接続文字列 |
| `SESSION_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `AUTH_PROVIDER` | `local` |
| `BLOB_STORE` | `postgres` |
| `COOKIE_SECURE` | `true` |
| `DEV_ALLOW_UNSCANNED` | `true`（デモ限定） |
| `RAYLOW_SEED_ON_BOOT` | 初回のみ `true`（投入後は `false` に戻す。seed は投入済みなら何もしない） |
| `SEED_DEMO_PASSWORD` / `SEED_DEMO_TOTP_SECRET` | 生成値（12 文字以上 / base32 20 文字） |
| `LOG_LEVEL` | `info` |

`RAYLOW_PUBLIC_ORIGIN` / `ALLOWED_ORIGINS` は未指定なら Render が注入する `RENDER_EXTERNAL_URL` を使う（独自ドメインを付けた場合は明示する）。待受ポートは Render の `PORT` に従う。

## 3. 確認

1. `GET https://<service>.onrender.com/api/health` → `{"data":{"ok":true,...}}`
2. `/login` → seed ユーザー（例 `hanako@aoba.example`）+ `SEED_DEMO_PASSWORD` → 認証アプリに `SEED_DEMO_TOTP_SECRET` を登録して 6 桁コード。
3. `/drafts/new` → 案件「売買代金請求事件」→ 受任通知 → プレビュー更新（初回は LibreOffice 起動で数十秒）。
4. Render ログで `RayLaw API listening` と `RayLaw worker started` を確認。

## 4. 運用・停止・撤去

- 再デプロイ: `main` への push で自動（Docker ビルド約 10 分）。
- 停止: Render サービスを Suspend、Supabase プロジェクトを Pause。
- 撤去: Render サービス削除、Supabase プロジェクト削除。原本は DB 内（`private.blobs`）なので DB 削除で消える。
- デモ資格情報の更新: `SEED_DEMO_*` を変えても既存ユーザーには反映されない（seed は再投入しない）。`UPDATE private.local_credentials` ではなくアプリの管理者機能か DB 再作成で行う。

## 5. ローカルでの同等検証（Docker 無し）

```
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/raylow_demo npm run db:setup
BLOB_STORE=postgres SEED_DEMO_PASSWORD=<12文字以上> SEED_DEMO_TOTP_SECRET=<base32> SEED_CREDENTIALS_PATH=.data/demo-seed-credentials.json npm run db:seed
# API（dist 配信）+ worker を同じ DB で起動し、
RAYLOW_E2E_BASE=http://127.0.0.1:3101 RAYLOW_SEED_CREDENTIALS=.data/demo-seed-credentials.json npm run test:e2e
```
e2e の縦断テストは CSP 違反・未捕捉例外が無いことも検証する。
