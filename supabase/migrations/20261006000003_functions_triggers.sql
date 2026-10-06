-- RayLaw v2 migration 0003: ACL functions, cross-org guards, append-only audit, job queue

-- ---------- ACL helper（SECURITY DEFINER は search_path 固定・schema-qualified） ----------
CREATE OR REPLACE FUNCTION app.is_org_member(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.org_id = p_org AND m.user_id = app.current_user_id() AND m.status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION app.org_role(p_org uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT m.role FROM public.memberships m
  WHERE m.org_id = p_org AND m.user_id = app.current_user_id() AND m.status = 'active'
  LIMIT 1
$$;

-- barrier 優先、member 必須。admin も事件本文の全件閲覧権を持たない。
CREATE OR REPLACE FUNCTION app.can_access_matter(p_matter uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT app.current_user_id() IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.matter_barriers b WHERE b.matter_id = p_matter AND b.user_id = app.current_user_id())
    AND EXISTS (
      SELECT 1 FROM public.matter_members mm
      JOIN public.matters mt ON mt.id = mm.matter_id
      JOIN public.memberships ms ON ms.org_id = mt.org_id AND ms.user_id = mm.user_id AND ms.status = 'active'
      WHERE mm.matter_id = p_matter AND mm.user_id = app.current_user_id()
    )
$$;

CREATE OR REPLACE FUNCTION app.can_edit_matter(p_matter uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT app.can_access_matter(p_matter)
    AND EXISTS (SELECT 1 FROM public.matter_members mm WHERE mm.matter_id = p_matter AND mm.user_id = app.current_user_id() AND mm.can_edit)
    AND NOT EXISTS (SELECT 1 FROM public.matters mt WHERE mt.id = p_matter AND mt.status <> 'active')
$$;

-- 案件に割り当てられた弁護士か（memberships.role=lawyer かつ matter_members）
CREATE OR REPLACE FUNCTION app.is_assigned_lawyer(p_matter uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matter_members mm
    JOIN public.matters mt ON mt.id = mm.matter_id
    JOIN public.memberships ms ON ms.org_id = mt.org_id AND ms.user_id = mm.user_id AND ms.status = 'active' AND ms.role = 'lawyer'
    JOIN public.lawyers l ON l.org_id = mt.org_id AND l.user_id = mm.user_id AND l.active
    WHERE mm.matter_id = p_matter AND mm.user_id = app.current_user_id()
  ) AND NOT EXISTS (SELECT 1 FROM public.matter_barriers b WHERE b.matter_id = p_matter AND b.user_id = app.current_user_id())
$$;

GRANT EXECUTE ON FUNCTION app.current_user_id(), app.current_request_id(), app.is_org_member(uuid), app.org_role(uuid), app.can_access_matter(uuid), app.can_edit_matter(uuid), app.is_assigned_lawyer(uuid) TO authenticated, service_role;

-- ---------- cross-org FK ガード ----------
-- SECURITY DEFINER: 同一 transaction で挿入直後（member 付与前）の行も参照できるよう RLS を迂回して org_id を読む。
-- search_path は固定し、参照は schema-qualified。
-- 使い方: CREATE TRIGGER ... EXECUTE FUNCTION app.tg_assert_same_org('contacts', 'contact_id')
CREATE OR REPLACE FUNCTION app.tg_assert_same_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  ref_table text := TG_ARGV[0];
  ref_col text := TG_ARGV[1];
  ref_id uuid;
  ref_org uuid;
  new_org uuid;
  rec jsonb := to_jsonb(NEW);
BEGIN
  ref_id := (rec ->> ref_col)::uuid;
  IF ref_id IS NULL THEN
    RETURN NEW;
  END IF;
  new_org := (rec ->> 'org_id')::uuid;
  EXECUTE format('SELECT org_id FROM public.%I WHERE id = $1', ref_table) INTO ref_org USING ref_id;
  IF ref_org IS NULL THEN
    RAISE EXCEPTION 'cross_org_reference: % % not found', ref_table, ref_id USING ERRCODE = '23503';
  END IF;
  IF ref_org IS DISTINCT FROM new_org THEN
    RAISE EXCEPTION 'cross_org_reference: % % belongs to another org', ref_table, ref_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

-- matter_id を持つテーブルの org 一致
CREATE TRIGGER matter_members_org BEFORE INSERT OR UPDATE ON public.matter_members FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matters', 'matter_id');
CREATE TRIGGER matter_barriers_org BEFORE INSERT OR UPDATE ON public.matter_barriers FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matters', 'matter_id');
CREATE TRIGGER matter_parties_org_matter BEFORE INSERT OR UPDATE ON public.matter_parties FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matters', 'matter_id');
CREATE TRIGGER matter_parties_org_contact BEFORE INSERT OR UPDATE ON public.matter_parties FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('contacts', 'contact_id');
CREATE TRIGGER matter_parties_org_rep BEFORE INSERT OR UPDATE ON public.matter_parties FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('contacts', 'representative_id');
CREATE TRIGGER matter_agents_org_matter BEFORE INSERT OR UPDATE ON public.matter_agents FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matters', 'matter_id');
CREATE TRIGGER matter_agents_org_contact BEFORE INSERT OR UPDATE ON public.matter_agents FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('contacts', 'lawyer_contact_id');
CREATE TRIGGER matter_agents_org_party BEFORE INSERT OR UPDATE ON public.matter_agents FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matter_parties', 'represented_party_id');
CREATE TRIGGER lawyers_org_profile BEFORE INSERT OR UPDATE ON public.lawyers FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('office_profiles', 'office_profile_id');
CREATE TRIGGER matters_org_lead BEFORE INSERT OR UPDATE ON public.matters FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('lawyers', 'lead_lawyer_id');
CREATE TRIGGER contact_aliases_org BEFORE INSERT OR UPDATE ON public.contact_aliases FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('contacts', 'contact_id');
CREATE TRIGGER contact_versions_org BEFORE INSERT OR UPDATE ON public.contact_versions FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('contacts', 'contact_id');
CREATE TRIGGER files_org_matter BEFORE INSERT OR UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matters', 'matter_id');
CREATE TRIGGER file_versions_org BEFORE INSERT OR UPDATE ON public.file_versions FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('files', 'file_id');
CREATE TRIGGER source_refs_org_matter BEFORE INSERT OR UPDATE ON public.source_refs FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matters', 'matter_id');
CREATE TRIGGER source_refs_org_fv BEFORE INSERT OR UPDATE ON public.source_refs FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('file_versions', 'file_version_id');
CREATE TRIGGER template_versions_org_t BEFORE INSERT OR UPDATE ON public.template_versions FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('templates', 'template_id');
CREATE TRIGGER template_versions_org_f BEFORE INSERT OR UPDATE ON public.template_versions FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('files', 'docx_file_id');
CREATE TRIGGER phrase_versions_org BEFORE INSERT OR UPDATE ON public.phrase_versions FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('phrase_libraries', 'phrase_id');
CREATE TRIGGER drafts_org_matter BEFORE INSERT OR UPDATE ON public.drafts FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matters', 'matter_id');
CREATE TRIGGER drafts_org_template BEFORE INSERT OR UPDATE ON public.drafts FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('templates', 'template_id');
CREATE TRIGGER drafts_org_recipient BEFORE INSERT OR UPDATE ON public.drafts FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('contacts', 'recipient_contact_id');
CREATE TRIGGER draft_revisions_org_d BEFORE INSERT OR UPDATE ON public.draft_revisions FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('drafts', 'draft_id');
CREATE TRIGGER draft_revisions_org_tv BEFORE INSERT OR UPDATE ON public.draft_revisions FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('template_versions', 'template_version_id');
CREATE TRIGGER draft_outputs_org BEFORE INSERT OR UPDATE ON public.draft_outputs FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('draft_revisions', 'revision_id');
CREATE TRIGGER draft_outputs_org_file BEFORE INSERT OR UPDATE ON public.draft_outputs FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('files', 'file_id');
CREATE TRIGGER edit_leases_org BEFORE INSERT OR UPDATE ON public.edit_leases FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('drafts', 'draft_id');
CREATE TRIGGER batches_org BEFORE INSERT OR UPDATE ON public.batches FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matters', 'matter_id');
CREATE TRIGGER batch_items_org_b BEFORE INSERT OR UPDATE ON public.batch_items FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('batches', 'batch_id');
CREATE TRIGGER batch_items_org_tv BEFORE INSERT OR UPDATE ON public.batch_items FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('template_versions', 'template_version_id');
CREATE TRIGGER reviews_org BEFORE INSERT OR UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('draft_revisions', 'revision_id');
CREATE TRIGGER review_comments_org BEFORE INSERT OR UPDATE ON public.review_comments FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('reviews', 'review_id');
CREATE TRIGGER evidence_org_matter BEFORE INSERT OR UPDATE ON public.evidence FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matters', 'matter_id');
CREATE TRIGGER evidence_org_fv BEFORE INSERT OR UPDATE ON public.evidence FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('file_versions', 'file_version_id');
CREATE TRIGGER packets_org BEFORE INSERT OR UPDATE ON public.packets FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matters', 'matter_id');
CREATE TRIGGER packet_items_org_p BEFORE INSERT OR UPDATE ON public.packet_items FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('packets', 'packet_id');
CREATE TRIGGER packet_items_org_o BEFORE INSERT OR UPDATE ON public.packet_items FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('draft_outputs', 'output_id');
CREATE TRIGGER packet_items_org_fv BEFORE INSERT OR UPDATE ON public.packet_items FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('file_versions', 'file_version_id');
CREATE TRIGGER dispatch_org_matter BEFORE INSERT OR UPDATE ON public.dispatch_records FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matters', 'matter_id');
CREATE TRIGGER dispatch_org_packet BEFORE INSERT OR UPDATE ON public.dispatch_records FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('packets', 'packet_id');
CREATE TRIGGER dispatch_org_output BEFORE INSERT OR UPDATE ON public.dispatch_records FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('draft_outputs', 'output_id');
CREATE TRIGGER jobs_org_matter BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION app.tg_assert_same_org('matters', 'matter_id');

-- 証拠: 同一案件内で file_version の案件一致
CREATE OR REPLACE FUNCTION app.tg_evidence_file_matter() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE fm uuid;
BEGIN
  IF NEW.file_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT f.matter_id INTO fm FROM public.file_versions fv JOIN public.files f ON f.id = fv.file_id WHERE fv.id = NEW.file_version_id;
  IF fm IS DISTINCT FROM NEW.matter_id THEN
    RAISE EXCEPTION 'evidence_file_matter_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER evidence_file_matter BEFORE INSERT OR UPDATE ON public.evidence FOR EACH ROW EXECUTE FUNCTION app.tg_evidence_file_matter();

-- 草案 revision と draft の template 一致、template_version の案件原資料参照禁止は API 側で検査

-- ---------- published 版の immutable ----------
CREATE OR REPLACE FUNCTION app.tg_template_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    IF NEW.status NOT IN ('published', 'retired') THEN
      RAISE EXCEPTION 'published_template_version_immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.field_schema IS DISTINCT FROM OLD.field_schema OR NEW.docx_file_id IS DISTINCT FROM OLD.docx_file_id OR NEW.docx_sha256 IS DISTINCT FROM OLD.docx_sha256 OR NEW.tag_map IS DISTINCT FROM OLD.tag_map OR NEW.renderer_profile_id IS DISTINCT FROM OLD.renderer_profile_id THEN
      RAISE EXCEPTION 'published_template_version_immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'retired_template_version_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER template_versions_immutable BEFORE UPDATE ON public.template_versions FOR EACH ROW EXECUTE FUNCTION app.tg_template_version_immutable();

-- draft_revisions / draft_outputs / contact_versions / audit は immutable
CREATE OR REPLACE FUNCTION app.tg_immutable_row() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'immutable_row: % does not allow %', TG_TABLE_NAME, TG_OP USING ERRCODE = '23514';
END
$$;
CREATE TRIGGER draft_revisions_immutable BEFORE UPDATE OR DELETE ON public.draft_revisions FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_row();
CREATE TRIGGER contact_versions_immutable BEFORE UPDATE OR DELETE ON public.contact_versions FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_row();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION app.tg_immutable_row();
-- file_versions: bytes/hash/kind は不変。encoding_name（検査で判明するテキスト添付の文字コード）だけ後から設定できる
CREATE OR REPLACE FUNCTION app.tg_file_versions_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'immutable_row: file_versions cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.size IS DISTINCT FROM OLD.size OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.file_id IS DISTINCT FROM OLD.file_id OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.derived_from_id IS DISTINCT FROM OLD.derived_from_id OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'immutable_row: file_versions bytes/identity cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER file_versions_immutable BEFORE UPDATE OR DELETE ON public.file_versions FOR EACH ROW EXECUTE FUNCTION app.tg_file_versions_guard();

-- draft_outputs: bytes を上書きしない（status 変更のみ許可）
CREATE OR REPLACE FUNCTION app.tg_draft_outputs_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'immutable_row: draft_outputs cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.file_id IS DISTINCT FROM OLD.file_id OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.format IS DISTINCT FROM OLD.format OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.revision_id IS DISTINCT FROM OLD.revision_id THEN
    RAISE EXCEPTION 'immutable_row: draft_outputs bytes/identity cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER draft_outputs_guard BEFORE UPDATE OR DELETE ON public.draft_outputs FOR EACH ROW EXECUTE FUNCTION app.tg_draft_outputs_guard();

-- 最後の admin 削除禁止
CREATE OR REPLACE FUNCTION app.tg_keep_last_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE remaining integer;
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'admin' AND OLD.status = 'active')
     OR (TG_OP = 'UPDATE' AND OLD.role = 'admin' AND OLD.status = 'active' AND (NEW.role <> 'admin' OR NEW.status <> 'active')) THEN
    SELECT count(*) INTO remaining FROM public.memberships m WHERE m.org_id = OLD.org_id AND m.role = 'admin' AND m.status = 'active' AND m.user_id <> OLD.user_id;
    IF remaining = 0 THEN
      RAISE EXCEPTION 'last_admin_cannot_be_removed' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER memberships_keep_last_admin BEFORE UPDATE OR DELETE ON public.memberships FOR EACH ROW EXECUTE FUNCTION app.tg_keep_last_admin();

-- legal_hold 中の案件は削除禁止、archived は書込み停止（status/legal_hold/archive_reason の変更は許可）
CREATE OR REPLACE FUNCTION app.tg_matter_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.legal_hold THEN
      RAISE EXCEPTION 'matter_legal_hold' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER matters_guard BEFORE DELETE ON public.matters FOR EACH ROW EXECUTE FUNCTION app.tg_matter_guard();

-- ---------- ジョブ claim（FOR UPDATE SKIP LOCKED、lease 120 秒） ----------
CREATE OR REPLACE FUNCTION app.claim_job(p_worker text, p_types text[], p_lease_seconds integer DEFAULT 120)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.jobs
  WHERE state = 'queued' AND run_after <= now() AND type = ANY (p_types) AND NOT cancel_requested
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public.jobs SET state = 'running', worker_id = p_worker, lease_until = now() + make_interval(secs => p_lease_seconds), attempt = attempt + 1
  WHERE id = j.id
  RETURNING * INTO j;
  RETURN NEXT j;
END
$$;

CREATE OR REPLACE FUNCTION app.heartbeat_job(p_job uuid, p_worker text, p_lease_seconds integer DEFAULT 120, p_progress jsonb DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.jobs SET lease_until = now() + make_interval(secs => p_lease_seconds), progress_json = COALESCE(p_progress, progress_json)
  WHERE id = p_job AND worker_id = p_worker AND state = 'running';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$$;

-- lease 切れの running job を queued へ戻す（attempt 上限で failed）
CREATE OR REPLACE FUNCTION app.requeue_expired_jobs() RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.jobs SET
    state = CASE WHEN attempt >= max_attempts THEN 'failed' ELSE 'queued' END,
    error_code = CASE WHEN attempt >= max_attempts THEN 'lease_expired' ELSE error_code END,
    worker_id = NULL,
    lease_until = NULL,
    run_after = now() + make_interval(secs => CASE WHEN attempt = 1 THEN 30 ELSE 120 END)
  WHERE state = 'running' AND lease_until < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

GRANT EXECUTE ON FUNCTION app.claim_job(text, text[], integer), app.heartbeat_job(uuid, text, integer, jsonb), app.requeue_expired_jobs() TO service_role;
