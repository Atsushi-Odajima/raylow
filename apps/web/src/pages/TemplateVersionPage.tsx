/**
 * S11 /templates/:id/versions/:v: 用途/出典 → フィールド → サンプル試験 → 承認者 → 公開申請/承認。
 * 公開には 3 つの確認チェックと sampleOnly の選択が必要。既公開版の編集は複製して新しい版。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { latestFileVersionId, useFile } from '../api/files';
import { useJob } from '../api/jobs';
import { usePublishTemplateVersion, useRetireTemplateVersion, useTemplate, useTestTemplateVersion } from '../api/templates';
import { isApiError } from '../lib/apiClient';
import { fileContentUrl } from '../lib/download';
import { formatDate, formatDateTime, shortHash } from '../lib/format';
import { TEMPLATE_SCOPE_LABEL, TEMPLATE_STATUS_LABEL, label, templateKindLabel } from '../lib/labels';
import { Alert } from '../components/Alert';
import { Badge, LegalJudgementBadge, SampleOnlyBadge, statusTone } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Field } from '../components/Field';
import { Input } from '../components/Input';
import { JobProgress } from '../components/JobProgress';
import { PageHeader } from '../components/PageHeader';
import { PdfPreview } from '../components/PdfPreview';
import { RadioGroup } from '../components/Checkbox';
import { ErrorState, LoadingState } from '../components/States';
import { TextArea } from '../components/TextArea';
import { NotFoundPage } from './NotFoundPage';

export function TemplateVersionPage() {
  const { id, v } = useParams();
  const navigate = useNavigate();
  const tpl = useTemplate(id);
  const version = useMemo(() => tpl.data?.versions.find((x) => String(x.revision) === v || x.id === v) ?? null, [tpl.data, v]);
  const publish = usePublishTemplateVersion();
  const retire = useRetireTemplateVersion();
  const test = useTestTemplateVersion();
  const [conf, setConf] = useState({ content: false, residual: false, applicability: false });
  const [sampleOnly, setSampleOnly] = useState<'true' | 'false' | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [checkedAt, setCheckedAt] = useState('');
  const [licenseNote, setLicenseNote] = useState('');
  const [retireReason, setRetireReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [testJobId, setTestJobId] = useState<string | null>(null);
  const testJob = useJob(testJobId);
  const testFileId = testJob.data?.state === 'succeeded' && typeof testJob.data.result?.outputFileId === 'string' ? (testJob.data.result.outputFileId as string) : null;
  const testFile = useFile(testFileId, { refetchInterval: testFileId ? 2500 : false });
  const testPdfUrl = testFile.data && testFile.data.scanStatus === 'clean' && testFile.data.mime.includes('pdf') ? fileContentUrl(testFile.data.id, latestFileVersionId(testFile.data)) : null;

  useEffect(() => {
    if (version) {
      setSourceUrl(version.sourceUrl ?? '');
      setCheckedAt(version.checkedAt ?? '');
      setLicenseNote(version.licenseNote ?? '');
    }
  }, [version]);

  if (tpl.isLoading) return <div className="container"><LoadingState /></div>;
  if (tpl.isError) return <div className="container" style={{ paddingTop: 'var(--space-6)' }}><ErrorState error={tpl.error} onRetry={() => void tpl.refetch()} /></div>;
  if (!tpl.data || !version || !id) return <NotFoundPage />;

  const t = tpl.data;
  const inspectionErrors = version.inspectionReport?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const residual = version.inspectionReport?.residualTextCandidates ?? [];
  const publishBlock =
    version.status === 'published' ? '既に公開されています' : version.status === 'retired' ? '廃止された版です' : !version.fieldSchema ? 'フィールド定義が未保存です（登録画面で対応付け）' : inspectionErrors > 0 ? `検査で対応外要素が ${inspectionErrors} 件あります` : !(conf.content && conf.residual && conf.applicability) ? '3 つの確認にチェックしてください' : sampleOnly == null ? 'サンプル扱いか所内書式版かを選んでください' : undefined;

  const doPublish = async () => {
    setErr(null);
    try {
      await publish.mutateAsync({
        versionId: version.id,
        input: {
          expectedVersion: version.version,
          confirmations: { contentReviewed: true, residualTextReviewed: true, applicabilityReviewed: true },
          sampleOnly: sampleOnly === 'true',
          sourceUrl: sourceUrl.trim() || null,
          checkedAt: checkedAt || null,
          licenseNote: licenseNote.trim() || null,
        },
      });
      void tpl.refetch();
    } catch (e) {
      if (isApiError(e) && e.code === 'mfa_required') setErr('公開には 15 分以内の認証コード再確認が必要です。確認後に再度「公開」を押してください。');
      else if (isApiError(e) && e.isConflict) { setErr('版が更新されています。再読込しました。'); void tpl.refetch(); }
      else setErr(isApiError(e) ? e.userMessage() : '公開に失敗しました');
    }
  };
  const doRetire = async () => {
    setErr(null);
    try {
      await retire.mutateAsync({ versionId: version.id, expectedVersion: version.version, ...(retireReason.trim() ? { reasonRaw: retireReason.trim() } : {}) });
      void tpl.refetch();
    } catch (e) {
      setErr(isApiError(e) ? e.userMessage() : '廃止に失敗しました');
    }
  };
  const runTest = async () => {
    setErr(null);
    try {
      const r = await test.mutateAsync({ versionId: version.id });
      setTestJobId(r.jobId);
    } catch (e) {
      setErr(isApiError(e) ? e.userMessage() : '試作を開始できませんでした');
    }
  };

  return (
    <div className="container">
      <PageHeader
        title={`${t.name} ― 版 ${version.revision}`}
        lead={`${templateKindLabel(version.kind)} ／ ${label(TEMPLATE_SCOPE_LABEL, version.scope)}`}
        crumbs={[{ to: '/templates', label: '書式' }, { label: t.name }, { label: `版 ${version.revision}` }]}
        actions={
          <>
            {t.versions.length > 1 ? <span className="aux muted">他の版: {t.versions.filter((x) => x.id !== version.id).map((x) => <Button key={x.id} small variant="quiet" onClick={() => navigate(`/templates/${id}/versions/${x.revision}`)}>v{x.revision}</Button>)}</span> : null}
            <LinkButton to={`/templates/import?templateId=${id}`} icon="upload">複製して新しい版を登録</LinkButton>
          </>
        }
      />
      <div className="stack">
        <div className="row aux">
          <Badge tone={statusTone(version.status)}>{label(TEMPLATE_STATUS_LABEL, version.status)}</Badge>
          {version.sampleOnly ? <SampleOnlyBadge /> : version.status === 'published' ? <Badge tone="success">所内書式版</Badge> : null}
          <span>DOCX sha256 {shortHash(version.docxSha256)}</span>
          <span>登録 {formatDateTime(version.createdAt)}</span>
        </div>
        {version.status === 'published' ? <Alert kind="info">既公開版は変更できません（immutable）。内容を変える場合は「複製して新しい版を登録」し、新しい版を公開してください。過去の文書は書き換わりません。</Alert> : null}
        {err ? <Alert kind="error" live>{err}</Alert> : null}

        <section className="band">
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>用途・出典</h2>
          <dl className="dl">
            <dt>種類</dt><dd>{templateKindLabel(version.kind)}</dd>
            <dt>用途</dt><dd>{label(TEMPLATE_SCOPE_LABEL, version.scope)}</dd>
            <dt>適用範囲</dt><dd className="mono aux">{Object.keys(version.applicability).length ? JSON.stringify(version.applicability) : '未設定（generic）'}</dd>
            <dt>出典 URL</dt><dd>{version.sourceUrl ? <a href={version.sourceUrl} target="_blank" rel="noreferrer noopener">{version.sourceUrl}</a> : '—'}</dd>
            <dt>確認日</dt><dd>{formatDate(version.checkedAt)}</dd>
            <dt>利用条件</dt><dd>{version.licenseNote ?? '—'}</dd>
          </dl>
        </section>

        <section className="band">
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>フィールド <span className="aux muted num">{version.fieldSchema?.fields.length ?? 0} 件</span></h2>
          {!version.fieldSchema ? <Alert kind="warning" actions={<LinkButton to={`/templates/import?versionId=${version.id}`} small>登録画面で対応付け</LinkButton>}>フィールド定義が未保存です。</Alert> : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">フィールド定義</caption>
                <thead><tr><th scope="col">キー</th><th scope="col">表示名</th><th scope="col">型</th><th scope="col">差込元</th><th scope="col">必須</th><th scope="col">備考</th></tr></thead>
                <tbody>
                  {version.fieldSchema.fields.map((f) => (
                    <tr key={f.key}><td className="mono">{f.key}</td><td>{f.label}</td><td>{f.type}</td><td>{f.source}{f.sourcePath ? <span className="aux muted mono"> {f.sourcePath}</span> : ''}</td><td>{f.required ? '必須' : ''}</td><td className="row">{f.legalJudgement ? <LegalJudgementBadge /> : null}{f.visibilityRule ? <Badge tone="muted">条件表示</Badge> : null}{f.maxGraphemes ? <span className="aux muted num">最大 {f.maxGraphemes} 字</span> : null}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {version.status !== 'published' && version.status !== 'retired' ? <div style={{ marginTop: 'var(--space-3)' }}><LinkButton to={`/templates/import?versionId=${version.id}`} small>対応付けを編集</LinkButton></div> : null}
        </section>

        <section className="band stack">
          <h2 style={{ fontSize: 18 }}>検査結果と残存文字</h2>
          {!version.inspectionReport ? <p className="muted">検査結果がありません。</p> : (
            <>
              <Alert kind={version.inspectionReport.ok ? 'success' : 'error'}>{version.inspectionReport.ok ? '対応範囲内です。' : `対応外要素が ${inspectionErrors} 件あります。公開できません。`}</Alert>
              {residual.length > 0 ? (
                <div className="stack-s">
                  <b>タグ以外の残存文字の候補（{residual.length} 件）— 他案件の実名・住所が含まれていないか全ページ確認してください</b>
                  <ul className="rowlist">{residual.map((c, k) => <li key={k} className="rowlist__item"><div className="rowlist__main"><div className="rowlist__title cell-raw">{c.text}</div><div className="rowlist__meta"><span className="mono">{c.location}</span><span>{c.reason}</span></div></div></li>)}</ul>
                </div>
              ) : <p className="aux muted">残存文字の候補は検出されませんでした（完全自動検知は保証しません）。</p>}
            </>
          )}
        </section>

        <section className="band stack">
          <h2 style={{ fontSize: 18 }}>サンプル試験（架空データ）</h2>
          <div className="row"><Button icon="document" onClick={() => void runTest()} busy={!!testJobId && testJob.data?.state !== 'succeeded' && testJob.data?.state !== 'failed'} disabledReason={!version.fieldSchema ? 'フィールド定義が必要です' : undefined}>試作を実行</Button></div>
          {testJobId ? <JobProgress job={testJob.data} pendingLabel="試作しています…" compact /> : null}
          <PdfPreview src={testPdfUrl} version={testFileId ?? undefined} emptyLabel="試作を実行すると PDF をここに表示します。" />
        </section>

        <section className="band stack">
          <h2 style={{ fontSize: 18 }}>承認・公開</h2>
          <dl className="dl">
            <dt>承認者</dt><dd>{version.approvedBy ? <span className="mono">{version.approvedBy.slice(0, 8)}</span> : '—'}</dd>
            <dt>承認日時</dt><dd>{formatDateTime(version.approvedAt)}</dd>
          </dl>
          {version.status !== 'published' && version.status !== 'retired' ? (
            <>
              <Alert kind="info">公開は弁護士のみ（15 分以内の認証コード確認が必要）。コードに承認者名を固定しません。</Alert>
              <Checkbox checked={conf.content} onCheckedChange={(c) => setConf({ ...conf, content: c })} label="書式の内容（文言・項目・固定文字列・画像）を全ページ確認した" />
              <Checkbox checked={conf.residual} onCheckedChange={(c) => setConf({ ...conf, residual: c })} label="タグ以外の残存文字（他案件の実名・住所・印影など）が無いことを確認した" />
              <Checkbox checked={conf.applicability} onCheckedChange={(c) => setConf({ ...conf, applicability: c })} label="適用範囲（手続・裁判所・用途）と出典・利用条件を確認した" />
              <RadioGroup
                name="sampleOnly"
                legend="公開の区分"
                value={sampleOnly}
                onValueChange={(val) => setSampleOnly(val as 'true' | 'false')}
                options={[
                  { value: 'true', label: 'サンプル・要確認として公開', description: '草案出力のみ。正式出力には使えません。出力に「サンプル・要確認」を表示します。' },
                  { value: 'false', label: '所内書式版として承認・公開', description: '事務所の弁護士が内容と適用範囲を確認済み。正式出力に使えます。' },
                ]}
              />
              <div className="form-grid">
                <Field label="出典 URL">{({ id: fid }) => <Input id={fid} value={sourceUrl} onValueChange={setSourceUrl} inputMode="url" autoComplete="off" />}</Field>
                <Field label="確認日">{({ id: fid }) => <Input id={fid} type="date" value={checkedAt} onValueChange={setCheckedAt} />}</Field>
                <Field label="利用条件" className="span-all">{({ id: fid }) => <Input id={fid} value={licenseNote} onValueChange={setLicenseNote} />}</Field>
              </div>
              <div><Button variant="primary" icon="check" onClick={() => void doPublish()} busy={publish.isPending} disabledReason={publishBlock}>公開</Button></div>
            </>
          ) : null}
          {version.status === 'published' ? (
            <div className="stack-s">
              <Field label="廃止の理由（任意）">{({ id: fid }) => <TextArea id={fid} short value={retireReason} onValueChange={setRetireReason} />}</Field>
              <div><Button variant="danger" onClick={() => void doRetire()} busy={retire.isPending}>この版を廃止</Button></div>
              <p className="aux muted">廃止しても過去の文書と出力は変わりません。新規作成に選べなくなります。</p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
