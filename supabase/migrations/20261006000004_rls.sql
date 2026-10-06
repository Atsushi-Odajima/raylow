-- RayLaw v2 migration 0004: GRANT + RLS（§20.1）
-- 層: Postgres RLS / SQL GRANT / private Storage / BFF。本人 claims を BFF から DB へ渡し、worker だけ service_role。

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
-- audit は通常 role に UPDATE/DELETE なし（さらに trigger で append-only）
REVOKE UPDATE, DELETE ON public.audit_events FROM authenticated, service_role;
REVOKE DELETE ON public.draft_revisions, public.draft_outputs, public.file_versions, public.contact_versions FROM authenticated;
-- 一般 role は jobs を直接 claim しない（worker のみ）
REVOKE UPDATE ON public.jobs FROM authenticated;
GRANT UPDATE (cancel_requested) ON public.jobs TO authenticated;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lawyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_barriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renderer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phrase_libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phrase_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edit_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packet_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox ENABLE ROW LEVEL SECURITY;

-- FORCE: 所有者にも適用（素の Postgres で migration を実行した owner が BFF ロールと同じ場合の保険）
-- ※ service_role は BYPASSRLS。

-- 利用者: 同じ org のメンバーのみ表示（名前のみ）。自分の行は常に表示。
CREATE POLICY app_users_select ON public.app_users FOR SELECT TO authenticated USING (
  id = app.current_user_id() OR EXISTS (
    SELECT 1 FROM public.memberships a JOIN public.memberships b ON a.org_id = b.org_id
    WHERE a.user_id = app.current_user_id() AND a.status = 'active' AND b.user_id = public.app_users.id
  )
);
CREATE POLICY app_users_update_self ON public.app_users FOR UPDATE TO authenticated USING (id = app.current_user_id());

CREATE POLICY organizations_select ON public.organizations FOR SELECT TO authenticated USING (app.is_org_member(id));
CREATE POLICY organizations_update_admin ON public.organizations FOR UPDATE TO authenticated USING (app.org_role(id) = 'admin');

CREATE POLICY memberships_select ON public.memberships FOR SELECT TO authenticated USING (app.is_org_member(org_id));
CREATE POLICY memberships_write_admin ON public.memberships FOR ALL TO authenticated USING (app.org_role(org_id) = 'admin') WITH CHECK (app.org_role(org_id) = 'admin');

-- org 共通マスター: org メンバーが閲覧、編集は admin/lawyer（staff も連絡先/事務所は編集可とする所内運用が多いため staff にも許可。最終承認は別）
CREATE POLICY office_profiles_select ON public.office_profiles FOR SELECT TO authenticated USING (app.is_org_member(org_id));
CREATE POLICY office_profiles_write ON public.office_profiles FOR ALL TO authenticated USING (app.is_org_member(org_id)) WITH CHECK (app.is_org_member(org_id));
CREATE POLICY lawyers_select ON public.lawyers FOR SELECT TO authenticated USING (app.is_org_member(org_id));
CREATE POLICY lawyers_write ON public.lawyers FOR ALL TO authenticated USING (app.org_role(org_id) IN ('admin', 'lawyer')) WITH CHECK (app.org_role(org_id) IN ('admin', 'lawyer'));
CREATE POLICY contacts_select ON public.contacts FOR SELECT TO authenticated USING (app.is_org_member(org_id));
CREATE POLICY contacts_write ON public.contacts FOR ALL TO authenticated USING (app.is_org_member(org_id)) WITH CHECK (app.is_org_member(org_id));
CREATE POLICY contact_aliases_all ON public.contact_aliases FOR ALL TO authenticated USING (app.is_org_member(org_id)) WITH CHECK (app.is_org_member(org_id));
CREATE POLICY contact_versions_all ON public.contact_versions FOR ALL TO authenticated USING (app.is_org_member(org_id)) WITH CHECK (app.is_org_member(org_id));

