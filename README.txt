RayLaw v2（レイロー）— 法律事務所の書類作成・訴訟準備アプリ
========================================================

本リポジトリは docs/spec/01_claude_code_prompt.txt（v2.0, 2026-10-06）を正本として実装した Web アプリ、worker、テスト、運用手順です。
初期状態の 20 書式は架空デモ（sample_only）であり、弁護士による内容確認・所内承認を経るまで正式出力には使えません。
法務監修・実機 iPhone 検証・独立したセキュリティ検査は未実施です（HANDOFF.txt）。

------------------------------------------------------------
1. 構成
------------------------------------------------------------
apps/web            React 19 / TypeScript strict / Vite 7 / React Router 7 / TanStack Query / Zod。PWA（manifest + 手書き sw.js）
apps/api            Fastify 5 BFF。opaque session cookie + CSRF/Origin + TOTP MFA。Postgres RLS を本人 claims で適用
apps/worker         Node render worker。docxtemplater(OSS core)+PizZip → LibreOffice headless → PDF。検査/スキャン/パック/エクスポート job
workers/documents   Python 隔離処理（DOCX 構造検査、ファイル検査、PDF フォント/サニタイズ）
packages/           japanese-text（検索キー ver1・グラフェム・和暦・証拠番号）, template-schema（FieldSpec/条件DSL/AST/差込）, domain（状態遷移・承認規則・canonical hash）, contracts（API 契約 Zod）
supabase/migrations Postgres スキーマ・RLS・トリガー・ジョブキュー（Supabase local でも素の Postgres でも適用可）
templates/demo      20 書式（template.docx + schema.json + provenance.json + sample_values.json + ast_sample.json）
tests/              unit / db / security / unicode / templates / export / e2e（Playwright）、fixtures
infra/ + docker-compose.yml   scanner(ClamAV) / document-worker(LibreOffice 同梱) / api / web(Caddy TLS)。infra/docker/demo.Dockerfile は単一コンテナのデモ配備用（docs/deploy-demo.md）
docs/               要件一覧・ER・データ辞書・権限表・状態遷移・脅威モデル・運用・API 契約・SBOM
assets/             ブランド素材・フォント（OFL）・アイコン

------------------------------------------------------------
2. Windows 11 からの起動手順（PowerShell）
------------------------------------------------------------
前提: Git、Node.js 22 LTS（22.12 以上）、Docker Desktop（WSL2）、Supabase CLI（npx 経由で可）。Python 3.13 と LibreOffice は worker を Docker で動かす場合は不要。

  git clone <利用者の repo URL> raylow
  cd raylow
  npm ci
  Copy-Item .env.example .env
  # .env を編集: DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_SERVICE / SESSION_ENCRYPTION_KEY（32byte base64）/ DB_AUTHENTICATOR_PASSWORD
  #   Supabase local の例: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
  #                        DATABASE_URL_APP=postgresql://authenticator:postgres@127.0.0.1:54322/postgres （SERVICE も同じ）
  #   SESSION_ENCRYPTION_KEY は  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  で生成
  npx supabase start
  npx supabase db reset            # supabase/migrations を適用（素の Postgres の場合は npm run db:setup）
  npm run db:seed                  # 架空「青葉法律事務所」と 20 書式を投入。パスワード/TOTP secret は .data/seed-credentials.json に一度だけ出力
  docker compose up -d scanner document-worker
  npm run dev                      # api(3001) / worker(ローカルで soffice がある場合) / web(5173)

ブラウザで http://localhost:5173 → ログイン（seed の email/password）→ TOTP（.data/seed-credentials.json の totp secret を認証アプリに登録、または `node -e` で otpauth から生成）→ /create。

期待結果:
  npm ci            … エラーなく完了（package-lock.json 固定）
  npx supabase db reset / npm run db:setup … "migrations applied: 7"
  npm run db:seed   … "seed: 完了。書式 20 件。"
  npm run dev       … api: "RayLaw API listening on http://127.0.0.1:3001", web: Vite "Local: http://localhost:5173/"
  ※ Docker 無しで worker をローカル実行する場合は python3 + lxml/pypdf/pillow/fonttools と LibreOffice が必要。`python3 -I scripts/build_static_fonts.py` で静的フォントを生成してから `npm run dev -w apps/worker`。

