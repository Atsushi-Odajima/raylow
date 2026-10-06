/**
 * S16 /matters/:id/evidence: 番号 → 原資料 → 標目/作成者/日付 → 立証趣旨。
 * 番号競合は 409 → 再選択。「甲第３号証の１」を小数にしない。主操作: 証拠説明書作成。
 */
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import type { Evidence, FileInfo } from '@raylow/contracts';
import { buildDisplayLabel, parseEvidenceLabel, parseJapaneseDate } from '@raylow/japanese-text';
import { useConfirmEvidence, useCorrectEvidence, useCreateEvidence, useUpdateEvidence, type EvidenceInput } from '../api/evidence';
import { latestFileVersionId } from '../api/files';
import { useMatter, useMatterEvidence, type EvidenceWithFile } from '../api/matters';
import { fieldErrorMap, isApiError } from '../lib/apiClient';
import { fileContentUrl, openInNewTab } from '../lib/download';
import { formatDateTime } from '../lib/format';
import { EVIDENCE_STATUS_LABEL, SCAN_STATUS_LABEL, label } from '../lib/labels';
import { Alert } from '../components/Alert';
import { Badge, statusTone } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { Field } from '../components/Field';
import { FileUpload } from '../components/FileUpload';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { TextArea } from '../components/TextArea';
import { Dialog } from '../components/Dialog';

