/** S18 送付/提出の手動記録: 出した版 → 宛先/方法/日時 → 受付情報 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { FileInfo } from '@raylow/contracts';
import { useMatter } from '../api/matters';
import { createDispatchRecord, type DispatchRecordInput } from '../api/packets';
import { fieldErrorMap, isApiError } from '../lib/apiClient';
import { fromDateTimeLocal, toDateTimeLocal } from '../lib/format';
import { DISPATCH_METHOD_LABEL } from '../lib/labels';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { ContactPicker } from '../components/ContactPicker';
import { Field } from '../components/Field';
import { FileUpload } from '../components/FileUpload';
import { Input } from '../components/Input';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { TextArea } from '../components/TextArea';

type Method = DispatchRecordInput['method'];

export function DispatchNewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const matterId = params.get('matterId') ?? '';
  const outputId = params.get('outputId');
  const packetId = params.get('packetId');
  const matter = useMatter(matterId || null);
  const [rec, setRec] = useState({ nameRaw: '', organizationNameRaw: '', addressRaw: '', type: 'opponent_agent' });
  const [method, setMethod] = useState<Method>('post');
  const [methodNote, setMethodNote] = useState('');
  const [sentAt, setSentAt] = useState(toDateTimeLocal(new Date().toISOString()));
  const [receipt, setReceipt] = useState('');
  const [received, setReceived] = useState('');
  const [receiptFile, setReceiptFile] = useState<FileInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const iso = fromDateTimeLocal(sentAt);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await createDispatchRecord({ matterId, packetId: packetId ?? null, outputId: outputId ?? null, recipientSnapshot: rec, method, ...(methodNote ? { methodNoteRaw: methodNote } : {}), sentAt: iso ?? sentAt, receiptRaw: receipt, receiptFileId: receiptFile?.id ?? null, receivedDocumentsRaw: received });
      navigate(`/dispatches/${r.id}`);
    } catch (e) {
      setFieldErr(fieldErrorMap(e));
      setErr(isApiError(e) ? e.userMessage() : '記録に失敗しました');
    } finally {
      setBusy(false);
    }
  };
  const block = !matterId ? '案件が指定されていません（案件・出力画面から開いてください）' : !rec.nameRaw.trim() ? '宛先名を入力してください' : !iso ? '日時を入力してください' : undefined;
  return (
    <div className="container">
      <PageHeader title="送付・提出を記録" lead={matter.data ? `${matter.data.titleRaw}` : undefined} crumbs={[{ to: matterId ? `/matters/${matterId}` : '/matters', label: '案件' }, { label: '送付・提出記録' }]} />
      <div className="form-800 stack-l">
        <Alert kind="info">アプリは外部へ自動送信しません。実際に送付・提出した事実を手動で記録し、別の担当者が受領を確認（received_verified）します。出力済みと提出済みは別の状態です。</Alert>
        {err ? <Alert kind="error" live>{err}</Alert> : null}
        <section className="band stack">
          <h2 style={{ fontSize: 18 }}>出した版</h2>
          <dl className="dl"><dt>出力</dt><dd className="mono">{outputId ?? '—'}</dd><dt>提出パック</dt><dd className="mono">{packetId ?? '—'}</dd></dl>
          {!outputId && !packetId ? <Alert kind="warning">出力または提出パックが指定されていません。何を送付したか特定するため、出力画面またはパック画面から記録することを推奨します。</Alert> : null}
        </section>
        <section className="band stack">
          <h2 style={{ fontSize: 18 }}>宛先・方法・日時</h2>
          <ContactPicker selectedId={null} onSelect={(c) => setRec({ ...rec, nameRaw: c.nameRaw, organizationNameRaw: c.organizationNameRaw, addressRaw: c.addressRaw })} />
          <div className="form-grid">
            <Field label="宛先名（snapshot）" required error={fieldErr['recipientSnapshot.nameRaw']}>{({ id, describedBy, invalid }) => <Input id={id} value={rec.nameRaw} onValueChange={(v) => setRec({ ...rec, nameRaw: v })} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
            <Field label="所属">{({ id }) => <Input id={id} value={rec.organizationNameRaw} onValueChange={(v) => setRec({ ...rec, organizationNameRaw: v })} autoComplete="off" />}</Field>
            <Field label="住所" className="span-all">{({ id }) => <Input id={id} value={rec.addressRaw} onValueChange={(v) => setRec({ ...rec, addressRaw: v })} autoComplete="off" />}</Field>
            <Field label="宛先種別">{({ id }) => <Select id={id} value={rec.type} onValueChange={(v) => setRec({ ...rec, type: v })} options={[{ value: 'opponent_agent', label: '相手方代理人' }, { value: 'opponent', label: '相手方本人' }, { value: 'client', label: '依頼者' }, { value: 'court', label: '裁判所' }, { value: 'third_party', label: '第三者' }]} />}</Field>
            <Field label="方法" required>{({ id }) => <Select id={id} value={method} onValueChange={(v) => setMethod(v as Method)} options={Object.entries(DISPATCH_METHOD_LABEL).map(([v, l]) => ({ value: v, label: l }))} />}</Field>
            <Field label="方法の補足（追跡番号など原文）">{({ id }) => <Input id={id} value={methodNote} onValueChange={setMethodNote} autoComplete="off" />}</Field>
            <Field label="送付・提出日時（日本時間）" required error={fieldErr.sentAt}>{({ id, describedBy, invalid }) => <Input id={id} type="datetime-local" value={sentAt} onValueChange={setSentAt} aria-describedby={describedBy} invalid={invalid} />}</Field>
          </div>
        </section>
        <section className="band stack">
          <h2 style={{ fontSize: 18 }}>受付情報</h2>
          <Field label="受付番号（原文）">{({ id }) => <Input id={id} value={receipt} onValueChange={setReceipt} autoComplete="off" />}</Field>
          <Field label="受領資料・控え">{({ id }) => <TextArea id={id} short value={received} onValueChange={setReceived} />}</Field>
          <div className="stack-s"><b>受付控えのファイル（任意）</b>{receiptFile ? <div className="aux">登録済み: {receiptFile.originalNameRaw}</div> : null}<FileUpload scope="receipt" matterId={matterId} accept=".pdf,.png,.jpg,.jpeg" onUploaded={(f) => setReceiptFile(f)} label="控えをアップロード" /></div>
        </section>
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" icon="recipient" onClick={() => void submit()} busy={busy} disabledReason={block}>記録する</Button></div>
      </div>
    </div>
  );
}
