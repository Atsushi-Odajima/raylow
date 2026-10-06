# RayLaw v2 テスト方針

出典: `vitest.config.ts`、`package.json`（scripts）、`tests/` 配下、`packages/*/src/*.test.ts`。実装状況はこの時点のファイル存在で判定した。

## 1. vitest プロジェクトと目的

| project | include | 設定 | 想定する検証内容 | 現状 |
|---|---|---|---|---|
| `unit` | `packages/*/src/**/*.test.ts`, `apps/api/src/**/*.test.ts`, `apps/worker/src/**/*.test.ts`（`*.db/templates/security/export/unicode.test.ts` を除外） | node | 純関数: canonical JSON と hash（全角/ASCII で hash が異なる、キー順序非依存）、`checkApproval`（AC14: staff / admin 単独 / 未割当 / 自己承認 / stale hash / barrier）、状態遷移表、検索キー ver1、和暦境界、証拠番号、grapheme、タグ allowlist、スキーマ検査（循環・未定義タグ・危険キー） | **一部実装**。存在するテスト: `packages/domain/src/domain.test.ts`、`packages/japanese-text/src/{era,evidence,grapheme,searchKey}.test.ts`、`packages/template-schema/src/{tags,validate}.test.ts`。`apps/api` / `apps/worker` 配下の `*.test.ts` は無い |
| `db` | `tests/db/**/*.db.test.ts` | timeout 60s/120s、直列 | RLS: 他 org / 未割当 / barrier が 0 行（AC18）、admin の全件閲覧不可、cross-org トリガ、immutable トリガ（draft_revisions / draft_outputs / audit）、最後の admin 保護、legal_hold、`claim_job` の SKIP LOCKED と lease 再投入、`expectedVersion` 409（AC17）、承認再送で二重遷移なし（AC27） | **未確認**（`tests/db/` は空） |
| `unicode` | `tests/unicode/**/*.unicode.test.ts` + `python3 -I tests/fixtures/normalization_reference.py --check tests/fixtures/unicode_cases.json` | node | `unicode_cases.json` 60 ケースの検索キー期待値、save→reload→JSON/TXT export でコードポイント不変（AC07、U08）、`unicode_fixture.txt` 往復、独立 Python 実装との一致 | **一部**。Python 検算（`--check`）は実行可能。vitest 側 `tests/unicode/` は空 |
| `templates` | `tests/templates/**/*.templates.test.ts` | timeout 300s、直列 | 20 書式の schema 妥当性、`split_run_tags.docx` の run 分割タグ検出、`forbidden/*` の個別拒否（位置付き）、`zip_bomb.docx` / `fake_mime.docx` の拒否、docxtemplater render → 未置換タグ 0、LibreOffice PDF 変換とフォント埋込（AC04/05/06/09） | **未確認**（`tests/templates/` は空）。fixture は `tests/fixtures/docx/*` に揃っている |
| `export` | `tests/export/**/*.export.test.ts` | timeout 120s | CSV 取込（UTF-8 BOM / cp932 / 引用符内改行 / external_id 競合 / 未登録参照 / 不正 encoding / 式注入）、CSV 出力の式注入対策と cp932 往復、matter_json / full_backup の schemaVersion 2 と checksums、`restore.mjs` の空環境判定と hash 照合（AC21/AC24） | **未確認**（`tests/export/` は空）。fixture は `tests/fixtures/csv/*` |
| `security` | `tests/security/**/*.security.test.ts` | timeout 120s、直列 | CSRF/Origin 拒否、MFA 未完了 401、requireRecentMfa、staff 承認拒否、自己承認拒否、stale hash 409、正式版ダウンロードの hash 一致要求、scan 未完了ファイルの 409、DOCM/マクロ/OLE/外部参照/ZIP bomb/偽 MIME/暗号化 PDF 拒否（AC14/AC20）、テンプレートへの XML/JS 文字列が実行されない（AC06） | **未確認**（`tests/security/` は空） |
| `test:e2e`（Playwright） | `playwright test -c tests/e2e/playwright.config.ts` | `@playwright/test` 1.63.0 | /create → 書式選択 → 入力 → 本文 → プレビュー → レビュー → 出力の導線、IME 変換中 Enter で submit しない（AC08）、409 ダイアログ、offline/logout/bfcache で機密を表示しない（AC23）、iPhone 幅での表示 | **未検証**。`tests/e2e/playwright.config.ts` が存在せず、スクリプトは失敗する |