export function EvidencePage() {
  const { id } = useParams();
  const matter = useMatter(id);
  const list = useMatterEvidence(id);
  const [editing, setEditing] = useState<EvidenceWithFile | 'new' | null>(null);
  const [correcting, setCorrecting] = useState<EvidenceWithFile | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const confirm = useConfirmEvidence();
  const rows = useMemo(() => [...(list.data ?? [])].sort((a, b) => a.canonicalNumber.localeCompare(b.canonicalNumber, 'ja', { numeric: true })), [list.data]);
  if (!id) return null;
  return (
    <div className="container">
      <PageHeader
        title="証拠台帳"
        lead={matter.data ? `${matter.data.titleRaw} ／ ${matter.data.caseNumberRaw || '事件番号なし'}` : undefined}
        crumbs={[{ to: '/matters', label: '案件' }, { to: `/matters/${id}`, label: matter.data?.titleRaw ?? '案件' }, { label: '証拠台帳' }]}
        actions={<><Button icon="plus" onClick={() => setEditing('new')}>証拠を追加</Button><LinkButton to={`/drafts/new?matterId=${id}`} variant="primary" icon="evidence">証拠説明書を作成</LinkButton></>}
      />
      <div className="stack">
        <Alert kind="info">証拠番号は原文（甲第３号証の１ など）を保持し、並替用の canonical 値を別に持ちます。確定後の改番は禁止で、訂正は履歴付きの別版になります。立証趣旨は弁護士が入力します。</Alert>
        {msg ? <Alert kind={msg.kind} live>{msg.text}</Alert> : null}
        {editing ? <EvidenceForm matterId={id} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
        {list.isLoading ? <LoadingState /> : null}
        {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
        {list.data && rows.length === 0 ? <EmptyState title="証拠はまだありません" action={<Button variant="primary" onClick={() => setEditing('new')}>証拠を追加</Button>}>原資料をアップロードし、番号・標目・作成者・日付・立証趣旨を登録します。</EmptyState> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">証拠台帳</caption>
              <thead><tr><th scope="col">番号</th><th scope="col">原資料</th><th scope="col">標目</th><th scope="col">作成者</th><th scope="col">日付</th><th scope="col">原本/写し</th><th scope="col">立証趣旨</th><th scope="col">状態</th><th scope="col">操作</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-raw"><b>{e.displayLabel}</b><div className="aux muted mono">{e.canonicalNumber}</div></td>
                    <td>{e.fileVersionId ? <Button small variant="quiet" icon="original" onClick={() => void openInNewTab(fileContentUrl(e.fileId ?? e.fileVersionId ?? '', e.fileVersionId)).catch((er: unknown) => setMsg({ kind: 'error', text: isApiError(er) ? (er.code === 'file_quarantined' ? '原資料は検査完了まで取得できません。' : er.userMessage()) : '原本を開けません' }))}>{e.fileName ?? '原本を開く'}</Button> : <span className="muted">未登録</span>}</td>
                    <td className="cell-raw">{e.titleRaw}</td>
                    <td className="cell-raw">{e.authorRaw}</td>
                    <td className="cell-raw">{e.dateRaw}{e.dateIso ? <div className="aux muted">{e.dateIso}</div> : null}</td>
                    <td>{e.originalCopy === 'original' ? '原本' : '写し'}</td>
                    <td className="cell-raw">{e.proofPurposeRaw || <span className="muted">未入力（弁護士）</span>}</td>
                    <td><Badge tone={statusTone(e.status)}>{label(EVIDENCE_STATUS_LABEL, e.status)}</Badge></td>
                    <td className="actions">
                      {e.status === 'draft' ? <><Button small onClick={() => setEditing(e)}>編集</Button> <Button small variant="primary" busy={confirm.isPending} onClick={() => void confirm.mutateAsync({ id: e.id, expectedVersion: e.version }).then(() => setMsg({ kind: 'success', text: `${e.displayLabel} を確定しました。` })).catch((er: unknown) => setMsg({ kind: 'error', text: isApiError(er) && er.isConflict ? `${e.displayLabel} は番号が競合しています（既に同じ canonical 番号が確定済み）。別の番号を選び直してください。` : isApiError(er) ? er.userMessage() : '確定に失敗しました' }))}>確定</Button></> : null}
                      {e.status === 'confirmed' || e.status === 'submitted' ? <Button small onClick={() => setCorrecting(e)}>訂正（履歴付き）</Button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      {correcting ? <CorrectDialog e={correcting} onClose={() => setCorrecting(null)} /> : null}
    </div>
  );
}

function EvidenceForm({ matterId, initial, onClose }: { matterId: string; initial: Evidence | null; onClose: () => void }) {
  const create = useCreateEvidence();
  const update = useUpdateEvidence();
  const [form, setForm] = useState<EvidenceInput>(initial ? { matterId, symbolRaw: initial.symbolRaw, numberRaw: initial.numberRaw, branchRaw: initial.branchRaw, fileVersionId: initial.fileVersionId, titleRaw: initial.titleRaw, authorRaw: initial.authorRaw, dateRaw: initial.dateRaw, originalCopy: initial.originalCopy, proofPurposeRaw: initial.proofPurposeRaw } : { matterId, symbolRaw: '甲', numberRaw: '', branchRaw: null, fileVersionId: null, titleRaw: '', authorRaw: '', dateRaw: '', originalCopy: 'copy', proofPurposeRaw: '' });
  const [uploaded, setUploaded] = useState<FileInfo | null>(null);
  const err = create.error ?? update.error;
  const errors = fieldErrorMap(err);
  const set = <K extends keyof EvidenceInput>(k: K, v: EvidenceInput[K]) => setForm({ ...form, [k]: v });
  const labelPreview = form.numberRaw ? buildDisplayLabel(form.symbolRaw, form.numberRaw, form.branchRaw ?? null) : '';
  const parsed = labelPreview ? parseEvidenceLabel(labelPreview) : null;
  const dateParsed = form.dateRaw ? parseJapaneseDate(form.dateRaw) : null;
  const submit = async () => {
    try {
      if (initial) await update.mutateAsync({ id: initial.id, patch: { symbolRaw: form.symbolRaw, numberRaw: form.numberRaw, branchRaw: form.branchRaw ?? null, fileVersionId: form.fileVersionId ?? null, titleRaw: form.titleRaw, authorRaw: form.authorRaw, dateRaw: form.dateRaw, originalCopy: form.originalCopy, proofPurposeRaw: form.proofPurposeRaw }, expectedVersion: initial.version });
      else await create.mutateAsync(form);
      onClose();
    } catch {
      /* errors で表示 */
    }
  };
  return (
    <form className="band stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      <h2 style={{ fontSize: 18 }}>{initial ? `証拠を編集: ${initial.displayLabel}` : '証拠を追加'}</h2>
      {err ? <Alert kind="error" live title={isApiError(err) && err.isConflict ? '番号が競合しています' : undefined}>{isApiError(err) ? (err.isConflict ? '同じ番号の証拠が既に確定しています。別の番号・枝番を選び直してください。' : err.userMessage()) : '保存に失敗しました'}</Alert> : null}
      <div className="form-grid">
        <Field label="符号" required error={errors.symbolRaw}>{({ id, describedBy, invalid }) => <Input id={id} value={form.symbolRaw} onValueChange={(v) => set('symbolRaw', v)} aria-describedby={describedBy} invalid={invalid} list="symbol-list" autoComplete="off" />}</Field>
        <datalist id="symbol-list"><option value="甲" /><option value="乙" /><option value="丙" /></datalist>
        <Field label="番号（原文）" required error={errors.numberRaw} hint="全角でも可。先頭 0 は保持">{({ id, describedBy, invalid }) => <Input id={id} value={form.numberRaw} onValueChange={(v) => set('numberRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
        <Field label="枝番（原文・任意）" error={errors.branchRaw}>{({ id, describedBy, invalid }) => <Input id={id} value={form.branchRaw ?? ''} onValueChange={(v) => set('branchRaw', v || null)} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
      </div>
      {labelPreview ? <div className="parsed-candidate">表示: <strong>{labelPreview}</strong>{parsed?.canonical ? ` ／ canonical ${parsed.canonical.symbol}:${parsed.canonical.number}${parsed.canonical.branch.length ? ':' + parsed.canonical.branch.join('.') : ''}` : ''}{parsed?.warnings.length ? ` ／ 注意: ${parsed.warnings.join(', ')}` : ''}</div> : null}
      <div className="form-grid">
        <Field label="標目" error={errors.titleRaw} className="span-all">{({ id, describedBy, invalid }) => <Input id={id} value={form.titleRaw ?? ''} onValueChange={(v) => set('titleRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
        <Field label="作成者" error={errors.authorRaw}>{({ id, describedBy, invalid }) => <Input id={id} value={form.authorRaw ?? ''} onValueChange={(v) => set('authorRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
        <Field label="作成日（原文）" error={errors.dateRaw} hint={dateParsed ? `解析候補: ${dateParsed.iso ?? '—'}（${dateParsed.precision}）${dateParsed.needsConfirmation ? ' 要確認' : ''}` : '例: 令和８年３月１日 / 2026-03-01'}>{({ id, describedBy, invalid }) => <Input id={id} value={form.dateRaw ?? ''} onValueChange={(v) => set('dateRaw', v)} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
        <Field label="原本・写し">{({ id }) => <Select id={id} value={form.originalCopy ?? 'copy'} onValueChange={(v) => set('originalCopy', v as 'original' | 'copy')} options={[{ value: 'original', label: '原本' }, { value: 'copy', label: '写し' }]} />}</Field>
      </div>
      <Field label="立証趣旨（弁護士が入力）" error={errors.proofPurposeRaw}>{({ id, describedBy, invalid }) => <TextArea id={id} short value={form.proofPurposeRaw ?? ''} onValueChange={(v) => set('proofPurposeRaw', v)} aria-describedby={describedBy} invalid={invalid} />}</Field>
      <div className="stack-s">
        <b>原資料</b>
        {form.fileVersionId ? <div className="row aux"><Badge tone="success">登録済み</Badge><span className="mono">{form.fileVersionId.slice(0, 8)}</span>{uploaded ? <span>{uploaded.originalNameRaw}（{label(SCAN_STATUS_LABEL, uploaded.scanStatus)}）</span> : null}<Button small variant="quiet" onClick={() => { set('fileVersionId', null); setUploaded(null); }}>外す</Button></div> : null}
        <FileUpload scope="matter" matterId={matterId} accept=".pdf,.docx,.png,.jpg,.jpeg,.txt,.csv" maxBytes={100 * 1024 * 1024} onUploaded={(f) => { setUploaded(f); set('fileVersionId', latestFileVersionId(f)); }} label="原資料をアップロード" />
      </div>
      <div className="row"><Button type="submit" variant="primary" busy={create.isPending || update.isPending} disabledReason={!form.symbolRaw.trim() || !form.numberRaw.trim() ? '符号と番号を入力してください' : undefined}>{initial ? '保存' : '追加（下書き）'}</Button><Button variant="quiet" onClick={onClose}>閉じる</Button></div>
    </form>
  );
}

function CorrectDialog({ e, onClose }: { e: Evidence; onClose: () => void }) {
  const correct = useCorrectEvidence();
  const [reason, setReason] = useState('');
  const [symbol, setSymbol] = useState(e.symbolRaw);
  const [number, setNumber] = useState(e.numberRaw);
  const [branch, setBranch] = useState(e.branchRaw ?? '');
  return (
    <Dialog open title={`訂正: ${e.displayLabel}`} onClose={onClose} actions={<><Button variant="quiet" onClick={onClose}>キャンセル</Button><Button variant="primary" busy={correct.isPending} disabledReason={!reason.trim() ? '理由を入力してください' : undefined} onClick={() => void correct.mutateAsync({ id: e.id, input: { expectedVersion: e.version, reasonRaw: reason, symbolRaw: symbol, numberRaw: number, branchRaw: branch || null } }).then(onClose).catch(() => undefined)}>履歴付きで訂正</Button></>}>
      <Alert kind="warning">{e.status === 'submitted' ? '提出済みラベルの改番は禁止です。訂正は履歴付きの別版として記録され、元のラベルは維持されます。' : '確定済みの証拠番号を訂正します。元の版は履歴として残ります。'}</Alert>
      {correct.isError ? <Alert kind="error" live>{isApiError(correct.error) ? (correct.error.isConflict ? '訂正後の番号が競合しています。別の番号を選んでください。' : correct.error.userMessage()) : '訂正に失敗しました'}</Alert> : null}
      <div className="form-grid">
        <Field label="符号">{({ id }) => <Input id={id} value={symbol} onValueChange={setSymbol} />}</Field>
        <Field label="番号">{({ id }) => <Input id={id} value={number} onValueChange={setNumber} />}</Field>
        <Field label="枝番">{({ id }) => <Input id={id} value={branch} onValueChange={setBranch} />}</Field>
      </div>
      <div className="parsed-candidate">訂正後の表示: <strong>{number ? buildDisplayLabel(symbol, number, branch || null) : '—'}</strong></div>
      <Field label="訂正理由" required>{({ id }) => <TextArea id={id} short value={reason} onValueChange={setReason} />}</Field>
      <p className="aux muted">最終更新 {formatDateTime(e.updatedAt)}</p>
    </Dialog>
  );
}
