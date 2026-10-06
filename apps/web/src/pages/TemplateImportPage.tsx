/**
 * S10 /templates/import: 対応範囲 → ファイル → 検査 → タグ対応付け → 試作。
 * PC は設定 / 試作 PDF の 2 面、mobile は工程別。未対応要素は位置・理由・修正手順を表示する。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { TemplateVersion } from '@raylow/contracts';
import { SYSTEM_SUPPLIED_KEYS, TemplateFieldSchemaSchema, TemplateKindSchema, isSafeTagKey, parseTemplateFieldSchema, validateTemplateSchema, type FieldSpecInput, type TemplateFieldSchemaInput } from '@raylow/template-schema';
import { latestFileVersionId, useFile } from '../api/files';
import { useJob } from '../api/jobs';
import { importTemplate, useTemplateVersion, useTestTemplateVersion, useUpdateTemplateSchema, type TemplateImportFields } from '../api/templates';
import { fieldErrorMap, isApiError } from '../lib/apiClient';
import { downloadFile, fileContentUrl } from '../lib/download';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { RECIPIENT_TYPE_LABEL, TEMPLATE_KIND_LABEL, TEMPLATE_SCOPE_LABEL, templateKindLabel } from '../lib/labels';
import { Alert } from '../components/Alert';
import { Badge } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Field } from '../components/Field';
import { Icon } from '../components/Icon';
import { Input } from '../components/Input';
import { JobProgress } from '../components/JobProgress';
import { PageHeader } from '../components/PageHeader';
import { PdfPreview } from '../components/PdfPreview';
import { Select } from '../components/Select';
import { Stepper } from '../components/Stepper';
import { ErrorState, LoadingState } from '../components/States';
import { TextArea } from '../components/TextArea';

type StepKey = 'scope' | 'file' | 'inspect' | 'mapping' | 'test';
const MAX_DOCX = 20 * 1024 * 1024;
const FIELD_TYPES = ['text', 'multiline', 'date', 'enum', 'boolean', 'personRef', 'partyRef', 'money', 'array'] as const;
const SOURCES = ['input', 'office', 'matter', 'recipient'] as const;
const RECIPIENT_TYPES = ['opponent_agent', 'opponent', 'client', 'court', 'third_party', 'none'] as const;

const SUPPORTED = ['本文・段落・表・ヘッダー/フッター内のタグ（{office_name} など ASCII キー）', '表の単純な行繰返し {#rows}…{/rows}、条件 {#has_x}…{/has_x}', '単一セクション・A4 横書き、通常の文字書式・罫線・余白・固定画像', 'タグが複数 run に分かれていても処理'];
const UNSUPPORTED = ['変更履歴・コメント、テキストボックス、OLE/埋込オブジェクト、マクロ（DOCM）', '脚注/文末脚注、複数セクション、複雑なフィールド、外部 relationship', '繰返し行を跨ぐ縦結合、段落を跨ぐタグ、不均衡なループ', 'dot パス（{a.b}）・式・JS・raw XML 挿入'];

export function TemplateImportPage() {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const resumeVersionId = params.get('versionId');
  const parentTemplateId = params.get('templateId');
  const [step, setStep] = useState<StepKey>(resumeVersionId ? 'inspect' : 'scope');
  const [versionId, setVersionId] = useState<string | null>(resumeVersionId);
  const [templateId, setTemplateId] = useState<string | null>(parentTemplateId);
  const [inspectJobId, setInspectJobId] = useState<string | null>(null);
  const [testJobId, setTestJobId] = useState<string | null>(null);
  const [testFileId, setTestFileId] = useState<string | null>(null);

  const inspectJob = useJob(inspectJobId);
  const inspectActive = !!inspectJobId && (inspectJob.data == null || inspectJob.data.state === 'queued' || inspectJob.data.state === 'running');
  const version = useTemplateVersion(versionId, { refetchInterval: versionId && !inspectActive && step === 'inspect' && !inspectJobId ? 2500 : false });
  useEffect(() => {
    if (inspectJob.data && (inspectJob.data.state === 'succeeded' || inspectJob.data.state === 'failed')) void version.refetch();
  }, [inspectJob.data, version]);
  useEffect(() => {
    if (version.data?.templateId) setTemplateId(version.data.templateId);
  }, [version.data?.templateId]);

  const testJob = useJob(testJobId);
  useEffect(() => {
    const r = testJob.data?.result;
    if (testJob.data?.state === 'succeeded' && r && typeof r.outputFileId === 'string') setTestFileId(r.outputFileId);
  }, [testJob.data]);
  const testFile = useFile(testFileId, { refetchInterval: testFileId ? 2500 : false });
  const testFileReady = testFile.data && testFile.data.scanStatus === 'clean';
  const testPdfUrl = testFileReady && testFile.data.mime.includes('pdf') ? fileContentUrl(testFile.data.id, latestFileVersionId(testFile.data)) : null;

  const steps = [
    { key: 'scope' as const, label: '対応範囲', done: step !== 'scope' },
    { key: 'file' as const, label: 'ファイル', done: !!versionId },
    { key: 'inspect' as const, label: '検査', done: !!version.data?.inspectionReport },
    { key: 'mapping' as const, label: 'タグ対応付け', done: !!version.data?.fieldSchema },
    { key: 'test' as const, label: '試作', done: !!testFileId },
  ];

  const previewPane = (
    <div className="stack-s">
      <div className="row-between">
        <b><Icon name="document" size={20} /> 試作 PDF（架空データ）</b>
        {version.data && templateId ? <Link to={`/templates/${templateId}/versions/${version.data.revision}`} className="aux">版の詳細へ</Link> : null}
      </div>
      {testJobId ? <JobProgress job={testJob.data} pendingLabel="試作しています…" compact /> : null}
      {testFileId && !testFileReady ? <Alert kind="info">試作ファイルの検査待ちです（{testFile.data?.scanStatus ?? '取得中'}）。</Alert> : null}
      {testFileReady && !testPdfUrl ? (
        <Alert kind="info" actions={<Button small icon="export" onClick={() => void downloadFile(fileContentUrl(testFile.data.id, latestFileVersionId(testFile.data)), testFile.data.originalNameRaw)}>試作ファイルを取得</Button>}>
          試作結果は {testFile.data.mime} です。
        </Alert>
      ) : null}
      <PdfPreview src={testPdfUrl} version={testFileId ?? undefined} emptyLabel="試作を実行すると、架空データを差し込んだ PDF をここに表示します。" />
    </div>
  );

  return (
    <div className="container">
      <PageHeader title="独自 DOCX 書式の登録" lead="タグ付き DOCX を登録 → 検出タグをスキーマ項目へ対応付け → 架空データで試作 → 版の公開。元ファイルは変更しません。" crumbs={[{ to: '/templates', label: '書式' }, { label: '登録' }]} />
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <Stepper label="登録の工程" steps={steps} current={step} onSelect={(k) => setStep(k)} />
      </div>
      <div className={isDesktop ? 'two-pane' : 'stack'}>
        <div className="stack">
          {step === 'scope' ? (
            <section className="band stack">
              <h2 style={{ fontSize: 18 }}>対応範囲</h2>
              <div className="grid-12">
                <div className="col-6"><h3>対応</h3><ul style={{ listStyle: 'disc', paddingLeft: '1.2em' }}>{SUPPORTED.map((s) => <li key={s}>{s}</li>)}</ul></div>
                <div className="col-6"><h3>初版では拒否（理由と修正手順を表示）</h3><ul style={{ listStyle: 'disc', paddingLeft: '1.2em' }}>{UNSUPPORTED.map((s) => <li key={s}>{s}</li>)}</ul></div>
              </div>
              <Alert kind="warning" title="他案件の実名・住所を含む DOCX を共通書式にすると情報が漏れます">タグ以外の残存文字は検出候補として表示します。公開前に確認者が全ページを確認してください（完全自動検知は保証しません）。印影・実署名は書式に含めないでください。</Alert>
              <div><Button variant="primary" onClick={() => setStep('file')}>ファイル選択へ</Button></div>
            </section>
          ) : null}
          {step === 'file' ? <FileStep templateId={templateId} onImported={(r) => { setVersionId(r.versionId); setTemplateId(r.templateId); setInspectJobId(r.jobId); setStep('inspect'); }} /> : null}
          {step === 'inspect' ? (
            <section className="band stack">
              <h2 style={{ fontSize: 18 }}>検査結果</h2>
              {inspectJobId ? <JobProgress job={inspectJob.data} pendingLabel="DOCX を検査しています…" /> : null}
              {version.isLoading ? <LoadingState /> : null}
              {version.isError ? <ErrorState error={version.error} onRetry={() => void version.refetch()} /> : null}
              {version.data && !version.data.inspectionReport && !inspectActive ? <Alert kind="info">検査結果がまだありません。しばらく待つと自動で更新されます。</Alert> : null}
              {version.data?.inspectionReport ? <InspectionView v={version.data} /> : null}
              <div className="row"><Button variant="primary" onClick={() => setStep('mapping')} disabledReason={!version.data?.inspectionReport ? '検査完了を待っています' : undefined}>タグ対応付けへ</Button></div>
            </section>
          ) : null}
          {step === 'mapping' && version.data ? <MappingStep v={version.data} onSaved={() => setStep('test')} /> : null}
          {step === 'test' && version.data ? (
            <TestStep v={version.data} onStarted={(jid) => { setTestJobId(jid); setTestFileId(null); }} busy={!!testJobId && testJob.data?.state !== 'failed' && testJob.data?.state !== 'succeeded'} onDone={() => templateId && navigate(`/templates/${templateId}/versions/${version.data?.revision ?? 1}`)} hasResult={!!testFileId} />
          ) : null}
          {!isDesktop && step === 'test' ? previewPane : null}
        </div>
        {isDesktop ? <div className="two-pane__sticky">{previewPane}</div> : null}
      </div>
    </div>
  );
}

function FileStep({ templateId, onImported }: { templateId: string | null; onImported: (r: { templateId: string; versionId: string; jobId: string }) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState<TemplateImportFields>({ name: '', kind: 'custom', scope: 'negotiation' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await importTemplate(file, { ...form, ...(templateId ? { templateId } : {}) });
      onImported(r);
    } catch (e) {
      if (isApiError(e)) {
        setFieldErr(fieldErrorMap(e));
        setErr(e.code === 'file_rejected' ? `ファイルが拒否されました: ${e.message}` : e.status === 415 ? 'DOCX（.docx）のみ登録できます。DOCM・マクロ付きは拒否されます。' : e.userMessage());
      } else setErr('登録に失敗しました');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="band stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      <h2 style={{ fontSize: 18 }}>ファイルと書式情報</h2>
      {templateId ? <Alert kind="info">既存の書式に新しい版として登録します（既公開版は変更されません）。</Alert> : null}
      {err ? <Alert kind="error" live>{err}</Alert> : null}
      <Field label="書式名" required error={fieldErr.name}>{({ id, describedBy, invalid }) => <Input id={id} value={form.name} onValueChange={(v) => setForm({ ...form, name: v })} aria-describedby={describedBy} invalid={invalid} autoComplete="off" />}</Field>
      <div className="form-grid">
        <Field label="種類" required>{({ id }) => <Select id={id} value={form.kind ?? 'custom'} onValueChange={(v) => setForm({ ...form, kind: TemplateKindSchema.parse(v) })} options={TemplateKindSchema.options.map((k) => ({ value: k, label: TEMPLATE_KIND_LABEL[k] ?? k }))} />}</Field>
        <Field label="用途" required>{({ id }) => <Select id={id} value={form.scope ?? 'negotiation'} onValueChange={(v) => setForm({ ...form, scope: v as TemplateImportFields['scope'] })} options={Object.entries(TEMPLATE_SCOPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />}</Field>
      </div>
      <Field label="出典 URL（公開書式を基にした場合）" error={fieldErr.sourceUrl} hint="公式書式であることと個別事件への適合性は別です">{({ id, describedBy, invalid }) => <Input id={id} value={form.sourceUrl ?? ''} onValueChange={(v) => setForm({ ...form, ...(v ? { sourceUrl: v } : { sourceUrl: undefined }) })} aria-describedby={describedBy} invalid={invalid} inputMode="url" autoComplete="off" />}</Field>
      <div className="form-grid">
        <Field label="確認日">{({ id }) => <Input id={id} type="date" value={form.checkedAt ?? ''} onValueChange={(v) => setForm({ ...form, ...(v ? { checkedAt: v } : { checkedAt: undefined }) })} />}</Field>
        <Field label="利用条件・ライセンスメモ">{({ id }) => <Input id={id} value={form.licenseNote ?? ''} onValueChange={(v) => setForm({ ...form, ...(v ? { licenseNote: v } : { licenseNote: undefined }) })} />}</Field>
      </div>
      <div className="file-drop">
        <input id="docx-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(e) => { const f = e.currentTarget.files?.[0] ?? null; setFile(f); if (f && f.size > MAX_DOCX) setErr('DOCX は 20MB までです'); else setErr(null); }} />
        <div className="row">
          <label htmlFor="docx-file" className="btn"><Icon name="upload" size={20} /> DOCX を選択</label>
          {file ? <span className="aux">{file.name}（{(file.size / 1024).toFixed(0)} KB）</span> : <span className="aux muted">.docx のみ、20MB まで</span>}
        </div>
      </div>
      <div><Button type="submit" variant="primary" busy={busy} disabledReason={!file ? 'DOCX を選択してください' : file.size > MAX_DOCX ? '20MB を超えています' : !form.name.trim() ? '書式名を入力してください' : undefined}>登録して検査</Button></div>
    </form>
  );
}

function InspectionView({ v }: { v: TemplateVersion }) {
  const r = v.inspectionReport;
  if (!r) return null;
  const errors = r.issues.filter((i) => i.severity === 'error');
  const warns = r.issues.filter((i) => i.severity !== 'error');
  return (
    <div className="stack">
      <Alert kind={r.ok ? 'success' : 'error'} title={r.ok ? '対応範囲内です' : `対応外要素が ${errors.length} 件あります（登録を続けられません）`}>
        {r.ok ? `検出タグ ${r.tags.length} 件。次にタグをスキーマ項目へ対応付けます。` : '下の位置・理由を確認し、Word 側で対応外要素を除いたコピーを保存してから再登録してください。元ファイルは変更しません。'}
        {r.inspectorVersion ? <div className="aux muted">inspector {r.inspectorVersion}</div> : null}
      </Alert>
      {!r.ok ? (
        <div className="notice-box stack-s">
          <b>修正手順（Word 側）</b>
          <ol style={{ paddingLeft: '1.4em', listStyle: 'decimal' }}>
            <li>元ファイルを「名前を付けて保存」で別名コピーにする</li>
            <li>「校閲」→ 変更履歴をすべて承諾し、コメントをすべて削除する</li>
            <li>テキストボックス・埋込オブジェクト・脚注・セクション区切りを本文へ置き換えるか削除する</li>
            <li>DOCX（マクロなし）で保存し、ここで再登録する</li>
          </ol>
        </div>
      ) : null}
      {r.issues.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">検査の指摘</caption>
            <thead><tr><th scope="col">区分</th><th scope="col">位置</th><th scope="col">理由</th><th scope="col">対応</th></tr></thead>
            <tbody>
              {[...errors, ...warns].map((i, k) => (
                <tr key={k}>
                  <td><Badge tone={i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warning' : 'muted'}>{i.severity === 'error' ? '拒否' : i.severity === 'warning' ? '警告' : '情報'}</Badge></td>
                  <td className="mono">{i.location ?? '—'}{i.tag ? ` ${i.tag}` : ''}</td>
                  <td>{i.message} <span className="aux muted mono">{i.code}</span></td>
                  <td>{i.hint ?? (i.severity === 'error' ? 'Word 側で該当要素を除いたコピーを保存' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <details>
        <summary>検出タグ（{r.tags.length} 件）</summary>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">検出タグ</caption>
            <thead><tr><th scope="col">タグ</th><th scope="col">種類</th><th scope="col">位置</th><th scope="col">判定</th></tr></thead>
            <tbody>{r.tags.map((t, k) => <tr key={k}><td className="mono">{t.raw}</td><td>{t.kind}</td><td className="mono">{t.location}</td><td>{t.valid ? <Badge tone="success">有効</Badge> : <Badge tone="error">無効: {t.reason}</Badge>}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
      {r.residualTextCandidates.length > 0 ? (
        <details open>
          <summary>タグ以外の残存文字の候補（{r.residualTextCandidates.length} 件・公開前に確認）</summary>
          <ul className="rowlist">{r.residualTextCandidates.map((c, k) => <li key={k} className="rowlist__item"><div className="rowlist__main"><div className="rowlist__title cell-raw">{c.text}</div><div className="rowlist__meta"><span className="mono">{c.location}</span><span>{c.reason}</span></div></div></li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

type FieldRow = FieldSpecInput & { _optionsText?: string };

function fieldsFromTags(v: TemplateVersion): FieldRow[] {
  const existing = v.fieldSchema?.fields;
  if (existing && existing.length > 0) return existing.map((f) => ({ ...f, _optionsText: (f.options ?? []).map((o) => `${o.value}=${o.label}`).join('\n') }));
  const tags = v.inspectionReport?.tags ?? [];
  const out: FieldRow[] = [];
  const seen = new Set<string>();
  const stack: FieldRow[] = [];
  for (const t of tags) {
    if (!t.valid) continue;
    if (t.kind === 'loop_open' || t.kind === 'inverted_open') {
      if (SYSTEM_SUPPLIED_KEYS.has(t.key) || t.key.startsWith('has_')) {
        stack.push({ key: t.key, type: 'boolean', label: t.key });
        continue;
      }
      const f: FieldRow = { key: t.key, type: 'array', label: t.key, source: 'input', itemFields: [] };
      if (!seen.has(t.key)) {
        out.push(f);
        seen.add(t.key);
      }
      stack.push(f);
      continue;
    }
    if (t.kind === 'loop_close') {
      stack.pop();
      continue;
    }
    if (SYSTEM_SUPPLIED_KEYS.has(t.key)) continue;
    const top = stack[stack.length - 1];
    if (top && top.type === 'array') {
      if (!(top.itemFields ?? []).some((i) => i.key === t.key)) top.itemFields = [...(top.itemFields ?? []), { key: t.key, type: 'text', label: t.key }];
      continue;
    }
    if (!seen.has(t.key)) {
      out.push({ key: t.key, type: 'text', label: t.key, source: 'input' });
      seen.add(t.key);
    }
  }
  return out;
}

function MappingStep({ v, onSaved }: { v: TemplateVersion; onSaved: () => void }) {
  const [fields, setFields] = useState<FieldRow[]>(() => fieldsFromTags(v));
  const [title, setTitle] = useState(v.fieldSchema?.title ?? '');
  const [recipientTypes, setRecipientTypes] = useState<string[]>(v.fieldSchema?.recipientTypes ?? ['opponent_agent', 'opponent', 'client']);
  const [bodyTag, setBodyTag] = useState(v.fieldSchema?.bodyTag ?? 'body_text');
  const [attachments, setAttachments] = useState(v.fieldSchema?.attachments ?? true);
  const [tagMap, setTagMap] = useState<Record<string, string>>(v.tagMap ?? {});
  const save = useUpdateTemplateSchema();
  const [serverErr, setServerErr] = useState<string | null>(null);
  const fieldErrs = fieldErrorMap(save.error);

  const valueTags = useMemo(() => (v.inspectionReport?.tags ?? []).filter((t) => t.valid && t.kind === 'value' && !SYSTEM_SUPPLIED_KEYS.has(t.key)), [v.inspectionReport]);
  const arrayItemKeys = useMemo(() => new Set(fields.flatMap((f) => (f.type === 'array' ? (f.itemFields ?? []).map((i) => i.key) : []))), [fields]);
  const unmapped = valueTags.filter((t) => !fields.some((f) => f.key === (tagMap[t.key] ?? t.key)) && !arrayItemKeys.has(t.key) && t.key !== bodyTag);

  const schemaInput: TemplateFieldSchemaInput = {
    schemaVersion: 1,
    kind: TemplateKindSchema.safeParse(v.kind).success ? TemplateKindSchema.parse(v.kind) : 'custom',
    title: title || v.kind,
    scope: (['negotiation', 'client', 'court', 'internal'].includes(v.scope) ? v.scope : 'negotiation') as 'negotiation' | 'client' | 'court' | 'internal',
    recipientTypes: recipientTypes as TemplateFieldSchemaInput['recipientTypes'],
    fields: fields.map(({ _optionsText, ...f }) => {
      const base: FieldSpecInput = { ...f };
      if (f.type === 'enum') base.options = (_optionsText ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [val, lab] = l.split('='); return { value: (val ?? '').trim(), label: (lab ?? val ?? '').trim() }; });
      else delete base.options;
      if (f.type !== 'array') delete base.itemFields;
      if (f.source === 'input') delete base.sourcePath;
      return base;
    }),
    bodyTag,
    attachments,
  };
  // schemaInput は毎 render 作られるため JSON 文字列で比較する
  const schemaJson = JSON.stringify(schemaInput);
  const localCheck = useMemo(() => {
    const parsed = parseTemplateFieldSchema(JSON.parse(schemaJson) as unknown);
    if (!parsed.schema) return parsed.issues;
    return validateTemplateSchema(
      parsed.schema,
      (v.inspectionReport?.tags ?? []).map((t) => ({ raw: t.raw, kind: t.kind, key: t.key, valid: t.valid, location: t.location, ...(t.reason !== undefined ? { reason: t.reason } : {}) })),
    );
  }, [schemaJson, v.inspectionReport]);
  const localErrors = localCheck.filter((i) => i.severity === 'error');

  const update = (i: number, patch: Partial<FieldRow>) => setFields(fields.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const addForTag = (key: string) => setFields([...fields, { key, type: 'text', label: key, source: 'input' }]);
  const addField = () => {
    let n = 1;
    while (fields.some((f) => f.key === `field_${n}`)) n++;
    setFields([...fields, { key: `field_${n}`, type: 'text', label: `項目 ${n}`, source: 'input' }]);
  };

  const submit = async () => {
    setServerErr(null);
    try {
      await save.mutateAsync({ versionId: v.id, input: { expectedVersion: v.version, fieldSchema: TemplateFieldSchemaSchema.parse(schemaInput), tagMap } });
      onSaved();
    } catch (e) {
      setServerErr(isApiError(e) ? (e.isConflict ? '他の更新と競合しました。再読込してください。' : e.userMessage()) : e instanceof Error ? e.message : '保存に失敗しました');
    }
  };

  return (
    <section className="band stack">
      <h2 style={{ fontSize: 18 }}>タグ対応付け（フィールド定義）</h2>
      {v.status === 'published' ? <Alert kind="warning">既公開版のスキーマは変更できません（409）。複製して新しい版として登録してください。</Alert> : null}
      {serverErr ? <Alert kind="error" live>{serverErr}</Alert> : null}
      {Object.keys(fieldErrs).length > 0 ? <Alert kind="error" live title="サーバー検査で不備があります"><ul>{Object.entries(fieldErrs).map(([k, m]) => <li key={k}><span className="mono">{k}</span>: {m}</li>)}</ul></Alert> : null}
      <div className="form-grid">
        <Field label="スキーマ表題" required>{({ id }) => <Input id={id} value={title} onValueChange={setTitle} autoComplete="off" />}</Field>
        <Field label="本文タグ" hint="省略時 body_text。{#body_blocks} を使う書式も可">{({ id }) => <Input id={id} value={bodyTag} onValueChange={setBodyTag} autoComplete="off" />}</Field>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field__label">許容する宛先種別</legend>
        <div className="radio-group">{RECIPIENT_TYPES.map((t) => <Checkbox key={t} checked={recipientTypes.includes(t)} onCheckedChange={(c) => setRecipientTypes(c ? [...recipientTypes, t] : recipientTypes.filter((x) => x !== t))} label={RECIPIENT_TYPE_LABEL[t]} />)}</div>
      </fieldset>
      <Checkbox checked={attachments} onCheckedChange={setAttachments} label="添付リスト（{#attachments}）を使う" />

      {unmapped.length > 0 ? (
        <Alert kind="warning" title={`未対応付けのタグが ${unmapped.length} 件あります`}>
          <div className="chip-list">{unmapped.map((t) => <Button key={t.key} small icon="plus" onClick={() => addForTag(t.key)}>{t.raw} の項目を追加</Button>)}</div>
        </Alert>
      ) : null}

      {valueTags.length > 0 ? (
        <details>
          <summary>タグ → 項目の対応（{valueTags.length} タグ。既定は同名キー）</summary>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">タグと項目の対応</caption>
              <thead><tr><th scope="col">タグ</th><th scope="col">位置</th><th scope="col">対応する項目</th></tr></thead>
              <tbody>
                {valueTags.map((t) => {
                  const mapped = tagMap[t.key] ?? (fields.some((f) => f.key === t.key) ? t.key : '');
                  return (
                    <tr key={t.key}>
                      <td className="mono">{t.raw}</td>
                      <td className="mono aux">{t.location}</td>
                      <td>
                        <Select
                          aria-label={`${t.raw} に対応する項目`}
                          value={mapped}
                          onValueChange={(val) => setTagMap((m) => { const n = { ...m }; if (val && val !== t.key) n[t.key] = val; else delete n[t.key]; return n; })}
                          placeholder={arrayItemKeys.has(t.key) ? '（配列の行項目）' : t.key === bodyTag ? '（本文タグ）' : '未対応付け'}
                          options={fields.filter((f) => f.type !== 'array').map((f) => ({ value: f.key, label: `${f.label}（${f.key}）` }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <div className="stack-s">
        <div className="row-between"><h3>フィールド <span className="aux muted num">{fields.length} 件</span></h3><Button small icon="plus" onClick={addField}>項目を追加</Button></div>
        {fields.map((f, i) => (
          <div key={i} className="block stack-s">
            <div className="form-grid">
              <Field label="キー（タグ名）" error={!isSafeTagKey(f.key) ? '英小文字・数字・_ のみ（先頭英字、64 文字以内）' : undefined}>{({ id, invalid }) => <Input id={id} value={f.key} onValueChange={(val) => update(i, { key: val })} invalid={invalid} autoComplete="off" spellCheck={false} />}</Field>
              <Field label="表示名" required>{({ id }) => <Input id={id} value={f.label} onValueChange={(val) => update(i, { label: val })} autoComplete="off" />}</Field>
              <Field label="型">{({ id }) => <Select id={id} value={f.type} onValueChange={(val) => update(i, { type: val as FieldRow['type'] })} options={FIELD_TYPES.map((t) => ({ value: t, label: t }))} />}</Field>
              <Field label="差込元">{({ id }) => <Select id={id} value={f.source ?? 'input'} onValueChange={(val) => update(i, { source: val as FieldRow['source'] })} options={SOURCES.map((s) => ({ value: s, label: s === 'input' ? '入力' : s === 'office' ? '自事務所' : s === 'matter' ? '案件' : '宛先' }))} />}</Field>
              {(f.source ?? 'input') !== 'input' ? <Field label="差込元の属性（sourcePath）" required hint="例: name_raw / address_raw / lead_lawyer.name_raw">{({ id }) => <Input id={id} value={f.sourcePath ?? ''} onValueChange={(val) => update(i, { sourcePath: val })} autoComplete="off" />}</Field> : null}
              <Field label="最大文字数（グラフェム）">{({ id }) => <Input id={id} value={f.maxGraphemes != null ? String(f.maxGraphemes) : ''} onValueChange={(val) => update(i, { maxGraphemes: /^\d+$/.test(val) ? Number(val) : undefined })} inputMode="numeric" autoComplete="off" />}</Field>
            </div>
            {f.type === 'enum' ? <Field label="選択肢（1 行に value=表示名）">{({ id }) => <TextArea id={id} short value={f._optionsText ?? ''} onValueChange={(val) => update(i, { _optionsText: val })} />}</Field> : null}
            {f.type === 'array' ? (
              <div className="stack-s">
                <b>行の項目</b>
                {(f.itemFields ?? []).map((it, k) => (
                  <div key={k} className="array-row">
                    <Field label="キー">{({ id }) => <Input id={id} value={it.key} onValueChange={(val) => update(i, { itemFields: (f.itemFields ?? []).map((x, j) => (j === k ? { ...x, key: val } : x)) })} />}</Field>
                    <Field label="表示名">{({ id }) => <Input id={id} value={it.label} onValueChange={(val) => update(i, { itemFields: (f.itemFields ?? []).map((x, j) => (j === k ? { ...x, label: val } : x)) })} />}</Field>
                    <Field label="型">{({ id }) => <Select id={id} value={it.type} onValueChange={(val) => update(i, { itemFields: (f.itemFields ?? []).map((x, j) => (j === k ? { ...x, type: val as typeof it.type } : x)) })} options={['text', 'multiline', 'date', 'enum', 'boolean', 'money'].map((t) => ({ value: t, label: t }))} />}</Field>
                    <div className="array-row__tools"><Button small variant="quiet" aria-label="行項目を削除" onClick={() => update(i, { itemFields: (f.itemFields ?? []).filter((_, j) => j !== k) })}><Icon name="close" size={16} /></Button></div>
                  </div>
                ))}
                <div><Button small icon="plus" onClick={() => update(i, { itemFields: [...(f.itemFields ?? []), { key: `item_${(f.itemFields ?? []).length + 1}`, type: 'text', label: '項目' }] })}>行項目を追加</Button></div>
              </div>
            ) : null}
            <div className="row">
              <Checkbox checked={!!f.required} onCheckedChange={(c) => update(i, { required: c })} label="必須" />
              <Checkbox checked={!!f.legalJudgement} onCheckedChange={(c) => update(i, { legalJudgement: c, ...(c ? { defaultPolicy: 'none' as const } : {}) })} label="弁護士判断（既定値なし・強調表示）" />
              <Button small variant="quiet" onClick={() => setFields(fields.filter((_, k) => k !== i))}><Icon name="close" size={16} /> 削除</Button>
            </div>
            {valueTags.some((t) => t.key === f.key) ? <div className="aux muted">タグ {`{${f.key}}`} に対応</div> : f.type !== 'array' ? <div className="aux" style={{ color: 'var(--color-warning)' }}>この項目を使うタグが DOCX にありません（警告）</div> : null}
          </div>
        ))}
      </div>
      {localCheck.length > 0 ? (
        <Alert kind={localErrors.length > 0 ? 'error' : 'warning'} title={localErrors.length > 0 ? `保存前の検査でエラー ${localErrors.length} 件` : '警告があります'}>
          <ul>{localCheck.slice(0, 20).map((i, k) => <li key={k}><span className="mono">{i.code}</span> {i.message}{i.location ? <span className="aux muted">（{i.location}）</span> : null}</li>)}</ul>
        </Alert>
      ) : null}
      <div className="row">
        <Button variant="primary" onClick={() => void submit()} busy={save.isPending} disabledReason={v.status === 'published' ? '既公開版は編集できません' : localErrors.length > 0 ? 'エラーを解消してください' : recipientTypes.length === 0 ? '宛先種別を 1 つ以上選んでください' : undefined}>
          スキーマを保存して試作へ
        </Button>
      </div>
    </section>
  );
}

function TestStep({ v, onStarted, busy, onDone, hasResult }: { v: TemplateVersion; onStarted: (jobId: string) => void; busy: boolean; onDone: () => void; hasResult: boolean }) {
  const test = useTestTemplateVersion();
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null);
    try {
      const r = await test.mutateAsync({ versionId: v.id });
      onStarted(r.jobId);
    } catch (e) {
      setErr(isApiError(e) ? e.userMessage() : '試作を開始できませんでした');
    }
  };
  return (
    <section className="band stack">
      <h2 style={{ fontSize: 18 }}>試作（架空データ）</h2>
      <p className="aux muted">架空データを差し込んで DOCX/PDF を生成し、未置換タグ・長い氏名での崩れ・字体を確認します。実在の案件データは使いません。</p>
      <div className="row aux"><span>{templateKindLabel(v.kind)}</span><Badge>{v.status}</Badge><span className="num">版 {v.revision}</span>{v.fieldSchema ? <span className="num">フィールド {v.fieldSchema.fields.length} 件</span> : <Badge tone="warning">スキーマ未保存</Badge>}</div>
      {err ? <Alert kind="error" live>{err}</Alert> : null}
      <div className="row">
        <Button variant="primary" icon="document" onClick={() => void run()} busy={busy} disabledReason={!v.fieldSchema ? 'スキーマを保存してから試作してください' : undefined}>試作を実行</Button>
        <Button onClick={onDone} disabledReason={!hasResult ? '試作結果を確認してから進んでください' : undefined}>版の詳細（公開申請）へ</Button>
        <LinkButton to="/templates" variant="quiet">書式一覧</LinkButton>
      </div>
    </section>
  );
}
