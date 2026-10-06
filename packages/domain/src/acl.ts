/**
 * 認可ルール（§20.1 / AC14）。純関数。DB 側 RLS と BFF の両方で同じ境界を適用する。
 */
export const ROLES = ['admin', 'lawyer', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export interface MembershipView {
  userId: string;
  role: Role;
  status: 'active' | 'suspended' | 'left';
}

export interface MatterAccessView {
  matterId: string;
  members: Array<{ userId: string; canEdit: boolean }>;
  barriers: Array<{ userId: string }>;
  leadLawyerUserId: string | null;
}

export function canAccessMatter(userId: string, m: MatterAccessView): boolean {
  if (m.barriers.some((b) => b.userId === userId)) return false; // barrier 優先
  return m.members.some((x) => x.userId === userId);
}

export function canEditMatter(userId: string, m: MatterAccessView): boolean {
  if (!canAccessMatter(userId, m)) return false;
  return m.members.some((x) => x.userId === userId && x.canEdit);
}

export interface ApprovalCheckInput {
  actorUserId: string;
  actorRole: Role;
  actorIsMatterMember: boolean;
  actorIsBarrier: boolean;
  /** 案件に割り当てられた lawyer（matter_members かつ lawyers.user_id 一致）か */
  actorIsAssignedLawyer: boolean;
  /** 対象 revision の最終編集者 */
  lastEditorUserId: string;
  /** レビュー対象 hash と現在の revision hash */
  targetHash: string;
  currentHash: string;
  draftStatus: string;
}

export type ApprovalDenial = 'staff_cannot_approve' | 'admin_cannot_approve' | 'not_matter_member' | 'barrier' | 'not_assigned_lawyer' | 'self_approval' | 'hash_stale' | 'invalid_status';

export function checkApproval(i: ApprovalCheckInput): { ok: true } | { ok: false; reason: ApprovalDenial; httpStatus: 403 | 409 } {
  if (i.actorIsBarrier) return { ok: false, reason: 'barrier', httpStatus: 403 };
  if (!i.actorIsMatterMember) return { ok: false, reason: 'not_matter_member', httpStatus: 403 };
  if (i.actorRole === 'staff') return { ok: false, reason: 'staff_cannot_approve', httpStatus: 403 };
  if (i.actorRole === 'admin' && !i.actorIsAssignedLawyer) return { ok: false, reason: 'admin_cannot_approve', httpStatus: 403 };
  if (!i.actorIsAssignedLawyer) return { ok: false, reason: 'not_assigned_lawyer', httpStatus: 403 };
  if (i.actorUserId === i.lastEditorUserId) return { ok: false, reason: 'self_approval', httpStatus: 403 };
  if (i.draftStatus !== 'ready_for_review' && i.draftStatus !== 'in_review') return { ok: false, reason: 'invalid_status', httpStatus: 409 };
  if (i.targetHash !== i.currentHash) return { ok: false, reason: 'hash_stale', httpStatus: 409 };
  return { ok: true };
}

export const APPROVAL_DENIAL_MESSAGES: Record<ApprovalDenial, string> = {
  staff_cannot_approve: '事務職員は最終承認できません（本文編集は可能です）',
  admin_cannot_approve: 'admin 役割だけでは承認できません。案件に割り当てられた弁護士が承認します',
  not_matter_member: 'この案件のメンバーではありません',
  barrier: 'この案件には閲覧制限が設定されています',
  not_assigned_lawyer: '案件に割り当てられた弁護士のみ承認できます',
  self_approval: '最終編集者本人は承認できません。別の弁護士が確認してください',
  hash_stale: '承認対象の版が古くなっています。再生成してから承認してください',
  invalid_status: 'この状態の草案は承認できません',
};
