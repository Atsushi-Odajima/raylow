# RayLaw v2 権限表

出典: `supabase/migrations/20261006000004_rls.sql`（RLS）、`20261006000003_functions_triggers.sql`（ACL 関数）、`apps/api/src/plugins/auth.ts`（認証プラグイン）、`apps/api/src/routes/*.ts`（ルート毎の制約）、`packages/domain/src/acl.ts`（承認ルール）。

## 1. 主体（ロール）

| 主体 | 由来 | 概要 |
|---|---|---|
| anon | 未認証 | `public: true` のルート（login / session / health）のみ |
| admin | `memberships.role='admin'` | ユーザー・基盤管理。**事件本文の全件閲覧権なし**（案件は member になった場合のみ） |
| lawyer | `memberships.role='lawyer'` | 書式公開・文例承認・案件担当。最終承認は `lawyers.user_id` が一致し案件 member である場合のみ |
| staff | `memberships.role='staff'` | マスター・草案編集可。最終承認・書式公開・文例承認・メンバー管理は不可 |
| worker (service_role) | `DATABASE_URL_SERVICE` | BYPASSRLS。job claim / heartbeat / 出力・監査の書込み。各 handler で job の org/matter を再確認 |
| BFF 内部 (service_role) | `withServiceTx` | セッション・資格情報・MFA（private schema）とメンバー招待のみ |

DB 接続: BFF は `withUserTx` で `SET LOCAL ROLE authenticated` + `request.jwt.claims={sub,role,org_id,app_role}` を設定して RLS を適用する。クライアントの role/actorId は一切使わず、`private.server_sessions` から決定する。

## 2. 認証プラグインの共通規則（`apps/api/src/plugins/auth.ts`）

| 規則 | 内容 |
|---|---|
| Origin 検査 | GET/HEAD/OPTIONS 以外は `Origin`（無ければ `Referer`）が `ALLOWED_ORIGINS` に含まれない限り 403 `origin_not_allowed`。public ルートにも適用 |
| 認証 | cookie `raylow_sid` → `private.server_sessions`（失効・idle 30 分・absolute 12 時間・user/membership 非 active で null）。無ければ 401 |
| CSRF | 変更系は `X-CSRF-Token` が `csrf_token_hash` と一致しないと 403 `csrf_failed` |
| MFA | `mfa_pending=true` のセッションは `allowMfaPending` ルート以外 401 `mfa_required` |
| requireRecentMfa | `last_mfa_at` が 15 分以内でないと 401 `mfa_required` |
| roles | `roles: [...]` に含まれない role は 403 |

## 3. 操作 × ロール マトリクス

凡例: ○ = 可、△ = 条件付き、× = 不可、— = 対象外。「案件 ACL」= `app.can_access_matter`（閲覧）/ `app.can_edit_matter`（編集、案件 active 必須）。admin も案件 ACL の例外にならない。