------------------------------------------------------------
3. scripts と期待結果
------------------------------------------------------------
  npm run build          … packages/apps を TypeScript build + Vite build（apps/web/dist）
  npm run lint           … ESLint（0 errors）
  npm run typecheck      … tsc -b（0 errors）
  npm test               … unit（japanese-text / template-schema / domain）39 tests pass
  npm run test:db        … テスト DB raylow_test を作り直し、RLS・不変トリガー・ジョブキュー + 縦断フロー（登録→公開→草案→承認→正式出力→送付記録）23 tests pass
  npm run test:security  … 認証/CSRF/Origin、越境 404、barrier、一括上限、危険 DOCX 拒否、XML/JS 注入、承認境界 19 tests pass
  npm run test:unicode   … 検索キー fixture（60 例）、原文 DB 往復、ICU 版記録、reference 実装の検算 6 tests + python PASS
  npm run test:templates … 20 書式 × (検査 + DOCX/PDF 生成 + フォント埋込 + 文字往復) と fixture 44 tests pass（LibreOffice 必要）
  npm run test:export    … CSV 取込（UTF-8 BOM/CP932/式注入/競合/未登録参照）、export（CSV/JSON+添付 ZIP/全量）、backup→restore 10 tests pass
  npm run test:e2e       … Playwright（事前に npm run dev と seed が必要）。desktop と 390px エミュレーション
  npm run sbom           … docs/sbom/sbom.cdx.json と LICENSES.md
  node scripts/backup.mjs [dir] / node scripts/restore.mjs <dir>   … pg_dump + blobs の日次バックアップと空環境への復元（hash 検証）
  python3 -I scripts/build_demo_templates.py   … 20 デモ書式の再生成（冪等）
  python3 -I scripts/build_static_fonts.py     … 可変フォント → 静的インスタンス（LibreOffice 用）
テスト DB は DATABASE_URL のデータベース名を raylow_test に置き換えて作成する（同じ Postgres サーバー）。

------------------------------------------------------------
4. iPhone（Safari / PWA）で開くには
------------------------------------------------------------
iPhone の localhost は Windows の localhost ではないため、HTTPS で配信された URL が必要です。
  (1) 利用者管理下の検証ホスト（Linux VM 等）に Docker をインストールし、本リポジトリを配置
  (2) .env に本番相当の値（DATABASE_URL_*、SESSION_ENCRYPTION_KEY、ALLOWED_ORIGINS=https://<domain>、RAYLOW_PUBLIC_ORIGIN、COOKIE_SECURE=true、CLAMD_HOST=scanner）を設定
  (3) RAYLOW_DOMAIN=<domain> docker compose --profile full up -d   … Caddy が Let's Encrypt で TLS を取得し、/api を同一 origin で proxy
  (4) iPhone Safari で https://<domain>/ → ログイン/MFA → 共有 → ホーム画面に追加 → PWA 起動 → /create → 受任通知作成 → PDF/DOCX 取得
確認項目: safe-area、ソフトキーボード、320/375/390/430px、ファイル選択、Safari のダウンロード/共有。Web Share API 不可の場合は download にフォールバック。
本リポジトリの開発コンテナでは Docker デーモンと公開ドメインが無いため、compose のビルド・起動と iPhone 実機は未検証です。

------------------------------------------------------------
5. 管理者向け
------------------------------------------------------------
- 初期 lawyer 指定・admin 作成は導入時にオンボーディング責任者が seed または POST /api/members（admin, MFA 15 分以内）で行い、監査に残る。弁護士 2 名以上の運用が前提（最終編集者とは別の弁護士が承認）。
- 書式公開: /templates/import → 検査 → タグ対応付け → 試作 → /templates/:id/versions/:v で 3 点確認 → 公開（sample_only=false が所内承認版）。published 版は不変。
- バックアップ/復元・保存期限・legal_hold・監視: docs/operations.md
- 詳細: docs/API.md, docs/permissions.md, docs/state-transitions.md, docs/threat-model.md, docs/data-dictionary.md, HANDOFF.txt
