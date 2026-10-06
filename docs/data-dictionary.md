# RayLaw v2 データ辞書

出典: `supabase/migrations/*.sql`。型は Postgres 型。「版」列は `app.tg_touch_version` トリガにより UPDATE ごとに `version+1`、`updated_at=now()` となる（対象表は末尾のトリガ一覧）。

共通規約（§8）: UUID 主キー（`gen_random_uuid()`）、業務表に `org_id`、`created_at/updated_at timestamptz`（UTC）、`created_by uuid → app_users`、`version integer`。氏名・住所・番号は text（数値型にしない）。日付のみの列は `date`。

以下、`NULL` 列は「可」= NULL 許容。既定が空欄は既定なし。

## public schema

### app_users

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| email_raw | text | 不可 | | メール原文 |
| email_key | text | 不可 | | 検索/一意用キー（小文字）。UNIQUE |
| display_name_raw | text | 不可 | | 表示名原文 |
| status | text | 不可 | 'active' | CHECK: active / suspended / left |
| created_at, updated_at | timestamptz | 不可 | now() | |
| version | integer | 不可 | 1 | 版 |

### organizations

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| name_raw | text | 不可 | | 事務所名原文 |
| status | text | 不可 | 'active' | CHECK: active / suspended / closed |
| settings | jsonb | 不可 | '{}' | 事務所設定（retentionYears, autoDeleteEnabled 等。`/api/settings`） |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

### memberships

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| org_id | uuid | 不可 | | PK(1), → organizations CASCADE |
| user_id | uuid | 不可 | | PK(2), → app_users CASCADE |
| role | text | 不可 | | CHECK: admin / lawyer / staff |
| status | text | 不可 | 'active' | CHECK: active / suspended / left |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

トリガ `memberships_keep_last_admin`: 最後の active admin の削除・降格・停止を拒否（`last_admin_cannot_be_removed`）。

### office_profiles

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| revision | integer | 不可 | | UNIQUE (org_id, revision)。更新は新 revision を追加 |
| name_raw | text | 不可 | | 事務所名（差出人表記） |
| address_raw / postcode_raw / phone_raw / fax_raw / email_raw | text | 不可 | '' | 原文 |
| signature_settings | jsonb | 不可 | '{}' | 署名欄設定 |
| honorific_settings | jsonb | 不可 | {"person":"様","lawyer":"先生","organization":"御中","court":"御中"} | 敬称設定 |
| is_current | boolean | 不可 | true | 現在版。部分 UNIQUE INDEX `office_profiles_current_uq (org_id) WHERE is_current` |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

### lawyers

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| user_id | uuid | 可 | | → app_users。UNIQUE (org_id, user_id)。承認権限判定（`app.is_assigned_lawyer`）に使用 |
| name_raw | text | 不可 | | 氏名原文 |
| kana | text | 不可 | '' | |
| office_profile_id | uuid | 可 | | → office_profiles（同 org、トリガ `lawyers_org_profile`） |
| title_raw | text | 不可 | '弁護士' | 肩書 |
| registration_number_raw | text | 不可 | '' | 登録番号原文 |
| active | boolean | 不可 | true | |
| search_key | text | 不可 | '' | 検索キー ver1 |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

### contacts

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| type | text | 不可 | | CHECK: person / organization / lawyer |
| name_raw | text | 不可 | | 氏名/名称原文 |
| kana | text | 不可 | '' | |
| organization_name_raw | text | 不可 | '' | 所属（同姓同名の識別に使う） |
| address_raw / postcode_raw | text | 不可 | '' | |
| channels_json | jsonb | 不可 | '{}' | phone / fax / email / note |
| external_id | text | 可 | | CSV 移行の外部 ID。部分 UNIQUE `contacts_external_id_uq (org_id, external_id) WHERE external_id IS NOT NULL` |
| checked_at | timestamptz | 可 | | 情報確認日 |
| search_key | text | 不可 | '' | 検索キー。INDEX `contacts_search_key_idx (org_id, search_key)` |
| notes_raw | text | 不可 | '' | |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

### contact_aliases

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| contact_id | uuid | 不可 | | → contacts CASCADE（同 org トリガ） |
| alias_raw | text | 不可 | | 別名原文 |
| search_key | text | 不可 | | INDEX `contact_aliases_search_key_idx (org_id, search_key)` |
| created_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |

### contact_versions（immutable）

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| contact_id | uuid | 不可 | | → contacts CASCADE |
| revision | integer | 不可 | | UNIQUE (contact_id, revision)。`contacts.version` を使う |
| snapshot | jsonb | 不可 | | 行全体の snapshot |
| created_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |

トリガ `contact_versions_immutable`: UPDATE/DELETE 拒否。

