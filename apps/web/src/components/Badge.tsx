import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type BadgeTone = 'neutral' | 'selected' | 'success' | 'warning' | 'error' | 'muted' | 'legal';

export function Badge({ tone = 'neutral', icon, children }: { tone?: BadgeTone | undefined; icon?: IconName | undefined; children: ReactNode }) {
  const cls = tone === 'neutral' ? 'badge' : `badge badge-${tone}`;
  return (
    <span className={cls}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </span>
  );
}

/** 法的判断を含む項目 */
export function LegalJudgementBadge() {
  return (
    <Badge tone="legal" icon="alert">
      弁護士判断
    </Badge>
  );
}

export function SampleOnlyBadge() {
  return (
    <Badge tone="warning" icon="alert">
      サンプル・要確認
    </Badge>
  );
}

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'approved':
    case 'published':
    case 'succeeded':
    case 'confirmed':
    case 'received_verified':
    case 'clean':
    case 'ready':
    case 'rendered':
      return 'success';
    case 'changes_requested':
    case 'failed':
    case 'infected':
    case 'rejected':
    case 'scan_failed':
    case 'blocked':
    case 'partial_failed':
      return 'error';
    case 'in_review':
    case 'pending':
    case 'pending_approval':
    case 'testing':
    case 'quarantine':
    case 'scanning':
    case 'rendering':
    case 'running':
    case 'checking':
      return 'warning';
    case 'superseded':
    case 'retired':
    case 'archived':
    case 'cancelled':
    case 'withdrawn':
      return 'muted';
    default:
      return 'neutral';
  }
}
