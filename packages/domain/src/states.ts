/**
 * 状態遷移（§6/§5.3/§7）。server で再検証する。client の role/actorId を信頼しない。
 */
export const DRAFT_STATUSES = ['draft', 'rendering', 'ready_for_review', 'in_review', 'changes_requested', 'approved', 'superseded', 'archived'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

const DRAFT_TRANSITIONS: Record<DraftStatus, readonly DraftStatus[]> = {
  draft: ['rendering', 'archived', 'superseded'],
  rendering: ['ready_for_review', 'draft'],
  ready_for_review: ['in_review', 'draft', 'rendering', 'archived'],
  in_review: ['changes_requested', 'approved', 'draft'],
  changes_requested: ['draft', 'rendering', 'archived'],
  approved: ['superseded', 'archived', 'draft'],
  superseded: ['archived'],
  archived: [],
};

export function canTransitionDraft(from: DraftStatus, to: DraftStatus): boolean {
  return DRAFT_TRANSITIONS[from].includes(to);
}

/** 編集・宛先変更・書式変更・外部編集版追加で承認を失効（approved→draft） */
export const APPROVAL_INVALIDATING_ACTIONS = ['edit_body', 'edit_fields', 'change_recipient', 'change_template_version', 'add_external_edit_version'] as const;

export const TEMPLATE_VERSION_STATUSES = ['draft', 'testing', 'published', 'retired'] as const;
export type TemplateVersionStatus = (typeof TEMPLATE_VERSION_STATUSES)[number];

const TV_TRANSITIONS: Record<TemplateVersionStatus, readonly TemplateVersionStatus[]> = {
  draft: ['testing', 'retired'],
  testing: ['published', 'draft', 'retired'],
  published: ['retired'], // published 版は immutable
  retired: [],
};

export function canTransitionTemplateVersion(from: TemplateVersionStatus, to: TemplateVersionStatus): boolean {
  return TV_TRANSITIONS[from].includes(to);
}

export const JOB_STATES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type JobState = (typeof JOB_STATES)[number];

export const REVIEW_STATUSES = ['pending', 'approved', 'changes_requested', 'withdrawn'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const BATCH_STATUSES = ['queued', 'running', 'partial_failed', 'succeeded', 'failed', 'cancelled'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const DISPATCH_STATUSES = ['recorded', 'received_verified'] as const;

export const MATTER_STATUSES = ['active', 'archived', 'closed'] as const;
export const ACCEPTANCE_STATUSES = ['unconfirmed', 'confirmed', 'declined'] as const;
export type AcceptanceStatus = (typeof ACCEPTANCE_STATUSES)[number];

export const FILE_SCAN_STATUSES = ['quarantine', 'scanning', 'clean', 'infected', 'rejected', 'scan_failed'] as const;
export type FileScanStatus = (typeof FILE_SCAN_STATUSES)[number];
