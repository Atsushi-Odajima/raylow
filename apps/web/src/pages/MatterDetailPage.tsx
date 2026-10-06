/**
 * S14 /matters/:id: 当事者/立場 → 代理人 → 裁判所/事件番号 → 受任範囲 → 書類。
 * 変更しても過去の書面は変わらない旨を表示。主操作「この案件で作成」。
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { MatterDetail, PartyRole } from '@raylow/contracts';
import { useAddAgent, useAddBarrier, useAddMatterMember, useAddParty, useMatter, useMatterAcceptance, useMatterDispatches, useMatterDocuments, useMatterLegalHold, useMatterStatus, useRemoveAgent, useRemoveMatterMember, useRemoveParty, useUpdateMatter, type MatterInput } from '../api/matters';
import { useMembers } from '../api/masters';
import { fieldErrorMap, isApiError } from '../lib/apiClient';
import { formatDateTime } from '../lib/format';
import { ACCEPTANCE_LABEL, DISPATCH_METHOD_LABEL, DISPATCH_STATUS_LABEL, MATTER_STATUS_LABEL, PARTY_ROLE_LABEL, draftStatusLabel, label, templateKindLabel } from '../lib/labels';
import { useSession } from '../lib/session';
import { Alert } from '../components/Alert';
import { Badge, statusTone } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { ContactPicker, type ContactLite } from '../components/ContactPicker';
import { Field } from '../components/Field';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { ErrorState, LoadingState } from '../components/States';
import { TextArea } from '../components/TextArea';
import { VersionConflictDialog } from '../components/VersionConflictDialog';
import { openPathFor } from './DocumentsPage';

export function MatterDetailPage() {
  const { id } = useParams();
  const q = useMatter(id);
  if (q.isLoading) return <div className="container"><LoadingState /></div>;
  if (q.isError || !q.data || !id) return <div className="container" style={{ paddingTop: 'var(--space-6)' }}><ErrorState error={q.error ?? new Error('not found')} onRetry={() => void q.refetch()} /></div>;
  return <MatterView m={q.data} />;
}

function MatterView({ m }: { m: MatterDetail }) {
  const session = useSession();
  const docs = useMatterDocuments(m.id);
  const dispatches = useMatterDispatches(m.id);
  const acceptance = useMatterAcceptance();
  const statusM = useMatterStatus();
  const hold = useMatterLegalHold();
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const run = async (p: Promise<unknown>) => {
    setErr(null);
    try {
      await p;
    } catch (e) {
      setErr(isApiError(e) ? e.userMessage() : '更新に失敗しました');
    }
  };
  const editable = m.canEdit && m.status === 'active';
  const editReason = !m.canEdit ? 'この案件の編集権限がありません' : m.status !== 'active' ? `状態「${label(MATTER_STATUS_LABEL, m.status)}」の案件は書込み停止中です（理由付き reopen で再開）` : undefined;

  return (
    <div className="container">
      <PageHeader
        title={m.titleRaw}
        lead={`${m.caseNumberRaw || '事件番号なし'} ／ ${m.courtRaw || '裁判所未設定'}${m.courtDepartmentRaw ? ` ${m.courtDepartmentRaw}` : ''}`}
        crumbs={[{ to: '/matters', label: '案件' }, { label: m.titleRaw }]}
        actions={<><LinkButton to={`/matters/${m.id}/evidence`} icon="evidence">証拠台帳</LinkButton><LinkButton to={`/packets/new?matterId=${m.id}`} icon="output">提出パック</LinkButton><LinkButton to={`/drafts/new?matterId=${m.id}`} variant="primary" icon="create">この案件で作成</LinkButton></>}
      />
      <div className="stack">
        <div className="row aux">
          <Badge tone={statusTone(m.status)}>{label(MATTER_STATUS_LABEL, m.status)}</Badge>
          <Badge tone={m.acceptanceStatus === 'confirmed' ? 'success' : 'warning'}>{label(ACCEPTANCE_LABEL, m.acceptanceStatus)}</Badge>
          {m.legalHold ? <Badge tone="error">legal hold（削除禁止）</Badge> : null}
          <span className="num">書類 {m.documentCount} 件</span>
          <span className="num">版 {m.version}</span>
        </div>
        <Alert kind="info">案件情報を変更しても、過去に作成した書面・確定版は変わりません。作成中の草案には「更新候補」として差分が表示されます。</Alert>
        {err ? <Alert kind="error" live>{err}</Alert> : null}

        <div className="grid-12">
          <section className="col-6 band stack" aria-labelledby="h-parties">
            <h2 id="h-parties" style={{ fontSize: 18 }}>当事者・立場</h2>
            {m.parties.length === 0 ? <p className="muted">当事者が登録されていません。</p> : (
              <ul className="rowlist">
                {m.parties.map((p) => (
                  <li key={p.id} className="rowlist__item">
                    <div className="rowlist__main"><div className="rowlist__title">{p.contact.nameRaw} <Badge>{label(PARTY_ROLE_LABEL, p.role)}</Badge>{p.positionRaw ? <span className="aux muted"> {p.positionRaw}</span> : null}</div><div className="rowlist__meta"><span>{p.contact.organizationNameRaw || '所属なし'}</span><span>{p.contact.addressRaw || '住所なし'}</span>{p.representative ? <span>代表者: {p.representative.nameRaw}</span> : null}</div></div>
                    <div className="rowlist__actions"><RemovePartyButton matterId={m.id} partyId={p.id} disabledReason={editReason} /></div>
                  </li>
                ))}
              </ul>
            )}
            {editable ? <AddPartyForm matterId={m.id} /> : null}
          </section>
          <section className="col-6 band stack" aria-labelledby="h-agents">
            <h2 id="h-agents" style={{ fontSize: 18 }}>代理人</h2>
            {m.agents.length === 0 ? <p className="muted">代理人が登録されていません。相手方に代理人がいる場合は登録してください（本人宛て送付時の確認に使います）。</p> : (
              <ul className="rowlist">
                {m.agents.map((a) => {
                  const party = m.parties.find((p) => p.id === a.representedPartyId);
                  return (
                    <li key={a.id} className="rowlist__item">
                      <div className="rowlist__main"><div className="rowlist__title">{a.lawyerContact.nameRaw} <span className="aux muted">（{a.lawyerContact.organizationNameRaw || '所属なし'}）</span></div><div className="rowlist__meta"><span>代理する側: {party ? `${party.contact.nameRaw}（${label(PARTY_ROLE_LABEL, party.role)}）` : '不明'}</span><span>{a.lawyerContact.addressRaw || '住所なし'}</span>{a.validFrom || a.validTo ? <span>期間 {a.validFrom ?? '—'} 〜 {a.validTo ?? '—'}</span> : null}</div></div>
                      <div className="rowlist__actions"><RemoveAgentButton matterId={m.id} agentId={a.id} disabledReason={editReason} /></div>
                    </li>
                  );
                })}
              </ul>
            )}
            {editable ? <AddAgentForm m={m} /> : null}
          </section>
        </div>

        <div className="grid-12">
          <section className="col-6 band stack" aria-labelledby="h-court">
            <h2 id="h-court" style={{ fontSize: 18 }}>裁判所・事件番号・受任範囲</h2>
            <BasicInfoForm m={m} editable={editable} editReason={editReason} />
          </section>
          <section className="col-6 band stack" aria-labelledby="h-acc">
            <h2 id="h-acc" style={{ fontSize: 18 }}>受任確認・状態</h2>
            <dl className="dl">
              <dt>受任確認</dt><dd>{label(ACCEPTANCE_LABEL, m.acceptanceStatus)}{m.acceptanceCheckedAt ? <span className="aux muted">（{formatDateTime(m.acceptanceCheckedAt)}）</span> : null}</dd>
              <dt>担当弁護士</dt><dd>{m.leadLawyerId ? <span className="mono">{m.leadLawyerId.slice(0, 8)}</span> : <span className="muted">未設定</span>}</dd>
            </dl>
            <div className="row">
              {(['confirmed', 'unconfirmed', 'declined'] as const).filter((s) => s !== m.acceptanceStatus).map((s) => (
                <Button key={s} small onClick={() => void run(acceptance.mutateAsync({ id: m.id, acceptanceStatus: s, expectedVersion: m.version }))} busy={acceptance.isPending} disabledReason={!m.isAssignedLawyer ? '担当弁護士のみ受任確認を変更できます' : undefined}>
                  {label(ACCEPTANCE_LABEL, s)}にする
                </Button>
              ))}
            </div>
            <p className="aux muted">利益相反の法律判断は担当者が既存手順で行います。システムは判定しません。</p>
            <Field label="状態変更・legal hold の理由">{({ id }) => <Input id={id} value={reason} onValueChange={setReason} autoComplete="off" />}</Field>
            <div className="row">
              {m.status === 'active' ? <Button small onClick={() => void run(statusM.mutateAsync({ id: m.id, status: 'archived', ...(reason ? { reasonRaw: reason } : {}), expectedVersion: m.version }))} disabledReason={!m.canEdit ? '権限がありません' : undefined}>アーカイブ（書込み停止）</Button> : <Button small onClick={() => void run(statusM.mutateAsync({ id: m.id, status: 'active', ...(reason ? { reasonRaw: reason } : {}), expectedVersion: m.version }))} disabledReason={!reason.trim() ? 'reopen には理由が必要です' : !m.canEdit ? '権限がありません' : undefined}>再開（reopen）</Button>}
              <Button small onClick={() => void run(hold.mutateAsync({ id: m.id, legalHold: !m.legalHold, ...(reason ? { reasonRaw: reason } : {}), expectedVersion: m.version }))} disabledReason={!m.canEdit ? '権限がありません' : undefined}>{m.legalHold ? 'legal hold を解除' : 'legal hold を設定'}</Button>
            </div>
            {m.archiveReasonRaw ? <p className="aux muted">アーカイブ理由: {m.archiveReasonRaw}</p> : null}
          </section>
        </div>

        <section className="band stack" aria-labelledby="h-members">
          <h2 id="h-members" style={{ fontSize: 18 }}>案件メンバー（ACL）</h2>
          <Alert kind="info">メンバー追加は担当弁護士の承認が必要です。barrier が設定されたユーザーは本文・候補数・プレビュー・出力のすべてにアクセスできません。</Alert>
          <ul className="rowlist">{m.members.map((u) => <li key={u.userId} className="rowlist__item"><div className="rowlist__main"><div className="rowlist__title">{u.displayName} <span className="aux muted">{u.role}</span> {u.canEdit ? <Badge tone="success">編集可</Badge> : <Badge tone="muted">閲覧</Badge>}</div></div><div className="rowlist__actions"><RemoveMemberButton matterId={m.id} userId={u.userId} disabledReason={!m.isAssignedLawyer ? '担当弁護士のみ' : u.userId === session.info?.user?.id ? '自分自身は外せません' : undefined} /></div></li>)}</ul>
          {m.isAssignedLawyer ? <MemberForms matterId={m.id} existing={m.members.map((x) => x.userId)} /> : null}
        </section>

        <section className="band stack" aria-labelledby="h-docs">
          <div className="row-between"><h2 id="h-docs" style={{ fontSize: 18 }}>この案件の書類</h2><LinkButton to={`/batches/new?matterId=${m.id}`} small icon="merge">一括作成</LinkButton></div>
          {docs.isLoading ? <LoadingState /> : null}
          {docs.data && docs.data.length === 0 ? <p className="muted">書類はまだありません。「この案件で作成」から始めてください。</p> : null}
          {docs.data && docs.data.length > 0 ? <ul className="rowlist">{docs.data.map((d) => <li key={d.id} className="rowlist__item"><div className="rowlist__main"><div className="rowlist__title"><Link to={openPathFor(d)}>{d.titleRaw}</Link></div><div className="rowlist__meta"><span>{templateKindLabel(d.kind)}</span><Badge tone={statusTone(d.status)}>{draftStatusLabel(d.status)}</Badge><time dateTime={d.updatedAt}>{formatDateTime(d.updatedAt)}</time></div></div></li>)}</ul> : null}
        </section>
        <section className="band stack" aria-labelledby="h-disp">
          <h2 id="h-disp" style={{ fontSize: 18 }}>送付・提出記録</h2>
          {dispatches.data && dispatches.data.length === 0 ? <p className="muted">記録はありません。</p> : null}
          {dispatches.data && dispatches.data.length > 0 ? <ul className="rowlist">{dispatches.data.map((r) => <li key={r.id} className="rowlist__item"><div className="rowlist__main"><div className="rowlist__title"><Link to={`/dispatches/${r.id}`}>{label(DISPATCH_METHOD_LABEL, r.method)} → {r.recipientSnapshot.nameRaw}</Link></div><div className="rowlist__meta"><Badge tone={statusTone(r.status)}>{label(DISPATCH_STATUS_LABEL, r.status)}</Badge><time dateTime={r.sentAt}>{formatDateTime(r.sentAt)}</time></div></div></li>)}</ul> : null}
        </section>
      </div>
    </div>
  );
}

function BasicInfoForm({ m, editable, editReason }: { m: MatterDetail; editable: boolean; editReason: string | undefined }) {
  const update = useUpdateMatter();
  const [form, setForm] = useState<Partial<MatterInput>>({ titleRaw: m.titleRaw, caseNumberRaw: m.caseNumberRaw, courtRaw: m.courtRaw, courtDepartmentRaw: m.courtDepartmentRaw, scopeRaw: m.scopeRaw });
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<number | null>(null);
  const errors = fieldErrorMap(update.error);
  const set = <K extends keyof MatterInput>(k: K, v: MatterInput[K]) => { setForm({ ...form, [k]: v }); setDirty(true); };
  const cs = m.caseNumberStruct;
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void update.mutateAsync({ id: m.id, patch: form, expectedVersion: m.version }).then(() => setDirty(false)).catch((er: unknown) => { if (isApiError(er) && er.isConflict) setConflict(er.currentVersion); }); }} noValidate>
      {update.isError && !(isApiError(update.error) && update.error.isConflict) ? <Alert kind="error" live>{isApiError(update.error) ? update.error.userMessage() : '保存に失敗しました'}</Alert> : null}
      <Field label="案件名" required error={errors.titleRaw}>{({ id, describedBy, invalid }) => <Input id={id} value={form.titleRaw ?? ''} onValueChange={(v) => set('titleRaw', v)} aria-describedby={describedBy} invalid={invalid} disabled={!editable} />}</Field>
      <Field label="事件番号（原文）" error={errors.caseNumberRaw} hint={cs ? `構造化: ${cs.courtLabel ?? ''} ${cs.yearEra ?? ''}${cs.eraYear ?? ''} ${cs.symbol ?? ''} ${cs.serial ?? ''}（${cs.parseStatus === 'parsed' ? '解析済み' : cs.parseStatus === 'manual' ? '手入力' : '確認待ち'}）。原文は保存されます` : '原文のまま保存。構造化は確認待ちになります'}>{({ id, describedBy, invalid }) => <Input id={id} value={form.caseNumberRaw ?? ''} onValueChange={(v) => set('caseNumberRaw', v)} aria-describedby={describedBy} invalid={invalid} disabled={!editable} autoComplete="off" />}</Field>
      <div className="form-grid">
        <Field label="裁判所" error={errors.courtRaw}>{({ id, describedBy, invalid }) => <Input id={id} value={form.courtRaw ?? ''} onValueChange={(v) => set('courtRaw', v)} aria-describedby={describedBy} invalid={invalid} disabled={!editable} />}</Field>
        <Field label="部・係" error={errors.courtDepartmentRaw}>{({ id, describedBy, invalid }) => <Input id={id} value={form.courtDepartmentRaw ?? ''} onValueChange={(v) => set('courtDepartmentRaw', v)} aria-describedby={describedBy} invalid={invalid} disabled={!editable} />}</Field>
      </div>
      <Field label="受任範囲" error={errors.scopeRaw}>{({ id, describedBy, invalid }) => <TextArea id={id} short value={form.scopeRaw ?? ''} onValueChange={(v) => set('scopeRaw', v)} aria-describedby={describedBy} invalid={invalid} disabled={!editable} />}</Field>
      <div><Button type="submit" variant="primary" small busy={update.isPending} disabledReason={editReason ?? (!dirty ? '変更がありません' : undefined)}>保存</Button></div>
      <VersionConflictDialog open={conflict != null} currentVersion={conflict} myVersion={m.version} onReload={() => window.location.reload()} onClose={() => setConflict(null)} />
    </form>
  );
}

function AddPartyForm({ matterId }: { matterId: string }) {
  const add = useAddParty();
  const [contact, setContact] = useState<ContactLite | null>(null);
  const [role, setRole] = useState<PartyRole>('client');
  const [position, setPosition] = useState('');
  return (
    <details>
      <summary>当事者を追加</summary>
      <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
        {add.isError ? <Alert kind="error" live>{isApiError(add.error) ? add.error.userMessage() : '追加に失敗しました'}</Alert> : null}
        <Field label="立場">{({ id }) => <Select id={id} value={role} onValueChange={(v) => setRole(v as PartyRole)} options={Object.entries(PARTY_ROLE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />}</Field>
        <Field label="肩書・位置（原文）">{({ id }) => <Input id={id} value={position} onValueChange={setPosition} autoComplete="off" placeholder="例: 原告、被告、債務者" />}</Field>
        <ContactPicker selectedId={contact?.id ?? null} selectedLabel={contact?.nameRaw} onSelect={setContact} onClear={() => setContact(null)} />
        <div><Button small variant="primary" busy={add.isPending} disabledReason={!contact ? '連絡先を選択してください' : undefined} onClick={() => contact && void add.mutateAsync({ id: matterId, input: { contactId: contact.id, role, positionRaw: position } }).then(() => { setContact(null); setPosition(''); }).catch(() => undefined)}>当事者として追加</Button></div>
      </div>
    </details>
  );
}

function AddAgentForm({ m }: { m: MatterDetail }) {
  const add = useAddAgent();
  const [contact, setContact] = useState<ContactLite | null>(null);
  const [partyId, setPartyId] = useState('');
  return (
    <details>
      <summary>代理人を追加</summary>
      <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
        {add.isError ? <Alert kind="error" live>{isApiError(add.error) ? add.error.userMessage() : '追加に失敗しました'}</Alert> : null}
        <Field label="代理する当事者" required>{({ id }) => <Select id={id} value={partyId} onValueChange={setPartyId} placeholder="選択" options={m.parties.map((p) => ({ value: p.id, label: `${p.contact.nameRaw}（${label(PARTY_ROLE_LABEL, p.role)}）` }))} />}</Field>
        <ContactPicker selectedId={contact?.id ?? null} selectedLabel={contact?.nameRaw} onSelect={setContact} onClear={() => setContact(null)} type="lawyer" />
        <p className="aux muted">同姓同名の弁護士は所属で識別し、同一人物でもこの案件で代理する側を確認してください。</p>
        <div><Button small variant="primary" busy={add.isPending} disabledReason={!contact ? '弁護士（連絡先）を選択してください' : !partyId ? '代理する当事者を選択してください' : undefined} onClick={() => contact && void add.mutateAsync({ id: m.id, input: { lawyerContactId: contact.id, representedPartyId: partyId } }).then(() => setContact(null)).catch(() => undefined)}>代理人として追加</Button></div>
      </div>
    </details>
  );
}

function RemovePartyButton({ matterId, partyId, disabledReason }: { matterId: string; partyId: string; disabledReason: string | undefined }) {
  const rm = useRemoveParty();
  return <Button small variant="quiet" busy={rm.isPending} disabledReason={disabledReason} onClick={() => window.confirm('この当事者を案件から外しますか？過去の書面は変わりません。') && rm.mutate({ id: matterId, partyId })}>外す</Button>;
}
function RemoveAgentButton({ matterId, agentId, disabledReason }: { matterId: string; agentId: string; disabledReason: string | undefined }) {
  const rm = useRemoveAgent();
  return <Button small variant="quiet" busy={rm.isPending} disabledReason={disabledReason} onClick={() => window.confirm('この代理人を外しますか？') && rm.mutate({ id: matterId, agentId })}>外す</Button>;
}
function RemoveMemberButton({ matterId, userId, disabledReason }: { matterId: string; userId: string; disabledReason: string | undefined }) {
  const rm = useRemoveMatterMember();
  return <Button small variant="quiet" busy={rm.isPending} disabledReason={disabledReason} onClick={() => window.confirm('このメンバーを外しますか？') && rm.mutate({ id: matterId, userId })}>外す</Button>;
}

function MemberForms({ matterId, existing }: { matterId: string; existing: string[] }) {
  const members = useMembers();
  const add = useAddMatterMember();
  const barrier = useAddBarrier();
  const [userId, setUserId] = useState('');
  const [canEdit, setCanEdit] = useState(true);
  const [bUser, setBUser] = useState('');
  const [bReason, setBReason] = useState('');
  const opts = (members.data ?? []).filter((u) => u.status === 'active').map((u) => ({ value: u.userId, label: `${u.displayName}（${u.role}）`, disabled: existing.includes(u.userId) }));
  return (
    <div className="grid-12">
      <div className="col-6 stack-s">
        <h3>メンバーを追加（担当弁護士の承認として記録）</h3>
        {add.isError ? <Alert kind="error" live>{isApiError(add.error) ? add.error.userMessage() : '追加に失敗しました'}</Alert> : null}
        <Field label="ユーザー">{({ id }) => <Select id={id} value={userId} onValueChange={setUserId} placeholder="選択" options={opts} />}</Field>
        <Checkbox checked={canEdit} onCheckedChange={setCanEdit} label="編集を許可" />
        <div><Button small busy={add.isPending} disabledReason={!userId ? 'ユーザーを選択' : undefined} onClick={() => void add.mutateAsync({ id: matterId, userId, canEdit }).then(() => setUserId('')).catch(() => undefined)}>追加</Button></div>
      </div>
      <div className="col-6 stack-s">
        <h3>barrier（閲覧禁止）を設定</h3>
        {barrier.isError ? <Alert kind="error" live>{isApiError(barrier.error) ? barrier.error.userMessage() : '設定に失敗しました'}</Alert> : null}
        <Field label="ユーザー">{({ id }) => <Select id={id} value={bUser} onValueChange={setBUser} placeholder="選択" options={(members.data ?? []).map((u) => ({ value: u.userId, label: `${u.displayName}（${u.role}）` }))} />}</Field>
        <Field label="理由" required>{({ id }) => <Input id={id} value={bReason} onValueChange={setBReason} autoComplete="off" />}</Field>
        <div><Button small variant="danger" busy={barrier.isPending} disabledReason={!bUser ? 'ユーザーを選択' : !bReason.trim() ? '理由を入力' : undefined} onClick={() => void barrier.mutateAsync({ id: matterId, userId: bUser, reason: bReason }).then(() => { setBUser(''); setBReason(''); }).catch(() => undefined)}>barrier を設定</Button></div>
      </div>
    </div>
  );
}
