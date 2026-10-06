# RayLaw v2 状態遷移

出典: `packages/domain/src/states.ts`（遷移表）、`supabase/migrations/20261006000002_core_tables.sql`（CHECK 制約）、`apps/api/src/routes/*.ts`（API 側遷移）、`apps/worker/src/**`（worker 側遷移）。各図の遷移ラベルは「操作 — 実行者」。状態名は DB の値。

遷移の実行者:

- **can_edit**: `app.can_edit_matter` を満たす案件メンバー（admin/lawyer/staff を問わない。案件が active であること）
- **access**: `app.can_access_matter` を満たすメンバー
- **assigned lawyer**: `app.is_assigned_lawyer`（案件 member ∧ role=lawyer ∧ lawyers 登録 ∧ barrier なし）
- **worker**: service_role の render worker（job handler）
- **admin / lawyer**: `memberships.role`

CHECK 制約で定義されるが、どのコード経路からも到達しない状態は「未到達」と明記する。

## 1. 草案 `drafts.status`

```mermaid
stateDiagram-v2
  [*] --> draft : POST /api/drafts — can_edit（revision 1 を自動差込で作成）
  draft --> rendering : POST /api/drafts/ID/render mode=draft — can_edit（dedupe 時は遷移なし）
  rendering --> ready_for_review : render_draft 成功 — worker
  rendering --> draft : render_draft 失敗（failed） — worker
  rendering --> draft : PUT revisions / apply-candidates / external-edit — can_edit
  draft --> in_review : POST request-review — access（preflight error なし・PDF 生成済み・reviewer は割当 lawyer かつ最終編集者以外）
  ready_for_review --> in_review : POST request-review — access
  changes_requested --> in_review : POST request-review — access
  ready_for_review --> draft : PUT revisions 等（新 revision） — can_edit
  in_review --> approved : POST /api/reviews/ID/decision approved — assigned lawyer（最終編集者以外、hash 一致）
  in_review --> changes_requested : POST decision changes_requested（理由必須） — assigned lawyer
  in_review --> draft : PUT revisions 等 — can_edit（pending review は withdrawn）
  changes_requested --> draft : PUT revisions 等 — can_edit
  approved --> draft : PUT revisions / apply-candidates / external-edit — can_edit（approved review を withdrawn、承認失効）
  draft --> ready_for_review : external_edit_ingest 成功 — worker（current_revision が外部編集版のとき）
  draft --> archived : POST /api/drafts/ID/archive — can_edit
  ready_for_review --> archived : POST archive — can_edit
  changes_requested --> archived : POST archive — can_edit
  approved --> archived : POST archive — can_edit
  superseded --> archived : POST archive — can_edit（superseded は未到達）
  archived --> [*]
```

補足:

- `render_final`（mode=final）は status を変えない。承認済み revision（`approved_revision_id`）に対して `draft_outputs(mode=final)` を追加するだけ。sample_only 書式は 409。
- `superseded` は `states.ts` に定義があるが設定するコード経路がない（未到達）。
- 承認失効時 `approved_revision_id` 列はクリアされず、`status` が `draft` になることで正式出力が止まる（`GET /api/outputs/:id/download?mode=final` は `status='approved'` と `approved_revision_id = revision_id` を要求）。
- `draft_revisions` 自体は immutable。遷移はすべて `drafts.current_revision_id` の差し替えと `status` 更新で表現する。
- 編集系操作は `edit_leases` が他者保持中なら 409 `lease_held`。

## 2. 書式版 `template_versions.status`

```mermaid
stateDiagram-v2
  [*] --> draft : POST /api/templates/import — admin, lawyer, staff（sample_only=true、inspect_template job 投入）
  draft --> testing : POST /api/template-versions/ID/test — org member（test_template job 投入）
  testing --> draft : PUT /api/template-versions/ID/schema — org member（スキーマ変更で試作結果を無効化）
  testing --> published : POST publish — lawyer + MFA 15 分以内（検査エラーなし・最新スキーマで試作成功・確認 3 点。sampleOnly=false は lawyers 登録者のみ）
  draft --> retired : POST retire — admin, lawyer
  testing --> retired : POST retire — admin, lawyer
  published --> retired : POST retire — admin, lawyer（templates.active_version_id を NULL）
  retired --> [*]
```

補足:

