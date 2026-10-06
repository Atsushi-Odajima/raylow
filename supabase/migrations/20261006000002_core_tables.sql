-- RayLaw v2 migration 0002: core tables (§8)
-- 方針: UUID 主キー、org_id、created_at/updated_at、created_by、version integer。
-- timestamptz は UTC 保存。日付のみは date。氏名・住所・番号は text（数値型にしない）。

-- ---------- 共通 ----------
CREATE OR REPLACE FUNCTION app.tg_touch_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;

-- ---------- 利用者 ----------
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_raw text NOT NULL,
  email_key text NOT NULL,
  display_name_raw text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'left')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (email_key)
);

-- ---------- 組織 ----------
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_raw text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE public.memberships (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'lawyer', 'staff')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'left')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE public.office_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  name_raw text NOT NULL,
  address_raw text NOT NULL DEFAULT '',
  postcode_raw text NOT NULL DEFAULT '',
  phone_raw text NOT NULL DEFAULT '',
  fax_raw text NOT NULL DEFAULT '',
  email_raw text NOT NULL DEFAULT '',
  signature_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  honorific_settings jsonb NOT NULL DEFAULT '{"person":"様","lawyer":"先生","organization":"御中","court":"御中"}'::jsonb,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (org_id, revision)
);
CREATE UNIQUE INDEX office_profiles_current_uq ON public.office_profiles (org_id) WHERE is_current;

CREATE TABLE public.lawyers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.app_users(id),
  name_raw text NOT NULL,
  kana text NOT NULL DEFAULT '',
  office_profile_id uuid REFERENCES public.office_profiles(id),
  title_raw text NOT NULL DEFAULT '弁護士',
  registration_number_raw text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  search_key text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (org_id, user_id)
);

-- ---------- 連絡先 ----------
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('person', 'organization', 'lawyer')),
  name_raw text NOT NULL,
  kana text NOT NULL DEFAULT '',
  organization_name_raw text NOT NULL DEFAULT '',
  address_raw text NOT NULL DEFAULT '',
  postcode_raw text NOT NULL DEFAULT '',
  channels_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_id text,
  checked_at timestamptz,
  search_key text NOT NULL DEFAULT '',
  notes_raw text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX contacts_external_id_uq ON public.contacts (org_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX contacts_search_key_idx ON public.contacts (org_id, search_key);

CREATE TABLE public.contact_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  alias_raw text NOT NULL,
  search_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id)
);
CREATE INDEX contact_aliases_search_key_idx ON public.contact_aliases (org_id, search_key);

CREATE TABLE public.contact_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  UNIQUE (contact_id, revision)
);

-- ---------- 案件 ----------
CREATE TABLE public.matters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title_raw text NOT NULL,
  case_number_raw text NOT NULL DEFAULT '',
  case_number_struct jsonb,
  court_raw text NOT NULL DEFAULT '',
  court_department_raw text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'closed')),
  acceptance_status text NOT NULL DEFAULT 'unconfirmed' CHECK (acceptance_status IN ('unconfirmed', 'confirmed', 'declined')),
  acceptance_checked_by uuid REFERENCES public.app_users(id),
  acceptance_checked_at timestamptz,
  scope_raw text NOT NULL DEFAULT '',
  lead_lawyer_id uuid REFERENCES public.lawyers(id),
  legal_hold boolean NOT NULL DEFAULT false,
  archive_reason_raw text,
  external_id text,
  search_key text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX matters_external_id_uq ON public.matters (org_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE public.matter_members (
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  can_edit boolean NOT NULL DEFAULT true,
  approved_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  PRIMARY KEY (matter_id, user_id)
);

CREATE TABLE public.matter_barriers (
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  PRIMARY KEY (matter_id, user_id)
);

CREATE TABLE public.matter_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id),
  role text NOT NULL CHECK (role IN ('client', 'opponent', 'co_party', 'third_party')),
  position_raw text NOT NULL DEFAULT '',
  representative_id uuid REFERENCES public.contacts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX matter_parties_matter_idx ON public.matter_parties (matter_id);

CREATE TABLE public.matter_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  lawyer_contact_id uuid NOT NULL REFERENCES public.contacts(id),
  represented_party_id uuid NOT NULL REFERENCES public.matter_parties(id) ON DELETE CASCADE,
  valid_from date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX matter_agents_matter_idx ON public.matter_agents (matter_id);

-- ---------- ファイル ----------
CREATE TABLE public.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id uuid REFERENCES public.matters(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('matter', 'template', 'output', 'packet', 'export', 'receipt')),
  storage_key text NOT NULL UNIQUE,
  original_name_raw text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL CHECK (size >= 0),
  sha256 text NOT NULL,
  scan_status text NOT NULL DEFAULT 'quarantine' CHECK (scan_status IN ('quarantine', 'scanning', 'clean', 'infected', 'rejected', 'scan_failed')),
  scan_report jsonb,
  confidential boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX files_matter_idx ON public.files (org_id, matter_id);

