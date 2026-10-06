/** S17 /packets/new: 提出先/profile → 対象書類 → 添付 → 作成（検査・出力は /packets/:id） */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { MatterSummary } from '@raylow/contracts';
import { useMatter, useMatterDocuments, useMatterEvidence } from '../api/matters';
import { createPacket, type PacketCreateInput } from '../api/packets';
import { fetchDocumentOutput } from '../api/drafts';
import { useCourtProfiles } from '../api/templates';
import { isApiError } from '../lib/apiClient';
import { draftStatusLabel, templateKindLabel } from '../lib/labels';
import { Alert } from '../components/Alert';
import { Badge, statusTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Field } from '../components/Field';
import { Input } from '../components/Input';
import { MatterPicker } from '../components/MatterPicker';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { Stepper } from '../components/Stepper';
import { LoadingState } from '../components/States';

type StepKey = 'court' | 'documents' | 'attachments' | 'create';

export function PacketNewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const pre = useMatter(params.get('matterId'));
  const [matter, setMatter] = useState<MatterSummary | null>(null);
  const m = matter ?? pre.data ?? null;
  const [step, setStep] = useState<StepKey>('court');
  const [courtProfileId, setCourtProfileId] = useState('');
  const [title, setTitle] = useState('');
  const [docIds, setDocIds] = useState<Set<string>>(new Set());
  const [evIds, setEvIds] = useState<Set<string>>(new Set());
  const [confirmedExternal, setConfirmedExternal] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const profiles = useCourtProfiles();
  const docs = useMatterDocuments(m?.id);
  const evidence = useMatterEvidence(m?.id);
  const approvedDocs = useMemo(() => (docs.data ?? []).filter((d) => d.status === 'approved'), [docs.data]);
  const otherDocs = useMemo(() => (docs.data ?? []).filter((d) => d.status !== 'approved' && d.status !== 'archived'), [docs.data]);
  const confirmedEvidence = useMemo(() => (evidence.data ?? []).filter((e) => e.status === 'confirmed' || e.status === 'submitted'), [evidence.data]);
  const profile = profiles.data?.find((p) => p.id === courtProfileId);

  const submit = async () => {
    if (!m || !courtProfileId) return;
    setBusy(true);
    setErr(null);
    try {
      let order = 1;
      const items: PacketCreateInput['items'] = [];
      // PacketItemInput は outputId を要求するため、承認済み書類ごとに正式 PDF 出力を解決する
      const missing: string[] = [];
      for (const id of docIds) {
        const doc = approvedDocs.find((d) => d.id === id);
        const out = await fetchDocumentOutput(id);
        const approvedId = out.approvedRevision?.id ?? null;
        const pdf = out.outputs.filter((o) => o.format === 'pdf' && o.mode === 'final' && o.status === 'ready' && (!approvedId || o.revisionId === approvedId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
        if (!pdf) {
          missing.push(doc?.titleRaw ?? id);
          continue;
        }
        items.push({ outputId: pdf.id, displayNameRaw: doc?.titleRaw ?? '', orderNo: order++, externalOutputConfirmed: true });
      }
      if (missing.length > 0) {
        setErr(`正式 PDF が未生成の書類があります: ${missing.join('、')}。出力画面で「正式版を生成」してから作成してください。`);
        return;
      }
      for (const id of evIds) items.push({ evidenceId: id, displayNameRaw: confirmedEvidence.find((e) => e.id === id)?.displayLabel ?? '', orderNo: order++, externalOutputConfirmed: confirmedExternal.has(id) });
      const p = await createPacket({ matterId: m.id, courtProfileId, titleRaw: title, items });
      navigate(`/packets/${p.id}`);
    } catch (e) {
      setErr(isApiError(e) ? e.userMessage() : '作成に失敗しました');
    } finally {
      setBusy(false);
    }
  };
  const block = !m ? '案件を選んでください' : !courtProfileId ? '提出先 profile を選んでください' : docIds.size + evIds.size === 0 ? '書類または証拠を 1 件以上選んでください' : undefined;

  return (
    <div className="container">
      <PageHeader title="提出パックの作成" lead="選択した書面の PDF/DOCX と証拠の提出用 PDF、manifest.json、確認一覧.txt を安全な連番名で ZIP 化します。内部監査・原本・所内メモは初期選択しません。" crumbs={[{ to: '/create', label: '作成' }, { label: '提出パック' }]} />
      <div style={{ marginBottom: 'var(--space-5)' }}><Stepper label="工程" current={step} onSelect={setStep} steps={[{ key: 'court', label: '提出先・profile', done: !!courtProfileId && !!m }, { key: 'documents', label: '対象書類', done: docIds.size > 0 }, { key: 'attachments', label: '添付（証拠）', done: evIds.size > 0 }, { key: 'create', label: '作成' }]} /></div>
      <div className="form-800 stack-l">
        {step === 'court' ? (
          <section className="band stack">
            <h2 style={{ fontSize: 18 }}>提出先・適用 profile</h2>
            <MatterPicker selected={m} onSelect={setMatter} />
            <Field label="裁判所 profile" required hint="初期は generic（形式上の確認のみ）。個別裁判所の書式を全国共通としません。公式仕様を確認してから追加します">{({ id, describedBy }) => <Select id={id} aria-describedby={describedBy} value={courtProfileId} onValueChange={setCourtProfileId} placeholder="選択" options={(profiles.data ?? []).map((p) => ({ value: p.id, label: `${p.name}（${p.applicableProcedure}）v${p.version}` }))} />}</Field>
            {profile ? <dl className="dl"><dt>出典</dt><dd>{profile.sourceUrl ?? '—'}</dd><dt>確認日</dt><dd>{profile.checkedAt ?? '—'}</dd><dt>適用手続</dt><dd>{profile.applicableProcedure}</dd></dl> : null}
            <Field label="パック名（任意）">{({ id }) => <Input id={id} value={title} onValueChange={setTitle} autoComplete="off" />}</Field>
            <div><Button variant="primary" onClick={() => setStep('documents')} disabledReason={!m || !courtProfileId ? '案件と profile を選んでください' : undefined}>次へ</Button></div>
          </section>
        ) : null}
        {step === 'documents' ? (
          <section className="band stack">
            <h2 style={{ fontSize: 18 }}>対象書類（承認済みのみ）</h2>
            {docs.isLoading ? <LoadingState /> : null}
            {approvedDocs.length === 0 ? <Alert kind="warning">承認済みの書類がありません。正式提出パックには弁護士承認済みの版が必要です。</Alert> : approvedDocs.map((d) => <Checkbox key={d.id} checked={docIds.has(d.id)} onCheckedChange={(c) => setDocIds((s) => { const n = new Set(s); if (c) n.add(d.id); else n.delete(d.id); return n; })} label={<>{d.titleRaw} <span className="aux muted">{templateKindLabel(d.kind)}</span></>} />)}
            {otherDocs.length > 0 ? <details><summary>未承認の書類（{otherDocs.length} 件・選択不可）</summary><ul className="rowlist">{otherDocs.map((d) => <li key={d.id} className="rowlist__item"><div className="rowlist__main"><div className="rowlist__title">{d.titleRaw}</div><div className="rowlist__meta"><Badge tone={statusTone(d.status)}>{draftStatusLabel(d.status)}</Badge></div></div><div className="rowlist__actions"><a className="btn btn-small" href={`/drafts/${d.id}/check`}>検査・レビューへ</a></div></li>)}</ul></details> : null}
            <div className="row"><Button onClick={() => setStep('court')}>戻る</Button><Button variant="primary" onClick={() => setStep('attachments')}>次へ</Button></div>
          </section>
        ) : null}
        {step === 'attachments' ? (
          <section className="band stack">
            <h2 style={{ fontSize: 18 }}>添付（確定済み証拠）</h2>
            <Alert kind="info">機密資料の外部出力可否は資料ごとに確認します。確認チェックが無い資料は検査で止まります。</Alert>
            {evidence.isLoading ? <LoadingState /> : null}
            {confirmedEvidence.length === 0 ? <p className="muted">確定済みの証拠がありません。<a href={m ? `/matters/${m.id}/evidence` : '#'}>証拠台帳</a>で確定してください。</p> : confirmedEvidence.map((e) => (
              <div key={e.id} className="notice-box stack-s">
                <Checkbox checked={evIds.has(e.id)} onCheckedChange={(c) => setEvIds((s) => { const n = new Set(s); if (c) n.add(e.id); else n.delete(e.id); return n; })} label={<><b>{e.displayLabel}</b> {e.titleRaw}</>} description={`${e.authorRaw || '作成者不明'} ／ ${e.dateRaw || '日付不明'} ／ ${e.originalCopy === 'original' ? '原本' : '写し'}${e.fileVersionId ? '' : ' ／ 原資料未登録'}`} />
                {evIds.has(e.id) ? <Checkbox checked={confirmedExternal.has(e.id)} onCheckedChange={(c) => setConfirmedExternal((s) => { const n = new Set(s); if (c) n.add(e.id); else n.delete(e.id); return n; })} label="この資料の外部出力（提出）を確認した" /> : null}
              </div>
            ))}
            <div className="row"><Button onClick={() => setStep('documents')}>戻る</Button><Button variant="primary" onClick={() => setStep('create')}>次へ</Button></div>
          </section>
        ) : null}
        {step === 'create' ? (
          <section className="band stack">
            <h2 style={{ fontSize: 18 }}>作成</h2>
            <dl className="dl"><dt>案件</dt><dd>{m?.titleRaw ?? '—'}</dd><dt>profile</dt><dd>{profile?.name ?? '—'}</dd><dt>書類</dt><dd className="num">{docIds.size} 件</dd><dt>証拠</dt><dd className="num">{evIds.size} 件（外部出力確認 {confirmedExternal.size} 件）</dd></dl>
            {err ? <Alert kind="error" live>{err}</Alert> : null}
            <div className="row"><Button onClick={() => setStep('attachments')}>戻る</Button><Button variant="primary" icon="output" onClick={() => void submit()} busy={busy} disabledReason={block}>パックを作成（検査へ）</Button></div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