- `published` は DB トリガ `tg_template_version_immutable` で `field_schema / docx_file_id / docx_sha256 / tag_map / renderer_profile_id` を変更不可。status は `retired` へのみ。
- `draft → published` は `canTransitionTemplateVersion` で拒否（先に test が必要）。
- publish は既存の published 版を retire しない（過去文書は書き換わらない）。`templates.active_version_id` だけ新版へ切替。
- `inspect_template` job が構造的に拒否した場合（`template_rejected`）は status は `draft` のまま、`files.scan_status` が `rejected` になり、publish は `inspection_report.issues` にエラーがあるため 409。

## 3. ジョブ `jobs.state`

```mermaid
stateDiagram-v2
  [*] --> queued : enqueueJob — BFF（同一 org/type/scope_key/input_hash が queued/running なら既存 job を返す）
  queued --> running : app.claim_job（FOR UPDATE SKIP LOCKED、lease 120 秒、attempt+1） — worker
  running --> running : app.heartbeat_job（30 秒ごと、progress 更新） — worker
  running --> succeeded : handler 成功（業務変更と同一 transaction） — worker
  running --> queued : retryable 失敗かつ attempt < max_attempts（run_after = now+30s or +120s） — worker
  running --> queued : lease 切れ（app.requeue_expired_jobs、attempt < max） — worker
  running --> failed : 非 retryable 失敗、または attempt >= max_attempts — worker
  running --> failed : lease 切れかつ attempt >= max（error_code=lease_expired） — worker
  running --> cancelled : cancel_requested を checkpoint で検知（JobFailure cancelled） — worker
  queued --> cancelled : cancel_requested かつ失敗処理時 — worker（claim は cancel_requested=true の job を取らない）
  succeeded --> [*]
  failed --> [*]
  cancelled --> [*]
```

補足:

- `POST /api/jobs/:id/cancel`（can_edit）は `cancel_requested=true` を立てるだけ。queued の job は claim されなくなり、running の job は次の `progress()` で停止する。
- retryable な失敗コード: `timeout`, `converter_unavailable`, `scanner_unavailable`, `tool_unavailable`, `transient`（ECONNREFUSED）, `file_not_clean`（外部編集版の scan 待ち）, `lease_expired`。書式エラー（`unreplaced_tag`, `template_compile_error`, `template_rejected` 等）は再試行しない。
- 再試行遅延は `JOB_RETRY_DELAYS_SECONDS=[30,120]`（attempt 1 回目の失敗後 30 秒、以後 120 秒）。
- job 失敗時の副作用: `render_draft` → `drafts.status rendering→draft`、`batch_items` → failed/cancelled、`packets` → failed。
- `succeeded` への更新は `WHERE state='running' AND worker_id=自分` を条件にし、lease を失っていた場合は `lease_lost` として失敗扱い（二重成果物を防ぐ）。

## 4. レビュー `reviews.status`

```mermaid
stateDiagram-v2
  [*] --> pending : POST /api/drafts/ID/request-review — access（同一 draft の既存 pending は withdrawn）
  pending --> approved : POST /api/reviews/ID/decision approved — assigned lawyer（checkApproval OK、PDF sha 一致、書式 published、preflight error なし、確認済み、T01 は受任 confirmed）
  pending --> changes_requested : POST decision changes_requested（reason 必須） — assigned lawyer
  pending --> withdrawn : 新しい request-review、または草案編集 — access / can_edit
  approved --> withdrawn : 承認後の編集（setCurrentRevision） — can_edit（decision_reason に失効注記を追記）
  approved --> [*]
  changes_requested --> [*]
  withdrawn --> [*]
```

`reviews.version` は `expectedVersion` で楽観ロック。決定済み review への再決定は 409。

## 5. 一括生成 `batches.status` / `batch_items.status`

```mermaid
stateDiagram-v2
  state batches {
    [*] --> queued : POST /api/batches — can_edit（INSERT 時の既定）
    queued --> running : 同じ transaction 内で子 item と render_draft job を投入後 — BFF
    running --> succeeded : 全 item 終了・failed なし（finalizeBatches / 失敗処理） — worker
    running --> partial_failed : 全 item 終了・failed あり — worker
    running --> cancelled : POST /api/batches/ID/cancel — can_edit
    partial_failed --> running : POST /api/batch-items/ID/retry — can_edit
    succeeded --> [*]
    cancelled --> [*]
  }
  state batch_items {
    [*] --> queued : item 作成（render_draft job 投入） — BFF
    [*] --> failed : 宛先種別が書式で不許可（recipient_type_not_allowed、draft なし） — BFF
    queued --> succeeded : render_draft 成功 — worker
    queued --> failed : render_draft 最終失敗 — worker
    queued --> cancelled : batch cancel（queued のみ）/ job cancelled — can_edit / worker
    failed --> queued : POST /api/batch-items/ID/retry（attempt+1、新 job） — can_edit
    succeeded --> [*]
    cancelled --> [*]
  }
```