### matters

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| title_raw | text | 不可 | | 事件名原文 |
| case_number_raw | text | 不可 | '' | 事件番号原文（先頭 0 保持） |
| case_number_struct | jsonb | 可 | | courtLabel / yearEra / eraYear / symbol / serial / parseStatus |
| court_raw / court_department_raw | text | 不可 | '' | |
| status | text | 不可 | 'active' | CHECK: active / archived / closed |
| acceptance_status | text | 不可 | 'unconfirmed' | CHECK: unconfirmed / confirmed / declined |
| acceptance_checked_by | uuid | 可 | | → app_users |
| acceptance_checked_at | timestamptz | 可 | | |
| scope_raw | text | 不可 | '' | 受任範囲原文 |
| lead_lawyer_id | uuid | 可 | | → lawyers（同 org トリガ `matters_org_lead`） |
| legal_hold | boolean | 不可 | false | true の間は DELETE 拒否（`matters_guard`） |
| archive_reason_raw | text | 可 | | archive / reopen 理由 |
| external_id | text | 可 | | 部分 UNIQUE `matters_external_id_uq (org_id, external_id)` |
| search_key | text | 不可 | '' | |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

### matter_members

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| matter_id | uuid | 不可 | | PK(1), → matters CASCADE |
| user_id | uuid | 不可 | | PK(2), → app_users CASCADE |
| org_id | uuid | 不可 | | → organizations CASCADE（matters と同 org、トリガ） |
| can_edit | boolean | 不可 | true | false は閲覧のみ |
| approved_by | uuid | 可 | | 承認した担当 lawyer → app_users |
| created_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |

### matter_barriers

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| matter_id | uuid | 不可 | | PK(1), → matters CASCADE |
| user_id | uuid | 不可 | | PK(2), → app_users CASCADE |
| org_id | uuid | 不可 | | → organizations CASCADE |
| reason | text | 不可 | | 制限理由（必須） |
| created_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |

barrier は member より優先（`app.can_access_matter`）。

### matter_parties

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| matter_id | uuid | 不可 | | → matters CASCADE。INDEX `matter_parties_matter_idx` |
| contact_id | uuid | 不可 | | → contacts（同 org トリガ） |
| role | text | 不可 | | CHECK: client / opponent / co_party / third_party |
| position_raw | text | 不可 | '' | 立場（原告/被告等の原文） |
| representative_id | uuid | 可 | | 法人代表者 → contacts（同 org トリガ） |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

### matter_agents

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| matter_id | uuid | 不可 | | → matters CASCADE。INDEX `matter_agents_matter_idx` |
| lawyer_contact_id | uuid | 不可 | | 代理人（contacts type=lawyer）→ contacts |
| represented_party_id | uuid | 不可 | | → matter_parties CASCADE（同 org トリガ） |
| valid_from / valid_to | date | 可 | | 代理期間 |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

### files

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| matter_id | uuid | 可 | | → matters CASCADE。template/export は NULL。INDEX `files_matter_idx (org_id, matter_id)` |
| scope | text | 不可 | | CHECK: matter / template / output / packet / export / receipt |
| storage_key | text | 不可 | | UUID。UNIQUE。blob の実体キー（`<key[0..2]>/<key>`） |
| original_name_raw | text | 不可 | | 表示用元ファイル名 |
| mime | text | 不可 | | 宣言 MIME |
| size | bigint | 不可 | | CHECK size >= 0 |
| sha256 | text | 不可 | | 原本 hash |
| scan_status | text | 不可 | 'quarantine' | CHECK: quarantine / scanning / clean / infected / rejected / scan_failed |
| scan_report | jsonb | 可 | | check_file / docxInspection / antivirus / sanitized |
| confidential | boolean | 不可 | true | 機密。パック出力時に個別確認が必要 |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

### file_versions（immutable）

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| file_id | uuid | 不可 | | → files CASCADE（同 org トリガ） |
| revision | integer | 不可 | | UNIQUE (file_id, revision) |
| storage_key | text | 不可 | | UNIQUE |
| sha256 | text | 不可 | | |
| size | bigint | 不可 | 0 | |
| kind | text | 不可 | 'original' | CHECK: original / derived_pdf / native_text / ocr_text / safe_preview / submission_pdf |
| encoding_name | text | 可 | | テキスト添付の encoding（utf-8 / cp932 / unknown） |
| derived_from_id | uuid | 可 | | 派生元 → file_versions |
| created_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |

トリガ `file_versions_immutable`: UPDATE/DELETE 拒否（注: `apps/worker/src/jobs/scan.ts` は `encoding_name` を UPDATE するため、このトリガにより失敗する。docs 末尾「不整合」参照）。

### source_refs

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| matter_id | uuid | 不可 | | → matters CASCADE |
| file_version_id | uuid | 不可 | | → file_versions（同 org トリガ） |
| page | integer | 可 | | |
| rect | jsonb | 可 | | 座標 |
| text_version_id | uuid | 可 | | → file_versions |
| quote_raw | text | 不可 | '' | 引用原文 |
| created_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |

