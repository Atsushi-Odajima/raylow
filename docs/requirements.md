# RayLaw v2 要件一覧（Phase0）

出典は `docs/spec/01_claude_code_prompt.txt` の章番号（§）。実装状態はコード現状を読んで判定した。

- **実装済**: コード上に該当する実装があり、ローカルでの動作確認（smoke / 単体テスト）も確認できたもの
- **一部**: 要件の一部のみ実装、または緩和・代替実装
- **未実装**: 該当コードなし
- **未検証**: コードはあるが、この開発コンテナでは動作確認できない（GoTrue / clamd / Tesseract / iPhone 実機 / Docker など）

実装箇所はリポジトリ相対パス。

## §1 目的・対象・主軸

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-001 | 自事務所・弁護士・相手方代理人・案件を登録し、書式に差込→本文編集→弁護士確認→Word/PDF 出力 | §1 | 実装済 | `apps/api/src/routes/{masters,matters,drafts,reviews}.ts`, `apps/worker/src/jobs/render.ts`, `scripts/smoke.mjs`（T01 の縦断を実行し `.data/smoke/T01_draft.{docx,pdf}` を生成） |
| R-002 | 対象ブラウザ Windows 11 Edge/Chrome、iPhone Safari/PWA、20 同時利用 | §1 | 未検証 | 同時利用・実機は未計測。PWA は `apps/web/public/{manifest.webmanifest,sw.js}` |
| R-003 | 既存 Word 書式の再利用、再入力削減、関連書類一括作成、未入力・不一致検出、Word 追編集 | §1 | 実装済 | `apps/api/src/routes/templates.ts`（取込）, `apps/api/src/services/drafts.ts`（差込・preflight）, `apps/api/src/routes/batches.ts`, `apps/api/src/routes/drafts.ts`（external-edit） |
| R-004 | 「名前だけで完成」は登録済み情報が揃う場合に限定。人物名から案件・受任範囲・法的回答を推測しない | §1 | 実装済 | `apps/api/src/services/drafts.ts` `resolveSourceValue`（ID で解決した行からのみ差込。氏名一致で置換しない） |
| R-005 | 法律判断を自動確定する生成 AI アプリにしない（外部 LLM 送信なし） | §1, §2 | 実装済 | 外部 LLM 呼び出しコードなし（`grep` で確認）。`legalJudgement:true` 項目に既定値を置かない `packages/template-schema/src/validate.ts` |

## §2 販売版の機能と範囲

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-010 | 事務所/弁護士/相手先登録 | §2 | 実装済 | `apps/api/src/routes/masters.ts` |
| R-011 | 案件基本情報・案件 ACL（member / barrier） | §2 | 実装済 | `apps/api/src/routes/matters.ts`, `supabase/migrations/20261006000003_functions_triggers.sql`（`app.can_access_matter`） |
| R-012 | 書式カタログ・独自 DOCX 書式登録・差込フィールド設定 | §2 | 実装済 | `apps/api/src/routes/templates.ts`, `apps/worker/src/jobs/inspect.ts`, `workers/documents/inspect_docx.py` |
| R-013 | 文例管理（版・承認） | §2 | 実装済 | `apps/api/src/routes/templates.ts`（`/api/phrases*`） |
| R-014 | 20 書式群 | §2, §4 | 一部 | `templates/demo/T01..T20`（架空デモ、sample_only、監修なし）。所内承認版は未作成 |
| R-015 | 文書作成ウィザード | §2 | 実装済 | `apps/web/src/pages/{DraftNewPage,DraftEditPage,DraftCheckPage}.tsx` |
| R-016 | 複数文書/複数宛先生成 | §2 | 実装済 | `apps/api/src/routes/batches.ts` |
| R-017 | レビュー | §2 | 実装済 | `apps/api/src/routes/reviews.ts` |
| R-018 | DOCX/PDF 出力 | §2 | 実装済 | `apps/worker/src/render/{docx,pdf}.ts` |
| R-019 | 訴訟準備パック | §2 | 実装済 | `apps/api/src/routes/packets.ts`, `apps/worker/src/jobs/packet.ts` |
| R-020 | 証拠台帳 | §2 | 実装済 | `apps/api/src/routes/evidence.ts` |
| R-021 | 原資料保存/参照 | §2 | 一部 | 保存・scan・派生安全版は `apps/api/src/routes/files.ts`, `apps/worker/src/jobs/scan.ts`。`source_refs` テーブルはあるが API 経路なし |
| R-022 | 版管理 | §2 | 実装済 | `draft_revisions` / `template_versions` / `office_profiles.revision` / `contact_versions` |
| R-023 | 送付/提出記録 | §2 | 実装済 | `apps/api/src/routes/packets.ts`（`/api/dispatch-records*`） |
| R-024 | 検索 | §2 | 実装済 | `apps/api/src/routes/misc.ts`（`/api/search`）, `packages/japanese-text/src/searchKey.ts` |
| R-025 | CSV 移行 | §2, §12 | 実装済 | `apps/api/src/routes/exports.ts`, `apps/api/src/services/csvImport.ts` |
| R-026 | 監査 | §2 | 実装済 | `apps/api/src/services/audit.ts`, `audit_events` append-only trigger |
| R-027 | バックアップ | §2 | 一部 | `scripts/backup.mjs`（pg_dump + blobs）、`scripts/restore.mjs`、export `full_backup`。暗号化・日次スケジュールは運用側（未実装） |
| R-028 | iPhone PWA | §2 | 未検証 | `apps/web/public/manifest.webmanifest`, `apps/web/public/sw.js`。実機未検証 |
| R-029 | 依頼者ポータル・稼働/実費・相反調査・時系列分析・期限通知を初回販売版から外す。disabled メニューを並べない | §2 | 実装済 | `apps/web/src/App.tsx` に該当ルートなし |
| R-030 | 実装しない事項（法律判断自動決定、法定期限計算、判例 DB、電子署名、裁判所自動提出、自動メール/FAX、広告 SDK、WYSIWYG、リアルタイム共同編集、縦書き新規作成） | §2 | 実装済 | 該当機能なし。`workers/documents/inspect_docx.py` は縦書きセクションを拒否 |
| R-031 | 相手方本人宛てを選べ、代理人がいる場合は確認を求める（可否は判定しない） | §2 | 実装済 | `apps/api/src/routes/drafts.ts`（`confirmDirectToOpponent` 無しは 422）, `apps/api/src/services/drafts.ts`（preflight `direct_to_represented_opponent`） |

