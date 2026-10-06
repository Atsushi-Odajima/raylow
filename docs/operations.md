# RayLaw v2 管理者手順と運用

対象はリポジトリ現状のコードで実行できる手順。環境構築（Docker Compose、reverse proxy、TLS、Supabase 本番接続）は未実装のため、該当箇所は「未実装」と記す。コマンドはリポジトリルートで実行する。

## 0. 前提とコンポーネント

| 構成要素 | 実装 | 状態 |
|---|---|---|
| Postgres | `supabase/migrations/*.sql`、`scripts/db-{setup,migrate,reset,seed}.mjs` | 実装済（素の Postgres / Supabase local のどちらでも適用可） |
| BFF | `apps/api`（port 3001、`API_HOST=127.0.0.1`） | 実装済 |
| Web | `apps/web`（Vite 5173、`/api` を 3001 へ proxy） | 実装済（本番 build の配信構成は未実装） |
| worker | `apps/worker`（常駐、`WORKER_POLL_MS` ごとに claim） | 実装済 |
| Python 検査 | `workers/documents/*.py`（lxml / pypdf / pillow / python-docx） | 実装済（コンテナ化は未実装） |
| LibreOffice | `SOFFICE_BIN`（既定 `soffice`） | ローカル導入が前提 |
| ClamAV | `CLAMD_HOST/CLAMD_PORT` | 未検証。未設定時は fail closed（scan_failed） |
| OCR | — | 未実装 |
| Docker Compose / reverse proxy | — | 未実装（`infra/` は空） |

環境変数は `.env.example` を `.env` にコピーして設定する。`SESSION_ENCRYPTION_KEY` は 32 byte の base64（例: `openssl rand -base64 32`）。`DATABASE_URL_APP` は RLS が適用されるログインロール（`authenticator` 経由で `authenticated` に SET ROLE できること）、`DATABASE_URL_SERVICE` は `service_role` に SET ROLE できるロールを指す。superuser を BFF に渡さない。

## 1. 初期セットアップ（開発・検証環境）

```
npm ci
cp .env.example .env            # 値を設定
npm run db:setup                # DB 作成（無ければ）+ migration 適用 + authenticator ロール
npm run db:seed                 # 架空デモ（青葉法律事務所 ほか）。資格情報は .data/seed-credentials.json
npm run dev                     # api / worker / web を同時起動
node scripts/smoke.mjs lawyerA  # 事務所→案件→受任通知→DOCX→PDF の縦断確認
```

- `npm run db:reset` は DB を破棄して再作成する（`NODE_ENV=production` では拒否）。
- `scripts/dev-restart.sh` は api/worker をバックグラウンド再起動し `.data/logs/*.log` へ出力する（開発専用）。
- `.data/seed-credentials.json` にデモ用パスワードと TOTP secret が入る。外部公開する環境では使わない。

Windows PowerShell 手順書（README.txt）、`docker compose up -d scanner document-worker`、Supabase CLI 手順は未実装。

## 2. オンボーディング（本番相当の初期化）

seed を使わない環境では、最初の組織・admin・弁護士の作成は **デプロイ運用責任者が DB 上で行う**（API に「最初の組織と admin を作る」経路は無い）。手順の骨子:

1. `organizations` に事務所を 1 行作成する。
2. `app_users` に初期 admin を作成し、`memberships(role='admin')` と `private.local_credentials`（`hashPassword` 相当の scrypt 文字列、`must_change=true`）を登録する。`AUTH_PROVIDER=supabase` の場合は `private.identity_links` に auth.users.id を対応づける（未検証）。
3. 初期 admin でログインし、MFA を登録する（`POST /api/auth/mfa/enroll` → `enroll/confirm`）。MFA 未登録ではほぼ全 API が 401 `mfa_required` になる。
4. `/setup` で事務所プロファイル（差出人情報・敬称設定）を保存する。
5. **弁護士の登録は 2 段階**: (a) admin が `/settings` から `POST /api/members`（role=lawyer、MFA 15 分以内）で所内ユーザーを招待し、応答に一度だけ含まれる初期パスワードを本人へ安全に渡す。(b) admin または lawyer が `POST /api/lawyers` で `lawyers` 行を作り `userId` を紐づける。`lawyers.user_id` が無いユーザーは role=lawyer でも承認・書式公開（所内承認版）ができない。
6. **弁護士は 2 名以上**を登録する。承認は「最終編集者とは別の割当弁護士」のみ可能なため、1 名では正式出力に到達できない（`/setup` と `/drafts/:id/check` に注記、`/api/settings` の `minLawyersForApproval=2`）。
7. 初期 lawyer 指定は監査 `member.invited` / `lawyer.created` に残る。仕様の「二者確認」は未実装のため、運用で第二者がログを確認する。
8. 書式: デモ 20 書式を使う場合は seed が `published` / `sample_only=true` で登録する。所内承認版は §5 の手順で別途作る。

