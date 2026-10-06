/**
 * S05 /drafts/:id/edit: 保存状態 → 不足 → 宛先/差出人 → 本文。
 * PC は入力 5 列 / PDF プレビュー 7 列、mobile は「入力/本文/プレビュー」タブ。
 * - autosave 700ms（IME 変換中は保存しない）、未保存/保存中/保存済み表示、beforeunload 警告
 * - edit lease（取得・30 秒 heartbeat・理由付き引継ぎ）
 * - 409 は版対比 → 再読込 / 別版として保存。422 は項目へ戻し入力保持
 * - render は明示ボタン。未保存本文と旧プレビューを区別して表示
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { DraftDetail, DraftOutput } from '@raylow/contracts';
import { TemplateFieldSchemaSchema, astToPlainText, emptyAST, validateFieldValues, type DocumentAST, type FieldValue, type FieldValues, type TemplateFieldSchema } from '@raylow/template-schema';
import { parseJapaneseDate } from '@raylow/japanese-text';
import { applyCandidates, draftKeys, fetchDraft, refreshCandidates, renderDraft, saveRevision, uploadExternalEdit, useDraft, type RefreshCandidates } from '../api/drafts';
import { useJob } from '../api/jobs';
import { useMatter, useMatterEvidence } from '../api/matters';
import { usePhrases } from '../api/templates';
import { useAutosave } from '../hooks/useAutosave';
import { useEditLease } from '../hooks/useEditLease';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { fieldErrorMap, isApiError } from '../lib/apiClient';
import { outputDownloadUrl } from '../lib/download';
import { formatDateTime } from '../lib/format';
import { RECIPIENT_TYPE_LABEL, draftStatusLabel } from '../lib/labels';
import { Alert } from '../components/Alert';
import { Badge, SampleOnlyBadge, statusTone } from '../components/Badge';
import { BlockEditor } from '../components/BlockEditor';
import { Button, LinkButton } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Dialog } from '../components/Dialog';
import { DiffView } from '../components/DiffView';
import { Field } from '../components/Field';
import { FieldForm } from '../components/FieldForm';
import { Icon } from '../components/Icon';
import { Input } from '../components/Input';
import { JobProgress } from '../components/JobProgress';
import { PdfPreview } from '../components/PdfPreview';
import { SaveStatus } from '../components/SaveStatus';
import { ErrorState, LoadingState } from '../components/States';
import { Tabs } from '../components/Tabs';
import { TextArea } from '../components/TextArea';
import { VersionConflictDialog } from '../components/VersionConflictDialog';

type PaneTab = 'fields' | 'body' | 'preview';
const TAB_PREF_KEY = 'raylaw.ui.editTab';

export function DraftEditPage() {
  const { id } = useParams();
  const draft = useDraft(id);
  if (draft.isLoading) {
    return (
      <div className="container">
        <LoadingState label="草案を読み込んでいます…" />
      </div>
    );
  }
  if (draft.isError || !draft.data || !id) {
    return (
      <div className="container" style={{ paddingTop: 'var(--space-6)' }}>
        <ErrorState error={draft.error ?? new Error('not found')} onRetry={() => void draft.refetch()} title="草案を開けません" />
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Link to="/documents">書類一覧へ</Link>
        </div>
      </div>
    );
  }
  // key は draft id のみ（revision 変化で再マウントするとカーソル・IME が飛ぶ）。版の切替は resetFrom で明示的に行う
  return <DraftEditor key={id} id={id} initial={draft.data} />;
}

function latestDraftPdf(outputs: DraftOutput[], revisionId: string | null): DraftOutput | null {
  const pdfs = outputs.filter((o) => o.format === 'pdf' && o.mode === 'draft' && o.status === 'ready').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return pdfs.find((o) => o.revisionId === revisionId) ?? pdfs[0] ?? null;
}

function DraftEditor({ id, initial }: { id: string; initial: DraftDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isDesktop = useIsDesktop();
  const focusKey = params.get('focus');
  const focusBlock = params.get('block');

  const [detail, setDetail] = useState<DraftDetail>(initial);
  const schema: TemplateFieldSchema | null = useMemo(() => {
    const r = TemplateFieldSchemaSchema.safeParse(detail.templateVersion.fieldSchema);
    return r.success ? r.data : null;
  }, [detail.templateVersion.fieldSchema]);

  const rev = detail.currentRevision;
  const [fields, setFields] = useState<FieldValues>(() => rev?.snapshot.fields ?? {});
  const [ast, setAst] = useState<DocumentAST>(() => rev?.ast ?? emptyAST());
  const [attachments, setAttachments] = useState<Array<{ name: string; copies: string }>>(() => rev?.snapshot.attachments ?? []);
  const [issueDateRaw, setIssueDateRaw] = useState<string>(() => rev?.snapshot.issueDate ?? '');
  const [phraseVersionIds, setPhraseVersionIds] = useState<string[]>(() => rev?.snapshot.sources.phraseVersionIds ?? []);
  const [version, setVersion] = useState<number>(detail.draft.version);
  const [dirty, setDirty] = useState(false);
  const [changeTick, setChangeTick] = useState(0);
  const savingTick = useRef(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ currentVersion: number | null; server: DraftDetail | null } | null>(null);
  const [tab, setTab] = useState<PaneTab>(() => {
    try {
      const v = localStorage.getItem(TAB_PREF_KEY);
      return v === 'body' || v === 'preview' ? v : 'fields';
    } catch {
      return 'fields';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TAB_PREF_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);
  useEffect(() => {
    if (focusBlock) setTab('body');
    else if (focusKey) setTab('fields');
  }, [focusBlock, focusKey]);
  useEffect(() => {
    const el = focusKey ? document.getElementById(`field-${focusKey}`) : focusBlock ? document.getElementById(`block-${focusBlock}`) : null;
    el?.scrollIntoView({ block: 'center' });
  }, [focusKey, focusBlock, tab]);

  const matter = useMatter(detail.draft.matterId);
  const evidence = useMatterEvidence(detail.draft.matterId);
  const phrases = usePhrases({ templateKind: detail.draft.kind });
  const approvedPhrases = useMemo(() => (phrases.data ?? []).filter((p) => p.currentVersion?.status === 'approved'), [phrases.data]);

  const status = detail.draft.status;
  const statusEditable = !['superseded', 'archived', 'rendering'].includes(status);
  const lease = useEditLease(id, detail.canEdit && statusEditable, detail.lease);
  const editable = detail.canEdit && statusEditable && lease.mine;
  const disabledReason = !detail.canEdit ? 'この草案の編集権限がありません（閲覧のみ）' : !statusEditable ? `状態「${draftStatusLabel(status)}」の草案は編集できません` : lease.heldByOther ? `${lease.heldByOther.userName} が編集中です` : !lease.mine ? '編集ロックを取得しています…' : undefined;

  const touch = () => {
    setDirty(true);
    setChangeTick((t) => t + 1);
  };
  /** サーバーの版でローカル状態を置き換える（再読込・更新候補の採用・外部編集版の取込） */
  const resetFrom = (d: DraftDetail) => {
    const r = d.currentRevision;
    setDetail(d);
    setFields(r?.snapshot.fields ?? {});
    setAst(r?.ast ?? emptyAST());
    setAttachments(r?.snapshot.attachments ?? []);
    setIssueDateRaw(r?.snapshot.issueDate ?? '');
    setPhraseVersionIds(r?.snapshot.sources.phraseVersionIds ?? []);
    setVersion(d.draft.version);
    setDirty(false);
    setFieldErrors({});
    setSaveError(null);
    qc.setQueryData(draftKeys.detail(id), d);
  };
  const onFieldChange = (key: string, v: FieldValue) => {
    setFields((f) => ({ ...f, [key]: v }));
    setFieldErrors((e) => {
      if (!(key in e)) return e;
      const n = { ...e };
      delete n[key];
      return n;
    });
    touch();
  };
  const onAstChange = (a: DocumentAST) => {
    setAst(a);
    touch();
  };

  const issueParsed = issueDateRaw ? parseJapaneseDate(issueDateRaw) : null;
  const issueDate: string | null = issueDateRaw ? (issueParsed?.precision === 'day' && issueParsed.iso ? issueParsed.iso : issueDateRaw) : null;

  const doSave = useCallback(
    async (expectedVersion: number) => {
      const tick = changeTick;
      savingTick.current = tick;
      const next = await saveRevision(id, { expectedVersion, fields, ast, attachments, issueDate, phraseVersionIds });
      setDetail(next);
      setVersion(next.draft.version);
      qc.setQueryData(draftKeys.detail(id), next);
      setSaveError(null);
      setFieldErrors({});
      if (savingTick.current === changeTick) setDirty(false);
      return next;
    },
    [id, fields, ast, attachments, issueDate, phraseVersionIds, changeTick, qc],
  );

  const save = useCallback(async () => {
    try {
      await doSave(version);
    } catch (e) {
      if (isApiError(e) && e.isConflict) {
        const server = await fetchDraft(id).catch(() => null);
        setConflict({ currentVersion: e.currentVersion, server });
        setSaveError('他の更新と競合しました');
      } else if (isApiError(e) && e.isValidation) {
        setFieldErrors(fieldErrorMap(e));
        setSaveError(e.userMessage());
        const first = e.fieldErrors[0]?.field;
        if (first) {
          setTab('fields');
          document.getElementById(`field-${first}`)?.scrollIntoView({ block: 'center' });
        }
      } else {
        setSaveError(isApiError(e) ? e.userMessage() : '保存に失敗しました');
      }
      throw e;
    }
  }, [doSave, version, id]);

  const autosave = useAutosave({ dirty, save, enabled: editable, registryKey: `draft:${id}`, changeTick });

  // ---------- プレビュー ----------
  const currentRevisionId = detail.currentRevision?.id ?? null;
  const pdf = useMemo(() => latestDraftPdf(detail.outputs, currentRevisionId), [detail.outputs, currentRevisionId]);
  const [renderJobId, setRenderJobId] = useState<string | null>(() => detail.pendingJobs.find((j) => j.type === 'render_draft' && (j.state === 'queued' || j.state === 'running'))?.id ?? null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const renderJob = useJob(renderJobId);
  useEffect(() => {
    const j = renderJob.data;
    if (!j || !renderJobId) return;
    if (j.state === 'succeeded' || j.state === 'failed' || j.state === 'cancelled') {
      void fetchDraft(id).then((d) => {
        setDetail((cur) => ({ ...cur, outputs: d.outputs, pendingJobs: d.pendingJobs, draft: { ...cur.draft, status: d.draft.status } }));
        qc.setQueryData(draftKeys.detail(id), d);
      });
      if (j.state !== 'failed') setRenderJobId(null);
    }
  }, [renderJob.data, renderJobId, id, qc]);

  const requestRender = async () => {
    setRenderError(null);
    try {
      if (dirty) {
        const ok = await autosave.flush();
        if (!ok) return;
      }
      const r = await renderDraft(id, 'draft');
      setRenderJobId(r.jobId);
    } catch (e) {
      setRenderError(isApiError(e) ? e.userMessage() : 'プレビューの生成を開始できませんでした');
    }
  };

  const previewStale = useMemo(() => {
    if (!pdf) return null;
    if (dirty) return '未保存の編集があります。保存後に「プレビューを更新」で最新の内容を反映してください。';
    if (pdf.revisionId !== currentRevisionId) return `このプレビューは以前の版（revision）から生成されたものです。「プレビューを更新」で現在の版（${detail.currentRevision?.revision ?? '—'}）を反映してください。`;
    if (autosave.savedAt && pdf.createdAt < autosave.savedAt.toISOString()) return `保存（${formatDateTime(autosave.savedAt.toISOString())}）より前に生成されたプレビューです。「プレビューを更新」で反映してください。`;
    return null;
  }, [pdf, dirty, currentRevisionId, autosave.savedAt, detail.currentRevision?.revision]);

  // ---------- 更新候補 ----------
  const [cands, setCands] = useState<RefreshCandidates | null>(null);
  const [candSel, setCandSel] = useState<Set<string>>(new Set());
  const [candBusy, setCandBusy] = useState(false);
  const [candErr, setCandErr] = useState<string | null>(null);
  const openCandidates = async () => {
    setCandErr(null);
    setCandBusy(true);
    try {
      const r = await refreshCandidates(id);
      setCands(r);
      setCandSel(new Set());
    } catch (e) {
      setCandErr(isApiError(e) ? e.userMessage() : '更新候補を取得できませんでした');
    } finally {
      setCandBusy(false);
    }
  };
  const applySelected = async () => {
    if (candSel.size === 0) return;
    setCandBusy(true);
    try {
      if (dirty) await autosave.flush();
      const next = await applyCandidates(id, version, [...candSel]);
      resetFrom(next);
      setCands(null);
    } catch (e) {
      setCandErr(isApiError(e) ? e.userMessage() : '適用に失敗しました');
    } finally {
      setCandBusy(false);
    }
  };

  // ---------- 外部編集版 ----------
  const extInput = useRef<HTMLInputElement>(null);
  const [extBusy, setExtBusy] = useState(false);
  const [extMsg, setExtMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const onExternal = async (f: File) => {
    setExtBusy(true);
    setExtMsg(null);
    try {
      const next = await uploadExternalEdit(id, f);
      resetFrom(next);
      setExtMsg({ kind: 'success', text: 'Word で編集した DOCX を外部編集版（新しい版）として取り込みました。検査・PDF 生成後に再レビューが必要です。本文エディタとは自動同期しません。' });
    } catch (e) {
      setExtMsg({ kind: 'error', text: isApiError(e) ? e.userMessage() : '取込に失敗しました' });
    } finally {
      setExtBusy(false);
    }
  };

  // ---------- 不足 ----------
  const valueIssues = useMemo(() => (schema ? validateFieldValues(schema, fields, rev?.snapshot.recipient.honorific || undefined) : []), [schema, fields, rev?.snapshot.recipient.honorific]);
  const missing = valueIssues.filter((i) => i.severity === 'error');
  const warns = valueIssues.filter((i) => i.severity === 'warning');

  const goCheck = async () => {
    if (dirty) {
      const ok = await autosave.flush();
      if (!ok) return;
    }
    navigate(`/drafts/${id}/check`);
  };

  const recipient = rev?.snapshot.recipient;
  const sources = rev?.snapshot.sources;

  const previewPane = (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <Icon name="document" size={20} />
          <b>書面プレビュー（PDF）</b>
          {pdf ? <span className="aux muted">生成 {formatDateTime(pdf.createdAt)}</span> : null}
        </div>
        <Button variant={pdf && !previewStale ? 'secondary' : 'primary'} small icon="refresh" onClick={() => void requestRender()} busy={!!renderJobId && renderJob.data?.state !== 'failed'} disabledReason={!detail.canEdit ? '編集権限がないため生成できません' : undefined}>
          プレビューを更新
        </Button>
      </div>
      {renderJobId ? <JobProgress job={renderJob.data} pendingLabel="PDF を生成しています…" compact onRetry={() => void requestRender()} /> : null}
      {renderError ? (
        <Alert kind="error" live>
          {renderError}
        </Alert>
      ) : null}
      {detail.templateVersion.sampleOnly ? <Alert kind="warning">サンプル書式のため、出力には「サンプル・要確認」が表示され、正式出力はできません。</Alert> : null}
      <PdfPreview src={pdf ? outputDownloadUrl(pdf.id, 'draft') : null} version={pdf?.id} staleNotice={previewStale} />
    </div>
  );

  const fieldsPane = schema ? (
    <div className="stack">
      <section>
        <h3 style={{ marginBottom: 'var(--space-2)' }}>発行日</h3>
        <Field label="発行日（原文）" hint="例: 令和8年10月6日 / 2026-10-06。日付精度が「日」のときだけ ISO 日付として保存します">
          {({ id: fid, describedBy }) => (
            <>
              <Input id={fid} value={issueDateRaw} onValueChange={(v) => { setIssueDateRaw(v); touch(); }} aria-describedby={describedBy} disabled={!editable} autoComplete="off" />
              {issueParsed ? (
                <div className="parsed-candidate">
                  解析候補: <strong>{issueParsed.iso ?? '解析できません'}</strong>（精度: {issueParsed.precision}）{issueParsed.needsConfirmation ? ' — 確認が必要です' : ''}
                </div>
              ) : null}
            </>
          )}
        </Field>
      </section>
      <FieldForm schema={schema} values={fields} onChange={onFieldChange} fieldErrors={fieldErrors} disabled={!editable} disabledReason={disabledReason} matter={matter.data ?? null} focusKey={focusKey} />
      {schema.attachments ? (
        <section className="stack-s">
          <h3>添付書類</h3>
          {attachments.map((a, i) => (
            <div key={i} className="array-row">
              <Field label="名称">{({ id: fid }) => <Input id={fid} value={a.name} onValueChange={(v) => { setAttachments(attachments.map((x, k) => (k === i ? { ...x, name: v } : x))); touch(); }} disabled={!editable} />}</Field>
              <Field label="通数（原文）">{({ id: fid }) => <Input id={fid} value={a.copies} onValueChange={(v) => { setAttachments(attachments.map((x, k) => (k === i ? { ...x, copies: v } : x))); touch(); }} disabled={!editable} />}</Field>
              <div className="array-row__tools">
                <Button small variant="quiet" aria-label="添付を削除" onClick={() => { setAttachments(attachments.filter((_, k) => k !== i)); touch(); }} disabledReason={!editable ? '編集不可' : undefined}>
                  <Icon name="close" size={16} />
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button small icon="plus" onClick={() => { setAttachments([...attachments, { name: '', copies: '' }]); touch(); }} disabledReason={!editable ? '編集不可' : undefined}>
              添付を追加
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  ) : (
    <Alert kind="error">書式のフィールド定義を読み取れません。書式の版を確認してください。</Alert>
  );

  const bodyPane = (
    <BlockEditor ast={ast} onChange={onAstChange} disabled={!editable} disabledReason={disabledReason} focusBlockId={focusBlock} evidence={evidence.data} phrases={approvedPhrases} onPhraseInserted={(pv) => { setPhraseVersionIds((s) => (s.includes(pv) ? s : [...s, pv])); touch(); }} />
  );

  return (
    <div className="container">
      <div className="edit-topbar">
        <div className="stack-s" style={{ minWidth: 0 }}>
          <nav aria-label="現在地" className="breadcrumb">
            <Link to="/documents">書類</Link> <span aria-hidden="true">/</span> <Link to={`/matters/${detail.draft.matterId}`}>{detail.draft.matterTitleRaw}</Link>
          </nav>
          <h1 className="h-ja" style={{ fontSize: 22, lineHeight: 1.4 }}>
            {detail.draft.titleRaw}
          </h1>
          <div className="row aux">
            <Badge tone={statusTone(status)}>{draftStatusLabel(status)}</Badge>
            <span className="num">版 {detail.currentRevision?.revision ?? '—'}</span>
            <span>{detail.templateVersion.templateName} <span className="num">v{detail.templateVersion.revision}</span></span>
            {detail.templateVersion.sampleOnly ? <SampleOnlyBadge /> : null}
            <SaveStatus state={autosave.state} savedAt={autosave.savedAt} errorMessage={saveError} />
          </div>
        </div>
        <div className="row">
          <Button small onClick={() => void openCandidates()} busy={candBusy} icon="merge" disabledReason={!editable ? disabledReason : undefined}>
            更新候補を確認
          </Button>
          <Button variant="primary" onClick={() => void goCheck()} icon="review" disabledReason={autosave.state === 'saving' ? '保存中です' : undefined}>
            確認へ
          </Button>
        </div>
      </div>

      {lease.heldByOther ? <LeaseTakeover holder={lease.heldByOther.userName} expiresAt={lease.heldByOther.expiresAt} onTakeover={lease.takeover} busy={lease.acquiring} /> : null}
      {lease.error ? <Alert kind="warning">編集ロックを取得できませんでした。保存時に競合する可能性があります。</Alert> : null}
      {status === 'approved' ? <Alert kind="warning" title="承認済みの草案です">編集して保存すると承認は失効し、再レビューが必要になります。確定済みの出力は変わりません。</Alert> : null}
      {status === 'in_review' ? <Alert kind="warning" title="レビュー中です">編集して保存するとレビュー対象の版が変わり、再依頼が必要になります。</Alert> : null}
      {status === 'changes_requested' ? <Alert kind="info" title="差戻しされています">{detail.openReviewId ? <Link to={`/reviews/${detail.openReviewId}`}>差戻し理由を見る</Link> : '理由はレビュー画面で確認してください。'}</Alert> : null}
      {saveError && autosave.state === 'error' ? (
        <Alert kind="error" live title="保存に失敗しました" actions={<Button small onClick={() => void autosave.flush()}>再試行</Button>}>
          {saveError}。入力内容はこの画面に保持されています。
        </Alert>
      ) : null}

      <div className="edit-layout" style={{ marginTop: 'var(--space-4)' }}>
        <div className="stack">
          {missing.length > 0 || warns.length > 0 ? (
            <section className="band stack-s" aria-labelledby="h-missing">
              <h2 id="h-missing" style={{ fontSize: 18 }}>
                不足・注意 <span className="aux muted num">（未入力 {missing.length} ／ 注意 {warns.length}）</span>
              </h2>
              <ul className="stack-s">
                {missing.map((i) => (
                  <li key={i.code + i.fieldKey} className="row">
                    <Icon name="alert" size={16} label="未入力" />
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => { setTab('fields'); document.getElementById(`field-${i.fieldKey.split('[')[0] ?? ''}`)?.scrollIntoView({ block: 'center' }); }}>
                      {i.message}
                    </button>
                  </li>
                ))}
                {warns.map((i) => (
                  <li key={i.code + i.fieldKey} className="row aux">
                    <Icon name="info" size={16} label="注意" /> {i.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="band" aria-labelledby="h-recipient">
            <h2 id="h-recipient" style={{ fontSize: 18, marginBottom: 'var(--space-2)' }}>
              宛先・差出人
            </h2>
            <dl className="dl">
              <dt>宛先</dt>
              <dd>
                {recipient ? (
                  <>
                    {RECIPIENT_TYPE_LABEL[recipient.type]}
                    {recipient.nameRaw ? ` ／ ${recipient.nameRaw}${recipient.honorific ? ` ${recipient.honorific}` : ''}` : ''}
                    {recipient.organizationNameRaw ? <div className="aux muted">{recipient.organizationNameRaw}</div> : null}
                    {recipient.addressRaw ? <div className="aux muted">{recipient.postcodeRaw} {recipient.addressRaw}</div> : null}
                    {recipient.confirmedDirectToOpponent ? <div className="aux"><Badge tone="warning">代理人がいるが本人宛て（確認済み）</Badge></div> : null}
                  </>
                ) : '—'}
              </dd>
              <dt>差出人</dt>
              <dd>
                {sources ? (
                  <span className="aux">
                    事務所版 {sources.officeProfileRevision ?? '—'} ／ 弁護士 {sources.lawyerId ? `v${sources.lawyerVersion ?? '—'}` : '未設定'} ／ 案件 v{sources.matterVersion}
                  </span>
                ) : '—'}
              </dd>
            </dl>
            <div className="aux muted" style={{ marginTop: 'var(--space-2)' }}>
              元データが更新されても草案は自動で変わりません。「更新候補を確認」から差分を選んで採用します。
            </div>
          </section>

          <Tabs<PaneTab>
            label="編集ペイン"
            value={isDesktop && tab === 'preview' ? 'fields' : tab}
            onChange={setTab}
            items={[{ key: 'fields', label: '入力' }, { key: 'body', label: '本文' }, ...(isDesktop ? [] : [{ key: 'preview' as const, label: 'プレビュー' }])]}
          >
            {(k) => (k === 'fields' ? fieldsPane : k === 'body' ? bodyPane : previewPane)}
          </Tabs>

          <section className="band stack-s" aria-labelledby="h-external">
            <h2 id="h-external" style={{ fontSize: 18 }}>
              Word で編集した DOCX の再取込
            </h2>
            <p className="aux muted">草案 DOCX を Word で追編集した場合は、ここから新しい「外部編集版」として取り込みます。本文エディタとは双方向同期しません。取込後は再検査・再レビューが必要です。</p>
            <input ref={extInput} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void onExternal(f); }} />
            <div>
              <Button small icon="upload" onClick={() => extInput.current?.click()} busy={extBusy} disabledReason={!detail.canEdit ? '編集権限がありません' : undefined}>
                DOCX を取り込む
              </Button>
            </div>
            {extMsg ? <Alert kind={extMsg.kind} live>{extMsg.text}</Alert> : null}
          </section>
        </div>
        {isDesktop ? <div className="edit-preview">{previewPane}</div> : null}
      </div>

      <VersionConflictDialog
        open={!!conflict}
        currentVersion={conflict?.currentVersion ?? null}
        myVersion={version}
        busy={autosave.state === 'saving'}
        onClose={() => setConflict(null)}
        onReload={() => {
          setConflict(null);
          void fetchDraft(id).then((d) => resetFrom(d)).catch((e: unknown) => setSaveError(isApiError(e) ? e.userMessage() : '再読込に失敗しました'));
        }}
        onSaveAsNew={() => {
          const cv = conflict?.currentVersion;
          setConflict(null);
          if (cv != null) void doSave(cv).catch((e: unknown) => setSaveError(isApiError(e) ? e.userMessage() : '保存に失敗しました'));
        }}
        compare={
          conflict?.server?.currentRevision ? (
            <div className="stack-s">
              <div className="aux muted">
                サーバー上の版 {conflict.server.currentRevision.revision}（{conflict.server.currentRevision.createdByName ?? '—'} ／ {formatDateTime(conflict.server.currentRevision.createdAt)}）と、あなたの本文の差分:
              </div>
              <DiffView before={astToPlainText(conflict.server.currentRevision.ast)} after={astToPlainText(ast)} label="本文の差分" />
            </div>
          ) : undefined
        }
      />

      <Dialog
        open={!!cands}
        title="更新候補（元データの変更）"
        onClose={() => setCands(null)}
        actions={
          <>
            <Button variant="quiet" onClick={() => setCands(null)}>
              閉じる
            </Button>
            <Button variant="primary" onClick={() => void applySelected()} busy={candBusy} disabledReason={candSel.size === 0 ? '採用する項目を選んでください' : undefined}>
              選択した差分を採用
            </Button>
          </>
        }
      >
        {candErr ? <Alert kind="error" live>{candErr}</Alert> : null}
        {cands && cands.candidates.length === 0 ? <p>元データとの差分はありません。</p> : null}
        <ul className="stack-s">
          {cands?.candidates.map((c) => (
            <li key={c.fieldKey} className="notice-box">
              <Checkbox
                checked={candSel.has(c.fieldKey)}
                onCheckedChange={(v) => setCandSel((s) => { const n = new Set(s); if (v) n.add(c.fieldKey); else n.delete(c.fieldKey); return n; })}
                label={<>{c.label} <span className="aux muted">（{c.sourceKind}{c.sourceVersion != null ? ` v${c.sourceVersion}` : ''}）</span>{c.manuallyOverridden ? <Badge tone="warning">手入力で上書き済み</Badge> : null}</>}
                description={<span>現在: <del>{c.currentValue || '（空）'}</del> → 新: <ins>{c.newValue || '（空）'}</ins></span>}
              />
            </li>
          ))}
        </ul>
      </Dialog>
      {candErr && !cands ? <Alert kind="error" live>{candErr}</Alert> : null}
      <div className="sticky-actions">
        <SaveStatus state={autosave.state} savedAt={autosave.savedAt} errorMessage={saveError} live={false} />
        <LinkButton to={`/documents/${id}/output`} small icon="output">
          出力画面
        </LinkButton>
        <Button variant="primary" small onClick={() => void goCheck()} icon="review">
          確認へ
        </Button>
      </div>
    </div>
  );
}

function LeaseTakeover({ holder, expiresAt, onTakeover, busy }: { holder: string; expiresAt: string; onTakeover: (reason: string) => Promise<boolean>; busy: boolean }) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <Alert kind="warning" title={`${holder} が編集中です（閲覧のみ）`} actions={<Button small onClick={() => setOpen((o) => !o)}>強制的に引き継ぐ</Button>}>
      <div>
        編集ロックの期限: {expiresAt ? formatDateTime(expiresAt) : '不明'}。相手が保存せずに離れている場合のみ、理由を記録して引き継いでください（監査に残ります）。
      </div>
      {open ? (
        <form
          className="stack-s"
          style={{ marginTop: 'var(--space-3)' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) void onTakeover(reason.trim()).then((ok) => ok && setOpen(false));
          }}
        >
          <Field label="引継ぎの理由" required>
            {({ id, describedBy }) => <TextArea id={id} short value={reason} onValueChange={setReason} aria-describedby={describedBy} />}
          </Field>
          <div>
            <Button type="submit" variant="danger" small busy={busy} disabledReason={!reason.trim() ? '理由を入力してください' : undefined}>
              理由を記録して引き継ぐ
            </Button>
          </div>
        </form>
      ) : null}
    </Alert>
  );
}