## §3 主な利用シナリオ

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-040 | UC01 事務所・弁護士・代理人・案件・当事者・受任範囲の登録 | §3 | 実装済 | `apps/api/src/routes/{masters,matters}.ts`, `apps/web/src/pages/{SetupPage,MattersPage,MatterDetailPage,ContactsPage}.tsx` |
| R-041 | UC02 受任通知: 代理人名入力→所属確認→日付確認→プレビュー→レビュー→出力。再入力不要 | §3 | 実装済 | `scripts/smoke.mjs` で確認（自動差込、draft 出力）。正式出力は承認後 |
| R-042 | UC03 回答書と答弁書を別種類とし、回答方針に既定を入れない | §3, §4 | 実装済 | `templates/demo/T02_reply_letter`, `T13_answer`（`legalJudgement:true`） |
| R-043 | UC04 提訴準備セット一括生成→検査→レビュー→ZIP→提出記録 | §3 | 実装済 | `apps/api/src/routes/{batches,packets}.ts`, `apps/worker/src/jobs/packet.ts` |
| R-044 | UC05 DOCX アップロード→検査→タグ対応→架空データ試作→承認→公開 | §3 | 実装済 | `apps/api/src/routes/templates.ts`（import / schema / test / publish） |
| R-045 | UC06 マスター変更時に未確定文書へ更新候補を表示し、確定版は変化しない | §3 | 実装済 | `apps/api/src/routes/drafts.ts`（refresh-candidates / apply-candidates）, `apps/api/src/routes/masters.ts`（office は新 revision を作成） |

## §4 20 書式群と入力仕様

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-050 | 全書式共通項目（案件 ID、書式版、発行日、自事務所/担当弁護士、当事者、宛先、件名、本文、添付） | §4 | 実装済 | `packages/template-schema/src/tags.ts` `COMMON_TAG_KEYS`, `renderData.ts`（`document_status_label` / `template_version_label` / `issue_date*` をシステム供給） |
| R-051 | 敬称を所内設定（先生/様/御中）から選択し二重敬称を検出。値を黙って変更しない | §4 | 実装済 | `office_profiles.honorific_settings`, `apps/api/src/services/drafts.ts` `honorificFor`, `packages/template-schema/src/validate.ts`（`double_honorific` 警告） |
| R-052 | T01 受任通知: 受任確認済みが正式版の条件 | §4 | 実装済 | `apps/api/src/routes/reviews.ts`（`acceptance_status !== 'confirmed'` で 422） |
| R-053 | T02 回答方針に既定の認諾等を入れない | §4 | 実装済 | `templates/demo/T02_reply_letter/schema.json`（`reply_policy` legalJudgement） |
| R-054 | T05 利息・時効を自動算定しない、T12 訴額・印紙額は人が入力 | §4 | 実装済 | 自動算定コードなし（`templates/demo/README.md`） |
| R-055 | T11 特別授権は既定 OFF、弁護士確認必須 | §4 | 実装済 | `templates/demo/T11_power_of_attorney_litigation/schema.json`（`auth_*` legalJudgement） |
| R-056 | T13 認否は段落単位で選べるが自動選択しない | §4 | 実装済 | `templates/demo/T13_answer/schema.json`（`admissions`） |
| R-057 | T14 書面番号は案件内で衝突検査 | §4 | 実装済 | `apps/api/src/services/draftDetail.ts` `buildPreflight`（`brief_number_conflict`） |
| R-058 | T16/T17 は同一スキーマにしない | §4 | 実装済 | `templates/demo/T16_*/schema.json`（`evidence_rows`）と `T17_*/schema.json`（`electronic_evidence_rows`） |
| R-059 | T18 選択手続/裁判所への適用を確認 | §4 | 実装済 | `templates/demo/T18_*`（`applicability_confirmed`） |
| R-060 | 20 種すべてに定義・入力フォーム・架空デモ DOCX・出力経路・fixture | §4 | 一部 | `templates/demo/*`（schema / docx / sample_values / ast_sample）。`tests/templates/` の自動試験は未作成（docs/testing.md） |
| R-061 | 初期書式は sample_only、草案に「サンプル・要確認」表示、弁護士承認後に正式利用 | §4 | 実装済 | `template_versions.sample_only`, `apps/worker/src/jobs/render.ts` `statusLabel`, `apps/api/src/routes/templates.ts`（publish `sampleOnly:false` は active lawyer のみ） |
| R-062 | 承認者名をコードに固定しない | §4 | 実装済 | publish は `actor.userId` を `approved_by` に記録 |
| R-063 | 裁判所公開書式使用時は出典・適用範囲・確認日・利用条件を記録 | §4 | 実装済 | `template_versions.{source_url,checked_at,license_note,applicability,provenance}`。デモは公開書式を使用していない |

