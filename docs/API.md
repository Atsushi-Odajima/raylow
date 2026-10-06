# RayLaw v2 API 契約（BFF: Fastify、同一 origin `/api`）

共通
- 成功: `{ "data": ..., "meta": { "requestId": "...", "nextCursor"?: string|null } }`
- 失敗: `{ "error": { "code", "message", "fieldErrors": [{field,code,message}], "requestId", "currentVersion"? } }`
- 認証: HttpOnly/Secure/SameSite=Lax の opaque cookie `raylow_sid`。GET 以外は `X-CSRF-Token` ヘッダ（`GET /api/auth/session` の `csrfToken`）と `Origin` allowlist 検査。CORS `*` 禁止。
- HTTP: 401 未認証（`mfa_required` は MFA 未完了）、403 許可なし、404 存在秘匿（他 org / barrier / 未割当は 404）、409 版競合/状態競合、413 容量、415 形式、422 入力不備、429 制限。
- 更新 `PUT`/状態変更は `expectedVersion` 必須。不一致は 409 + `currentVersion`。
- 一覧は `cursor`/`limit<=100`。ACL 適用後に件数と候補を返す。
- Zod スキーマ名は `packages/contracts/src/*.ts` を参照（下表 Req/Res 列）。
- 日時は UTC ISO。表示は Asia/Tokyo。

## 認証（apps/api/src/routes/auth.ts）
| Method | Path | Req | Res | 備考 |
|---|---|---|---|---|
| POST | /api/auth/login | LoginRequestSchema | LoginResponseSchema | cookie 発行（mfa_pending）。rate limit 10/min/IP |
| POST | /api/auth/mfa/enroll | - | MfaEnrollResponseSchema | 未登録時のみ。otpauth URL を返す（QR はクライアント側で描画） |
| POST | /api/auth/mfa/enroll/confirm | MfaVerifyRequestSchema | SessionInfoSchema | 登録完了 + MFA 済 |
| POST | /api/auth/mfa/verify | MfaVerifyRequestSchema | SessionInfoSchema | ログイン後の TOTP 検証 |
| POST | /api/auth/step-up | MfaVerifyRequestSchema | SessionInfoSchema | 重要操作前の再確認（15 分） |
| GET | /api/auth/session | - | SessionInfoSchema | 未認証でも 200（authenticated=false） |
| POST | /api/auth/logout | - | {ok:true} | DB session 失効 |

## マスター
| Method | Path | Req | Res |
|---|---|---|---|
| GET | /api/offices | - | OfficeProfileSchema[]（revision 降順、先頭が current） |
| POST | /api/offices | OfficeProfileInputSchema | OfficeProfileSchema（新 revision を current に） |
| PUT | /api/offices/:id | OfficeProfileUpdateSchema | OfficeProfileSchema（新 revision を作成。既存 revision は immutable） |
| GET | /api/lawyers | - | LawyerSchema[] |
| POST | /api/lawyers | LawyerInputSchema | LawyerSchema |
| PUT | /api/lawyers/:id | LawyerUpdateSchema | LawyerSchema |
| GET | /api/contacts | ContactSearchQuerySchema (query) | ContactSchema[]（matchReason 付き） |
| POST | /api/contacts | ContactInputSchema | ContactSchema（similarIds に類似候補。merge はしない） |
| GET | /api/contacts/:id | - | ContactSchema |
| PUT | /api/contacts/:id | ContactUpdateSchema | ContactSchema（contact_versions に snapshot） |
| POST | /api/contacts/:id/aliases | {aliasRaw} | ContactSchema |
| GET | /api/members | - | MemberSchema[] |
| POST | /api/members | MemberInviteSchema | MemberSchema（admin。初期パスワードは応答で一度だけ返す） |
| PUT | /api/members/:userId | {role?, status?, expectedVersion} | MemberSchema（最後の admin 削除は 409） |

