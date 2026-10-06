/** S17 /packets/:id: 横工程（提出先 → 対象書類 → 添付 → 検査 → 出力）。未完成項目へリンク */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useJob } from '../api/jobs';
import { packetKeys, useCheckPacket, usePacket, useRenderPacket, useUpdatePacket } from '../api/packets';
import { isApiError } from '../lib/apiClient';
import { downloadFile } from '../lib/download';
import { formatDateTime, shortHash } from '../lib/format';
import { PACKET_STATUS_LABEL, label } from '../lib/labels';
import { Alert } from '../components/Alert';
import { Badge, statusTone } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { JobProgress } from '../components/JobProgress';
import { PageHeader } from '../components/PageHeader';
import { Stepper } from '../components/Stepper';
import { ErrorState, LoadingState } from '../components/States';

export function PacketDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const q = usePacket(id, jobId ? 2500 : false);
  const check = useCheckPacket();
  const render = useRenderPacket();
  const update = useUpdatePacket();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (job.data && jobId && (job.data.state === 'succeeded' || job.data.state === 'failed')) {
      void qc.invalidateQueries({ queryKey: packetKeys.detail(id ?? '') });
      if (job.data.state === 'succeeded') setJobId(null);
    }
  }, [job.data, jobId, id, qc]);
  if (q.isLoading) return <div className="container"><LoadingState /></div>;
  if (q.isError || !q.data || !id) return <div className="container" style={{ paddingTop: 'var(--space-6)' }}><ErrorState error={q.error ?? new Error('not found')} onRetry={() => void q.refetch()} /></div>;
  const p = q.data;
  const stepCurrent = p.status === 'rendered' ? 'output' : p.checkReport ? (p.checkReport.blocking ? 'check' : 'output') : p.items.length > 0 ? 'check' : 'documents';
  const issues = p.checkReport?.issues ?? [];
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(isApiError(e) ? (e.isValidation ? `${e.userMessage()} 欠落項目を解消してから出力してください。` : e.userMessage()) : '失敗しました');
    }
  };
  const toggleConfirm = (itemId: string, v: boolean) => {
    void run(() => update.mutateAsync({ id: p.id, input: { expectedVersion: p.version, items: p.items.map((it) => ({ outputId: it.outputId ?? null, fileVersionId: it.fileVersionId ?? null, evidenceId: it.evidenceId ?? null, displayNameRaw: it.displayNameRaw, orderNo: it.orderNo, externalOutputConfirmed: it.id === itemId ? v : it.externalOutputConfirmed })) } }));
  };
  return (
    <div className="container">
      <PageHeader
        title={p.titleRaw || '提出パック'}
        lead={`${p.courtProfileName ?? 'profile 未設定'} ／ 版 ${p.revision} ／ 更新 ${formatDateTime(p.updatedAt)}`}
        crumbs={[{ to: `/matters/${p.matterId}`, label: '案件' }, { label: '提出パック' }]}
        actions={<><LinkButton to={`/dispatches/new?matterId=${p.matterId}&packetId=${p.id}`} icon="recipient">提出を記録</LinkButton><Button variant="primary" icon="output" busy={render.isPending || (!!jobId && job.data?.state !== 'failed')} disabledReason={p.status === 'blocked' ? '検査で欠落があります。解消してから出力してください' : !p.checkReport ? '先に検査を実行してください' : p.checkReport.blocking ? '検査エラーが残っています' : undefined} onClick={() => void run(async () => { const r = await render.mutateAsync(p.id); setJobId(r.jobId); })}>パック出力（ZIP）</Button></>}
      />
      <div className="stack">
        <Stepper label="工程" current={stepCurrent} steps={[{ key: 'court', label: '提出先', done: !!p.courtProfileId }, { key: 'documents', label: '対象書類', done: p.items.some((i) => i.kind !== 'evidence_pdf') }, { key: 'attachments', label: '添付', done: p.items.some((i) => i.kind === 'evidence_pdf') }, { key: 'check', label: '検査', done: !!p.checkReport && !p.checkReport.blocking }, { key: 'output', label: '出力', done: p.status === 'rendered' }]} />
        <div className="row aux"><Badge tone={statusTone(p.status)}>{label(PACKET_STATUS_LABEL, p.status)}</Badge>{p.hash ? <span>hash {shortHash(p.hash)}</span> : null}{p.checkReport ? <span>検査 {formatDateTime(p.checkReport.checkedAt)}</span> : null}</div>
        {err ? <Alert kind="error" live>{err}</Alert> : null}
        {jobId ? <JobProgress job={job.data} pendingLabel="ZIP を生成しています…" /> : null}
        {p.status === 'rendered' && p.fileId ? <Alert kind="success" title="提出パックを出力しました" actions={<Button small icon="export" onClick={() => void run(() => downloadFile(`/api/packets/${p.id}/download`, `${p.titleRaw || 'packet'}.zip`))}>ZIP を取得</Button>}>ZIP の取得は提出済みを意味しません。外部で提出したら「提出を記録」してください。</Alert> : null}

        <section className="band stack">
          <div className="row-between"><h2 style={{ fontSize: 18 }}>内容 <span className="aux muted num">{p.items.length} 件</span></h2><Button small icon="review" busy={check.isPending} onClick={() => void run(() => check.mutateAsync(p.id))}>検査を実行</Button></div>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">パックの項目</caption>
              <thead><tr><th scope="col">順</th><th scope="col">種別</th><th scope="col">名称</th><th scope="col">元</th><th scope="col">承認</th><th scope="col">外部出力確認</th><th scope="col">sha256</th></tr></thead>
              <tbody>
                {p.items.map((it) => (
                  <tr key={it.id}>
                    <td className="num">{it.orderNo}</td>
                    <td>{it.kind === 'document_pdf' ? '書面 PDF' : it.kind === 'document_docx' ? '書面 DOCX' : it.kind === 'evidence_pdf' ? '証拠 PDF' : 'ファイル'}</td>
                    <td className="cell-raw">{it.displayNameRaw || '—'}</td>
                    <td className="aux">{it.sourceLabel}</td>
                    <td>{it.approved == null ? '—' : it.approved ? <Badge tone="success">承認済</Badge> : <Badge tone="error">未承認</Badge>}</td>
                    <td>{it.confidential ? <Checkbox checked={it.externalOutputConfirmed} onCheckedChange={(v) => toggleConfirm(it.id, v)} label="確認" /> : <span className="aux muted">非機密</span>}</td>
                    <td className="mono aux">{shortHash(it.sha256)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="band stack">
          <h2 style={{ fontSize: 18 }}>検査結果</h2>
          {!p.checkReport ? <p className="muted">まだ検査していません。</p> : issues.length === 0 ? <Alert kind="success">欠落はありません。出力できます。</Alert> : (
            <ul className="rowlist">{issues.map((i, k) => <li key={k} className="rowlist__item"><div className="rowlist__main"><div className="rowlist__title"><Badge tone={i.severity === 'error' ? 'error' : 'warning'}>{i.severity === 'error' ? 'エラー' : '警告'}</Badge> {i.message}</div><div className="rowlist__meta"><span className="mono">{i.code}</span></div></div>{i.link ? <div className="rowlist__actions"><Link to={i.link} className="btn btn-small">未完成項目へ</Link></div> : null}</li>)}</ul>
          )}
          <p className="aux muted">形式検査の成功は法律内容の正当性を保証しません。mints 等の完全対応を称しません。</p>
        </section>
      </div>
    </div>
  );
}
