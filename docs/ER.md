# RayLaw v2 ER 図

出典: `supabase/migrations/20261006000002_core_tables.sql`（public）、`20261006000005_private_auth.sql`（private）。列の詳細は `docs/data-dictionary.md`。

凡例と前提:

- すべての業務テーブルは `org_id → organizations.id`（ON DELETE CASCADE）を持つ。読みやすさのため、各図では `organizations` との関係を代表的なテーブルのみ描き、他は属性 `org_id FK` で示す。`audit_events.org_id` と `outbox.org_id` は FK 制約なし。
- `created_by / approved_by / reviewer_id / recorded_by / verified_by` 等の `app_users` 参照は図では省略し、属性にのみ記載する。
- 遅延 FK（DEFERRABLE INITIALLY DEFERRED）: `templates.active_version_id`、`phrase_libraries.current_version_id`、`drafts.current_revision_id / approved_revision_id`。
- cross-org 参照は FK とは別に `app.tg_assert_same_org` トリガで拒否する（`docs/data-dictionary.md` のトリガ一覧）。

## 1. 組織・利用者・マスター

```mermaid
erDiagram
  app_users {
    uuid id PK
    text email_raw
    text email_key UK
    text display_name_raw
    text status
  }
  organizations {
    uuid id PK
    text name_raw
    text status
    jsonb settings
    uuid created_by FK
  }
  memberships {
    uuid org_id PK, FK
    uuid user_id PK, FK
    text role
    text status
  }
  office_profiles {
    uuid id PK
    uuid org_id FK
    integer revision UK
    text name_raw
    jsonb honorific_settings
    boolean is_current
  }
  lawyers {
    uuid id PK
    uuid org_id FK
    uuid user_id FK
    uuid office_profile_id FK
    text name_raw
    boolean active
  }
  contacts {
    uuid id PK
    uuid org_id FK
    text type
    text name_raw
    text external_id
    text search_key
  }
  contact_aliases {
    uuid id PK
    uuid org_id FK
    uuid contact_id FK
    text alias_raw
    text search_key
  }
  contact_versions {
    uuid id PK
    uuid org_id FK
    uuid contact_id FK
    integer revision UK
    jsonb snapshot
  }

  app_users ||--o{ memberships : "user_id"
  organizations ||--o{ memberships : "org_id"
  organizations ||--o{ office_profiles : "org_id"
  organizations ||--o{ lawyers : "org_id"
  organizations ||--o{ contacts : "org_id"
  app_users |o--o{ lawyers : "user_id (nullable, UNIQUE per org)"
  office_profiles |o--o{ lawyers : "office_profile_id"
  contacts ||--o{ contact_aliases : "contact_id"
  contacts ||--o{ contact_versions : "contact_id"
```

## 2. 案件と ACL

```mermaid
erDiagram
  matters {
    uuid id PK
    uuid org_id FK
    text title_raw
    text case_number_raw
    jsonb case_number_struct
    text status
    text acceptance_status
    uuid acceptance_checked_by FK
    uuid lead_lawyer_id FK
    boolean legal_hold
    text external_id
  }
  matter_members {
    uuid matter_id PK, FK
    uuid user_id PK, FK
    uuid org_id FK
    boolean can_edit
    uuid approved_by FK
  }
  matter_barriers {
    uuid matter_id PK, FK
    uuid user_id PK, FK
    uuid org_id FK
    text reason
  }
  matter_parties {
    uuid id PK
    uuid org_id FK
    uuid matter_id FK
    uuid contact_id FK
    text role
    uuid representative_id FK
  }
  matter_agents {
    uuid id PK
    uuid org_id FK
    uuid matter_id FK
    uuid lawyer_contact_id FK
    uuid represented_party_id FK
    date valid_from
    date valid_to
  }
  lawyers {
    uuid id PK
  }
  contacts {
    uuid id PK
  }
  app_users {
    uuid id PK
  }

  matters ||--o{ matter_members : "matter_id"
  matters ||--o{ matter_barriers : "matter_id"
  matters ||--o{ matter_parties : "matter_id"
  matters ||--o{ matter_agents : "matter_id"
  lawyers |o--o{ matters : "lead_lawyer_id"
  app_users ||--o{ matter_members : "user_id"
  app_users ||--o{ matter_barriers : "user_id"
  contacts ||--o{ matter_parties : "contact_id"
  contacts |o--o{ matter_parties : "representative_id"
  contacts ||--o{ matter_agents : "lawyer_contact_id"
  matter_parties ||--o{ matter_agents : "represented_party_id"
```

`matter_parties`（当事者）と `matter_agents`（代理人）は別の関係である。代理人は `contacts(type=lawyer)` を `represented_party_id` に紐づける。

## 3. ファイル・原資料