## §5 テンプレートエンジン

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-070 | Docxtemplater OSS core + PizZip、PDF は別の LibreOffice headless | §5.1 | 実装済 | `apps/worker/src/render/docx.ts`（docxtemplater 3.71.0 / pizzip 3.3.0）, `render/pdf.ts` |
| R-071 | ライセンス・版の確認と lockfile 固定、有料 module を導入しない | §5.1 | 一部 | `package-lock.json`, `.npmrc save-exact`, `docs/sbom/`（`scripts/sbom.mjs`）。`SOURCE_NOTES.txt` は未作成 |
| R-072 | 新規デモ DOCX は python-docx | §5.1 | 実装済 | `scripts/build_demo_templates.py` |
| R-073 | DOCX + schema.json + provenance.json を一組にし DB へ版固定 | §5.1 | 実装済 | `template_versions.{docx_file_id,docx_sha256,field_schema,provenance}` |
| R-074 | 任意式・JS 実行・eval・raw XML 挿入禁止 | §5.1 | 実装済 | `render/docx.ts` parser を固定（allowlist キーのみ）、`inspect_docx.py` `expression_not_allowed` |
| R-075 | タグは ASCII allowlist、`{#loop}`/`{/loop}`/条件、dot 探索不許可、`__proto__`/`constructor`/`prototype` 拒否 | §5.1 | 実装済 | `packages/template-schema/src/tags.ts`（`TAG_KEY_RE`, `DANGEROUS_KEYS`）, `inspect_docx.py` `parse_tag_body` |
| R-076 | 文字列は XML escape、改行は linebreaks 設定で処理 | §5.1 | 実装済 | docxtemplater 既定 escape + `linebreaks: true`（`render/docx.ts`） |
| R-077 | 差込値は plain text。本文はアプリ AST を renderer で段落群へ変換 | §5.1, §6 | 実装済 | `packages/template-schema/src/{ast,renderData}.ts`（`body_blocks` ループ） |
| R-078 | 汎用リッチエディタを作らない。署名画像挿入は対象外、既存ロゴ画像は保持 | §5.1 | 実装済 | `apps/web/src/components/BlockEditor.tsx`（限定 AST、textarea ベース）。`inspect_docx.py` は埋込画像を info として保持 |
| R-079 | 本文・段落・表・ヘッダー/フッターのタグ、単一セクション A4 横書き | §5.2 | 実装済 | `inspect_docx.py`（document/header/footer を走査、`multiple_sections`/`vertical_text` 拒否、A4 以外は警告） |
| R-080 | 表は単純行繰返し。繰返し行を跨ぐ縦結合は拒否 | §5.2 | 実装済 | `inspect_docx.py` `vmerge_in_loop` |
| R-081 | ZIP/XML 構造検査。run 分割タグを処理。単純文字列置換で実装しない | §5.2 | 実装済 | `inspect_docx.py` `paragraph_text`（run 連結）, docxtemplater（run 跨ぎ対応）, fixture `tests/fixtures/docx/split_run_tags.docx` |
| R-082 | 段落跨ぎタグ / 不均衡 loop を登録時に位置付きエラー | §5.2 | 実装済 | `inspect_docx.py` `paragraph_spanning_tag`, `unbalanced_loop`（location = part/p番号） |
| R-083 | 変更履歴/コメント/テキストボックス/OLE/外部 relationship/マクロ/脚注/複数セクション/複雑フィールドを検出し拒否、修正手順表示、元ファイル不変 | §5.2 | 実装済 | `inspect_docx.py`（各 code と `HINT_COPY`）, `workers/documents/check_file.py`, fixture `tests/fixtures/docx/forbidden/*` |
| R-084 | 静的ページ番号フィールド（PAGE）は allowlist | §5.2 | 実装済 | `inspect_docx.py` `ALLOWED_FIELD_INSTR`（PAGE/NUMPAGES/SECTIONPAGES） |
| R-085 | タグ挿入は Word で行う。最小導線「登録→タグ対応→テスト出力→公開」 | §5.2 | 実装済 | `apps/api/src/routes/templates.ts`, `apps/web/src/pages/{TemplateImportPage,TemplateVersionPage}.tsx` |
| R-086 | 長い氏名で段落が伸びても自動縮小/省略しない。警告→新書式版 | §5.2 | 一部 | preflight `layout_overflow_candidate`（40 文字超の単純ヒューリスティック）, `max_graphemes_exceeded` 警告。実際の段落伸長の検出は未実装 |
| R-087 | FieldSpec={key,type,label,source,required,defaultPolicy,maxGraphemes,options,visibilityRule,validationRules,outputFormat} | §5.3 | 実装済 | `packages/template-schema/src/fieldSpec.ts` |
| R-088 | type=text/multiline/date/enum/boolean/personRef/partyRef/money/array、source=office/matter/recipient/input | §5.3 | 実装済 | 同上（`FieldTypeSchema`, `FieldSourceSchema`） |
| R-089 | 必須欠落・非表示条件と必須条件の循環・未定義タグを登録時検査 | §5.3 | 実装済 | `packages/template-schema/src/validate.ts`（`rule_cycle`, `undefined_tag`, `required_missing`） |
| R-090 | 条件 DSL は eq/in/isPresent/and/or/not、深さ 5、項数 100 | §5.3 | 実装済 | `packages/template-schema/src/condition.ts` |
| R-091 | 金額は JPY 整数 decimal string + raw、日付は raw + ISO + precision | §5.3 | 実装済 | `packages/japanese-text/src/{numeric,era}.ts`, `renderData.ts` |
| R-092 | 依頼者/相手方/代理人は別 field、氏名一致だけで置換しない | §5.3 | 実装済 | `apps/api/src/services/drafts.ts`（`matter.client_name` / `matter.opponent_name` / `recipient.*` を別経路で解決） |
| R-093 | TemplateVersion の属性一式、status=draft/testing/published/retired、published は immutable、sample_only は正式利用不可 | §5.3 | 実装済 | `supabase/migrations/20261006000002_core_tables.sql`, `..003`（`tg_template_version_immutable`）, `packages/domain/src/states.ts` |
| R-094 | Word 書式はデータであり命令ではない。文書内の外部命令・URL を実行しない | §5.3 | 実装済 | `render/pdf.ts`（`no_proxy=*`、固定 fontconfig）, `inspect_docx.py`（外部 rel 拒否、hyperlink は警告） |

## §6 差込・本文・一括生成の不変条件

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-100 | 選択時に事務所・案件・宛先・書式・文例の版を snapshot | §6 | 実装済 | `DraftSnapshotSchema.sources`（`packages/contracts/src/drafts.ts`）, `apps/api/src/routes/drafts.ts` |
| R-101 | 氏名検索は所属と住所を併記、同姓同名は必ず選択、代理する側を確認 | §6 | 実装済 | `apps/api/src/routes/masters.ts`（contacts 検索）, `apps/web/src/components/ContactPicker.tsx`, seed に同姓同名 2 名 |
| R-102 | field 値は {rawValue,displayValue,sourceId,sourceVersion,manuallyOverridden} | §6 | 実装済 | `packages/template-schema/src/validate.ts` `FieldValue` |
| R-103 | 元データ更新で草案を黙って変更しない。更新候補から差分採用。手入力上書きは保持 | §6 | 実装済 | `apps/api/src/services/drafts.ts` `computeRefreshCandidates`, routes `apply-candidates`（fieldKeys 選択制） |
| R-104 | DocumentAST={schemaVersion:1,blocks:[heading\|paragraph\|numberedParagraph\|evidenceRef]}、stable ID、全角番号文字列維持 | §6 | 実装済 | `packages/template-schema/src/ast.ts`, `validateUniqueBlockIds` |
| R-105 | 引用参照は documentVersionId/page/rect/textVersionId で固定 | §6 | 一部 | `EvidenceRefBlockSchema.sourceRef` にスキーマあり。`source_refs` テーブルあり。UI/API での引用作成は未実装 |
| R-106 | Word 追編集後の再取込は新しい外部編集版。自動双方向同期しない。再アップロード→scan→新 PDF→再レビュー | §6 | 実装済 | `apps/api/src/routes/drafts.ts`（`external-edit`）, `apps/worker/src/jobs/externalEdit.ts` |
| R-107 | Batch は 1 案件・最大 20 書式×50 宛先・合計 100。超過は 422 | §6 | 実装済 | `packages/domain/src/limits.ts`, `apps/api/src/routes/batches.ts`（`batch_limit_exceeded`） |
| R-108 | 宛先ごとに独立 snapshot、他宛先を差し込まない | §6 | 実装済 | `apps/api/src/routes/batches.ts` `createItemDraft` |
| R-109 | 一括ジョブは子ジョブ単位、部分成功と失敗を表示、失敗分だけ再試行 | §6 | 実装済 | `batch_items`, `/api/batch-items/:id/retry`, `apps/worker/src/worker.ts` `finalizeBatches` |
| R-110 | 全件完成が必要な正式提出パックは欠落があれば出力不可、草案単品は成功分取得可 | §6 | 実装済 | `apps/api/src/routes/packets.ts`（`checkPacket` blocking → 422） |
| R-111 | Draft 状態 draft→rendering→ready_for_review→in_review→changes_requested/approved→superseded/archived | §6 | 一部 | `packages/domain/src/states.ts`。`superseded` へ遷移させるコードは無い（docs/state-transitions.md） |
| R-112 | 編集・宛先変更・書式変更・外部編集版追加で承認失効。確定済み bytes は上書きしない | §6 | 実装済 | `apps/api/src/routes/drafts.ts` `setCurrentRevision`（approved→draft、review withdrawn）, `tg_draft_outputs_guard`, `LocalFsBlobStore.put` の `wx` フラグ |
| R-113 | 下書き DOCX と正式 DOCX/PDF は別エンドポイント、下書きに草案表記、正式は承認済 hash 一致のみ | §6 | 実装済 | `GET /api/outputs/:id/download?mode=draft\|final`, `render/docx.ts` 草案段落挿入 |
| R-114 | ダウンロード成功だけで送付/提出済みにしない | §6 | 実装済 | 送付記録は `POST /api/dispatch-records` の手動登録のみ。download 監査に注記 |