## 案件
| Method | Path | Req | Res |
|---|---|---|---|
| GET | /api/matters | MatterListQuerySchema | MatterSummarySchema[] |
| POST | /api/matters | MatterInputSchema | MatterDetailSchema（作成者を member に付与） |
| GET | /api/matters/:id | - | MatterDetailSchema |
| PUT | /api/matters/:id | MatterUpdateSchema | MatterDetailSchema |
| POST | /api/matters/:id/acceptance | MatterAcceptanceSchema | MatterDetailSchema（担当 lawyer のみ） |
| POST | /api/matters/:id/status | MatterStatusChangeSchema | MatterDetailSchema（archive/reopen は理由付き） |
| POST | /api/matters/:id/legal-hold | MatterLegalHoldSchema | MatterDetailSchema |
| POST | /api/matters/:id/parties | PartyInputSchema | MatterDetailSchema |
| PUT | /api/matters/:id/parties/:partyId | PartyUpdateSchema | MatterDetailSchema |
| DELETE | /api/matters/:id/parties/:partyId | - | MatterDetailSchema |
| POST | /api/matters/:id/agents | AgentInputSchema | MatterDetailSchema |
| DELETE | /api/matters/:id/agents/:agentId | - | MatterDetailSchema |
| POST | /api/matters/:id/members | MemberAddSchema | MatterDetailSchema（担当 lawyer 承認） |
| DELETE | /api/matters/:id/members/:userId | - | MatterDetailSchema |
| POST | /api/matters/:id/barriers | BarrierAddSchema | MatterDetailSchema |
| GET | /api/matters/:id/evidence | - | EvidenceSchema[] |
| GET | /api/matters/:id/dispatches | - | DispatchRecordSchema[] |
| GET | /api/matters/:id/documents | DraftListQuerySchema | DraftSchema[] |

## 書式・文例
| Method | Path | Req | Res |
|---|---|---|---|
| GET | /api/templates | TemplateListQuerySchema | TemplateSummarySchema[] |
| GET | /api/templates/:id | - | TemplateSummarySchema & { versions: TemplateVersionSchema[] } |
| GET | /api/templates/:id/versions | - | TemplateVersionSchema[] |
| POST | /api/templates/import | multipart: `file` (docx) + `fields` (JSON: TemplateImportFieldsSchema) | TemplateImportResponseSchema（検査 job 開始） |
| GET | /api/template-versions/:id | - | TemplateVersionSchema |
| PUT | /api/template-versions/:id/schema | TemplateSchemaUpdateSchema | TemplateVersionSchema（published は 409） |
| POST | /api/template-versions/:id/test | TemplateTestRequestSchema | {jobId}（架空データで試作。結果は job.result.outputFileId） |
| POST | /api/template-versions/:id/publish | TemplatePublishSchema | TemplateVersionSchema（lawyer のみ。MFA 15 分以内） |
| POST | /api/template-versions/:id/retire | TemplateRetireSchema | TemplateVersionSchema |
| GET | /api/template-versions/:id/docx | - | DOCX bytes（登録者/管理用。no-store） |
| GET | /api/phrases | {category?, templateKind?} | PhraseSchema[] |
| POST | /api/phrases | PhraseInputSchema | PhraseSchema |
| GET | /api/phrases/:id | - | PhraseSchema（versions 付き） |
| POST | /api/phrases/:id/versions | PhraseVersionInputSchema | PhraseSchema |
| POST | /api/phrase-versions/:id/approve | PhraseApproveSchema | PhraseSchema（lawyer のみ） |
| GET | /api/renderer-profiles | - | RendererProfileSchema[] |
| GET | /api/court-profiles | - | CourtProfileSchema[] |

## 草案・出力
| Method | Path | Req | Res |
|---|---|---|---|
| POST | /api/drafts | DraftCreateSchema | DraftDetailSchema（自動差込で revision 1 を作成。idempotencyKey 同一なら既存を返す） |
| GET | /api/drafts/:id | - | DraftDetailSchema |
| PUT | /api/drafts/:id/revisions | DraftRevisionInputSchema | DraftDetailSchema（新 revision。approved は失効→draft） |
| POST | /api/drafts/:id/lease | DraftLeaseRequestSchema | EditLeaseSchema（他者保持中は 409 `lease_held`。takeoverReason で強制引継ぎ） |
| DELETE | /api/drafts/:id/lease | - | {released:true} |
| POST | /api/drafts/:id/refresh-candidates | - | RefreshCandidatesResponseSchema |
| POST | /api/drafts/:id/apply-candidates | ApplyCandidatesSchema | DraftDetailSchema |
| POST | /api/drafts/:id/render | RenderRequestSchema | RenderResponseSchema（mode=final は承認済 revision のみ） |
| GET | /api/drafts/:id/preflight | - | PreflightReportSchema |
| POST | /api/drafts/:id/request-review | ReviewRequestCreateSchema | ReviewSchema（preflight error があれば 422） |
| POST | /api/drafts/:id/external-edit | multipart `file` (docx) | DraftDetailSchema（kind=external_edit の新 revision + scan/render job） |
| POST | /api/drafts/:id/archive | {expectedVersion} | DraftDetailSchema |
| GET | /api/documents | DraftListQuerySchema | DraftSchema[] |
| GET | /api/documents/:id/output | - | { draft, approvedRevision, outputs: DraftOutputSchema[], draftOutputs, dispatches: DispatchRecordSchema[] } |
| GET | /api/outputs/:id/download?mode=draft\|final | - | bytes（final は approved_revision かつ hash 一致のみ。no-store） |

