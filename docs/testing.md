# RayLaw v2 テスト方針

出典: `vitest.config.ts`、`package.json`（scripts）、`tests/` 配下、`packages/*/src/*.test.ts`。実装状況はこの時点のファイル存在で判定した。

## 1. vitest プロジェクトと実行結果（2026-10-06、開発コンテナで実測）

| project | include | 設定 | 検証内容 | 結果 |
|---|---|---|---|---|
| `unit` | `packages/*/src/**/*.test.ts` | node、DB 不要 | canonical JSON/hash、checkApproval（AC14）、状態遷移、検索キー ver1、和暦境界、証拠番号、grapheme、タグ allowlist、スキーマ検査（循環・未定義タグ・危険キー）、条件 DSL | **39 tests pass**（7 files） |
| `db` | `tests/db/**/*.db.test.ts` | テスト DB `raylow_test` を globalSetup で再作成（migrate + seed）、直列 | `rls.db.test.ts`: 他 org/未割当/barrier 0 行、admin 全件閲覧不可、cross-org トリガ、audit append-only、published 書式不変、最後の admin 保護、証拠番号一意、version 自動増分、claim_job SKIP LOCKED、input_hash 重複拒否。`flow.db.test.ts`: 書式登録→検査→スキーマ→試作→公開(所内版)→受任通知→AC01/13/17→render→AC14→AC16→AC10/11→AC15→AC03 | **23 tests pass**（2 files） |
| `security` | `tests/security/**/*.security.test.ts` | 同上 | 未認証 401 / mfa_required、誤パスワード同一応答、CSRF/Origin 403、no-store、ログアウト後 401、AC18 越境 404（案件/文書/証拠/監査/検索/export/file/job）、barrier、AC12 上限 422 と宛先別 snapshot、DOCM/偽 MIME 415、ZIP bomb + forbidden 14 種の位置付き拒否、AC06 スキーマ 422、XML/JS 注入のエスケープ、サンプル書式の正式出力拒否、staff 公開拒否、本人宛て確認、AC02 同姓同名 | **19 tests pass** |
| `unicode` | `tests/unicode/**/*.unicode.test.ts` + `python3 -I tests/fixtures/normalization_reference.py --check` | 同上 | 60 fixture の検索キー（production と Python reference の双方）、ICU 版記録、API 往復でコードポイント不変、unicode_fixture.txt byte 往復、表記ゆれ/原文一致検索の区別、canonical hash、和暦/証拠番号 | **6 tests pass** + Python `PASS` |
| `templates` | `tests/templates/**/*.templates.test.ts` | DB 不要、LibreOffice/Python 必要、直列 | 20 書式 × (inspector OK + スキーマ整合 + 架空サンプルで DOCX 生成 + 未置換タグなし + PDF 変換 + フォント埋込(NotoSerifJP/NotoSansJP) + text extraction 往復) + split_run_tags/長い氏名/行ループ + 未置換タグ失敗 + forbidden 15 種 + zip_bomb/fake_mime | **44 tests pass** |
| `export` | `tests/export/**/*.export.test.ts` | 同上（DB） | CSV 取込（UTF-8 BOM、引用符内改行、CP932 strict、不正バイト、式注入拒否と全体停止、external_id 競合、未登録参照）、export（contacts CSV+JSON、CP932 不可時の拒否、matter_json ZIP の manifest/hash、full_backup は admin のみ、evidence/audit CSV）、backup.mjs→restore.mjs（空 DB 復元 + hash/ACL 行数一致） | **10 tests pass** |
| `test:e2e`（Playwright） | `tests/e2e/*.e2e.ts` | `npm run dev` と seed 済み DB が必要。desktop(1280×900) と mobile-390（iPhone 13 エミュレーション） | PWA manifest/sw/no-store、ログイン→MFA→/create→ウィザード→自動差込→本文→プレビュー→形式検査、ログアウト後の bfcache 復帰 | 本文末尾「e2e 結果」参照 |

`npm test` は `unit` のみ。`npm run test:all` は unit → unicode → templates → export → security → db を順に実行する（DB 系 project はそれぞれ raylow_test を作り直すため並列実行しない）。

## 2. 実行コマンドと期待結果

| コマンド | 期待結果（実測） |
|---|---|
| `npm run typecheck` | `tsc -b tsconfig.build.json` 成功（0 errors） |
| `npm run lint` | ESLint 0 errors |
| `npm test` | 7 files / 39 tests pass。DB・LibreOffice・Python 不要 |
| `npm run test:unicode` | 6 tests pass + `cases: 60 failures: 0 -> PASS` |
| `npm run test:db` / `test:security` / `test:export` | 23 / 19 / 10 tests pass（各 20〜60 秒、LibreOffice を使う） |
| `npm run test:templates` | 44 tests pass（約 1〜2 分） |
| `npm run test:e2e` | 「e2e 結果」参照 |
| `node scripts/smoke.mjs [lawyerA]` | api/worker 起動済みで `SMOKE OK`。`.data/smoke/T01_draft.{docx,pdf}` を生成し、未承認の `mode=final` が 409 |
| `python3 -I tests/fixtures/build_fixtures.py --check` / `python3 -I scripts/build_demo_templates.py --check` | 差分なし（冪等） |

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

## 6. e2e 結果（2026-10-06）

| テスト | desktop-chromium | mobile-390 |
|---|---|---|
| manifest と service worker が配信され、API は cache されない（AC23/PWA） | pass | pass |
| ログイン→MFA→/create→案件→書式→宛先→自動差込→本文→PDF プレビュー→形式検査（AC01/AC22 相当/AC30） | pass（login→preview→check 12.4 秒、PDF 生成 job 含む） | pass（12.3 秒） |
| ログアウト後に bfcache 復帰しても機密画面を表示しない（AC23） | pass | pass |

6 passed / 0 failed（約 40 秒）。実機 iPhone ではなく Chromium 141 の 390×844 エミュレーション。

## 7. 推奨する追加順序

1. `tests/security`: 認可・ハッシュ・ファイル拒否は fixture と API だけで検証でき、脅威モデルの残余リスク（export ダウンロードの本人確認、RLS と API の差）を回帰テスト化できる。
2. `tests/db`: RLS と トリガ（特に `file_versions_immutable` と `scan.ts` の衝突）。
3. `tests/templates`: 20 書式の render と `forbidden/*` の個別拒否。
4. `tests/export`: CSV 往復と `restore.mjs`。
5. `tests/unicode`: vitest 側の往復テスト（現状 include 対象 0 件）。
6. `tests/e2e/playwright.config.ts` の追加と IME/bfcache シナリオ。