API 経路なし（未使用）。

### renderer_profiles

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 可 | | NULL は共通既定（`00000000-0000-4000-8000-000000000011` default-a4-portrait） |
| name | text | 不可 | | |
| settings | jsonb | 不可 | | paper / orientation / marginsMm / bodyFont / bodyPt / lineHeightPt / paragraphIndentEm / headingPt / pageNumber / writingMode |
| created_at, updated_at | timestamptz | 不可 | now() | |
| version | integer | 不可 | 1 | 版 |

### templates

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| name | text | 不可 | | |
| kind | text | 不可 | | T01_… / custom（`TemplateKindSchema`） |
| active_version_id | uuid | 可 | | → template_versions（DEFERRABLE INITIALLY DEFERRED）。publish で切替、retire で NULL |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

### template_versions

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| template_id | uuid | 不可 | | → templates CASCADE（同 org トリガ） |
| revision | integer | 不可 | | UNIQUE (template_id, revision) |
| docx_file_id | uuid | 不可 | | → files（scope=template、同 org トリガ） |
| docx_sha256 | text | 不可 | | 書式 DOCX hash（render 時に再照合） |
| field_schema | jsonb | 不可 | | `TemplateFieldSchemaSchema` |
| kind | text | 不可 | | |
| scope | text | 不可 | | negotiation / client / court / internal |
| applicability | jsonb | 不可 | '{}' | 適用範囲 |
| source_url | text | 可 | | 出典 |
| checked_at | date | 可 | | 確認日 |
| license_note | text | 可 | | 利用条件 |
| status | text | 不可 | 'draft' | CHECK: draft / testing / published / retired |
| sample_only | boolean | 不可 | true | true は正式出力不可 |
| approved_by | uuid | 可 | | → app_users（publish 時の actor） |
| approved_at | timestamptz | 可 | | |
| renderer_profile_id | uuid | 可 | | → renderer_profiles |
| inspection_report | jsonb | 可 | | `InspectionReportSchema`（issues / tags / residualTextCandidates） |
| tag_map | jsonb | 不可 | '{}' | タグ→フィールド対応 |
| provenance | jsonb | 不可 | '{}' | source / uploadedBy / supervised 等 |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

トリガ `template_versions_immutable`: published は status を published/retired 以外へ変更不可、`field_schema / docx_file_id / docx_sha256 / tag_map / renderer_profile_id` 変更不可。retired は不変。

### phrase_libraries

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| title | text | 不可 | | |
| category | text | 不可 | '' | |
| template_kind | text | 可 | | 用途の書式種別 |
| current_version_id | uuid | 可 | | → phrase_versions（DEFERRABLE） |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

### phrase_versions

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| phrase_id | uuid | 不可 | | → phrase_libraries CASCADE（同 org トリガ） |
| revision | integer | 不可 | | UNIQUE (phrase_id, revision) |
| body_raw | text | 不可 | | 文例原文 |
| status | text | 不可 | 'draft' | CHECK: draft / pending_approval / approved / retired |
| approved_by | uuid | 可 | | → app_users |
| approved_at | timestamptz | 可 | | |
| created_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |

### drafts

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| matter_id | uuid | 不可 | | → matters CASCADE（同 org トリガ）。INDEX `drafts_matter_idx (org_id, matter_id, updated_at DESC)` |
| template_id | uuid | 不可 | | → templates（同 org トリガ） |
| kind | text | 不可 | | 書式種別 |
| title_raw | text | 不可 | '' | |
| status | text | 不可 | 'draft' | CHECK: draft / rendering / ready_for_review / in_review / changes_requested / approved / superseded / archived |
| recipient_type | text | 不可 | | CHECK: opponent_agent / opponent / client / court / third_party / none |
| recipient_contact_id | uuid | 可 | | → contacts（同 org トリガ） |
| current_revision_id | uuid | 可 | | → draft_revisions（DEFERRABLE） |
| approved_revision_id | uuid | 可 | | → draft_revisions（DEFERRABLE）。承認失効で status→draft（列はそのまま） |
| idempotency_key | text | 可 | | 部分 UNIQUE `drafts_idempotency_uq (org_id, idempotency_key)` |
| batch_id | uuid | 可 | | 一括生成元（FK なし） |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版（`expectedVersion` 比較対象） |

### draft_revisions（immutable）

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| draft_id | uuid | 不可 | | → drafts CASCADE（同 org トリガ） |
| revision | integer | 不可 | | UNIQUE (draft_id, revision) |
| template_version_id | uuid | 不可 | | → template_versions（同 org トリガ） |
| snapshot_json | jsonb | 不可 | | `DraftSnapshotSchema`（fields / recipient / attachments / sources / issueDate） |
| ast_json | jsonb | 不可 | | `DocumentASTSchema` |
| source_revision_id | uuid | 可 | | 派生元 → draft_revisions |
| kind | text | 不可 | 'app' | CHECK: app / external_edit |
| external_file_version_id | uuid | 可 | | 外部編集 DOCX → file_versions |
| hash | text | 不可 | | sha256(canonicalJson({snapshot, ast, templateVersionId})) |
| created_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | 最終編集者 → app_users（自己承認判定に使用） |

