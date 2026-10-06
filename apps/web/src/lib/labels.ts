/** 列挙値の日本語表示 */
import type { DraftStatus, RecipientType, Role } from '@raylow/contracts';

export const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  draft: '下書き',
  rendering: '生成中',
  ready_for_review: '確認待ち（依頼前）',
  in_review: 'レビュー中',
  changes_requested: '差戻し',
  approved: '承認済み',
  superseded: '旧版',
  archived: 'アーカイブ',
};

export function draftStatusLabel(s: string): string {
  return (DRAFT_STATUS_LABEL as Record<string, string>)[s] ?? s;
}

export const TEMPLATE_STATUS_LABEL: Record<string, string> = {
  draft: '下書き',
  testing: '試作中',
  published: '公開',
  retired: '廃止',
};

export const TEMPLATE_KIND_LABEL: Record<string, string> = {
  T01_engagement_notice: '受任通知',
  T02_reply_letter: '回答書',
  T03_inquiry_letter: '照会書',
  T04_document_request: '資料提出依頼書',
  T05_demand_letter: '催告書',
  T06_settlement_proposal: '和解提案書',
  T07_agreement: '合意書',
  T08_cover_letter: '送付書',
  T09_client_progress_report: '依頼者への進捗報告書',
  T10_retainer_agreement: '委任契約書',
  T11_power_of_attorney_litigation: '訴訟委任状',
  T12_complaint: '訴状',
  T13_answer: '答弁書',
  T14_brief: '準備書面',
  T15_party_list: '当事者目録',
  T16_evidence_description: '証拠説明書',
  T17_electronic_evidence_description: '電子証拠説明書',
  T18_documentary_evidence_submission: '書証提出書',
  T19_withdrawal_of_action: '訴え取下書',
  T20_termination_of_engagement: '委任終了通知',
  custom: '独自書式',
};

export function templateKindLabel(k: string): string {
  return TEMPLATE_KIND_LABEL[k] ?? k;
}

export const TEMPLATE_SCOPE_LABEL: Record<string, string> = {
  negotiation: '交渉',
  client: '依頼者',
  court: '裁判所',
  internal: '所内',
};

export const RECIPIENT_TYPE_LABEL: Record<RecipientType, string> = {
  opponent_agent: '相手方代理人',
  opponent: '相手方本人',
  client: '依頼者',
  court: '裁判所',
  third_party: '第三者',
  none: '宛先なし',
};

export const PARTY_ROLE_LABEL: Record<string, string> = {
  client: '依頼者',
  opponent: '相手方',
  co_party: '共同当事者',
  third_party: '第三者',
};

export const CONTACT_TYPE_LABEL: Record<string, string> = {
  person: '個人',
  organization: '法人・団体',
  lawyer: '弁護士',
};

export const ROLE_LABEL: Record<Role, string> = { admin: '管理者', lawyer: '弁護士', staff: '事務職員' };

export const JOB_STATE_LABEL: Record<string, string> = {
  queued: '待機中',
  running: '処理中',
  succeeded: '完了',
  failed: '失敗',
  cancelled: '中止',
};

export const JOB_TYPE_LABEL: Record<string, string> = {
  render_draft: '草案の生成',
  render_final: '正式版の生成',
  inspect_template: '書式の検査',
  test_template: '書式の試作',
  scan_file: 'ファイル検査',
  batch_render: '一括生成',
  render_packet: '提出パックの生成',
  export: 'エクスポート',
  import_csv: 'CSV 取込',
  external_edit_ingest: '外部編集版の取込',
};

export const REVIEW_STATUS_LABEL: Record<string, string> = {
  pending: '確認待ち',
  approved: '承認',
  changes_requested: '差戻し',
  withdrawn: '取下げ',
};

export const MATTER_STATUS_LABEL: Record<string, string> = { active: '進行中', archived: 'アーカイブ', closed: '終了' };
export const ACCEPTANCE_LABEL: Record<string, string> = { unconfirmed: '受任未確認', confirmed: '受任確認済み', declined: '受任しない' };

export const DISPATCH_METHOD_LABEL: Record<string, string> = {
  post: '郵送',
  registered_post: '書留',
  content_certified_post: '内容証明郵便',
  fax: 'FAX',
  email: 'メール',
  hand: '持参・手交',
  court_counter: '裁判所窓口',
  court_electronic: '裁判所オンライン提出',
  other: 'その他',
};

export const DISPATCH_STATUS_LABEL: Record<string, string> = { recorded: '記録済み', received_verified: '受領確認済み' };

export const EVIDENCE_STATUS_LABEL: Record<string, string> = { draft: '下書き', confirmed: '確定', submitted: '提出済み', superseded: '旧版' };

export const PACKET_STATUS_LABEL: Record<string, string> = {
  draft: '作成中',
  checking: '検査中',
  blocked: '出力不可（欠落あり）',
  ready: '出力可',
  rendering: '生成中',
  rendered: '出力済み',
  failed: '失敗',
  archived: 'アーカイブ',
};

export const BATCH_STATUS_LABEL: Record<string, string> = {
  queued: '待機中',
  running: '生成中',
  partial_failed: '一部失敗',
  succeeded: '完了',
  failed: '失敗',
  cancelled: '中止',
};

export const PHRASE_STATUS_LABEL: Record<string, string> = { draft: '下書き', pending_approval: '承認待ち', approved: '承認済み', retired: '廃止' };

export const SCAN_STATUS_LABEL: Record<string, string> = {
  quarantine: '検査待ち（隔離中）',
  scanning: '検査中',
  clean: '検査済み',
  infected: '脅威検出（利用不可）',
  rejected: '拒否',
  scan_failed: '検査失敗（利用不可）',
};

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (key == null) return '—';
  return map[key] ?? key;
}
