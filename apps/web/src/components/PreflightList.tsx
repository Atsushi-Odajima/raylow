import type { PreflightIssue, PreflightReport } from '@raylow/contracts';
import { Link } from 'react-router';
import { Alert } from './Alert';
import { Icon } from './Icon';

const CATEGORY_LABEL: Record<string, string> = {
  required: '必須項目',
  identity_mismatch: '人物・事件番号の不一致',
  unreplaced_tag: '未置換タグ',
  template_unapproved: '未承認書式',
  evidence: '証拠番号・参照',
  font: 'フォント',
  layout: '頁・添付・用紙',
  recipient_mixing: '宛先混入',
  metadata: '内部コメント・metadata',
  honorific: '敬称',
  other: 'その他',
};

export function issueLink(draftId: string, i: PreflightIssue): string {
  if (i.fieldKey) return `/drafts/${draftId}/edit?focus=${encodeURIComponent(i.fieldKey)}`;
  if (i.blockId) return `/drafts/${draftId}/edit?block=${encodeURIComponent(i.blockId)}`;
  return `/drafts/${draftId}/edit`;
}

export function PreflightIssueRow({ issue, draftId }: { issue: PreflightIssue; draftId: string }) {
  return (
    <li className="rowlist__item">
      <div className="rowlist__main">
        <div className="rowlist__title">
          <Icon name={issue.severity === 'error' ? 'alert' : issue.severity === 'confirm' ? 'review' : 'info'} size={16} label={issue.severity === 'error' ? 'エラー' : issue.severity === 'confirm' ? '要確認' : '警告'} /> {issue.message}
        </div>
        <div className="rowlist__meta">
          <span>{CATEGORY_LABEL[issue.category] ?? issue.category}</span>
          <span className="mono">{issue.code}</span>
          {issue.location ? <span>位置: {issue.location}</span> : null}
          {issue.fieldKey ? <span>項目: {issue.fieldKey}</span> : null}
          {issue.blockId ? <span>段落: {issue.blockId}</span> : null}
        </div>
      </div>
      <div className="rowlist__actions">
        <Link to={issueLink(draftId, issue)} className="btn btn-small">
          該当箇所へ
        </Link>
      </div>
    </li>
  );
}

export function LegalReviewNote({ report }: { report: PreflightReport | null | undefined }) {
  return (
    <Alert kind="info" title="法的審査は別です（システムは法的問題なしと判定しません）">
      {report?.legalReviewNote ?? 'この検査は形式検査です。法的内容の確認は担当弁護士が行います。'}
    </Alert>
  );
}