-- 案件: member かつ barrier なし。admin も全件閲覧不可。INSERT は org の lawyer/admin（最初の作成 lawyer に membership を API が付与）。
CREATE POLICY matters_select ON public.matters FOR SELECT TO authenticated USING (app.can_access_matter(id));
CREATE POLICY matters_insert ON public.matters FOR INSERT TO authenticated WITH CHECK (app.org_role(org_id) IN ('admin', 'lawyer', 'staff'));
CREATE POLICY matters_update ON public.matters FOR UPDATE TO authenticated USING (app.can_access_matter(id) AND EXISTS (SELECT 1 FROM public.matter_members mm WHERE mm.matter_id = id AND mm.user_id = app.current_user_id() AND mm.can_edit));
CREATE POLICY matters_delete ON public.matters FOR DELETE TO authenticated USING (false);

CREATE POLICY matter_members_select ON public.matter_members FOR SELECT TO authenticated USING (app.can_access_matter(matter_id) OR user_id = app.current_user_id());
CREATE POLICY matter_members_write ON public.matter_members FOR ALL TO authenticated USING (app.is_assigned_lawyer(matter_id) OR app.org_role(org_id) = 'admin') WITH CHECK (app.is_org_member(org_id) AND (app.is_assigned_lawyer(matter_id) OR app.org_role(org_id) = 'admin' OR created_by = app.current_user_id()));
CREATE POLICY matter_barriers_select ON public.matter_barriers FOR SELECT TO authenticated USING (app.org_role(org_id) = 'admin' OR app.is_assigned_lawyer(matter_id));
CREATE POLICY matter_barriers_write ON public.matter_barriers FOR ALL TO authenticated USING (app.org_role(org_id) = 'admin' OR app.is_assigned_lawyer(matter_id)) WITH CHECK (app.org_role(org_id) = 'admin' OR app.is_assigned_lawyer(matter_id));

CREATE POLICY matter_parties_select ON public.matter_parties FOR SELECT TO authenticated USING (app.can_access_matter(matter_id));
CREATE POLICY matter_parties_write ON public.matter_parties FOR ALL TO authenticated USING (app.can_edit_matter(matter_id)) WITH CHECK (app.can_edit_matter(matter_id));
CREATE POLICY matter_agents_select ON public.matter_agents FOR SELECT TO authenticated USING (app.can_access_matter(matter_id));
CREATE POLICY matter_agents_write ON public.matter_agents FOR ALL TO authenticated USING (app.can_edit_matter(matter_id)) WITH CHECK (app.can_edit_matter(matter_id));

-- ファイル: matter scope は案件 ACL、template/export scope は org
CREATE POLICY files_select ON public.files FOR SELECT TO authenticated USING (
  app.is_org_member(org_id) AND (matter_id IS NULL OR app.can_access_matter(matter_id))
);
CREATE POLICY files_write ON public.files FOR ALL TO authenticated USING (
  app.is_org_member(org_id) AND (matter_id IS NULL OR app.can_edit_matter(matter_id))
) WITH CHECK (
  app.is_org_member(org_id) AND (matter_id IS NULL OR app.can_edit_matter(matter_id))
);
CREATE POLICY file_versions_select ON public.file_versions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.files f WHERE f.id = file_id AND app.is_org_member(f.org_id) AND (f.matter_id IS NULL OR app.can_access_matter(f.matter_id)))
);
CREATE POLICY file_versions_insert ON public.file_versions FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.files f WHERE f.id = file_id AND app.is_org_member(f.org_id) AND (f.matter_id IS NULL OR app.can_edit_matter(f.matter_id)))
);
CREATE POLICY source_refs_select ON public.source_refs FOR SELECT TO authenticated USING (app.can_access_matter(matter_id));
CREATE POLICY source_refs_write ON public.source_refs FOR ALL TO authenticated USING (app.can_edit_matter(matter_id)) WITH CHECK (app.can_edit_matter(matter_id));

