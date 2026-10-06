/**
 * S13 /batches/new: 案件 → 書式（≤20） → 宛先（≤50） → 生成。合計 100 上限。
 * 宛先ごとに独立 snapshot。他宛先の情報は混入しない旨を表示する。
 */
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { MatterSummary, RecipientType } from '@raylow/contracts';
import { createBatch } from '../api/batches';
import { useMatter } from '../api/matters';
import { useTemplates } from '../api/templates';
import { isApiError } from '../lib/apiClient';
import { newUuid } from '../lib/ids';
import { PARTY_ROLE_LABEL, RECIPIENT_TYPE_LABEL, label, templateKindLabel } from '../lib/labels';
import { Alert } from '../components/Alert';
import { SampleOnlyBadge } from '../components/Badge';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { ContactPicker, type ContactLite } from '../components/ContactPicker';
import { Field } from '../components/Field';
import { MatterPicker } from '../components/MatterPicker';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { ErrorState, LoadingState } from '../components/States';

interface Recipient {
  key: string;
  type: RecipientType;
  contact: ContactLite | null;
}

export function BatchNewPage() {
  const navigate = useNavigate();
  const [matter, setMatter] = useState<MatterSummary | null>(null);
  const [templateIds, setTemplateIds] = useState<Set<string>>(new Set());
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [purpose, setPurpose] = useState<'drafts' | 'submission_pack'>('drafts');
  const [addType, setAddType] = useState<RecipientType>('opponent_agent');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idem = useRef(newUuid());
  const matterDetail = useMatter(matter?.id);
  const templates = useTemplates({ status: 'published' });

  const total = templateIds.size * recipients.length;
  const suggestions: ContactLite[] = useMemo(() => {
    const d = matterDetail.data;
    if (!d) return [];
    if (addType === 'opponent_agent') return d.agents.map((a) => ({ ...a.lawyerContact, type: 'lawyer' as const, note: '代理人' }));
    if (addType === 'client') return d.parties.filter((p) => p.role === 'client').map((p) => ({ ...p.contact, note: '依頼者' }));
    if (addType === 'opponent') return d.parties.filter((p) => p.role === 'opponent').map((p) => ({ ...p.contact, note: '相手方' }));
    return d.parties.map((p) => ({ ...p.contact, note: label(PARTY_ROLE_LABEL, p.role) }));
  }, [matterDetail.data, addType]);

  const addRecipient = (c: ContactLite | null) => {
    if (recipients.length >= 50) return;
    if (c && recipients.some((r) => r.type === addType && r.contact?.id === c.id)) return;
    setRecipients([...recipients, { key: newUuid(), type: addType, contact: c }]);
  };
  const block = !matter ? '案件を選んでください' : templateIds.size === 0 ? '書式を 1 つ以上選んでください' : templateIds.size > 20 ? '書式は 20 件までです' : recipients.length === 0 ? '宛先を 1 件以上追加してください' : recipients.length > 50 ? '宛先は 50 件までです' : total > 100 ? `合計 ${total} 件は上限 100 件を超えています` : undefined;

  const submit = async () => {
    if (!matter || block) return;
    setBusy(true);
    setErr(null);
    try {
      const b = await createBatch({ matterId: matter.id, templateVersionIds: [...templateIds], recipients: recipients.map((r) => ({ type: r.type, contactId: r.contact?.id ?? null })), idempotencyKey: idem.current, purpose });
      navigate(`/batches/${b.id}`);
    } catch (e) {
      setErr(isApiError(e) ? (e.code === 'batch_limit_exceeded' ? '合計 100 成果物の上限を超えています（422）。書式または宛先を減らしてください。' : e.userMessage()) : '作成に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <PageHeader title="一括作成" lead="1 案件で最大 20 書式 × 50 宛先、合計 100 成果物まで。宛先ごとに独立した差込で生成し、他宛先の情報は混入しません。" crumbs={[{ to: '/create', label: '作成' }, { label: '一括作成' }]} />
      <div className="form-800 stack-l">
        <section className="band stack"><h2 style={{ fontSize: 18 }}>1. 案件</h2><MatterPicker selected={matter} onSelect={setMatter} /></section>
        <section className="band stack">
          <h2 style={{ fontSize: 18 }}>2. 書式 <span className="aux muted num">{templateIds.size} / 20</span></h2>
          {templates.isLoading ? <LoadingState /> : null}
          {templates.isError ? <ErrorState error={templates.error} onRetry={() => void templates.refetch()} /> : null}
          {templates.data?.map((t) => {
            const av = t.activeVersion;
            if (!av || av.status !== 'published') return null;
            const checked = templateIds.has(av.id);
            return <Checkbox key={t.id} checked={checked} onCheckedChange={(c) => setTemplateIds((s) => { const n = new Set(s); if (c) n.add(av.id); else n.delete(av.id); return n; })} label={<>{t.name} <span className="aux muted">{templateKindLabel(t.kind)}</span> {av.sampleOnly ? <SampleOnlyBadge /> : null}</>} disabledReason={!checked && templateIds.size >= 20 ? '20 件に達しています' : undefined} />;
          })}
          <Field label="用途">{({ id }) => <Select id={id} value={purpose} onValueChange={(v) => setPurpose(v as 'drafts' | 'submission_pack')} options={[{ value: 'drafts', label: '草案（成功分を個別に取得可）' }, { value: 'submission_pack', label: '正式提出パック用（全件完成が必要）' }]} />}</Field>
        </section>
        <section className="band stack">
          <h2 style={{ fontSize: 18 }}>3. 宛先 <span className="aux muted num">{recipients.length} / 50</span></h2>
          <Alert kind="warning">宛先ごとに独立した差込を行います。対象外の当事者・他の宛先の情報が混入しないよう、宛先の所属・住所を確認してください。</Alert>
          <Field label="追加する宛先の種別">{({ id }) => <Select id={id} value={addType} onValueChange={(v) => setAddType(v as RecipientType)} options={(Object.keys(RECIPIENT_TYPE_LABEL) as RecipientType[]).map((t) => ({ value: t, label: RECIPIENT_TYPE_LABEL[t] }))} />}</Field>
          {addType === 'court' || addType === 'none' ? <div><Button small icon="plus" onClick={() => addRecipient(null)} disabledReason={recipients.length >= 50 ? '50 件に達しています' : undefined}>「{RECIPIENT_TYPE_LABEL[addType]}」を追加</Button></div> : <ContactPicker selectedId={null} onSelect={(c) => addRecipient(c)} suggestions={suggestions} type={addType === 'opponent_agent' ? 'lawyer' : undefined} />}
          {recipients.length > 0 ? (
            <ul className="rowlist" aria-label="追加済みの宛先">
              {recipients.map((r) => (
                <li key={r.key} className="rowlist__item">
                  <div className="rowlist__main"><div className="rowlist__title">{RECIPIENT_TYPE_LABEL[r.type]}{r.contact ? ` ／ ${r.contact.nameRaw}` : ''}</div>{r.contact ? <div className="rowlist__meta"><span>{r.contact.organizationNameRaw || '所属なし'}</span><span>{r.contact.addressRaw || '住所なし'}</span></div> : null}</div>
                  <div className="rowlist__actions"><Button small variant="quiet" onClick={() => setRecipients(recipients.filter((x) => x.key !== r.key))}>削除</Button></div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <section className="band stack">
          <h2 style={{ fontSize: 18 }}>4. 生成</h2>
          <p className="num">成果物 <b>{templateIds.size} 書式 × {recipients.length} 宛先 = {total} 件</b>（上限 100）</p>
          {err ? <Alert kind="error" live>{err}</Alert> : null}
          <div><Button variant="primary" icon="merge" onClick={() => void submit()} busy={busy} disabledReason={block}>生成を開始</Button></div>
        </section>
      </div>
    </div>
  );
}