`npm test` は `unit` のみ。`npm run test:all` は unit → unicode → templates → export → security → db を順に実行する。

## 2. 実行コマンドと期待結果

| コマンド | 期待結果（現状） |
|---|---|
| `npm run typecheck` | `tsc -b tsconfig.build.json` が成功（未確認） |
| `npm run lint` | ESLint 成功（未確認） |
| `npm test` | 6 つの `*.test.ts` が成功。DB・LibreOffice・Python 不要 |
| `npm run test:unicode` | vitest 側はテスト 0 件（project に include が無いため「No test files found」で失敗する可能性あり）。Python `--check` は 60 ケース一致で exit 0 |
| `npm run test:db` / `test:templates` / `test:export` / `test:security` | テストファイルが無いため実行対象なし |
| `npm run test:e2e` | 設定ファイル欠如で失敗 |
| `node scripts/smoke.mjs [lawyerA]` | api/worker 起動済みの状態で `SMOKE OK`。`.data/smoke/T01_draft.{docx,pdf}` を生成し、未承認での `mode=final` が 409 になることを確認。この縦断は本リポジトリで実行済み（`.data/smoke/` に成果物あり） |
| `python3 -I tests/fixtures/build_fixtures.py --check` | fixture が決定的に再生成され差分なし |
| `python3 -I scripts/build_demo_templates.py --check` | 20 書式の生成物に差分なし |

## 3. fixture 索引（`tests/fixtures/README.md`）

| ディレクトリ / ファイル | 用途 | 対応 project |
|---|---|---|
| `unicode_cases.json`, `unicode_fixture.txt`, `normalization_reference.py` | 検索キー ver1 の検算、往復不変 | unicode |
| `docx/split_run_tags.docx` | run 分割タグ・表の行ループ・ヘッダータグ | templates |
| `docx/zip_bomb.docx`, `docx/fake_mime.docx` | 拒否系 | templates, security |
| `docx/forbidden/*.docx|.docm`（16 件 + 対照群） | 禁止要素を 1 種類ずつ | templates, security |
| `csv/*.csv`, `csv/contacts_bad_encoding.bin` | 取込検証（BOM / cp932 / 式注入 / 引用符内改行 / 重複 ID / 未登録参照 / 不正 encoding） | export |
| `templates/demo/T01..T20` | 20 書式のデモ DOCX・schema・sample_values・ast_sample | templates |

## 4. 各 project が前提とする環境

| project | DB | worker/LibreOffice | Python | clamd |
|---|---|---|---|---|
| unit | 不要 | 不要 | 不要 | 不要 |
| unicode | 不要 | 不要 | 要（`--check`） | 不要 |
| templates | 要（seed 書式を使う場合） | 要（PDF 変換まで検証する場合） | 要（inspect_docx.py） | 不要 |
| export | 要 | 要（export job） | 不要 | 不要 |
| security | 要 | 一部（scan job） | 要 | 不要（fail closed を検証） |
| db | 要（`DATABASE_URL_APP` / `DATABASE_URL_SERVICE`） | 不要 | 不要 | 不要 |
| e2e | 要 | 要 | 要 | 不要 |

## 5. 既知の未検証事項（テストでは埋められないもの）

- iPhone Safari / PWA 実機（AC22）、Windows Word での最終 DOCX 確認（AC09）。
- ClamAV 実機（AC20 の一部）、Supabase Auth / Storage。
- 20 同時利用・2,000 案件・20,000 文書の性能（AC26）。
- コントラスト・キーボード・スクリーンリーダー（AC25）。
- 法務書式の所内承認・監修（AC28）。

## 6. 推奨する追加順序

1. `tests/security`: 認可・ハッシュ・ファイル拒否は fixture と API だけで検証でき、脅威モデルの残余リスク（export ダウンロードの本人確認、RLS と API の差）を回帰テスト化できる。
2. `tests/db`: RLS と トリガ（特に `file_versions_immutable` と `scan.ts` の衝突）。
3. `tests/templates`: 20 書式の render と `forbidden/*` の個別拒否。
4. `tests/export`: CSV 往復と `restore.mjs`。
5. `tests/unicode`: vitest 側の往復テスト（現状 include 対象 0 件）。
6. `tests/e2e/playwright.config.ts` の追加と IME/bfcache シナリオ。