| 操作 | admin | lawyer | staff | worker | 根拠 |
|---|---|---|---|---|---|
| ログイン / MFA 登録・検証 / step-up / logout | ○ | ○ | ○ | — | `routes/auth.ts` |
| 事務所プロファイル 閲覧 | ○ | ○ | ○ | — | RLS `office_profiles_select` (org member) |
| 事務所プロファイル 作成・更新（新 revision） | ○ | ○ | ○ | — | RLS `office_profiles_write` (org member)。route 制限なし |
| 弁護士 閲覧 | ○ | ○ | ○ | — | RLS `lawyers_select` |
| 弁護士 登録・更新 | ○ | ○ | × | — | route `roles:['admin','lawyer']`、RLS `lawyers_write` |
| 連絡先 閲覧・検索・登録・更新・別名 | ○ | ○ | ○ | — | RLS `contacts_write` (org member) |
| 所内メンバー一覧 | ○ | ○ | ○ | — | RLS `memberships_select` |
| メンバー招待 / 役割・状態変更 | △ MFA15分 | × | × | — | route `roles:['admin'], requireRecentMfa`、RLS `memberships_write_admin`。自分自身の admin 解除は禁止、最後の admin はトリガで保護 |
| 事務所設定 閲覧 | ○ | ○ | ○ | — | `GET /api/settings` |
| 事務所設定 更新 | △ MFA15分 | × | × | — | route `roles:['admin'], requireRecentMfa`、RLS `organizations_update_admin` |
| 案件 作成 | ○ | ○ | ○ | — | RLS `matters_insert`（admin/lawyer/staff）。作成者と lead lawyer を member に登録 |
| 案件 閲覧（一覧・詳細・文書・証拠・送付） | △ 案件ACL | △ 案件ACL | △ 案件ACL | — | RLS `matters_select` = `can_access_matter`。他 org / 非 member / barrier は 0 行 → 404 |
| 案件 更新（基本情報） | △ can_edit | △ can_edit | △ can_edit | — | RLS `matters_update`、route は archived を 409 |
| 受任確認 / 状態変更(archive/reopen/closed) / legal_hold | × | △ 割当lawyer | × | — | route `requireAssignedLawyer`（`app.is_assigned_lawyer`） |
| 当事者・代理人 追加/更新/削除 | △ can_edit | △ can_edit | △ can_edit | — | RLS `matter_parties_write` / `matter_agents_write` |
| 案件メンバー 追加・削除 | × (API) / ○ (RLS) | △ 割当lawyer | × | — | route `requireAssignedLawyer`。RLS `matter_members_write` は admin も許可（API より緩い。threat-model 参照） |
| barrier 追加 | × (API) / ○ (RLS) | △ 割当lawyer | × | — | 同上。barrier 追加時に member 行を削除 |
| 書式 一覧・詳細・版・DOCX 取得 | ○ | ○ | ○ | — | RLS `templates_select` / `template_versions_select` (org member) |
| 書式 DOCX 取込（import） | ○ | ○ | ○ | — | route `roles:['admin','lawyer','staff']`、RLS `files_write`（matter NULL → org member） |
| 書式 スキーマ更新 / 試作（test） | ○ | ○ | ○ | — | route 制限なし、RLS `template_versions_write` (org member)。published/retired は 409 |
| 書式 公開（publish） | × | △ MFA15分 | × | — | route `roles:['lawyer'], requireRecentMfa`。`sampleOnly:false` は `lawyers` に active 登録された本人のみ。検査エラー無し・最新スキーマで試作成功・確認 3 点が必要 |
| 書式 廃止（retire） | ○ | ○ | × | — | route `roles:['admin','lawyer']` |
| 文例 作成・版保存 | ○ | ○ | ○ | — | RLS `phrase_libraries_all` / `phrase_versions_all` |
| 文例 承認 | × | △ 作成者以外 | × | — | route `roles:['lawyer']`、作成者本人は 403 |
| renderer / court profile 閲覧 | ○ | ○ | ○ | — | RLS select (org_id NULL or member)。書込み API なし |
| 草案 作成・保存・更新候補適用・render(draft)・lease・external-edit・archive | △ can_edit | △ can_edit | △ can_edit | — | RLS `drafts_write` = `can_edit_matter`。lease 他者保持中は 409 |
| 草案 閲覧・preflight・outputs 一覧 | △ 案件ACL | △ 案件ACL | △ 案件ACL | — | RLS `drafts_select` |
| 草案 render(final) | △ 承認済 | △ 承認済 | △ 承認済 | — | 承認済 revision かつ sample_only=false のみ。route は draft 以外は can_edit を要求しない（RLS jobs_insert が can_edit を要求） |
| レビュー依頼 | △ 案件ACL | △ 案件ACL | △ 案件ACL | — | RLS `reviews_write` = `can_access_matter`。reviewer は割当 lawyer かつ最終編集者以外。preflight error は 422、PDF 未生成は 422 |
| レビュー決定（承認/差戻し） | △ 割当lawyer のみ | △ 割当lawyer・最終編集者以外 | × | — | route `roles:['lawyer','admin']` + `checkApproval`（下表） |
| レビューコメント・解決 | △ 案件ACL | △ 案件ACL | △ 案件ACL | — | RLS `review_comments_all` |
| 正式版ダウンロード | △ 案件ACL | △ 案件ACL | △ 案件ACL | — | approved revision かつ承認 hash 一致、mode=final 出力のみ |
| 草案版ダウンロード | △ 案件ACL | △ 案件ACL | △ 案件ACL | — | 「【草案】」接頭、監査記録 |
| ファイル upload（matter/receipt） | △ can_edit | △ can_edit | △ can_edit | — | init 時に `can_edit_matter` を検査 |
| ファイル upload（template） | ○ | ○ | ○ | — | org member |
| ファイル取得 | △ 案件ACL / org | △ | △ | — | matter NULL は org member、それ以外は `can_access_matter`。scan_status clean 以外は 409 |
| 証拠 作成・更新・確定・訂正 | △ can_edit | △ can_edit | △ can_edit | — | RLS `evidence_write` |
| 一括生成 作成・cancel・retry | △ can_edit | △ can_edit | △ can_edit | — | 20×50、合計 100 超は 422。published 以外 422、submission_pack で sample_only は 422 |
| パック 作成・更新・検査・render | △ can_edit | △ can_edit | △ can_edit | — | RLS `packets_write`。blocking があれば render 422 |
| パック ダウンロード | △ 案件ACL | △ 案件ACL | △ 案件ACL | — | rendered のみ |
| 送付記録 登録 | △ can_edit | △ can_edit | △ can_edit | — | RLS `dispatch_write` |
| 送付記録 確認（verify） | △ 記録者以外 | △ 記録者以外 | △ 記録者以外 | — | 記録者本人は 403 |
| ジョブ 閲覧 | △ org member + 案件ACL | △ | △ | ○ | RLS `jobs_select` |
| ジョブ cancel | △ can_edit | △ can_edit | △ can_edit | — | RLS `jobs_cancel`、`cancel_requested` 列のみ UPDATE 可 |
| export 要求（contacts/matters/evidence/audit/matter_json） | ○ | ○ | ○ | — | matter 系は案件 ACL（RLS）。audit_csv の org-level 行は admin のみ含む（worker 側判定） |
| export 要求（full_backup） | ○ | × | × | — | route と worker の両方で admin 判定 |
| export ダウンロード | △ job が見える者 | △ | △ | — | RLS `jobs_select` / `files_select`。要求者本人の確認は無い（threat-model 参照） |
| CSV import preview / commit | ○ | ○ | ○ | — | route 制限なし。挿入は contacts/matters の RLS に従う |
| 監査 閲覧 | △ org-level 行 + member 案件 | △ 自分の行 + member 案件 | △ 同 | — | RLS `audit_select`: matter_id あり → `can_access_matter`、無し → admin または actor 本人 |
| 検索 | △ RLS で絞られた範囲 | △ | △ | — | contacts は org 全体、matters/drafts は案件 ACL |
| outbox 閲覧 | ○ (RLS) | × | × | — | API なし |
| private schema（session/credentials/TOTP） | × | × | × | ○ | REVOKE ALL from authenticated |
| job claim / heartbeat / requeue | × | × | × | ○ | GRANT EXECUTE to service_role のみ |
| 監査行の UPDATE/DELETE | × | × | × | × | REVOKE + trigger（service_role も不可） |