```mermaid
erDiagram
  files {
    uuid id PK
    uuid org_id FK
    uuid matter_id FK
    text scope
    text storage_key UK
    text original_name_raw
    text mime
    bigint size
    text sha256
    text scan_status
    jsonb scan_report
    boolean confidential
  }
  file_versions {
    uuid id PK
    uuid org_id FK
    uuid file_id FK
    integer revision UK
    text storage_key UK
    text sha256
    text kind
    text encoding_name
    uuid derived_from_id FK
  }
  source_refs {
    uuid id PK
    uuid org_id FK
    uuid matter_id FK
    uuid file_version_id FK
    integer page
    jsonb rect
    uuid text_version_id FK
    text quote_raw
  }
  matters {
    uuid id PK
  }

  matters |o--o{ files : "matter_id (nullable for template/export)"
  files ||--o{ file_versions : "file_id"
  file_versions |o--o{ file_versions : "derived_from_id"
  matters ||--o{ source_refs : "matter_id"
  file_versions ||--o{ source_refs : "file_version_id"
  file_versions |o--o{ source_refs : "text_version_id"
```

## 4. 書式・文例・描画設定

```mermaid
erDiagram
  renderer_profiles {
    uuid id PK
    uuid org_id FK
    text name
    jsonb settings
  }
  templates {
    uuid id PK
    uuid org_id FK
    text name
    text kind
    uuid active_version_id FK
  }
  template_versions {
    uuid id PK
    uuid org_id FK
    uuid template_id FK
    integer revision UK
    uuid docx_file_id FK
    text docx_sha256
    jsonb field_schema
    text status
    boolean sample_only
    uuid approved_by FK
    uuid renderer_profile_id FK
    jsonb inspection_report
    jsonb tag_map
    jsonb provenance
  }
  phrase_libraries {
    uuid id PK
    uuid org_id FK
    text title
    text category
    text template_kind
    uuid current_version_id FK
  }
  phrase_versions {
    uuid id PK
    uuid org_id FK
    uuid phrase_id FK
    integer revision UK
    text body_raw
    text status
    uuid approved_by FK
  }
  files {
    uuid id PK
  }
  organizations {
    uuid id PK
  }

  organizations |o--o{ renderer_profiles : "org_id (NULL = 共通既定)"
  templates ||--o{ template_versions : "template_id"
  template_versions |o--o| templates : "active_version_id (deferred FK)"
  files ||--o{ template_versions : "docx_file_id"
  renderer_profiles |o--o{ template_versions : "renderer_profile_id"
  phrase_libraries ||--o{ phrase_versions : "phrase_id"
  phrase_versions |o--o| phrase_libraries : "current_version_id (deferred FK)"
```

## 5. 草案・レビュー・一括生成

```mermaid
erDiagram
  drafts {
    uuid id PK
    uuid org_id FK
    uuid matter_id FK
    uuid template_id FK
    text kind
    text title_raw
    text status
    text recipient_type
    uuid recipient_contact_id FK
    uuid current_revision_id FK
    uuid approved_revision_id FK
    text idempotency_key
    uuid batch_id
  }
  draft_revisions {
    uuid id PK
    uuid org_id FK
    uuid draft_id FK
    integer revision UK
    uuid template_version_id FK
    jsonb snapshot_json
    jsonb ast_json
    uuid source_revision_id FK
    text kind
    uuid external_file_version_id FK
    text hash
  }
  draft_outputs {
    uuid id PK
    uuid org_id FK
    uuid revision_id FK
    text format
    text mode
    uuid file_id FK
    text sha256
    text renderer_version
    jsonb font_manifest
    jsonb preflight_report
    text status
  }
  edit_leases {
    uuid draft_id PK, FK
    uuid org_id FK
    uuid user_id FK
    timestamptz expires_at
    text takeover_reason
  }
  reviews {
    uuid id PK
    uuid org_id FK
    uuid revision_id FK
    text target_hash
    text target_output_pdf_sha256
    text target_output_docx_sha256
    uuid reviewer_id FK
    uuid requested_by FK
    text status
    text decision_reason
  }
  review_comments {
    uuid id PK
    uuid org_id FK
    uuid review_id FK
    text block_id
    text field_key
    text body_raw
    timestamptz resolved_at
  }
  batches {
    uuid id PK
    uuid org_id FK
    uuid matter_id FK
    text status
    text idempotency_key UK
    text purpose
  }
  batch_items {
    uuid id PK
    uuid org_id FK
    uuid batch_id FK
    uuid draft_id FK
    uuid template_version_id FK
    jsonb recipient_snapshot
    text status
    text error_code
    uuid job_id
    integer attempt
  }
  matters {
    uuid id PK
  }
  templates {
    uuid id PK
  }
  template_versions {
    uuid id PK
  }
  contacts {
    uuid id PK
  }
  files {
    uuid id PK
  }
  file_versions {
    uuid id PK
  }

  matters ||--o{ drafts : "matter_id"
  templates ||--o{ drafts : "template_id"
  contacts |o--o{ drafts : "recipient_contact_id"
  drafts ||--o{ draft_revisions : "draft_id"
  draft_revisions |o--o| drafts : "current_revision_id / approved_revision_id (deferred)"
  template_versions ||--o{ draft_revisions : "template_version_id"
  draft_revisions |o--o{ draft_revisions : "source_revision_id"
  file_versions |o--o{ draft_revisions : "external_file_version_id"
  draft_revisions ||--o{ draft_outputs : "revision_id"
  files ||--o{ draft_outputs : "file_id"
  drafts ||--o| edit_leases : "draft_id"
  draft_revisions ||--o{ reviews : "revision_id"
  reviews ||--o{ review_comments : "review_id"
  matters ||--o{ batches : "matter_id"
  batches ||--o{ batch_items : "batch_id"
  drafts |o--o{ batch_items : "draft_id"
  template_versions ||--o{ batch_items : "template_version_id"
```