-- 書式/文例: org 権限
CREATE POLICY renderer_profiles_select ON public.renderer_profiles FOR SELECT TO authenticated USING (org_id IS NULL OR app.is_org_member(org_id));
CREATE POLICY renderer_profiles_write ON public.renderer_profiles FOR ALL TO authenticated USING (org_id IS NOT NULL AND app.org_role(org_id) IN ('admin', 'lawyer')) WITH CHECK (org_id IS NOT NULL AND app.org_role(org_id) IN ('admin', 'lawyer'));
CREATE POLICY templates_select ON public.templates FOR SELECT TO authenticated USING (app.is_org_member(org_id));
CREATE POLICY templates_write ON public.templates FOR ALL TO authenticated USING (app.is_org_member(org_id)) WITH CHECK (app.is_org_member(org_id));
CREATE POLICY template_versions_select ON public.template_versions FOR SELECT TO authenticated USING (app.is_org_member(org_id));
CREATE POLICY template_versions_write ON public.template_versions FOR ALL TO authenticated USING (app.is_org_member(org_id)) WITH CHECK (app.is_org_member(org_id));
CREATE POLICY phrase_libraries_all ON public.phrase_libraries FOR ALL TO authenticated USING (app.is_org_member(org_id)) WITH CHECK (app.is_org_member(org_id));
CREATE POLICY phrase_versions_all ON public.phrase_versions FOR ALL TO authenticated USING (app.is_org_member(org_id)) WITH CHECK (app.is_org_member(org_id));

-- 草案系: 案件 ACL
CREATE POLICY drafts_select ON public.drafts FOR SELECT TO authenticated USING (app.can_access_matter(matter_id));
CREATE POLICY drafts_write ON public.drafts FOR ALL TO authenticated USING (app.can_edit_matter(matter_id)) WITH CHECK (app.can_edit_matter(matter_id));
CREATE POLICY draft_revisions_select ON public.draft_revisions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.drafts d WHERE d.id = draft_id AND app.can_access_matter(d.matter_id)));
CREATE POLICY draft_revisions_insert ON public.draft_revisions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.drafts d WHERE d.id = draft_id AND app.can_edit_matter(d.matter_id)));
CREATE POLICY draft_outputs_select ON public.draft_outputs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.draft_revisions r JOIN public.drafts d ON d.id = r.draft_id WHERE r.id = revision_id AND app.can_access_matter(d.matter_id)));
CREATE POLICY draft_outputs_write ON public.draft_outputs FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.draft_revisions r JOIN public.drafts d ON d.id = r.draft_id WHERE r.id = revision_id AND app.can_edit_matter(d.matter_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.draft_revisions r JOIN public.drafts d ON d.id = r.draft_id WHERE r.id = revision_id AND app.can_edit_matter(d.matter_id)));
CREATE POLICY edit_leases_all ON public.edit_leases FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.drafts d WHERE d.id = draft_id AND app.can_access_matter(d.matter_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.drafts d WHERE d.id = draft_id AND app.can_edit_matter(d.matter_id)));

CREATE POLICY batches_select ON public.batches FOR SELECT TO authenticated USING (app.can_access_matter(matter_id));
CREATE POLICY batches_write ON public.batches FOR ALL TO authenticated USING (app.can_edit_matter(matter_id)) WITH CHECK (app.can_edit_matter(matter_id));
CREATE POLICY batch_items_select ON public.batch_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.batches b WHERE b.id = batch_id AND app.can_access_matter(b.matter_id)));
CREATE POLICY batch_items_write ON public.batch_items FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.batches b WHERE b.id = batch_id AND app.can_edit_matter(b.matter_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.batches b WHERE b.id = batch_id AND app.can_edit_matter(b.matter_id)));