## 4. 案件 ACL の規則（`app.can_access_matter` / `packages/domain/src/acl.ts`）

1. `matter_barriers` に本人がいれば **常に不可**（member より優先）。
2. `matter_members` に本人がいて、同 org の `memberships.status='active'` であれば閲覧可。
3. 編集は加えて `matter_members.can_edit=true` かつ `matters.status='active'`。
4. admin であることは 1–3 を免除しない。
5. 他 org / 非 member / barrier のいずれも RLS で 0 行となり、API は **404**（存在秘匿）を返す。`cross_org_reference` トリガ違反・`42501` も 404 に変換（`apps/api/src/app.ts`）。
6. 案件作成時、作成者（role 不問）と `leadLawyerId` の user を member として登録（`approved_by` = 作成者）。
7. member 追加・削除・barrier 追加は割当 lawyer のみ（API）。削除で案件の lawyer が 0 人になる場合は 409。
8. barrier 追加時は同一ユーザーの member 行を削除。barrier があるユーザーの member 追加は 409。
9. membership が非 active になると `resolveSession` がセッションを失効させ、`PUT /api/members/:userId` は全セッションを revoke する。

## 5. 承認ルール（`checkApproval`）

`POST /api/reviews/:id/decision` は transaction 内で以下を順に検査する。

| 条件 | 結果 | HTTP |
|---|---|---|
| barrier あり | `barrier` | 403 |
| 案件 member でない | `not_matter_member` | 403 |
| role=staff | `staff_cannot_approve` | 403 |
| role=admin かつ割当 lawyer でない | `admin_cannot_approve` | 403 |
| 割当 lawyer でない（`app.is_assigned_lawyer`） | `not_assigned_lawyer` | 403 |
| actor = 対象 revision の `created_by`（最終編集者） | `self_approval` | 403 |
| draft.status が ready_for_review / in_review 以外 | `invalid_status` | 409 |
| review.target_hash ≠ 現在 revision hash（current_revision_id が別、または hash 相違） | `hash_stale` | 409 |
| body.targetHash ≠ review.target_hash | `hash_stale` | 409 |
| 承認時: 最新 draft PDF sha ≠ `target_output_pdf_sha256` | `hash_stale` | 409 |
| 承認時: 書式版が published でない | conflict | 409 |
| 承認時: preflight blocking | `precondition_failed` | 422 |
| 承認時: `confirmationsRequired` に理由付き確認が無い | `precondition_failed` | 422 |
| 承認時: T01 で `acceptance_status≠confirmed` | `precondition_failed` | 422 |
| 差戻し時: reason 無し | `validation_failed` | 422 |
| review.version ≠ expectedVersion | `version_conflict` | 409 |