本番でのパスワード・鍵・接続文字列は repo に入れない。`.env` の配布と保管は secret manager 側（未実装）。

## 3. メンバー招待・権限変更・退所

| 操作 | 手順 | 備考 |
|---|---|---|
| 招待 | admin が MFA を 15 分以内に確認（`POST /api/auth/step-up`）→ `POST /api/members {email, displayNameRaw, role}` | 既存メールなら既存ユーザーに membership を追加。初期パスワードは応答で一度だけ |
| 役割変更 | `PUT /api/members/:userId {role, expectedVersion}` | 自分自身の admin 解除は 403。最後の admin の降格はトリガで 409 |
| 停止 / 退所 | `PUT /api/members/:userId {status:'suspended'|'left', expectedVersion}` | 全セッションを即時 revoke。次回以降のリクエストは 401 |
| 退所者の案件引継ぎ | 各案件で割当 lawyer が `POST /api/matters/:id/members`（後任）→ `DELETE /api/matters/:id/members/:userId`（退所者） | 案件の lawyer が 0 人になる削除は 409。一括引継ぎ API は無い |
| MFA 再登録（端末紛失） | 回復コード機能は未実装。運用で `private.mfa_totp` の行を削除し、本人に再度 `mfa/enroll` させる | DB 操作が必要（監査に残らない） |

## 4. 案件のメンバー・barrier

- 案件作成者と `leadLawyerId` のユーザーは自動的に member（`can_edit=true`）。
- member 追加・削除・barrier 追加は **割当弁護士**（`app.is_assigned_lawyer`）のみ。admin 単独では不可（API）。
- barrier 追加は理由必須。追加時に同一ユーザーの member 行を削除し、以後は member に追加できない（409）。
- 案件 archive / closed / reopen（理由必須）/ legal_hold は割当弁護士のみ。archive 中は書込み系が RLS で止まる。
- 他 org・非 member・barrier のユーザーには案件は 404 として見えない。

## 5. 書式公開ワークフロー

1. **取込** `POST /api/templates/import`（multipart `file` + `fields {name, kind, scope, templateId?, sourceUrl?, checkedAt?, licenseNote?}`）。DOCX は 20MB まで、`.docm` は拒否。`inspect_template` job が構造検査を行い `inspection_report` を保存する。構造的拒否（マクロ・OLE・外部参照・テキストボックス・変更履歴・コメント・脚注・複数セクション・縦結合ループ・段落跨ぎタグ・不均衡ループ・式/ドット/危険キー）は job 失敗 `template_rejected` となり、位置と「Word 側で対応外要素を除いたコピーを保存」の案内が返る。元ファイルは変更しない。
2. **残存文字の確認** `inspection_report.residualTextCandidates`（住所・電話・郵便番号・メール様の文字列）を確認者が全ページ見て、他案件の実名・住所が無いことを確認する。
3. **スキーマ** `PUT /api/template-versions/:id/schema {expectedVersion, fieldSchema, tagMap, rendererProfileId?}`。未定義タグ・循環・危険キー・enum/array の不備は 422。スキーマに UUID 風の文字列（案件内 ID）があれば 422。保存すると `testing → draft` に戻る。
4. **試作** `POST /api/template-versions/:id/test {sampleValues?}`。架空値で DOCX/PDF を生成し、`job.result.outputFileId` で確認する。ヘッダーに「【試作・架空データ】サンプル・要確認」が入る。
5. **公開** `POST /api/template-versions/:id/publish` — lawyer かつ MFA 15 分以内。必須条件:
   - `inspection_report` にエラーが無い
   - 最新スキーマ更新後に `test_template` job が成功している
   - `confirmations: {contentReviewed:true, residualTextReviewed:true, applicabilityReviewed:true}`
   - `sampleOnly`: `true` = サンプル（草案のみ、正式出力不可）/ `false` = **所内承認版**（`lawyers` に active 登録された本人のみ）
   - `applicability / sourceUrl / checkedAt / licenseNote` を併せて記録できる
   公開で `templates.active_version_id` が切り替わる。既公開版は retire されず過去文書は不変。