トリガ `draft_revisions_immutable`: UPDATE/DELETE 拒否。

### draft_outputs

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| revision_id | uuid | 不可 | | → draft_revisions CASCADE（同 org トリガ）。INDEX `draft_outputs_revision_idx` |
| format | text | 不可 | | CHECK: docx / pdf |
| mode | text | 不可 | | CHECK: draft / final |
| file_id | uuid | 不可 | | → files（scope=output、同 org トリガ） |
| sha256 | text | 不可 | | 出力 bytes hash |
| renderer_version | text | 不可 | | `raylow-render/1.0.0;docxtemplater@…;pizzip@…[;soffice version]` または `external-edit` |
| font_manifest | jsonb | 不可 | '[]' | 同梱フォント sha と PDF 内フォント |
| preflight_report | jsonb | 可 | | worker の検査結果（unreplacedTags / missingFonts / pages / metadataFound …） |
| status | text | 不可 | 'ready' | CHECK: ready / failed / superseded |
| created_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |

トリガ `draft_outputs_guard`: DELETE 拒否、`file_id / sha256 / format / mode / revision_id` 変更拒否（status 変更のみ可）。

### edit_leases

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| draft_id | uuid | 不可 | | PK, → drafts CASCADE（同 org トリガ） |
| org_id | uuid | 不可 | | → organizations CASCADE |
| user_id | uuid | 不可 | | 保持者 → app_users |
| expires_at | timestamptz | 不可 | | 取得から 90 秒（`EDIT_LEASE_SECONDS`） |
| takeover_reason | text | 可 | | 強制引継ぎ理由 |
| created_at, updated_at | timestamptz | 不可 | now() | |

### batches

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| matter_id | uuid | 不可 | | → matters CASCADE（同 org トリガ） |
| status | text | 不可 | 'queued' | CHECK: queued / running / partial_failed / succeeded / failed / cancelled |
| idempotency_key | text | 不可 | | UNIQUE (org_id, idempotency_key) |
| purpose | text | 不可 | 'drafts' | CHECK: drafts / submission_pack（submission_pack は sample_only 書式を拒否） |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

### batch_items

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| batch_id | uuid | 不可 | | → batches CASCADE（同 org トリガ）。INDEX `batch_items_batch_idx` |
| draft_id | uuid | 可 | | 生成された草案 → drafts（宛先種別不許可なら NULL） |
| template_version_id | uuid | 不可 | | → template_versions（同 org トリガ） |
| recipient_snapshot | jsonb | 不可 | | {type, contactId} |
| status | text | 不可 | 'queued' | CHECK: queued / running / succeeded / failed / cancelled |
| error_code / error_message | text | 可 | | |
| job_id | uuid | 可 | | render_draft job（FK なし） |
| attempt | integer | 不可 | 0 | |
| created_at, updated_at | timestamptz | 不可 | now() | |

### reviews

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| revision_id | uuid | 不可 | | → draft_revisions CASCADE（同 org トリガ）。INDEX `reviews_revision_idx` |
| target_hash | text | 不可 | | 依頼時の revision hash |
| target_output_pdf_sha256 | text | 可 | | 依頼時の draft PDF sha（承認時に再照合） |
| target_output_docx_sha256 | text | 可 | | 依頼時の draft DOCX sha（記録のみ） |
| reviewer_id | uuid | 可 | | → app_users |
| requested_by | uuid | 可 | | → app_users |
| status | text | 不可 | 'pending' | CHECK: pending / approved / changes_requested / withdrawn |
| decision_reason | text | 可 | | 差戻しは必須 |
| decided_at | timestamptz | 可 | | |
| created_at, updated_at | timestamptz | 不可 | now() | |
| version | integer | 不可 | 1 | 版 |

### review_comments

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| review_id | uuid | 不可 | | → reviews CASCADE（同 org トリガ） |
| block_id | text | 可 | | AST block ID |
| field_key | text | 可 | | |
| body_raw | text | 不可 | | |
| resolved_at | timestamptz | 可 | | |
| created_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |

### evidence

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| matter_id | uuid | 不可 | | → matters CASCADE（同 org トリガ）。INDEX `evidence_matter_idx` |
| symbol_raw | text | 不可 | | 甲/乙/丙/… 原文 |
| number_raw | text | 不可 | | 番号原文（全角可） |
| branch_raw | text | 可 | | 枝番原文 |
| canonical_number | text | 不可 | | `symbol:number[:branch.branch]`（ASCII）。部分 UNIQUE `evidence_canonical_uq (matter_id, canonical_number) WHERE status IN (confirmed, submitted)` |
| display_label | text | 不可 | | 「甲第３号証の１」 |
| file_version_id | uuid | 可 | | → file_versions。トリガ `evidence_file_matter` で同一案件のファイルのみ |
| title_raw / author_raw / date_raw | text | 不可 | '' | |
| date_iso | text | 可 | | day 精度で解析できた場合のみ |
| original_copy | text | 不可 | 'copy' | CHECK: original / copy |
| proof_purpose_raw | text | 不可 | '' | 立証趣旨（弁護士入力） |
| status | text | 不可 | 'draft' | CHECK: draft / confirmed / submitted / superseded |
| superseded_by | uuid | 可 | | 訂正後の行 → evidence |
| correction_reason_raw | text | 可 | | 訂正理由 |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

### court_profiles

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 可 | | NULL は共通（generic `00000000-0000-4000-8000-000000000001`） |
| version | integer | 不可 | 1 | profile の版 |
| name | text | 不可 | | |
| source_url | text | 可 | | |
| checked_at | date | 可 | | |
| applicable_procedure | text | 不可 | 'generic' | |
| file_rules / page_rules / naming_rules | jsonb | 不可 | '{}' | 形式確認規則（naming_rules.maxNameGraphemes を packet が使用） |
| created_at, updated_at | timestamptz | 不可 | now() | |

### packets

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| matter_id | uuid | 不可 | | → matters CASCADE（同 org トリガ） |
| revision | integer | 不可 | 1 | |
| title_raw | text | 不可 | '' | |
| status | text | 不可 | 'draft' | CHECK: draft / checking / blocked / ready / rendering / rendered / failed / archived |
| court_profile_id | uuid | 可 | | → court_profiles |
| manifest_json | jsonb | 可 | | 生成 ZIP の manifest（schemaVersion 2） |
| hash | text | 可 | | ZIP sha256 |
| file_id | uuid | 可 | | → files（scope=packet） |
| check_report | jsonb | 可 | | {issues, blocking, checkedAt} |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版（render job は作成時 version を照合） |

### packet_items

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| packet_id | uuid | 不可 | | → packets CASCADE（同 org トリガ） |
| output_id | uuid | 可 | | → draft_outputs（同 org トリガ） |
| file_version_id | uuid | 可 | | → file_versions（同 org トリガ） |
| evidence_id | uuid | 可 | | → evidence |
| order_no | integer | 不可 | | UNIQUE (packet_id, order_no) |
| display_name_raw | text | 不可 | '' | ZIP entry 表示名 |
| external_output_confirmed | boolean | 不可 | false | 機密資料の外部出力確認 |
| created_at | timestamptz | 不可 | now() | |

CHECK: `output_id IS NOT NULL OR file_version_id IS NOT NULL`。

### dispatch_records

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| matter_id | uuid | 不可 | | → matters CASCADE（同 org トリガ） |
| packet_id | uuid | 可 | | → packets（同 org トリガ） |
| output_id | uuid | 可 | | → draft_outputs（同 org トリガ） |
| recipient_snapshot | jsonb | 不可 | | {nameRaw, organizationNameRaw, addressRaw, type} |
| method | text | 不可 | | post / registered_post / content_certified_post / fax / email / hand / court_counter / court_electronic / other（`method:note` 形式で備考を連結） |
| sent_at | timestamptz | 不可 | | |
| receipt_raw | text | 不可 | '' | 受付番号原文 |
| receipt_file_id | uuid | 可 | | → files（scope=receipt） |
| received_documents_raw | text | 不可 | '' | 受領資料 |
| status | text | 不可 | 'recorded' | CHECK: recorded / received_verified |
| recorded_by / verified_by | uuid | 可 | | → app_users（verify は recorded_by 以外） |
| verified_at | timestamptz | 可 | | |
| created_at, updated_at | timestamptz | 不可 | now() | |
| version | integer | 不可 | 1 | 版 |

CHECK: `packet_id IS NOT NULL OR output_id IS NOT NULL`。