## レビュー
| Method | Path | Req | Res |
|---|---|---|---|
| GET | /api/reviews | ReviewListQuerySchema | ReviewSchema[] |
| GET | /api/reviews/:id | - | ReviewDetailSchema |
| POST | /api/reviews/:id/decision | ReviewDecisionSchema | ReviewDetailSchema（割当 lawyer かつ最終編集者以外。hash 不一致は 409 `hash_stale`） |
| POST | /api/reviews/:id/comments | ReviewCommentInputSchema | ReviewCommentSchema |
| POST | /api/review-comments/:id/resolve | - | ReviewCommentSchema |

## ファイル・証拠
| Method | Path | Req | Res |
|---|---|---|---|
| POST | /api/uploads/init | UploadInitSchema | UploadInitResponseSchema |
| PUT | /api/uploads/:id/content | raw bytes（Content-Type=application/octet-stream、<=100MB） | {received:number} |
| POST | /api/uploads/:id/finalize | - | UploadFinalizeResponseSchema（quarantine → scan job） |
| GET | /api/files/:id | - | FileSchema |
| GET | /api/files/:id/content?version=:fileVersionId | - | bytes（毎回 ACL / no-store。scan 未完了は 409 `file_quarantined`） |
| POST | /api/evidence | EvidenceInputSchema | EvidenceSchema |
| PUT | /api/evidence/:id | EvidenceUpdateSchema | EvidenceSchema |
| POST | /api/evidence/:id/confirm | EvidenceConfirmSchema | EvidenceSchema（canonical 重複は 409） |
| POST | /api/evidence/:id/correct | EvidenceCorrectSchema | EvidenceSchema（提出済ラベルの改番禁止 → 履歴付き別版） |

## 一括・パック・送付
| Method | Path | Req | Res |
|---|---|---|---|
| POST | /api/batches | BatchCreateSchema | BatchSchema（20×50、合計 100 超は 422 `batch_limit_exceeded`） |
| GET | /api/batches/:id | - | BatchSchema |
| POST | /api/batches/:id/cancel | - | BatchSchema（未開始の子だけ停止） |
| POST | /api/batch-items/:id/retry | - | BatchItemSchema |
| POST | /api/packets | PacketCreateSchema | PacketSchema |
| GET | /api/packets/:id | - | PacketSchema |
| PUT | /api/packets/:id | PacketUpdateSchema | PacketSchema |
| POST | /api/packets/:id/check | - | PacketSchema（check_report） |
| POST | /api/packets/:id/render | - | {jobId}（欠落があれば 422） |
| GET | /api/packets/:id/download | - | ZIP bytes |
| POST | /api/dispatch-records | DispatchRecordInputSchema | DispatchRecordSchema |
| GET | /api/dispatch-records/:id | - | DispatchRecordSchema |
| POST | /api/dispatch-records/:id/verify | DispatchVerifySchema | DispatchRecordSchema（記録者以外） |

## ジョブ・移行・監査・その他
| Method | Path | Req | Res |
|---|---|---|---|
| GET | /api/jobs/:id | - | JobSchema |
| POST | /api/jobs/:id/cancel | - | JobSchema |
| POST | /api/exports | ExportRequestSchema | ExportResponseSchema |
| GET | /api/exports/:jobId/download | - | bytes |
| POST | /api/imports/preview | multipart `file` + `fields`(ImportPreviewRequestSchema) | ImportPreviewResponseSchema |
| POST | /api/imports/commit | ImportCommitSchema | ImportCommitResponseSchema（1 行でもエラーなら全体 rollback） |
| GET | /api/audit | AuditQuerySchema | AuditEventSchema[] |
| GET | /api/search | SearchQuerySchema | SearchResultSchema |
| GET | /api/settings | - | OrgSettingsSchema |
| PUT | /api/settings | OrgSettingsUpdateSchema | OrgSettingsSchema |
| GET | /api/home/create | - | CreateHomeSchema（S01 用） |
| GET | /api/health | - | HealthSchema（事務所情報/secret を出さない） |