6. **廃止** `POST /api/template-versions/:id/retire`（admin/lawyer）。active 版なら `active_version_id` を NULL にする。
7. 既公開版を直したい場合は同じ `templateId` で再度 import し、新しい revision を 1〜5 で公開する。published 版はトリガで不変。

文例（`/api/phrases`）も同様に版を作り、lawyer（作成者以外）が `confirmations {contentReviewed, residualTextReviewed}` で承認する。

## 6. バックアップと復元

### 6.1 スクリプト（`scripts/backup.mjs` / `scripts/restore.mjs`）

```
node scripts/backup.mjs [出力ディレクトリ]      # 既定 .data/backups/<timestamp>/
node scripts/restore.mjs <バックアップディレクトリ>
```

- backup: `pg_dump --format=custom`（`DATABASE_URL`）→ `db.dump`、`BLOB_LOCAL_DIR`（既定 `.data/blobs`）→ `blobs/`、`templates/demo`、`assets/fonts`、`supabase/migrations` をコピーし `manifest.json` を書く。**暗号化はしない**。別権限の保管先への転送・age/gpg 暗号化・日次スケジュールは運用側で設定する（未実装）。
- restore: 復元先に `organizations` の行があれば中止（空環境限定）。`pg_restore --clean --if-exists` → blobs コピー（空でなければ中止）→ `file_versions.sha256` と blob 実体の全件照合 → `matter_members / matter_barriers / memberships` 件数を表示。hash 不一致や欠損があれば exit 1（「添付と DB の片方だけ」を完了にしない）。
- `BLOB_STORE=supabase` のときの blob バックアップ・復元は未実装（スクリプトはローカル FS のみ）。
- `renderer_profiles` / `court_profiles` は DB dump に含まれる。フォントは `assets/fonts` のコピー。

### 6.2 アプリ内 export（`POST /api/exports`）

| type | 内容 | 権限 |
|---|---|---|
| contacts_csv | 連絡先 CSV + 原文 JSON の ZIP | org member |
| matters_csv | 要求者がアクセスできる案件の CSV | org member |
| evidence_csv | 案件の証拠台帳 CSV | 案件 ACL |
| audit_csv | 案件の監査 CSV（org-level 行は admin のみ含む） | 案件 ACL |
| matter_json | 案件 JSON + 添付 ZIP（schemaVersion 2、checksums.sha256） | 案件 ACL |
| full_backup | org 全量 JSON + 全 blob の ZIP | **admin のみ** |

`GET /api/exports/:jobId/download` で取得。CSV は UTF-8 BOM 既定、`encoding:'cp932'` は全セルが往復可能な場合のみ（不可なら `cp932_unencodable`）。CSV の `= + - @ TAB CR` 始まりは `'` を付加するため、原文は JSON 側で確認する。**この ZIP（`data.json`）から復元するスクリプトは無い**（復元は 6.1 の pg_dump 系のみ）。`docs/threat-model.md` B6 のとおり、ダウンロードは job が見える org メンバー全員に許可されているため、full_backup の job ID の扱いに注意する。

### 6.3 復元訓練

四半期ごとに空の DB・空の blob ディレクトリへ `restore.mjs` を実行し、`restore complete (DB + blobs + hash verified)` と ACL 件数を記録する。RPO 24h / RTO 1 営業日は目標値であり保証ではない。

## 7. 保存期限・archive・legal_hold

- `PUT /api/settings {retentionYears, autoDeleteEnabled, expectedVersion}`（admin、MFA 15 分以内）。`autoDeleteEnabled` は既定 false で、**有効にしても削除を実行する処理は存在しない**（設定値の保存のみ）。
- 案件の `archived` / `closed` は書込み停止（RLS `can_edit_matter`）。再開は理由付き（`reasonRaw` 必須）で割当弁護士が行う。
- `POST /api/matters/:id/legal-hold {legalHold:true}` で削除禁止（トリガ）。API に案件削除は無く、RLS でも DELETE は常に false。
- 解約時の export は `full_backup`、バックアップ側の消去予定は運用手順で管理する（アプリ外）。