### jobs

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | → organizations CASCADE |
| matter_id | uuid | 可 | | → matters CASCADE（同 org トリガ） |
| type | text | 不可 | | render_draft / render_final / inspect_template / test_template / scan_file / render_packet / export / external_edit_ingest（`JOB_TYPES` には batch_render / import_csv もあるが handler なし） |
| state | text | 不可 | 'queued' | CHECK: queued / running / succeeded / failed / cancelled |
| scope_key | text | 不可 | '' | `draft:<id>` / `file:<id>` / `template_version:<id>` / `packet:<id>` / `export:<userId>` |
| input_hash | text | 不可 | | sha256(canonicalJson(payload)) |
| payload | jsonb | 不可 | '{}' | handler 入力 |
| result | jsonb | 可 | | 成功結果 / 失敗 details |
| lease_until | timestamptz | 可 | | claim から 120 秒、heartbeat で延長 |
| worker_id | text | 可 | | |
| attempt | integer | 不可 | 0 | claim ごとに +1 |
| max_attempts | integer | 不可 | 3 | |
| run_after | timestamptz | 不可 | now() | 再試行待ち時刻 |
| progress_json | jsonb | 不可 | '{}' | {step, label} |
| error_code / error_message | text | 可 | | |
| cancel_requested | boolean | 不可 | false | authenticated は この列のみ UPDATE 可 |
| created_at, updated_at | timestamptz | 不可 | now() | |
| created_by | uuid | 可 | | → app_users |
| version | integer | 不可 | 1 | 版 |

INDEX: `jobs_dedupe_uq UNIQUE (org_id, type, scope_key, input_hash) WHERE state IN ('queued','running')`、`jobs_claim_idx (state, run_after) WHERE state='queued'`。

### audit_events（append-only）

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | FK なし |
| matter_id | uuid | 可 | | FK なし |
| actor_id | uuid | 可 | | |
| actor_role | text | 可 | | admin / lawyer / staff / worker |
| action | text | 不可 | | 例: draft.created, review.approved, output.downloaded_final |
| target_type | text | 不可 | | |
| target_id | uuid | 可 | | |
| target_version | integer | 可 | | |
| target_hash | text | 可 | | revision hash / 出力 sha |
| request_id | text | 可 | | HTTP request id または job id |
| details | jsonb | 不可 | '{}' | 本文を入れない運用 |
| created_at | timestamptz | 不可 | now() | |

INDEX: `audit_events_org_idx (org_id, created_at DESC)`、`audit_events_matter_idx (matter_id, created_at DESC)`。トリガ `audit_events_append_only` + `REVOKE UPDATE, DELETE`（authenticated, service_role）。

### outbox

| 列 | 型 | NULL | 既定 | 意味 / 制約 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| org_id | uuid | 不可 | | FK なし |
| event_type | text | 不可 | | audit action と同じ |
| payload_ref | text | 可 | | target_id |
| payload | jsonb | 不可 | '{}' | |
| state | text | 不可 | 'pending' | CHECK: pending / processed / failed（消費者は未実装） |
| created_at | timestamptz | 不可 | now() | |
| processed_at | timestamptz | 可 | | |

## private schema（`service_role` のみ）

### private.server_sessions

| 列 | 型 | NULL | 既定 | 意味 |
|---|---|---|---|---|
| id | uuid | 不可 | gen_random_uuid() | PK |
| cookie_hash | text | 不可 | | sha256(cookie 値)。UNIQUE |
| user_id | uuid | 不可 | | → app_users CASCADE。INDEX `server_sessions_user_idx` |
| org_id | uuid | 不可 | | → organizations CASCADE |
| refresh_token_enc | text | 可 | | Supabase refresh token（AES-256-GCM、`SESSION_ENCRYPTION_KEY`） |
| idle_expiry | timestamptz | 不可 | | 30 分、アクセスごとに延長（absolute を超えない） |
| absolute_expiry | timestamptz | 不可 | | 12 時間 |
| last_mfa_at | timestamptz | 可 | | 重要操作は 15 分以内 |
| mfa_pending | boolean | 不可 | true | ログイン直後は true |
| csrf_token_hash | text | 不可 | | sha256(CSRF token)。`GET /api/auth/session` と MFA 検証で再発行 |
| user_agent_hash | text | 可 | | |
| revoked_at | timestamptz | 可 | | logout / membership 失効 |
| created_at, last_seen_at | timestamptz | 不可 | now() | |

### private.local_credentials（AUTH_PROVIDER=local）

| 列 | 型 | NULL | 既定 | 意味 |
|---|---|---|---|---|
| user_id | uuid | 不可 | | PK, → app_users CASCADE |
| password_hash | text | 不可 | | `scrypt$32768$8$1$<salt>$<key>` |
| must_change | boolean | 不可 | false | 招待時 true（UI 強制は未実装） |
| failed_attempts | integer | 不可 | 0 | 10 回で 15 分 lock |
| locked_until | timestamptz | 可 | | |
| created_at, updated_at | timestamptz | 不可 | now() | |

### private.mfa_totp

| 列 | 型 | NULL | 既定 | 意味 |
|---|---|---|---|---|
| user_id | uuid | 不可 | | PK, → app_users CASCADE |
| secret_enc | text | 不可 | | base32 secret を AES-256-GCM 暗号化 |
| enrolled_at | timestamptz | 可 | | NULL は登録未完了 |
| last_used_counter | bigint | 可 | | 使用済み counter 再利用防止 |
| recovery_codes_hash | text[] | 不可 | '{}' | 未使用（生成経路なし） |
| created_at | timestamptz | 不可 | now() | |