CREATE TABLE public.file_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'original' CHECK (kind IN ('original', 'derived_pdf', 'native_text', 'ocr_text', 'safe_preview', 'submission_pdf')),
  encoding_name text,
  derived_from_id uuid REFERENCES public.file_versions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  UNIQUE (file_id, revision)
);

CREATE TABLE public.source_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  file_version_id uuid NOT NULL REFERENCES public.file_versions(id),
  page integer,
  rect jsonb,
  text_version_id uuid REFERENCES public.file_versions(id),
  quote_raw text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id)
);

-- ---------- 書式 ----------
CREATE TABLE public.renderer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  settings jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE public.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  active_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE public.template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  docx_file_id uuid NOT NULL REFERENCES public.files(id),
  docx_sha256 text NOT NULL,
  field_schema jsonb NOT NULL,
  kind text NOT NULL,
  scope text NOT NULL,
  applicability jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url text,
  checked_at date,
  license_note text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'testing', 'published', 'retired')),
  sample_only boolean NOT NULL DEFAULT true,
  approved_by uuid REFERENCES public.app_users(id),
  approved_at timestamptz,
  renderer_profile_id uuid REFERENCES public.renderer_profiles(id),
  inspection_report jsonb,
  tag_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (template_id, revision)
);
ALTER TABLE public.templates ADD CONSTRAINT templates_active_version_fk FOREIGN KEY (active_version_id) REFERENCES public.template_versions(id) DEFERRABLE INITIALLY DEFERRED;

-- ---------- 文例 ----------
CREATE TABLE public.phrase_libraries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT '',
  template_kind text,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE public.phrase_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phrase_id uuid NOT NULL REFERENCES public.phrase_libraries(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  body_raw text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'retired')),
  approved_by uuid REFERENCES public.app_users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  UNIQUE (phrase_id, revision)
);
ALTER TABLE public.phrase_libraries ADD CONSTRAINT phrase_current_version_fk FOREIGN KEY (current_version_id) REFERENCES public.phrase_versions(id) DEFERRABLE INITIALLY DEFERRED;

-- ---------- 草案 ----------
CREATE TABLE public.drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.templates(id),
  kind text NOT NULL,
  title_raw text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'rendering', 'ready_for_review', 'in_review', 'changes_requested', 'approved', 'superseded', 'archived')),
  recipient_type text NOT NULL CHECK (recipient_type IN ('opponent_agent', 'opponent', 'client', 'court', 'third_party', 'none')),
  recipient_contact_id uuid REFERENCES public.contacts(id),
  current_revision_id uuid,
  approved_revision_id uuid,
  idempotency_key text,
  batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX drafts_idempotency_uq ON public.drafts (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX drafts_matter_idx ON public.drafts (org_id, matter_id, updated_at DESC);

CREATE TABLE public.draft_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  template_version_id uuid NOT NULL REFERENCES public.template_versions(id),
  snapshot_json jsonb NOT NULL,
  ast_json jsonb NOT NULL,
  source_revision_id uuid REFERENCES public.draft_revisions(id),
  kind text NOT NULL DEFAULT 'app' CHECK (kind IN ('app', 'external_edit')),
  external_file_version_id uuid REFERENCES public.file_versions(id),
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  UNIQUE (draft_id, revision)
);
ALTER TABLE public.drafts ADD CONSTRAINT drafts_current_revision_fk FOREIGN KEY (current_revision_id) REFERENCES public.draft_revisions(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.drafts ADD CONSTRAINT drafts_approved_revision_fk FOREIGN KEY (approved_revision_id) REFERENCES public.draft_revisions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.draft_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES public.draft_revisions(id) ON DELETE CASCADE,
  format text NOT NULL CHECK (format IN ('docx', 'pdf')),
  mode text NOT NULL CHECK (mode IN ('draft', 'final')),
  file_id uuid NOT NULL REFERENCES public.files(id),
  sha256 text NOT NULL,
  renderer_version text NOT NULL,
  font_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  preflight_report jsonb,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'failed', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id)
);
CREATE INDEX draft_outputs_revision_idx ON public.draft_outputs (revision_id);

CREATE TABLE public.edit_leases (
  draft_id uuid PRIMARY KEY REFERENCES public.drafts(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id),
  expires_at timestamptz NOT NULL,
  takeover_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- 一括 ----------
CREATE TABLE public.batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'partial_failed', 'succeeded', 'failed', 'cancelled')),
  idempotency_key text NOT NULL,
  purpose text NOT NULL DEFAULT 'drafts' CHECK (purpose IN ('drafts', 'submission_pack')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (org_id, idempotency_key)
);

