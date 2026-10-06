/**
 * S20 /settings: 権限/書式設定/バックアップ/移行。権限付与は担当 lawyer 承認、弁護士 2 名以上の運用前提を明記。
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useInviteMember, useMembers, useUpdateMember, type MemberInvite } from '../api/masters';
import { exportDownloadUrl, importCommit, importPreview, requestExport, useSettings, useUpdateSettings, type ExportRequest, type ImportPreview } from '../api/misc';
import { useJob } from '../api/jobs';
import { isApiError } from '../lib/apiClient';
import { downloadFile } from '../lib/download';
import { ROLE_LABEL } from '../lib/labels';
import { useSession } from '../lib/session';
import { Alert } from '../components/Alert';
import { Badge } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Field } from '../components/Field';
import { Input } from '../components/Input';
import { JobProgress } from '../components/JobProgress';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/Select';
import { ErrorState, LoadingState } from '../components/States';
import { Tabs } from '../components/Tabs';

type Tab = 'org' | 'members' | 'backup' | 'migration';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('org');
  const session = useSession();
  const isAdmin = session.info?.role === 'admin';
  return (
    <div className="container">
      <PageHeader title="設定" lead="事務所の設定・所内ユーザー・バックアップ・移行。監査ログは別画面です。" actions={<><LinkButton to="/setup" icon="settings">事務所・弁護士</LinkButton><LinkButton to="/phrases" icon="quote">文例</LinkButton><LinkButton to="/contacts" icon="recipient">連絡先</LinkButton><LinkButton to="/audit" icon="history">監査ログ</LinkButton></>} />
      <Tabs<Tab> label="設定項目" value={tab} onChange={setTab} items={[{ key: 'org', label: '事務所・保管' }, { key: 'members', label: '所内ユーザー・権限' }, { key: 'backup', label: 'バックアップ・エクスポート' }, { key: 'migration', label: 'CSV 移行' }]}>
        {(k) => (k === 'org' ? <OrgSection /> : k === 'members' ? <MembersSection isAdmin={isAdmin} /> : k === 'backup' ? <BackupSection /> : <MigrationSection />)}
      </Tabs>
    </div>
  );
}

function OrgSection() {
  const q = useSettings();
  const update = useUpdateSettings();
  const [retention, setRetention] = useState<string | null>(null);
  const [autoDelete, setAutoDelete] = useState<boolean | null>(null);
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const ret = retention ?? (s.retentionYears != null ? String(s.retentionYears) : '');
  const ad = autoDelete ?? s.autoDeleteEnabled;
  return (
    <div className="form-800 stack">
      <section className="band stack">
        <h2 style={{ fontSize: 18 }}>運用の前提</h2>
        <dl className="dl"><dt>事務所名</dt><dd>{s.name}</dd><dt>承認に必要な弁護士数</dt><dd className="num">{s.minLawyersForApproval} 名以上</dd></dl>
        <Alert kind="info" title="弁護士 2 名以上の運用前提">最終承認は割当 lawyer のみ。最終編集者とは別の弁護士が確認します。権限付与（案件メンバー追加）は担当 lawyer の承認、担当不在の引継ぎは admin ＋ 別 lawyer の二者承認です。admin は事件本文の全件閲覧権を持ちません。</Alert>
      </section>
      <section className="band stack">
        <h2 style={{ fontSize: 18 }}>保管期限</h2>
        <Alert kind="warning">保存期限は固定の法定年数を仮定せず事務所が設定します。自動本番削除は既定 OFF。legal hold 中の案件は削除されません。</Alert>
        {update.isError ? <Alert kind="error" live>{isApiError(update.error) ? update.error.userMessage() : '保存に失敗しました'}</Alert> : null}
        {update.isSuccess ? <Alert kind="success" live>設定を保存しました。</Alert> : null}
        <Field label="保管年数（空欄 = 未設定）">{({ id }) => <Input id={id} value={ret} onValueChange={setRetention} inputMode="numeric" autoComplete="off" />}</Field>
        <Checkbox checked={ad} onCheckedChange={setAutoDelete} label="期限超過データの自動削除を有効にする（既定 OFF）" description="有効化しても legal hold 中の案件は削除されません" />
        <div><Button variant="primary" busy={update.isPending} disabledReason={s.version == null ? 'API が version を返していないため保存できません（expectedVersion 必須）' : undefined} onClick={() => update.mutate({ retentionYears: ret ? Number(ret) : null, autoDeleteEnabled: ad, expectedVersion: s.version ?? 1 })}>保存</Button></div>
      </section>
    </div>
  );
}

function MembersSection({ isAdmin }: { isAdmin: boolean }) {
  const members = useMembers();
  const invite = useInviteMember();
  const update = useUpdateMember();
  const [form, setForm] = useState<MemberInvite>({ email: '', displayNameRaw: '', role: 'staff' });
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  if (members.isLoading) return <LoadingState />;
  if (members.isError || !members.data) return <ErrorState error={members.error} onRetry={() => void members.refetch()} />;
  const lawyers = members.data.filter((m) => m.role === 'lawyer' && m.status === 'active').length;
  return (
    <div className="stack">
      {lawyers < 2 ? <Alert kind="warning">有効な弁護士ユーザーが {lawyers} 名です。運用は弁護士 2 名以上を前提としています（最終編集者とは別の弁護士が承認するため）。</Alert> : null}
      <Alert kind="info">権限付与は担当 lawyer 承認。案件ごとのメンバー・barrier は各案件画面で設定します。退所時は status を left にすると session と membership が失効します。最後の admin は削除できません。</Alert>
      {issued ? <Alert kind="success" title="初期パスワードを一度だけ表示します" live>{issued.email} の初期パスワード: <b className="mono">{issued.password}</b>。安全な方法で本人へ伝え、初回ログインで MFA を登録してもらいます。この画面を離れると再表示できません。</Alert> : null}
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">所内ユーザー</caption>
          <thead><tr><th scope="col">氏名</th><th scope="col">メール</th><th scope="col">役割</th><th scope="col">状態</th><th scope="col">MFA</th><th scope="col">弁護士紐付け</th><th scope="col">操作</th></tr></thead>
          <tbody>
            {members.data.map((m) => (
              <tr key={m.userId}>
                <td>{m.displayName}</td><td className="mono aux">{m.email}</td><td>{ROLE_LABEL[m.role]}</td><td><Badge tone={m.status === 'active' ? 'success' : 'muted'}>{m.status}</Badge></td><td>{m.mfaEnrolled ? '登録済み' : <Badge tone="warning">未登録</Badge>}</td><td>{m.lawyerId ? 'あり' : '—'}</td>
                <td className="actions">{isAdmin ? <><Select aria-label={`${m.displayName} の役割`} value={m.role} onValueChange={(v) => update.mutate({ userId: m.userId, role: v, expectedVersion: m.version ?? 1 })} options={(['admin', 'lawyer', 'staff'] as const).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /> <Button small onClick={() => update.mutate({ userId: m.userId, status: m.status === 'active' ? 'suspended' : 'active', expectedVersion: m.version ?? 1 })}>{m.status === 'active' ? '停止' : '再有効化'}</Button></> : <span className="aux muted">admin のみ</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {update.isError ? <Alert kind="error" live>{isApiError(update.error) ? (update.error.isConflict ? '最後の admin は削除・降格できません、または版が競合しました。' : update.error.userMessage()) : '更新に失敗しました'}</Alert> : null}
      {isAdmin ? (
        <form className="band stack" onSubmit={(e) => { e.preventDefault(); void invite.mutateAsync(form).then((m) => { if (m.initialPassword) setIssued({ email: m.email, password: m.initialPassword }); setForm({ email: '', displayNameRaw: '', role: 'staff' }); }).catch(() => undefined); }} noValidate>
          <h2 style={{ fontSize: 18 }}>所内ユーザーを追加</h2>
          {invite.isError ? <Alert kind="error" live>{isApiError(invite.error) ? invite.error.userMessage() : '追加に失敗しました'}</Alert> : null}
          <div className="form-grid">
            <Field label="メール" required>{({ id }) => <Input id={id} type="email" value={form.email} onValueChange={(v) => setForm({ ...form, email: v })} autoComplete="off" inputMode="email" />}</Field>
            <Field label="表示名" required>{({ id }) => <Input id={id} value={form.displayNameRaw} onValueChange={(v) => setForm({ ...form, displayNameRaw: v })} autoComplete="off" />}</Field>
            <Field label="役割" required>{({ id }) => <Select id={id} value={form.role} onValueChange={(v) => setForm({ ...form, role: v as MemberInvite['role'] })} options={(['admin', 'lawyer', 'staff'] as const).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />}</Field>
          </div>
          <p className="aux muted">初期 lawyer 指定はオンボーディング運用責任者が行い、変更は監査・二者確認の対象です。admin が自分を lawyer にして承認制約を迂回しないでください。</p>
          <div><Button type="submit" variant="primary" busy={invite.isPending} disabledReason={!form.email.trim() || !form.displayNameRaw.trim() ? 'メールと表示名を入力してください' : undefined}>追加（初期パスワード発行）</Button></div>
        </form>
      ) : null}
    </div>
  );
}

function BackupSection() {
  const q = useSettings();
  const [type, setType] = useState<ExportRequest['type']>('matters_csv');
  const [encoding, setEncoding] = useState<'utf8_bom' | 'cp932'>('utf8_bom');
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    setErr(null);
    try {
      const r = await requestExport({ type, encoding });
      setJobId(r.jobId);
    } catch (e) {
      setErr(isApiError(e) ? e.userMessage() : 'エクスポートを開始できませんでした');
    }
  };
  return (
    <div className="form-800 stack">
      <section className="band stack">
        <h2 style={{ fontSize: 18 }}>バックアップ</h2>
        <dl className="dl"><dt>バックアップ</dt><dd>{q.data?.backupNote ?? '—'}</dd><dt>保管地域</dt><dd>{q.data?.storageRegionNote ?? '—'}</dd></dl>
        <Alert kind="info">日次で DB・Storage・書式・fonts・renderer 設定を暗号化バックアップし、四半期に空環境へ復元検証します（目標 RPO 24 時間 / RTO 1 営業日。保証契約とは区別）。復元は空環境限定です。</Alert>
      </section>
      <section className="band stack">
        <h2 style={{ fontSize: 18 }}>エクスポート</h2>
        {err ? <Alert kind="error" live>{err}</Alert> : null}
        <div className="form-grid">
          <Field label="種類">{({ id }) => <Select id={id} value={type} onValueChange={(v) => setType(v as ExportRequest['type'])} options={[{ value: 'matters_csv', label: '案件 CSV' }, { value: 'contacts_csv', label: '連絡先 CSV' }, { value: 'evidence_csv', label: '証拠台帳 CSV（案件指定は案件画面）' }, { value: 'audit_csv', label: '監査 CSV' }, { value: 'full_backup', label: '管理者向け全量バックアップ（schemaVersion=2）' }]} />}</Field>
          <Field label="CSV 文字コード" hint="CP932 は全セルが strict にエンコード可能な場合のみ">{({ id }) => <Select id={id} value={encoding} onValueChange={(v) => setEncoding(v as 'utf8_bom' | 'cp932')} options={[{ value: 'utf8_bom', label: 'UTF-8（BOM 付き）' }, { value: 'cp932', label: 'CP932（Shift_JIS）' }]} />}</Field>
        </div>
        <div className="row"><Button variant="primary" icon="export" onClick={() => void start()} busy={!!jobId && job.data?.state !== 'succeeded' && job.data?.state !== 'failed'}>エクスポートを開始</Button></div>
        {jobId ? <JobProgress job={job.data} pendingLabel="エクスポートを準備しています…" /> : null}
        {jobId && job.data?.state === 'succeeded' ? <div><Button icon="export" onClick={() => void downloadFile(exportDownloadUrl(jobId), `export_${type}`).catch((e: unknown) => setErr(isApiError(e) ? e.userMessage() : '取得に失敗しました'))}>ファイルを取得</Button></div> : null}
        <p className="aux muted">CSV は式注入対策を適用します。原文の完全保存は JSON/TXT で提供します。</p>
      </section>
    </div>
  );
}

function MigrationSection() {
  const [kind, setKind] = useState<'contacts' | 'matters' | 'matter_parties'>('contacts');
  const [encoding, setEncoding] = useState<'auto' | 'utf8' | 'utf8_bom' | 'cp932'>('auto');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<{ inserted: number; updated: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const doPreview = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setPreview(await importPreview(file, { kind, encoding }));
    } catch (e) {
      setErr(isApiError(e) ? e.userMessage() : 'プレビューに失敗しました');
    } finally {
      setBusy(false);
    }
  };
  const doCommit = async () => {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    try {
      setResult(await importCommit(preview.importToken));
      setPreview(null);
    } catch (e) {
      setErr(isApiError(e) ? e.userMessage() : '取込に失敗しました（全行 rollback）');
    } finally {
      setBusy(false);
    }
  };
  const cols = preview?.previewRows[0] ? Object.keys(preview.previewRows[0]) : [];
  return (
    <div className="stack">
      <section className="band stack form-800">
        <h2 style={{ fontSize: 18 }}>CSV 取込（連絡先 / 案件 / 関係当事者）</h2>
        <Alert kind="info">20 行をプレビューし、全行検査後に transaction で commit します。1 行でもエラーがあれば全体を止めます。encoding 失敗は置換せずエラー。人物を名前だけで結合しません（external_id 必須）。</Alert>
        {err ? <Alert kind="error" live>{err}</Alert> : null}
        {result ? <Alert kind="success" live>取込完了: 追加 {result.inserted} 件 ／ 更新 {result.updated} 件</Alert> : null}
        <div className="form-grid">
          <Field label="種類">{({ id }) => <Select id={id} value={kind} onValueChange={(v) => setKind(v as typeof kind)} options={[{ value: 'contacts', label: '連絡先（external_id,type,name_raw,kana,organization_name_raw,address_raw,postcode_raw,phone_raw,email_raw）' }, { value: 'matters', label: '案件（external_id,title_raw,case_number_raw,court_raw,status,scope_raw）' }, { value: 'matter_parties', label: '関係当事者（matter_external_id,contact_external_id,role）' }]} />}</Field>
          <Field label="文字コード">{({ id }) => <Select id={id} value={encoding} onValueChange={(v) => setEncoding(v as typeof encoding)} options={[{ value: 'auto', label: '自動判定' }, { value: 'utf8_bom', label: 'UTF-8（BOM）' }, { value: 'utf8', label: 'UTF-8' }, { value: 'cp932', label: 'CP932' }]} />}</Field>
        </div>
        <div className="file-drop"><input id="csv-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { setFile(e.currentTarget.files?.[0] ?? null); setPreview(null); }} /><div className="row"><label htmlFor="csv-file" className="btn">CSV を選択</label>{file ? <span className="aux">{file.name}</span> : null}</div></div>
        <div className="row"><Button variant="primary" onClick={() => void doPreview()} busy={busy} disabledReason={!file ? 'CSV を選択してください' : undefined}>プレビュー（20 行）</Button></div>
      </section>
      {preview ? (
        <section className="band stack">
          <div className="row aux"><span>判定 encoding: <b>{preview.detectedEncoding}</b></span><span className="num">全 {preview.totalRows} 行</span><Badge tone={preview.canCommit ? 'success' : 'error'}>{preview.canCommit ? '取込可' : `エラー ${preview.errors.length} 件（取込不可）`}</Badge></div>
          {preview.errors.length > 0 ? <div className="table-wrap"><table className="table"><caption className="sr-only">エラー</caption><thead><tr><th scope="col">行</th><th scope="col">列</th><th scope="col">内容</th></tr></thead><tbody>{preview.errors.map((e, k) => <tr key={k}><td className="num">{e.row}</td><td className="mono">{e.column ?? '—'}</td><td>{e.message} <span className="aux muted mono">{e.code}</span></td></tr>)}</tbody></table></div> : null}
          <div className="table-wrap"><table className="table"><caption className="sr-only">プレビュー</caption><thead><tr>{cols.map((c) => <th key={c} scope="col" className="mono">{c}</th>)}</tr></thead><tbody>{preview.previewRows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="cell-raw">{r[c] ?? ''}</td>)}</tr>)}</tbody></table></div>
          <div><Button variant="primary" onClick={() => void doCommit()} busy={busy} disabledReason={!preview.canCommit ? 'エラーを解消した CSV で再度プレビューしてください' : undefined}>全行を取り込む（transaction）</Button></div>
        </section>
      ) : null}
      <p className="aux muted"><Link to="/audit">監査ログ</Link>で取込の記録を確認できます。</p>
    </div>
  );
}