### private.identity_links

| 列 | 型 | NULL | 既定 | 意味 |
|---|---|---|---|---|
| provider | text | 不可 | | PK(1)。'supabase' |
| provider_user_id | text | 不可 | | PK(2)。auth.users.id |
| user_id | uuid | 不可 | | → app_users CASCADE |
| created_at | timestamptz | 不可 | now() | |

## 関数（app schema）

| 関数 | 権限 | 内容 |
|---|---|---|
| `app.current_user_id()` | authenticated, service_role | `request.jwt.claims` の `sub` を uuid で返す（BFF が `set_config` で渡す） |
| `app.current_request_id()` | 同 | `app.request_id` 設定値 |
| `app.is_org_member(org)` | SECURITY DEFINER | active な memberships があるか |
| `app.org_role(org)` | SECURITY DEFINER | その org での role |
| `app.can_access_matter(matter)` | SECURITY DEFINER | barrier が無く、matter_members に存在し、membership が active。admin 例外なし |
| `app.can_edit_matter(matter)` | SECURITY DEFINER | can_access かつ `can_edit` かつ matters.status='active' |
| `app.is_assigned_lawyer(matter)` | SECURITY DEFINER | matter_members ∧ memberships.role='lawyer' ∧ lawyers.user_id 一致（active）∧ barrier なし |
| `app.claim_job(worker, types[], lease_seconds=120)` | service_role | `FOR UPDATE SKIP LOCKED` で 1 件 claim、state=running、attempt+1、lease_until 設定 |
| `app.heartbeat_job(job, worker, lease_seconds, progress)` | service_role | lease 延長と progress 更新。自分が保持する running job のみ |
| `app.requeue_expired_jobs()` | service_role | lease 切れ running を queued（attempt<max）または failed(`lease_expired`) に戻し、run_after を +30 秒（attempt=1）/ +120 秒 |
| `app.tg_touch_version()` | trigger | updated_at=now(), version+1 |
| `app.tg_assert_same_org()` | trigger（SECURITY DEFINER。RLS に関わらず参照先行を読む） | 参照先行の org_id と NEW.org_id の一致を検査。不一致/不存在は `cross_org_reference`（BFF は 404 に変換） |
| `app.tg_evidence_file_matter()` | trigger（SECURITY DEFINER） | evidence.file_version_id のファイルが同一案件か |
| `app.tg_template_version_immutable()` | trigger | published/retired の不変性 |
| `app.tg_immutable_row()` | trigger | UPDATE/DELETE を一律拒否 |
| `app.tg_draft_outputs_guard()` | trigger | DELETE 拒否、bytes/identity 列の変更拒否 |
| `app.tg_keep_last_admin()` | trigger（SECURITY DEFINER） | 最後の active admin を守る |
| `app.tg_matter_guard()` | trigger | legal_hold 中の DELETE 拒否 |

SECURITY DEFINER は ACL helper 5 関数と `tg_assert_same_org` / `tg_evidence_file_matter` / `tg_keep_last_admin`。すべての関数は `SET search_path = pg_catalog, pg_temp` と schema-qualified 参照を使う。

## トリガ一覧

| トリガ | 対象 | 関数 | 強制内容 |
|---|---|---|---|
| `<table>_touch` | app_users, organizations, memberships, office_profiles, lawyers, contacts, matters, matter_parties, matter_agents, files, renderer_profiles, templates, template_versions, phrase_libraries, drafts, batches, reviews, evidence, packets, dispatch_records, jobs | tg_touch_version | 楽観ロック用 version/updated_at |
| cross-org 群（`matter_members_org`, `matter_barriers_org`, `matter_parties_org_{matter,contact,rep}`, `matter_agents_org_{matter,contact,party}`, `lawyers_org_profile`, `matters_org_lead`, `contact_aliases_org`, `contact_versions_org`, `files_org_matter`, `file_versions_org`, `source_refs_org_{matter,fv}`, `template_versions_org_{t,f}`, `phrase_versions_org`, `drafts_org_{matter,template,recipient}`, `draft_revisions_org_{d,tv}`, `draft_outputs_org{,_file}`, `edit_leases_org`, `batches_org`, `batch_items_org_{b,tv}`, `reviews_org`, `review_comments_org`, `evidence_org_{matter,fv}`, `packets_org`, `packet_items_org_{p,o,fv}`, `dispatch_org_{matter,packet,output}`, `jobs_org_matter`） | 各表 | tg_assert_same_org | FK 先が同一 org であること（他 org の ID を jsonb 等から持ち込んでも挿入不可） |
| `evidence_file_matter` | evidence | tg_evidence_file_matter | 証拠の原資料が同一案件 |
| `template_versions_immutable` | template_versions | tg_template_version_immutable | published 版 immutable |
| `draft_revisions_immutable`, `contact_versions_immutable`, `audit_events_append_only`, `file_versions_immutable` | 各表 | tg_immutable_row | UPDATE/DELETE 禁止 |
| `draft_outputs_guard` | draft_outputs | tg_draft_outputs_guard | 確定済み bytes の上書き禁止 |
| `memberships_keep_last_admin` | memberships | tg_keep_last_admin | 最後の admin 保護 |
| `matters_guard` | matters（DELETE） | tg_matter_guard | legal_hold 中の削除禁止 |