CREATE TABLE public.batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  draft_id uuid REFERENCES public.drafts(id),
  template_version_id uuid NOT NULL REFERENCES public.template_versions(id),
  recipient_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  error_code text,
  error_message text,
  job_id uuid,
  attempt integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX batch_items_batch_idx ON public.batch_items (batch_id);

-- ---------- レビュー ----------
CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES public.draft_revisions(id) ON DELETE CASCADE,
  target_hash text NOT NULL,
  target_output_pdf_sha256 text,
  target_output_docx_sha256 text,
  reviewer_id uuid REFERENCES public.app_users(id),
  requested_by uuid REFERENCES public.app_users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'changes_requested', 'withdrawn')),
  decision_reason text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX reviews_revision_idx ON public.reviews (revision_id);

CREATE TABLE public.review_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  block_id text,
  field_key text,
  body_raw text NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id)
);

-- ---------- 証拠 ----------
CREATE TABLE public.evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  symbol_raw text NOT NULL,
  number_raw text NOT NULL,
  branch_raw text,
  canonical_number text NOT NULL,
  display_label text NOT NULL,
  file_version_id uuid REFERENCES public.file_versions(id),
  title_raw text NOT NULL DEFAULT '',
  author_raw text NOT NULL DEFAULT '',
  date_raw text NOT NULL DEFAULT '',
  date_iso text,
  original_copy text NOT NULL DEFAULT 'copy' CHECK (original_copy IN ('original', 'copy')),
  proof_purpose_raw text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'submitted', 'superseded')),
  superseded_by uuid REFERENCES public.evidence(id),
  correction_reason_raw text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1
);
-- 同じ案件の確定証拠番号 canonical 複合キー一意
CREATE UNIQUE INDEX evidence_canonical_uq ON public.evidence (matter_id, canonical_number) WHERE status IN ('confirmed', 'submitted');
CREATE INDEX evidence_matter_idx ON public.evidence (matter_id);

-- ---------- 提出パック ----------
CREATE TABLE public.court_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  name text NOT NULL,
  source_url text,
  checked_at date,
  applicable_procedure text NOT NULL DEFAULT 'generic',
  file_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  page_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  naming_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1,
  title_raw text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'checking', 'blocked', 'ready', 'rendering', 'rendered', 'failed', 'archived')),
  court_profile_id uuid REFERENCES public.court_profiles(id),
  manifest_json jsonb,
  hash text,
  file_id uuid REFERENCES public.files(id),
  check_report jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE public.packet_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  packet_id uuid NOT NULL REFERENCES public.packets(id) ON DELETE CASCADE,
  output_id uuid REFERENCES public.draft_outputs(id),
  file_version_id uuid REFERENCES public.file_versions(id),
  evidence_id uuid REFERENCES public.evidence(id),
  order_no integer NOT NULL,
  display_name_raw text NOT NULL DEFAULT '',
  external_output_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (packet_id, order_no),
  CHECK (output_id IS NOT NULL OR file_version_id IS NOT NULL)
);

-- ---------- 送付/提出記録 ----------
CREATE TABLE public.dispatch_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  packet_id uuid REFERENCES public.packets(id),
  output_id uuid REFERENCES public.draft_outputs(id),
  recipient_snapshot jsonb NOT NULL,
  method text NOT NULL,
  sent_at timestamptz NOT NULL,
  receipt_raw text NOT NULL DEFAULT '',
  receipt_file_id uuid REFERENCES public.files(id),
  received_documents_raw text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'received_verified')),
  recorded_by uuid REFERENCES public.app_users(id),
  verified_by uuid REFERENCES public.app_users(id),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CHECK (packet_id IS NOT NULL OR output_id IS NOT NULL)
);

-- ---------- ジョブ ----------
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id uuid REFERENCES public.matters(id) ON DELETE CASCADE,
  type text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  scope_key text NOT NULL DEFAULT '',
  input_hash text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  lease_until timestamptz,
  worker_id text,
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL DEFAULT now(),
  progress_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX jobs_dedupe_uq ON public.jobs (org_id, type, scope_key, input_hash) WHERE state IN ('queued', 'running');
CREATE INDEX jobs_claim_idx ON public.jobs (state, run_after) WHERE state = 'queued';

-- ---------- 監査 / outbox ----------
CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  matter_id uuid,
  actor_id uuid,
  actor_role text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  target_version integer,
  target_hash text,
  request_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_idx ON public.audit_events (org_id, created_at DESC);
CREATE INDEX audit_events_matter_idx ON public.audit_events (matter_id, created_at DESC);

CREATE TABLE public.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  event_type text NOT NULL,
  payload_ref text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- version/updated_at trigger
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_users','organizations','memberships','office_profiles','lawyers','contacts','matters','matter_parties','matter_agents','files','renderer_profiles','templates','template_versions','phrase_libraries','drafts','batches','reviews','evidence','packets','dispatch_records','jobs']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.tg_touch_version()', t, t);
  END LOOP;
END
$$;