## 8. 監視シグナル

アラート基盤は未実装。以下を定期クエリ・ログ監視で確認する。

| シグナル | 確認方法 | 対応 |
|---|---|---|
| job 滞留 | `SELECT type, count(*) FROM jobs WHERE state='queued' AND run_after < now() - interval '5 minutes' GROUP BY type` | worker が起動しているか（`.data/logs/worker.log` の `RayLaw worker started`）。`jobs_claim_idx` を使う |
| job 失敗 | `SELECT type, error_code, count(*) FROM jobs WHERE state='failed' AND updated_at > now() - interval '1 day' GROUP BY 1,2` | `converter_unavailable` は LibreOffice、`scanner_unavailable` は clamd、`template_rejected`/`unreplaced_tag` は書式側の修正導線（`fixLink`） |
| lease 切れ | `error_code='lease_expired'`、worker ログ `lease_lost` | worker のハング・メモリ不足 |
| hash 不一致 | job `error_code IN ('hash_mismatch','template_hash_mismatch')`、`restore.mjs` の `hash mismatch`、`output.downloaded_final` 直前の 409 `hash_stale` 多発 | blob 改ざん・欠損の疑い。該当 `storage_key` を隔離して調査 |
| storage 欠損 | export job `blob_missing`、`restore.mjs` の `missing blob` | バックアップから当該 blob を復元 |
| scanner 停止 | `SELECT count(*) FROM files WHERE scan_status='scan_failed'`、job `scanner_unavailable` | clamd 復旧後、該当ファイルは再アップロードまたは job 再投入（自動再検査なし） |
| 残容量 | `.data/blobs`、`.data/tmp`（job 中断時の残留）、Postgres | `.data/tmp` の古いディレクトリは削除可 |
| 異常ログイン | `audit_events.action IN ('auth.login','auth.step_up','auth.mfa_enrolled')` の時刻・actor、API ログの 401/429 | `local_credentials.locked_until` の確認 |
| 権限変更 | `audit_events.action IN ('member.invited','member.updated','lawyer.created','lawyer.updated','matter.member_added','matter.barrier_added','draft.lease_takeover')` | 第二者が週次で確認（二者承認の代替） |
| health | `GET /api/health` → `{ok:true,time}` | 事務所情報・secret は含まない |

外部 error 監視へ本文を送らない。Fastify ログは cookie / authorization / x-csrf-token を redact し、worker は `payload.snapshot` / `payload.ast` を redact する。

## 9. オフボーディング

1. admin が MFA を再確認し `PUT /api/members/:userId {status:'left', expectedVersion}` を実行する。全セッションが revoke され、以後の API は 401。
2. 当該ユーザーが割当弁護士だった案件は、別の割当弁護士が後任を member に追加してから本人を削除する（lawyer が 0 人になる削除は 409）。
3. `lawyers.active=false` に更新する（`PUT /api/lawyers/:id`）。履歴の `lawyers` 行は残す（過去文書の差出人表記は snapshot に固定されており変化しない）。
4. 退所者の端末に保存された DOCX/PDF は遠隔削除できない。事務所の情報管理規程で回収する。
5. `private.local_credentials` / `private.mfa_totp` の行は membership を `left` にしても残る。ログインは membership 非 active で `no_membership` となるが、完全削除が必要なら `app_users` ごと削除する（監査の `actor_id` は残り、`actor_name` は NULL になる）。

## 10. 既知の運用上の制約

- API プロセスは 1 つを前提（upload / import の進行状態がメモリ）。
- clamd 未接続の環境ではすべてのアップロードが `scan_failed` になる。開発では `DEV_ALLOW_UNSCANNED=true`（非 production のみ）。
- OCR、Supabase Storage、Supabase Auth、Docker Compose、TLS 終端、iPhone 実機、ClamAV 実機は未検証または未実装。
- `scan.ts` のテキスト添付 encoding 更新は `file_versions_immutable` トリガにより失敗する（docs/data-dictionary.md）。
- 法務書式の所内承認・販売前監修・独立セキュリティ検査・復元訓練は未実施。