## GRANT 要約（migration 004/005）

- `authenticated`, `service_role`: public 全表 SELECT/INSERT/UPDATE/DELETE。ただし `audit_events` は UPDATE/DELETE を両 role から REVOKE。`draft_revisions`, `draft_outputs`, `file_versions`, `contact_versions` は authenticated の DELETE を REVOKE。`jobs` は authenticated の UPDATE を REVOKE し `cancel_requested` 列のみ GRANT。
- `private`: service_role のみ。PUBLIC/anon/authenticated は REVOKE ALL。
- RLS は public 全表で ENABLE（ポリシーは `docs/permissions.md`）。`service_role` は BYPASSRLS。

## 仕様（§8）と migration の差分

| 項目 | §8 の記載 | migration |
|---|---|---|
| 利用者表 | 記載なし（Supabase auth.users を想定） | `public.app_users` を追加し、`private.identity_links` で auth.users と対応 |
| office_profiles | name_raw なし | `name_raw`, `honorific_settings`, `is_current` を追加 |
| lawyers | — | `registration_number_raw`, `search_key` 追加 |
| contacts | — | `postcode_raw`, `external_id`, `notes_raw`, `search_key` 追加 |
| matters | — | `legal_hold`, `archive_reason_raw`, `external_id`, `case_number_struct`, `search_key` 追加（§20.5 / §19 U06 由来） |
| matter_members | (matter_id,user_id,can_edit) | `org_id`, `approved_by` 追加 |
| template_versions | docxBlobId | `docx_file_id`（files への FK）。`inspection_report`, `tag_map`, `provenance`, `sample_only` 追加 |
| renderer_profiles / court_profiles | §5.3 / §7 で参照のみ | 表を追加 |
| draft_outputs | blob_id | `file_id`。`mode`, `preflight_report` 追加 |
| edit_leases | (draft_id,user_id,expires_at) | `org_id`, `takeover_reason` 追加 |
| batches / batch_items | — | `purpose`、`template_version_id`, `job_id`, `attempt`, `error_message` 追加 |
| reviews | — | `target_output_pdf_sha256`, `target_output_docx_sha256`, `requested_by` 追加 |
| files.scope | matter / template | output / packet / export / receipt を追加 |
| file_versions | blob_id | `storage_key`。`kind`, `encoding_name`, `size` 追加 |
| evidence | — | `date_iso`, `superseded_by`, `correction_reason_raw` 追加 |
| packets / packet_items | — | `org_id`, `title_raw`, `court_profile_id`, `file_id`, `check_report` / `evidence_id`, `display_name_raw`, `external_output_confirmed` 追加 |
| dispatch_records | verified_by | `status`, `recorded_by`, `verified_at`, `received_documents_raw` 追加 |
| jobs | — | `scope_key`, `payload`, `result`, `worker_id`, `max_attempts`, `run_after`, `error_message`, `cancel_requested` 追加 |
| audit_events / outbox | — | `actor_role`, `target_type`, `target_hash`, `details` / `org_id`, `payload`, `processed_at` 追加 |
| server_sessions | §20.2 の列 | `mfa_pending`, `csrf_token_hash`, `user_agent_hash`, `last_seen_at` 追加。`local_credentials`, `mfa_totp`, `identity_links` は仕様に無い追加表 |
| idempotency_key | 「同じ org と operation で一意」 | drafts と batches それぞれの (org_id, key) 一意。operation 列はなく表ごとに分離 |

## コードと migration の不整合（確認事項）

- `file_versions_immutable` トリガが UPDATE を全面拒否する一方、`apps/worker/src/jobs/scan.ts` はテキスト添付の `encoding_name` を UPDATE する。この UPDATE はトリガで失敗する（scan job 全体が失敗する）。
- `migration 004` の `matters_insert` コメントは「org の lawyer/admin」だが、ポリシーは `staff` も許可している。
- `JOB_TYPES`（`packages/contracts/src/jobs.ts`）の `batch_render` / `import_csv` に対応する worker handler は無い（一括は `render_draft` 子 job、CSV 取込は API 同期処理）。
- `packets.status` の `checking` / `archived`、`evidence.status` の `submitted`、`drafts.status` の `superseded`、`batches.status` の `failed` を設定するコード経路は無い。