承認後は `drafts.status='approved'`, `approved_revision_id` 設定。以後の編集・候補適用・外部編集版追加は `setCurrentRevision` で `draft` に戻し、approved review を `withdrawn` にする（承認失効）。

レビュー依頼側（`POST /api/drafts/:id/request-review`）でも reviewer が割当 lawyer であること、最終編集者と異なることを 422 で検査する。

## 6. ルート別の認可設定（`config: { auth: ... }` を持つもの）

| ルート | 設定 |
|---|---|
| POST /api/auth/login | `public`、rate limit 10/min |
| GET /api/auth/session | `public` |
| POST /api/auth/mfa/enroll | `allowMfaPending` |
| POST /api/auth/mfa/enroll/confirm, /api/auth/mfa/verify | `allowMfaPending`、rate limit 10/min |
| POST /api/auth/step-up | 認証必須、rate limit 10/min |
| POST /api/auth/logout | `allowMfaPending` |
| GET /api/health | `public` |
| POST /api/lawyers, PUT /api/lawyers/:id | `roles: admin, lawyer` |
| POST /api/members, PUT /api/members/:userId | `roles: admin` + `requireRecentMfa` |
| PUT /api/settings | `roles: admin` + `requireRecentMfa` |
| POST /api/templates/import | `roles: admin, lawyer, staff` |
| POST /api/template-versions/:id/publish | `roles: lawyer` + `requireRecentMfa` |
| POST /api/template-versions/:id/retire | `roles: admin, lawyer` |
| POST /api/phrase-versions/:id/approve | `roles: lawyer` |
| POST /api/reviews/:id/decision | `roles: lawyer, admin`（さらに `checkApproval`） |
| 上記以外の全ルート | 認証 + MFA 済み + CSRF/Origin のみ。権限は RLS と route 内検査（`requireAssignedLawyer`, `can_edit_matter` 等） |

## 7. RLS ポリシー要約（migration 004）

| テーブル | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| app_users | 本人 or 同 org のメンバー | UPDATE 本人のみ |
| organizations | org member | UPDATE admin |
| memberships | org member | ALL admin |
| office_profiles, contacts, contact_aliases, contact_versions, templates, template_versions, phrase_libraries, phrase_versions | org member | ALL org member |
| lawyers | org member | ALL admin / lawyer |
| renderer_profiles, court_profiles | org_id NULL or member | ALL admin / lawyer（org_id NOT NULL） |
| matters | `can_access_matter` | INSERT admin/lawyer/staff、UPDATE access ∧ can_edit、DELETE false |
| matter_members | access or 本人行 | ALL assigned lawyer or admin（WITH CHECK: member ∧ (assigned or admin or created_by 本人)） |
| matter_barriers | admin or assigned lawyer | ALL admin or assigned lawyer |
| matter_parties, matter_agents, source_refs, evidence, batches, packets, dispatch_records, drafts | `can_access_matter` | ALL `can_edit_matter` |
| files | member ∧ (matter NULL or access) | ALL member ∧ (matter NULL or can_edit) |
| file_versions | 親 files と同条件 | INSERT のみ（親 can_edit） |
| draft_revisions | 親 draft access | INSERT のみ（親 can_edit） |
| draft_outputs, batch_items, packet_items | 親 access | ALL 親 can_edit |
| edit_leases | 親 access | ALL（WITH CHECK 親 can_edit） |
| reviews, review_comments | 親 access | ALL 親 access |
| jobs | member ∧ (matter NULL or access) | INSERT member ∧ (matter NULL or can_edit)、UPDATE（cancel_requested のみ）同 |
| audit_events | member ∧ (matter access) ∧ (matter あり or admin or actor 本人) | INSERT member ∧ actor_id 本人 |
| outbox | admin | INSERT member |

API 層の制約（割当 lawyer のみ等）は RLS より厳しい箇所があり、DB 直接接続を前提にした防御ではない点に注意（`docs/threat-model.md`）。