## §7 レビュー・訴訟準備パック

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-120 | Preflight (a)必須 (b)人物/事件番号不一致 (c)未置換タグ (d)未承認書式 (e)証拠重複/参照切れ (f)フォント欠落 (g)頁・添付・用紙 (h)宛先混入 (i)内部コメント/metadata | §7 | 一部 | `apps/api/src/services/drafts.ts` `computePreflight`。(b) は事件番号のみ、(g) は頁数表示のみ、(h) は相手方本人宛て確認のみ |
| R-121 | エラーは正式出力を停止。要確認項目は理由付き確認 | §7 | 実装済 | `request-review` と `decision` で `blocking` → 422、`confirmationsRequired` と `confirmations[].reason` |
| R-122 | 形式検査と法的審査を別表示。「法的問題なし」と総合判定しない | §7 | 実装済 | `PreflightReportSchema.legalReviewNote`, `kind:'formal'` |
| R-123 | 最終承認は割当 lawyer のみ。最終編集者とは別の弁護士。staff は編集可・承認不可 | §7 | 実装済 | `packages/domain/src/acl.ts` `checkApproval`, `apps/api/src/routes/reviews.ts` |
| R-124 | 弁護士 2 名以上の運用前提を明記 | §7, §20.1 | 実装済 | `apps/web/src/pages/SetupPage.tsx`, `DraftCheckPage.tsx`（2 名未満警告）, `/api/settings` `minLawyersForApproval:2` |
| R-125 | 承認対象 = AST/入力 snapshot/書式 hash/出力 DOCX/PDF hash/添付 manifest/rendererProfile。transaction 内で再検証、古い版は 409 | §7 | 一部 | revision hash（snapshot+ast+templateVersionId）と PDF sha を再検証、書式 docx_sha256 を監査に記録。DOCX sha は `reviews.target_output_docx_sha256` に保存するが決定時に再照合しない |
| R-126 | 提出パック: 書面 PDF/DOCX + 証拠派生 PDF + manifest.json + 確認一覧.txt を安全な連番名で ZIP | §7 | 実装済 | `apps/worker/src/jobs/packet.ts` |
| R-127 | 内部監査・原本・所内メモを初期選択しない。機密資料の外部出力可否を資料ごとに確認 | §7 | 実装済 | `packet_items.external_output_confirmed`, `checkPacket` `confidential_not_confirmed` |
| R-128 | 裁判所 profile={id,version,name,sourceUrl,checkedAt,applicableProcedure,fileRules,pageRules,namingRules}。初期 generic。mints 完全対応と表示しない | §7 | 実装済 | `court_profiles`, `supabase/migrations/20261006000006_static_seed.sql` |
| R-129 | 提出/送付記録は manual。他担当者が確認し received_verified へ。アプリは外部送信しない | §7 | 実装済 | `apps/api/src/routes/packets.ts`（verify は記録者以外） |