`drafts.batch_id` と `batch_items.job_id` は FK 制約のない参照列。

## 6. 証拠・提出パック・送付記録

```mermaid
erDiagram
  evidence {
    uuid id PK
    uuid org_id FK
    uuid matter_id FK
    text symbol_raw
    text number_raw
    text branch_raw
    text canonical_number
    text display_label
    uuid file_version_id FK
    text status
    uuid superseded_by FK
    text correction_reason_raw
  }
  court_profiles {
    uuid id PK
    uuid org_id FK
    integer version
    text name
    text applicable_procedure
    jsonb file_rules
    jsonb page_rules
    jsonb naming_rules
  }
  packets {
    uuid id PK
    uuid org_id FK
    uuid matter_id FK
    integer revision
    text status
    uuid court_profile_id FK
    jsonb manifest_json
    text hash
    uuid file_id FK
    jsonb check_report
  }
  packet_items {
    uuid id PK
    uuid org_id FK
    uuid packet_id FK
    uuid output_id FK
    uuid file_version_id FK
    uuid evidence_id FK
    integer order_no UK
    boolean external_output_confirmed
  }
  dispatch_records {
    uuid id PK
    uuid org_id FK
    uuid matter_id FK
    uuid packet_id FK
    uuid output_id FK
    jsonb recipient_snapshot
    text method
    timestamptz sent_at
    uuid receipt_file_id FK
    text status
    uuid recorded_by FK
    uuid verified_by FK
  }
  matters {
    uuid id PK
  }
  file_versions {
    uuid id PK
  }
  files {
    uuid id PK
  }
  draft_outputs {
    uuid id PK
  }
  organizations {
    uuid id PK
  }

  matters ||--o{ evidence : "matter_id"
  file_versions |o--o{ evidence : "file_version_id"
  evidence |o--o| evidence : "superseded_by"
  organizations |o--o{ court_profiles : "org_id (NULL = generic)"
  matters ||--o{ packets : "matter_id"
  court_profiles |o--o{ packets : "court_profile_id"
  files |o--o| packets : "file_id (生成 ZIP)"
  packets ||--o{ packet_items : "packet_id"
  draft_outputs |o--o{ packet_items : "output_id"
  file_versions |o--o{ packet_items : "file_version_id"
  evidence |o--o{ packet_items : "evidence_id"
  matters ||--o{ dispatch_records : "matter_id"
  packets |o--o{ dispatch_records : "packet_id"
  draft_outputs |o--o{ dispatch_records : "output_id"
  files |o--o{ dispatch_records : "receipt_file_id"
```

## 7. ジョブ・監査・outbox

```mermaid
erDiagram
  jobs {
    uuid id PK
    uuid org_id FK
    uuid matter_id FK
    text type
    text state
    text scope_key
    text input_hash
    jsonb payload
    jsonb result
    timestamptz lease_until
    text worker_id
    integer attempt
    integer max_attempts
    timestamptz run_after
    jsonb progress_json
    text error_code
    boolean cancel_requested
    uuid created_by FK
  }
  audit_events {
    uuid id PK
    uuid org_id
    uuid matter_id
    uuid actor_id
    text actor_role
    text action
    text target_type
    uuid target_id
    integer target_version
    text target_hash
    text request_id
    jsonb details
    timestamptz created_at
  }
  outbox {
    uuid id PK
    uuid org_id
    text event_type
    text payload_ref
    jsonb payload
    text state
    timestamptz processed_at
  }
  organizations {
    uuid id PK
  }
  matters {
    uuid id PK
  }

  organizations ||--o{ jobs : "org_id"
  matters |o--o{ jobs : "matter_id (nullable)"
  organizations ||..o{ audit_events : "org_id (FK なし)"
  matters |o..o{ audit_events : "matter_id (FK なし)"
  organizations ||..o{ outbox : "org_id (FK なし)"
```