補足: `batch_items.status='running'` と `batches.status='failed'` は CHECK にあるが設定経路がない（未到達）。実行中かどうかは `jobs.state` で判断する。

## 6. 提出パック `packets.status`

```mermaid
stateDiagram-v2
  [*] --> draft : POST /api/packets — can_edit
  draft --> draft : PUT /api/packets/ID（項目差し替え、check_report クリア） — can_edit
  blocked --> draft : PUT /api/packets/ID — can_edit
  ready --> draft : PUT /api/packets/ID — can_edit
  draft --> blocked : POST check（error あり） — can_edit
  draft --> ready : POST check（error なし） — can_edit
  blocked --> blocked : POST check — can_edit
  ready --> blocked : POST check（状況変化で error） — can_edit
  blocked --> ready : POST check — can_edit
  ready --> rendering : POST /api/packets/ID/render（内部で再 check、blocking なら 422） — can_edit
  rendering --> rendered : render_packet 成功（ZIP、manifest、hash、file_id） — worker
  rendering --> failed : render_packet 失敗（stale / item_not_approved / hash_mismatch / confidential_not_confirmed 等） — worker
  failed --> draft : PUT /api/packets/ID — can_edit
  rendered --> [*]
```

補足:

- `checking` と `archived` は CHECK にあるが未到達。
- render job は `packets.version` を payload に持ち、worker は一致しないと `stale` で失敗する（job 投入後の変更を拒否）。
- `rendered` / `archived` への `PUT` は 409（新しいパックを作る）。
- ZIP ダウンロードは `rendered` のみ。ダウンロードは提出済みを意味しない（送付記録で管理）。

## 7. 証拠 `evidence.status`

```mermaid
stateDiagram-v2
  [*] --> draft : POST /api/evidence — can_edit
  draft --> draft : PUT /api/evidence/ID（番号変更可、canonical 重複は 409） — can_edit
  draft --> confirmed : POST /api/evidence/ID/confirm — can_edit（同一案件で canonical 重複なら 409）
  confirmed --> confirmed : PUT /api/evidence/ID（標目等の更新。番号変更は部分 UNIQUE で検査） — can_edit
  draft --> superseded : POST /api/evidence/ID/correct（理由必須、新しい draft 行を作成し superseded_by に接続） — can_edit
  confirmed --> superseded : POST correct — can_edit
  submitted --> superseded : POST correct — can_edit（submitted は未到達）
  superseded --> [*]
```

補足: `submitted` を設定する経路がない（提出パック出力や送付記録登録では evidence.status を変更しない）。`PUT` は `submitted/superseded` を 409 で拒否するよう書かれているが、submitted には到達しない。部分 UNIQUE `evidence_canonical_uq` は `confirmed/submitted` 行にのみ効く。

## 8. ファイル検査 `files.scan_status`

```mermaid
stateDiagram-v2
  [*] --> quarantine : upload finalize / external-edit / template import — BFF（scan_file または inspect_template job 投入）
  [*] --> clean : worker 生成物（output / packet / export）・seed の書式 — worker / seed（internal、scan なし）
  quarantine --> scanning : scan_file 開始 — worker
  scanning --> rejected : check_file.py NG（magic/MIME/拡張子/ZIP 構造/暗号化 PDF/JS/画像上限）または template scope で DOCX 検査 NG — worker
  scanning --> infected : clamd FOUND — worker
  scanning --> scan_failed : clamd 接続不可（fail closed、job は retryable 失敗） — worker
  scanning --> clean : check OK かつ clamd OK（または DEV_ALLOW_UNSCANNED、非 production のみ） — worker
  scan_failed --> scanning : job 再試行（最大 3 回） — worker
  quarantine --> clean : inspect_template 成功（template scope、scan_status が quarantine/scanning のとき） — worker
  quarantine --> rejected : inspect_template 構造拒否 — worker
  clean --> [*]
  rejected --> [*]
  infected --> [*]
```

補足:

- `GET /api/files/:id/content` は `clean` 以外を 409（`file_quarantined` / `file_rejected` / `scanner_unavailable`）で拒否。
- PDF は `clean` 化時に派生安全版 `file_versions(kind=safe_preview)` を追加し、既定の取得対象にする。
- `scan_failed` が 3 回続くと job は `failed` のままで `files.scan_status='scan_failed'` が残る。復旧後は再アップロードまたは手動の job 再投入が必要（自動再検査なし）。

## 9. 案件 `matters.status` / `matters.acceptance_status`

```mermaid
stateDiagram-v2
  state status {
    [*] --> active : POST /api/matters — org member（作成者が member に）
    active --> archived : POST /api/matters/ID/status archived — assigned lawyer（reasonRaw 任意）
    active --> closed : POST status closed — assigned lawyer
    archived --> active : POST status active（reasonRaw 必須） — assigned lawyer
    closed --> active : POST status active（reasonRaw 必須） — assigned lawyer
    archived --> closed : POST status closed — assigned lawyer
    closed --> archived : POST status archived — assigned lawyer
  }
  state acceptance_status {
    [*] --> unconfirmed : 作成時既定
    unconfirmed --> confirmed : POST /api/matters/ID/acceptance — assigned lawyer
    unconfirmed --> declined : POST acceptance — assigned lawyer
    confirmed --> unconfirmed : POST acceptance — assigned lawyer
    confirmed --> declined : POST acceptance — assigned lawyer
    declined --> confirmed : POST acceptance — assigned lawyer
    declined --> unconfirmed : POST acceptance — assigned lawyer
  }
```

補足:

- `active` 以外では `app.can_edit_matter` が false になり、草案・証拠・ファイル等の書込みが RLS で止まる（閲覧は可）。`status` 列自体の更新は `matters_update` ポリシー（access ∧ can_edit 行）で許可される。
- `legal_hold=true` の間は `matters` の DELETE がトリガで拒否される（API に DELETE は無く、RLS `matters_delete` も false）。
- `acceptance_status='confirmed'` は T01（受任通知）の承認条件。

## 10. 送付/提出記録 `dispatch_records.status`

```mermaid
stateDiagram-v2
  [*] --> recorded : POST /api/dispatch-records — can_edit（output_id または packet_id 必須、method/sent_at/宛先 snapshot）
  recorded --> received_verified : POST /api/dispatch-records/ID/verify — can_edit かつ recorded_by 以外（expectedVersion）
  received_verified --> [*]
```

## 11. 編集 lease `edit_leases`

```mermaid
stateDiagram-v2
  [*] --> free : lease 行なし、または expires_at < now
  free --> held : POST /api/drafts/ID/lease — can_edit（expires_at = now + 90 秒）
  held --> held : POST lease（同一 user、heartbeat 30 秒ごとに延長） — 保持者
  held --> free : DELETE /api/drafts/ID/lease — 保持者
  held --> free : 90 秒経過（期限切れ、行は残る） — 時間経過
  held --> held_by_other : POST lease takeoverReason あり — can_edit の別 user（監査 draft.lease_takeover）
  held --> held : POST lease takeoverReason なし（別 user） — 409 lease_held、遷移なし
  held_by_other --> held : 以後は新しい保持者として同じ規則
```

編集系 API（`PUT revisions` / `apply-candidates` / `external-edit`）は `assertLeaseOrFree` で他者保持中を 409 にする。lease 取得自体は編集権限（`can_edit_matter`）を要求する。

## 12. セッション `private.server_sessions`（参考）

```mermaid
stateDiagram-v2
  [*] --> mfa_pending : POST /api/auth/login（cookie 発行、csrf token を header で先渡し、idle 30 分 / absolute 12 時間） — anon
  mfa_pending --> active : POST /api/auth/mfa/verify または enroll/confirm（last_mfa_at=now） — 本人
  active --> active : 任意のリクエスト（idle_expiry 延長、absolute を超えない） — 本人
  active --> active : POST /api/auth/step-up（last_mfa_at 更新、15 分以内で requireRecentMfa 通過） — 本人
  active --> revoked : POST /api/auth/logout — 本人
  mfa_pending --> revoked : POST logout — 本人
  active --> revoked : 再 login（旧 cookie を失効）/ membership 非 active / admin による status 変更（revokeAllUserSessions）
  active --> expired : idle_expiry または absolute_expiry 超過
  mfa_pending --> expired : 同上
  revoked --> [*]
  expired --> [*]
```