CREATE POLICY reviews_select ON public.reviews FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.draft_revisions r JOIN public.drafts d ON d.id = r.draft_id WHERE r.id = revision_id AND app.can_access_matter(d.matter_id)));
CREATE POLICY reviews_write ON public.reviews FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.draft_revisions r JOIN public.drafts d ON d.id = r.draft_id WHERE r.id = revision_id AND app.can_access_matter(d.matter_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.draft_revisions r JOIN public.drafts d ON d.id = r.draft_id WHERE r.id = revision_id AND app.can_access_matter(d.matter_id)));
CREATE POLICY review_comments_all ON public.review_comments FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.reviews rv JOIN public.draft_revisions r ON r.id = rv.revision_id JOIN public.drafts d ON d.id = r.draft_id WHERE rv.id = review_id AND app.can_access_matter(d.matter_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.reviews rv JOIN public.draft_revisions r ON r.id = rv.revision_id JOIN public.drafts d ON d.id = r.draft_id WHERE rv.id = review_id AND app.can_access_matter(d.matter_id)));

CREATE POLICY evidence_select ON public.evidence FOR SELECT TO authenticated USING (app.can_access_matter(matter_id));
CREATE POLICY evidence_write ON public.evidence FOR ALL TO authenticated USING (app.can_edit_matter(matter_id)) WITH CHECK (app.can_edit_matter(matter_id));

CREATE POLICY court_profiles_select ON public.court_profiles FOR SELECT TO authenticated USING (org_id IS NULL OR app.is_org_member(org_id));
CREATE POLICY court_profiles_write ON public.court_profiles FOR ALL TO authenticated USING (org_id IS NOT NULL AND app.org_role(org_id) IN ('admin', 'lawyer')) WITH CHECK (org_id IS NOT NULL AND app.org_role(org_id) IN ('admin', 'lawyer'));
CREATE POLICY packets_select ON public.packets FOR SELECT TO authenticated USING (app.can_access_matter(matter_id));
CREATE POLICY packets_write ON public.packets FOR ALL TO authenticated USING (app.can_edit_matter(matter_id)) WITH CHECK (app.can_edit_matter(matter_id));
CREATE POLICY packet_items_all ON public.packet_items FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.packets p WHERE p.id = packet_id AND app.can_access_matter(p.matter_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.packets p WHERE p.id = packet_id AND app.can_edit_matter(p.matter_id)));
CREATE POLICY dispatch_select ON public.dispatch_records FOR SELECT TO authenticated USING (app.can_access_matter(matter_id));
CREATE POLICY dispatch_write ON public.dispatch_records FOR ALL TO authenticated USING (app.can_edit_matter(matter_id)) WITH CHECK (app.can_edit_matter(matter_id));

-- jobs: 案件 job は案件 ACL、org job（import/export/template inspect）は org
CREATE POLICY jobs_select ON public.jobs FOR SELECT TO authenticated USING (app.is_org_member(org_id) AND (matter_id IS NULL OR app.can_access_matter(matter_id)));
CREATE POLICY jobs_insert ON public.jobs FOR INSERT TO authenticated WITH CHECK (app.is_org_member(org_id) AND (matter_id IS NULL OR app.can_edit_matter(matter_id)));
CREATE POLICY jobs_cancel ON public.jobs FOR UPDATE TO authenticated USING (app.is_org_member(org_id) AND (matter_id IS NULL OR app.can_edit_matter(matter_id)));

-- 監査: 権限のある案件/org のみ。本文は details に入れない運用。
CREATE POLICY audit_select ON public.audit_events FOR SELECT TO authenticated USING (
  app.is_org_member(org_id) AND (matter_id IS NULL OR app.can_access_matter(matter_id))
  AND (matter_id IS NOT NULL OR app.org_role(org_id) = 'admin' OR actor_id = app.current_user_id())
);
CREATE POLICY audit_insert ON public.audit_events FOR INSERT TO authenticated WITH CHECK (app.is_org_member(org_id) AND actor_id = app.current_user_id());
CREATE POLICY outbox_insert ON public.outbox FOR INSERT TO authenticated WITH CHECK (app.is_org_member(org_id));
CREATE POLICY outbox_select_admin ON public.outbox FOR SELECT TO authenticated USING (app.org_role(org_id) = 'admin');