`jobs_dedupe_uq`（`org_id, type, scope_key, input_hash` / state IN queued,running）で同一入力の重複投入を防ぐ。

## 8. 非公開 schema `private`

```mermaid
erDiagram
  app_users {
    uuid id PK
  }
  organizations {
    uuid id PK
  }
  server_sessions {
    uuid id PK
    text cookie_hash UK
    uuid user_id FK
    uuid org_id FK
    text refresh_token_enc
    timestamptz idle_expiry
    timestamptz absolute_expiry
    timestamptz last_mfa_at
    boolean mfa_pending
    text csrf_token_hash
    text user_agent_hash
    timestamptz revoked_at
    timestamptz last_seen_at
  }
  local_credentials {
    uuid user_id PK, FK
    text password_hash
    boolean must_change
    integer failed_attempts
    timestamptz locked_until
  }
  mfa_totp {
    uuid user_id PK, FK
    text secret_enc
    timestamptz enrolled_at
    bigint last_used_counter
    text_array recovery_codes_hash
  }
  identity_links {
    text provider PK
    text provider_user_id PK
    uuid user_id FK
  }

  app_users ||--o{ server_sessions : "user_id"
  organizations ||--o{ server_sessions : "org_id"
  app_users ||--o| local_credentials : "user_id"
  app_users ||--o| mfa_totp : "user_id"
  app_users ||--o{ identity_links : "user_id"
```

`private` schema は `authenticated` / `anon` から REVOKE ALL。RLS を有効化しポリシーを置かないため、`service_role`（BYPASSRLS）だけが操作できる。BFF は `withServiceTx`（`apps/api/src/db/pool.ts`）経由でのみ触る。

## 9. テーブル群の説明

| 群 | テーブル | 役割 |
|---|---|---|
| 利用者・組織 | `app_users`, `organizations`, `memberships` | ログイン主体、事務所、所属と役割（admin/lawyer/staff）。`memberships` は org 単位の権限、案件アクセスは別途 `matter_members` |
| 事務所マスター | `office_profiles`, `lawyers` | 差出人情報は revision 制（更新は新 revision、`is_current` 1 件）。`lawyers.user_id` でログイン利用者と対応づけ、承認権限の判定に使う |
| 連絡先 | `contacts`, `contact_aliases`, `contact_versions` | 共有連絡先（人物/組織/弁護士）。別名は明示登録、更新ごとに snapshot を immutable 保存 |
| 案件 | `matters`, `matter_members`, `matter_barriers`, `matter_parties`, `matter_agents` | 事件情報、案件 ACL（member 必須、barrier 優先）、当事者と代理人（別関係） |
| ファイル | `files`, `file_versions`, `source_refs` | 原本 bytes（storage_key=UUID、sha256、quarantine→scan）、派生版（safe_preview / derived_pdf / native_text / ocr_text / submission_pdf）、引用参照 |
| 書式 | `renderer_profiles`, `templates`, `template_versions` | 書式カタログと版。版は DOCX file + sha256 + field_schema + provenance + inspection_report を固定。published は immutable |
| 文例 | `phrase_libraries`, `phrase_versions` | 所内文例と版・承認 |
| 草案 | `drafts`, `draft_revisions`, `draft_outputs`, `edit_leases` | 文書と immutable な版（snapshot_json + ast_json + hash）、出力物（docx/pdf × draft/final）、編集 lease |
| レビュー | `reviews`, `review_comments` | 承認対象 hash と出力 sha を固定した承認記録、ブロック/項目単位のコメント |
| 一括 | `batches`, `batch_items` | 20 書式 × 50 宛先の一括生成。子項目ごとに draft と job を持つ |
| 証拠 | `evidence` | 証拠番号（raw と canonical）、原資料版への参照、訂正は superseded + 新行 |
| 提出 | `court_profiles`, `packets`, `packet_items`, `dispatch_records` | 提出先 profile、提出パック（検査結果・manifest・ZIP）、手動の送付/提出記録と他担当者確認 |
| 基盤 | `jobs`, `audit_events`, `outbox` | job queue（claim/lease/retry）、append-only 監査、outbox（記録のみ。消費者は未実装） |
| private | `server_sessions`, `local_credentials`, `mfa_totp`, `identity_links` | BFF セッション、ローカル資格情報（scrypt）、TOTP secret（AES-256-GCM 暗号化）、Supabase Auth との ID 対応 |

`public._raylow_migrations` は `scripts/db-migrate.mjs` が作る適用履歴表（migration ファイル外）。