## §9 技術構成・API・保存

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-140 | React/TypeScript strict/Vite/React Router/TanStack Query/Zod、独自 CSS tokens | §9 | 実装済 | `apps/web/package.json`, `apps/web/src/styles/tokens.css` |
| R-141 | エディタは ProseMirror/Tiptap OSS core で限定 AST | §9 | 一部 | `apps/web/src/components/BlockEditor.tsx` は textarea ベースの独自実装（Tiptap 不使用と明記） |
| R-142 | PDF.js でサーバー生成 PDF 表示。端末で DOCX/PDF を描画しない | §9 | 実装済 | `apps/web/src/components/PdfPreview.tsx`（pdfjs-dist） |
| R-143 | Fastify BFF | §9 | 実装済 | `apps/api/src/app.ts` |
| R-144 | Supabase Auth | §9 | 未検証 | `apps/api/src/auth/provider.ts` `authenticateSupabase`（GoTrue password grant）。開発コンテナで GoTrue 未起動。既定は `AUTH_PROVIDER=local`（`private.local_credentials` scrypt） |
| R-145 | Postgres / private Storage | §9 | 一部 | Postgres 実装済。Storage は `BLOB_STORE=local`（`.data/blobs`）で動作、`supabase` 実装（`SupabaseBlobStore`）は未検証 |
| R-146 | Node render worker、Python 文書検査 worker、LibreOffice | §9 | 実装済 | `apps/worker/src/**`, `workers/documents/*.py`, `render/pdf.ts` |
| R-147 | ClamAV | §9, §20.3 | 未検証 | `apps/worker/src/jobs/scan.ts` `clamdScan`（INSTREAM）。clamd 無しは fail closed |
| R-148 | OCR は Tesseract ローカル | §9, §20.3 | 未実装 | `file_versions.kind` に `ocr_text` 値はあるが処理コードなし（`workers/documents/README.md`） |
| R-149 | monorepo 構成（apps/web, apps/api, apps/worker, workers/documents, packages/*, supabase/migrations, templates/demo, tests/fixtures, docs, assets） | §9 | 実装済 | リポジトリ構成 |
| R-150 | 依存版を lock、SOURCE_NOTES.txt に URL/確認日/採用版/ライセンス | §9 | 一部 | `package-lock.json`, `docs/sbom/`。`SOURCE_NOTES.txt` 未作成 |
| R-151 | .env.example に値を入れない | §9 | 実装済 | `.env.example` |
| R-152 | API 共通 {data,meta:{requestId}} / error={code,message,fieldErrors,requestId} | §9 | 実装済 | `apps/api/src/lib/reply.ts`, `apps/api/src/app.ts` setErrorHandler, `packages/contracts/src/common.ts` |
| R-153 | 認証 cookie + CSRF/Origin 検査 | §9, §20.2 | 実装済 | `apps/api/src/plugins/auth.ts` |
| R-154 | GET 一覧は cursor/limit<=100。ACL 適用後に件数と候補 | §9 | 実装済 | `CursorQuerySchema`, 各 routes の `decodeCursor`、RLS 下で SELECT |
| R-155 | 列挙された API 経路一式 | §9 | 実装済 | `docs/API.md`, `apps/api/src/routes/*.ts`（`PUT /api/template-versions/:id/schema` 等すべて存在） |
| R-156 | 状態遷移/権限は server で再検証、client の role/actorId を信頼しない | §9 | 実装済 | `apps/api/src/db/pool.ts` `withUserTx`（session から actor 決定）, `packages/domain/src/states.ts` |
| R-157 | HTTP 401/403/404/409/413/415/422/429 の使い分け、stacktrace を返さない | §9 | 実装済 | `apps/api/src/errors.ts`, `app.ts` |
| R-158 | job claim=FOR UPDATE SKIP LOCKED、lease 120 秒/heartbeat 30 秒、最大 3 回、30/120 秒再試行、3 回で failed | §9 | 実装済 | `app.claim_job` / `app.heartbeat_job` / `app.requeue_expired_jobs`（migration 003）, `apps/worker/src/worker.ts`, `packages/domain/src/limits.ts` |
| R-159 | retry 可能は timeout 等のみ。書式エラーは自動再試行せず修正導線 | §9 | 実装済 | `JobFailure.retryable`, `apps/api/src/routes/jobs.ts` `RETRYABLE` / `fixLink` |
| R-160 | input_hash + operation + scope で重複生成を防ぐ | §9 | 実装済 | `jobs_dedupe_uq`（migration 002）, `apps/api/src/services/jobs.ts` |
| R-161 | ブラウザはサーバー正本。700ms debounce autosave、未保存表示、通信断時の離脱警告 | §9 | 実装済 | `apps/web/src/hooks/useAutosave.ts`, `apps/web/src/lib/unsaved.ts`, `components/SaveStatus.tsx` |
| R-162 | 機密データを IndexedDB/localStorage に永続保存しない | §9, §20.2 | 実装済 | `apps/web/src/lib/session.ts`（メモリのみ）。localStorage はタブ選択の記憶のみ（`DraftEditPage.tsx`） |
| R-163 | edit lease 90 秒/30 秒 heartbeat、強制引継ぎに理由、本文の同時編集なし | §9 | 実装済 | `apps/api/src/routes/drafts.ts`（lease）, `apps/web/src/hooks/useEditLease.ts` |

## §10 UI 数値・新ブランド

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-170 | 配色トークン（背景 #F3F0F5、primary #59385F、本文 #302936 等） | §10 | 一部 | `apps/web/src/styles/tokens.css`, `assets/design_tokens.json`。全値の一致・コントラスト（AC25）は未検証 |
| R-171 | Noto Sans JP / Noto Serif JP / Bricolage Grotesque を同梱、CDN 不使用 | §10, §14 | 実装済 | `assets/fonts/*`, `assets/licenses/*`, `apps/web/public/fonts` |
| R-172 | breakpoint/spacing/サイズ規定、320px 対応、タッチ 44px | §10 | 未検証 | `apps/web/src/styles/*.css`。実機・幅別の表示確認は未実施 |
| R-173 | loading/empty/success/warning/error の表現規定、色だけで状態を示さない | §10 | 未検証 | `apps/web/src/components/{States,Alert,JobProgress}.tsx` |
| R-174 | 旧配色・KPI カード・3 カラム・ガラス表現を使わない | §10 | 実装済 | `apps/web/src/pages/CreatePage.tsx`（/create 入口）。該当表現なし |

## §11 主要画面・導線

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-180 | S01–S20 の画面とルート（/create, /setup, /templates, /drafts/new, /drafts/:id/edit, /drafts/:id/check, /reviews/:id, /documents, /documents/:id/output, /templates/import, /templates/:id/versions/:v, /phrases, /batches, /matters, /contacts, /matters/:id/evidence, /packets, /dispatches/:id, /jobs/:id, /settings, /audit） | §11 | 実装済 | `apps/web/src/App.tsx`, `apps/web/src/pages/*.tsx` |
| R-181 | 認証切れは再ログイン後に権限再確認、未保存状態を説明 | §11 | 実装済 | `apps/web/src/lib/session.ts`, `components/SessionDialogs.tsx`, `pages/AuthExpiredPage.tsx` |
| R-182 | 422 は入力項目へ戻し値保持、409 は版対比から再読込/別版、job 失敗は job 画面 | §11 | 一部 | `components/VersionConflictDialog.tsx`, `pages/JobPage.tsx`, `lib/apiClient.ts`。全画面での一貫性は未検証 |
| R-183 | 権限なしはデータ存在を漏らさず戻る | §11 | 実装済 | `apps/api/src/errors.ts` `notFound`（403/404 同一文言）, `apps/web/src/lib/apiClient.ts` `isNotFoundOrForbidden` |
| R-184 | nav は「作成・書類・案件・書式」 | §11 | 未検証 | `apps/web/src/layout/AppShell.tsx` |

## §12 インポート・エクスポート

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-190 | 連絡先 CSV 列 external_id,type,name_raw,kana,organization_name_raw,address_raw,postcode_raw,phone_raw,email_raw | §12 | 実装済 | `apps/api/src/services/csvImport.ts` `IMPORT_COLUMNS` |
| R-191 | 案件 CSV / 関係当事者 CSV（matter_external_id,contact_external_id,role）。人物を名前だけで結合しない | §12 | 実装済 | 同上、`validateImportRows`（`unknown_reference`） |
| R-192 | UTF-8 BOM 有無 / CP932 選択、20 行 preview、全行検査後 transaction commit | §12 | 実装済 | `decodeCsvStrict`, `POST /api/imports/preview`（`previewRows` 20）, `POST /api/imports/commit` |
| R-193 | RFC4180（引用符内カンマ/改行） | §12 | 実装済 | `csv-parse`（`parseCsvRows`） |
| R-194 | encoding 失敗は置換せずエラー | §12 | 実装済 | `decodeCsvStrict`（`TextDecoder fatal`、CP932 は round-trip 確認） |
| R-195 | 1 行のエラーで batch 全体停止、同一 external_id 異内容は競合、未登録外部 ID 参照も停止 | §12 | 実装済 | `validateImportRows`、commit 直前の再検査 |
| R-196 | export: DOCX/PDF、証拠台帳 CSV、監査 CSV、案件 JSON+添付 ZIP、全量バックアップ | §12 | 実装済 | `apps/worker/src/jobs/export.ts`（contacts_csv/matters_csv/evidence_csv/audit_csv/matter_json/full_backup） |
| R-197 | schemaVersion=2、原文・関係 ID・hash を含む。復元は空環境限定 | §12 | 一部 | `export.ts`（schemaVersion 2, checksums.sha256）。export ZIP（data.json）からの復元経路は無く、`scripts/restore.mjs` は `scripts/backup.mjs` の pg_dump 出力を復元する |
| R-198 | CSV 式注入対策、原文完全保存は JSON/TXT | §12 | 一部 | 出力側 `export.ts` `csvSafe`（先頭 `'` 付加）+ contacts は JSON 併載。取込側は `formula_injection` として行を拒否（`csvImport.ts`）。`tests/fixtures/csv/README.md` の期待（取込は原文保存）と相違 |
| R-199 | ZIP 名は安全な連番 + 短い表示名、manifest で対応。パストラバーサル・重複 entry・巨大展開を拒否 | §12 | 実装済 | `apps/worker/src/jobs/packet.ts` `safeEntryName`, `inspect_docx.py` / `check_file.py`（取込 ZIP 検査） |
| R-200 | 添付と DB の片方だけを復元して完了扱いにしない | §12 | 実装済 | `scripts/restore.mjs`（file_versions.sha256 と blob を照合、不一致で exit 1） |

## §13 Windows 11 から iPhone PWA まで

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-210 | Git/Node LTS/Docker Desktop/WSL2/Supabase CLI 導入手順 | §13 | 未実装 | `README.md` は見出しのみ。`README.txt` なし |
| R-211 | Python 文書処理のコンテナ化 | §13 | 未実装 | Dockerfile/compose なし（`infra/` 空） |
| R-212 | PowerShell 手順（clone→npm ci→.env→supabase start→db reset→compose up→npm run dev）と動く scripts/compose | §13 | 一部 | `scripts/db-*.mjs`, `scripts/dev-restart.sh` はあり。`docker compose` 定義と README 手順は未実装 |
| R-213 | web 5173 / api 3001、同一 origin の /api proxy、worker の internal port 非公開 | §13 | 実装済 | `apps/web/vite.config.ts`, `apps/api/src/config.ts`（`API_HOST=127.0.0.1`）。worker は HTTP を listen しない |
| R-214 | seed: 架空事務所 2、lawyerA/B、staff、別案件 barrier、同姓同名代理人、20 書式デモ | §13 | 実装済 | `apps/api/src/seed/run.ts` |
| R-215 | パスワードは初期化時生成、固定本番値を repo に入れない | §13 | 実装済 | seed が `randomToken` で生成し `.data/seed-credentials.json`（.gitignore）へ保存 |
| R-216 | 必須 scripts: dev/build/lint/typecheck/test/test:db/test:e2e/test:unicode/test:templates/test:export/test:security | §13 | 一部 | `package.json` に全て定義。`test:e2e` が参照する `tests/e2e/playwright.config.ts` は存在しない |
| R-217 | README に各 script の期待結果 | §13 | 未実装 | — |
| R-218 | iPhone は HTTPS 配信。同一 origin 配置、Auth redirect、TLS、cookie、常駐 worker | §13 | 未検証 | `COOKIE_SECURE` / `ALLOWED_ORIGINS` 環境変数のみ。配信環境なし |
| R-219 | デプロイ先未指定なら Docker Compose + reverse proxy 構成 | §13 | 未実装 | `scripts/sbom.mjs` に Caddy を列挙するが compose 定義なし |
| R-220 | manifest: name/short_name=RayLaw, start_url=/create, scope=/, standalone, theme #59385F, background #F3F0F5, icons 192/512/maskable, apple-touch-icon 180 | §13 | 実装済 | `apps/web/public/manifest.webmanifest`, `apps/web/index.html` |
| R-221 | iPhone 実機検証（ホーム画面追加→受任通知→PDF/DOCX） | §13 | 未検証 | — |
| R-222 | PWA cache は静的 shell/font/icon のみ。API・原本・出力は network-only/no-store。offline は再接続案内 | §13 | 実装済 | `apps/web/public/sw.js`, `apps/web/public/offline.html`, `apps/api/src/app.ts`（`Cache-Control: no-store`） |
| R-223 | MFA 画面とログアウト後に過去文書を表示しない | §13 | 実装済 | `apps/web/src/api/auth.ts`（`queryClient.clear()`）, `lib/session.ts`（pageshow 再検証） |
| R-224 | SW 更新は編集中に強制 reload せず保存後に適用 | §13 | 実装済 | `apps/web/src/lib/swRegister.ts`（`unsavedRegistry`） |

## §19 全角・日本語・原文保持

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-230 | U01 三層保存: 原本 bytes（immutable/sha256）→ 抽出/転記テキスト版 → 検索キー | §19 | 一部 | bytes: `files`/`file_versions` + `tg_immutable_row`。検索キー: `search_key` 列。テキスト抽出版（`native_text`/`ocr_text`）を生成する処理は未実装 |
| R-231 | DB 本文に NFKC/NFC/trim を一律適用しない。改行・U+3000・半角英数をそのまま保持 | §19 | 実装済 | `RawText`（`packages/contracts/src/common.ts`）。正規化コードなし。`packages/domain/src/domain.test.ts` で全角/ASCII hash 差を確認 |
| R-232 | テキスト添付は元 bytes + encoding 名を保存 | §19 | 実装済 | `apps/worker/src/jobs/scan.ts`（`file_versions.encoding_name`） |
| R-233 | U02 検索は「表記ゆれを含む」既定、「原文一致」切替。一致理由と原文を表示 | §19 | 実装済 | `ContactSearchQuerySchema.mode`, `SearchQuerySchema.mode`, `matchReason` |
| R-234 | 検索キー ver1 規則（全角英数→ASCII、大文字→小文字、全角丸括弧、U+3000、半角カナ区間のみ NFKC）。全文 NFKC 禁止 | §19 | 実装済 | `packages/japanese-text/src/searchKey.ts`, `tests/fixtures/{unicode_cases.json,normalization_reference.py}` |
| R-235 | ①≠1、Ⅰ≠I、㈱≠(株)、髙≠高、﨑≠崎、ダッシュ類、～≠〜、¥≠\ を保持 | §19 | 実装済 | 同上（`searchKey.test.ts`） |
| R-236 | 別名辞書は明示登録。自動名寄せしない。検索キーを唯一キーにしない | §19 | 実装済 | `contact_aliases`, `POST /api/contacts/:id/aliases`, `similarIds` は提案のみ |
| R-237 | ACL で絞ったデータだけ検索・snippet・件数 | §19 | 実装済 | `/api/search` は `withUserTx`（RLS）内で実行 |
| R-238 | offset mapping を保持し、多対一は広くハイライト | §19 | 一部 | `searchKey.ts` `mapKeyRangeToSource`。UI でのハイライト利用は未検証 |
| R-239 | U03 IME 変換中は正規化・保存・submit・ショートカットを走らせない。Enter は isComposing/229 で submit 禁止。確定後 700ms 保存 | §19 | 実装済 | `packages/japanese-text/src/ime.ts`, `apps/web/src/lib/ime.ts`, `components/{Input,TextArea}.tsx`, `hooks/useAutosave.ts` |
| R-240 | 電話・金額・日付は raw と parsed を分離。全角「１２３」は parse 候補のみ | §19 | 実装済 | `packages/japanese-text/src/numeric.ts`（`parseMoneyJpy`, `parseIntegerCandidate`） |
| R-241 | inputMode numeric を本文・事件番号・人名に使わない | §19 | 未検証 | `apps/web/src/components/Input.tsx` |
| R-242 | U04 Intl.Segmenter grapheme。IVS/サロゲート/結合濁点/ZWJ を分割しない。ICU 版記録 | §19 | 実装済 | `packages/japanese-text/src/grapheme.ts`（`icuVersion`）, `grapheme.test.ts` |
| R-243 | 制御文字・bidi・zero width は警告表示、自動削除しない。不可視文字表示モード | §19 | 一部 | `packages/japanese-text/src/invisible.ts`, `BlockEditor.tsx` が `findInvisible` を利用。表示モードの詳細は未検証 |
| R-244 | U05 原文差分（全角/半角/空白/改行/異体字を変更として表示）、表記差を畳む閲覧モード、件数を消さない | §19 | 実装済 | `packages/japanese-text/src/widthDiff.ts`, `apps/web/src/components/DiffView.tsx` |
| R-245 | 承認 hash は原文 AST から、正規化後の hash で承認しない | §19 | 実装済 | `packages/domain/src/canonical.ts`, `apps/api/src/services/drafts.ts` `revisionHash` |
| R-246 | 変換ツールは選択範囲 + 種別、before/after・件数→適用→undo。全体ワンクリック整形なし | §19 | 一部 | `packages/japanese-text/src/convert.ts` `previewConvert`。UI 側の undo・既定除外（引用/人名/証拠番号）は未検証 |
| R-247 | U06 事件番号は raw_label 必須 + 構造化 fields、parse 失敗でも原文保存・確認待ち | §19 | 実装済 | `matters.case_number_raw` / `case_number_struct`（`CaseNumberStructSchema.parseStatus`） |
| R-248 | 和暦は version 付き表、元年=1、境界日照合（令和元年4月30日等を警告）、「頃」は approximate、不明は null | §19 | 実装済 | `packages/japanese-text/src/era.ts`（`ERA_TABLE_VERSION`, `era_boundary_mismatch`）, `era.test.ts` |
| R-249 | 証拠番号 party_symbol/number_raw/branch_raw/display_label、canonical は別値、浮動小数にしない、並替は符号→番号→枝番 | §19 | 実装済 | `packages/japanese-text/src/evidence.ts`, `evidence.canonical_number`, `/api/matters/:id/evidence`（`compareEvidence`） |
| R-250 | 提出済みラベルの改番禁止、訂正は履歴付き別版 | §19 | 一部 | `POST /api/evidence/:id/correct`（superseded + 新版）。`status='submitted'` を設定する経路が無く、提出済み判定は到達しない |
| R-251 | U07 業務文書は横書き A4。縦書き・無損失 Word 編集は対象外 | §19 | 実装済 | `inspect_docx.py`（`vertical_text` 拒否）, renderer_profiles 既定 |
| R-252 | 文書書式 profile（A4 縦、余白、Noto Serif JP 12pt、行送り 20pt、字下げ 1em、見出し 14pt、頁番号下中央） | §19 | 実装済 | `supabase/migrations/20261006000006_static_seed.sql`（`default-a4-portrait`）, `scripts/build_demo_templates.py` |
| R-253 | w:rFonts eastAsia 指定、全角本文を ASCII 化しない | §19 | 実装済 | `scripts/build_demo_templates.py`（rFonts ascii/hAnsi/eastAsia/cs 明示） |
| R-254 | PDF は同一 DOCX snapshot を LibreOffice headless 固定版 + 固定フォントで生成、converter version/hash 記録 | §19 | 実装済 | `apps/worker/src/render/{pdf,fonts}.ts`（fontconfig 固定、`sofficeVersion`）, `draft_outputs.renderer_version`, `font_manifest` |
| R-255 | フォント埋込・text extraction 往復・missing glyph・annotation・metadata・外部リンクを preflight | §19 | 一部 | `workers/documents/pdf_fonts.py`（埋込/注釈/リンク/metadata/expect-text）。missing glyph は同梱外フォント検出による近似 |
| R-256 | 字体未収録/PUA/IVS の未検証があれば export を止め、一般字へ置換して通過させない | §19 | 一部 | `invisible.ts` が PUA/IVS を検出するが preflight には接続されていない。フォント fallback 検出（`font_missing`）はエラー扱い |
| R-257 | CP932 取込は strict decode、CSV は UTF-8 BOM 標準、CP932 出力は全セル strict encode 可の場合のみ | §19 | 実装済 | `csvImport.ts`, `export.ts` `encodeCsv`（encode→decode 往復確認） |
| R-258 | 元ファイル名は表示用、storage key は UUID、ZIP entry は連番 + 対応表 | §19 | 実装済 | `files.original_name_raw` / `storage_key`, `packet.ts` manifest |
| R-259 | U08 fixtures（unicode_cases.json, normalization_reference.py, unicode_fixture.txt）、save→reload→export 不変 | §19 | 一部 | `tests/fixtures/*` は同梱。往復不変を検査する自動テスト（`tests/unicode/`）は未作成 |

## §20 セキュリティ・運用詳細

| ID | 要件 | 出典 | 実装状態 | 実装箇所 |
|---|---|---|---|---|
| R-270 | admin はユーザー/基盤管理のみ、事件本文の全件閲覧権なし | §20.1 | 実装済 | `app.can_access_matter`（admin 例外なし）, `packages/domain/src/acl.ts` |
| R-271 | lawyer/staff とも matter_members 必要、matter_barriers 優先 | §20.1 | 実装済 | 同上 |
| R-272 | 書式・事務所マスターは org 権限、案件内当事者は案件 ACL。共有連絡先から特定事件との関係を漏らさない | §20.1 | 実装済 | `supabase/migrations/20261006000004_rls.sql`（contacts/templates は org、matter_parties は案件） |
| R-273 | member 追加は担当 lawyer 承認 | §20.1 | 実装済 | `POST /api/matters/:id/members`（`requireAssignedLawyer`） |
| R-274 | 担当不在の引継ぎは admin + 別 lawyer の二者承認 | §20.1 | 未実装 | member 削除時に「他の lawyer が残る」検査のみ（`matters.ts`）。二者承認フローなし |
| R-275 | 最初の案件作成 lawyer に membership 付与 | §20.1 | 実装済 | `POST /api/matters`（作成者と lead lawyer を member に） |
| R-276 | 退所で session/membership 失効、担当を引継ぎ | §20.1 | 一部 | `PUT /api/members/:userId` status 変更で `revokeAllUserSessions`、`resolveSession` が membership 非 active を失効。担当引継ぎは手動 |
| R-277 | 最後の admin 削除禁止 | §20.1 | 実装済 | `app.tg_keep_last_admin`（migration 003） |
| R-278 | Postgres RLS + GRANT + private Storage + BFF の多層。本人 JWT を BFF から DB へ、worker だけ service role | §20.1 | 実装済 | `apps/api/src/db/pool.ts`（`SET LOCAL ROLE authenticated` + `request.jwt.claims`）, migration 004 |
| R-279 | worker は job の org/matter を再確認 | §20.1 | 実装済 | 各 job handler の `scope_mismatch` 検査 |
| R-280 | SECURITY DEFINER 関数は search_path 固定・schema-qualified | §20.1 | 実装済 | migration 003（`SET search_path = pg_catalog, pg_temp`） |
| R-281 | 承認・状態遷移は actor を server session から決定、transaction で version/hash 再検証、監査/outbox を同一 transaction | §20.1 | 実装済 | `apps/api/src/routes/reviews.ts`, `apps/api/src/services/audit.ts` |
| R-282 | admin が自分を lawyer にして承認を迂回できない | §20.1 | 一部 | 自分自身の role 変更は禁止（`masters.ts`）。admin 2 名が相互に role 変更する経路は残る（docs/threat-model.md） |
| R-283 | 初期 lawyer 指定は運用責任者が行い、変更を監査・二者確認 | §20.1 | 一部 | `member.invited` 監査のみ。二者確認なし |
| R-284 | 所内ユーザー MFA/TOTP 必須 | §20.2 | 実装済 | `private.mfa_totp`, `apps/api/src/auth/totp.ts`, `plugins/auth.ts`（`mfa_pending` で 401） |
| R-285 | BFF が Auth と通信、ブラウザは opaque cookie のみ。HttpOnly/Secure/SameSite=Lax | §20.2 | 一部 | `apps/api/src/routes/auth.ts` `cookieOpts`。`secure` は `COOKIE_SECURE` 環境変数（既定 false） |
| R-286 | CSRF token と Origin allowlist、CORS * 禁止 | §20.2 | 実装済 | `plugins/auth.ts`（`X-CSRF-Token`、Origin/Referer allowlist）。CORS プラグイン未登録 |
| R-287 | server_sessions（cookie hash、user/org、暗号化 refresh token、idle 30 分、absolute 12 時間、last_mfa_at、revoked_at）、非公開 schema | §20.2 | 実装済 | `supabase/migrations/20261006000005_private_auth.sql`, `apps/api/src/auth/session.ts` |
| R-288 | refresh は session 行 lock | §20.2 | 実装済 | `resolveSession`（`FOR UPDATE OF s`） |
| R-289 | 重要操作は MFA 確認 15 分以内 | §20.2 | 実装済 | `requireRecentMfa`（members / settings / template publish）, `POST /api/auth/step-up` |
| R-290 | token/鍵を localStorage に入れない。ログアウトで DB session 失効 + query cache 破棄。復帰時は権限再検証まで旧画面を隠す | §20.2 | 実装済 | `apps/web/src/lib/session.ts`, `api/auth.ts`, `POST /api/auth/logout` |
| R-291 | 原資料は PDF/DOCX/PNG/JPEG/TXT/CSV。100MB/ファイル、PDF 500 頁、1job 2000 頁、書式 20MB、展開 200MB/2000 entries、圧縮率 100 倍、画像 4000 万 pixel | §20.3 | 一部 | `packages/domain/src/limits.ts`, `check_file.py`, `inspect_docx.py`。1job 2000 頁の集計は未実装 |
| R-292 | parser timeout 120 秒 / render 300 秒、worker メモリ 2GB/CPU 2、job ごと一時領域 | §20.3 | 一部 | timeout は `python.ts`（120s）/`pdf.ts`（300s）。メモリ/CPU 制限はコンテナ未定義のため未実装 |
| R-293 | magic bytes/MIME/拡張子整合、ClamAV、ZIP 構造検査。DOCM/マクロ/暗号化 PDF/OLE/path traversal/外部 rel/爆弾を拒否 | §20.3 | 実装済（ClamAV は未検証） | `apps/api/src/services/files.ts` `detectMagic`, `check_file.py`, `scan.ts` |
| R-294 | raw SVG/HTML を入力として許可しない | §20.3 | 実装済 | `check_file.py` `html_or_svg_not_allowed`, `files.ts` 拡張子拒否 |
| R-295 | quarantine 保存、scan 完了まで一般取得不可。scanner 停止は成功にしない | §20.3 | 実装済 | `files.scan_status` 既定 `quarantine`, `GET /api/files/:id/content` 409, `scan.ts` fail closed（`DEV_ALLOW_UNSCANNED` は非 production のみ） |
| R-296 | nonroot/network-off worker、変換ソフトから外部 URL を取得させない | §20.3 | 一部 | `render/pdf.ts`（`no_proxy=*`、env 最小化）。コンテナ/ネットワーク分離は未実装 |
| R-297 | 一時ディレクトリは job 終了時に清掃。保存原本 bytes は immutable | §20.3 | 実装済 | 各 job の `fs.rm(..., {recursive:true})`、`LocalFsBlobStore.put`（`wx`） |
| R-298 | PDF は派生安全版でプレビュー、JS/添付/外部動作を実行しない。正式版はコメント・metadata・外部参照を除去 | §20.3 | 実装済 | `workers/documents/pdf_sanitize.py`, `scan.ts`（`safe_preview`）, `render/docx.ts` `stripMetadata`（final） |
| R-299 | 黒く覆うだけの墨消しを作らない | §20.3 | 実装済 | 該当機能なし |
| R-300 | 他案件の実名・住所を含む DOCX の共通書式化を防ぐ: 残存文字を候補提示、確認者が全ページ確認 | §20.4 | 実装済 | `inspect_docx.py` `residualTextCandidates`, `TemplatePublishSchema.confirmations.residualTextReviewed` |
| R-301 | shared テンプレートに案件内ファイル ID を残さない | §20.4 | 一部 | `PUT /api/template-versions/:id/schema` が UUID 風文字列を拒否（ヒューリスティック） |
| R-302 | 出力は BFF 経由で毎回 ACL 確認。長寿命公開 URL を作らない。直接 upload URL は 60 秒・scan 前 read 不可 | §20.4 | 実装済 | `GET /api/outputs/:id/download`, `GET /api/files/:id/content`, `POST /api/uploads/init`（60 秒、メモリ内） |
| R-303 | 端末保存済みファイルを遠隔で消せるとは表示しない | §20.4 | 実装済 | 該当表示なし |
| R-304 | audit は append-only、通常 role に UPDATE/DELETE なし。actor/action/対象版/hash/requestID/日時を記録 | §20.5 | 実装済 | migration 003/004（trigger + REVOKE）, `audit_events` 列 |
| R-305 | 汎用ログに本文・token・secret・相手先一覧を出さない | §20.5 | 一部 | `app.ts` redact（cookie/authorization/x-csrf-token）, `worker.ts` redact（payload.snapshot/ast）。網羅性は未検証 |
| R-306 | 運用者の特権アクセスも記録 | §20.5 | 一部 | worker 操作は `actor_role='worker'` で記録。DB 直接操作の記録は Postgres 側設定に依存（未実装） |
| R-307 | TLS/保存時暗号化、鍵は secret manager と分離 | §20.5 | 未実装 | 環境依存。`SESSION_ENCRYPTION_KEY` は .env |
| R-308 | 日次 DB+Storage+書式+fonts+renderer 設定の暗号化 backup、四半期の空環境復元。RPO 24h / RTO 1 営業日 | §20.5 | 一部 | `scripts/backup.mjs`（pg_dump + blobs + templates/demo + assets/fonts + migrations）、`scripts/restore.mjs`。暗号化・スケジュール・復元訓練は運用側 |
| R-309 | 保存期限は事務所設定。案件 archive は書込み停止、理由付き reopen。legal_hold 中は削除禁止。自動削除は既定 OFF | §20.5 | 実装済 | `/api/settings`（retentionYears, autoDeleteEnabled 既定 false）, `app.can_edit_matter`（active のみ）, `POST /api/matters/:id/status`（reopen 理由必須）, `app.tg_matter_guard` |
| R-310 | 監視: job 滞留/失敗、hash 不一致、storage 欠損、scanner 停止、残容量、異常ログイン | §20.5 | 一部 | 検知信号は DB/監査に記録される（docs/operations.md）。アラート基盤は未実装 |
| R-311 | health endpoint に事務所情報/secret を出さない | §20.5 | 実装済 | `GET /api/health`（`{ok,time}` のみ） |
| R-312 | 形式検査成功は法的正当性を保証しない。実弁護士レビュー・独立セキュリティ検査・Word/PDF/iPhone 検証・復元検証を本番前ゲートとする | §20.6 | 未検証 | 本リポジトリ時点では未実施 |
