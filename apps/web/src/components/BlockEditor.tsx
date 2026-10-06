/**
 * 限定 AST（heading / paragraph / numberedParagraph / evidenceRef）のブロックエディタ。
 * 各ブロックは stable ID を持つ。番号文字列（「第１」「（１）」など）は原文のまま保持する。
 * Tiptap は使わず textarea ベース（v1）。
 */
import { useState } from 'react';
import type { Block, DocumentAST } from '@raylow/template-schema';
import type { Evidence, Phrase } from '@raylow/contracts';
import { findInvisible } from '@raylow/japanese-text';
import { newBlockId } from '../lib/ids';
import { Button } from './Button';
import { Icon } from './Icon';
import { Input } from './Input';
import { Select } from './Select';
import { TextArea } from './TextArea';
import { Dialog } from './Dialog';
import { PHRASE_STATUS_LABEL } from '../lib/labels';
import { Alert } from './Alert';

export interface BlockEditorProps {
  ast: DocumentAST;
  onChange: (ast: DocumentAST) => void;
  disabled?: boolean | undefined;
  disabledReason?: string | undefined;
  focusBlockId?: string | null | undefined;
  evidence?: Evidence[] | undefined;
  phrases?: Phrase[] | undefined;
  onPhraseInserted?: ((phraseVersionId: string) => void) | undefined;
}

type BlockKind = Block['type'];
const KIND_OPTIONS = [
  { value: 'paragraph', label: '段落' },
  { value: 'heading', label: '見出し' },
  { value: 'numberedParagraph', label: '番号付き段落' },
];

export function BlockEditor({ ast, onChange, disabled, disabledReason, focusBlockId, evidence, phrases, onPhraseInserted }: BlockEditorProps) {
  const [phraseOpen, setPhraseOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const blocks = ast.blocks;
  const set = (next: Block[]) => onChange({ schemaVersion: 1, blocks: next });
  const updateAt = (i: number, b: Block) => set(blocks.map((x, k) => (k === i ? b : x)));
  const insertAt = (i: number, b: Block) => set([...blocks.slice(0, i), b, ...blocks.slice(i)]);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    const a = next[i];
    const b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    set(next);
  };
  const remove = (i: number) => set(blocks.filter((_, k) => k !== i));

  const changeKind = (i: number, kind: BlockKind) => {
    const cur = blocks[i];
    if (!cur || cur.type === 'evidenceRef') return;
    const text = cur.text;
    let next: Block;
    if (kind === 'heading') next = { id: cur.id, type: 'heading', level: 1, text };
    else if (kind === 'numberedParagraph') next = { id: cur.id, type: 'numberedParagraph', numberLabel: cur.type === 'numberedParagraph' ? cur.numberLabel : '', text, level: 1 };
    else next = { id: cur.id, type: 'paragraph', text };
    updateAt(i, next);
  };

  const addParagraph = (i: number) => insertAt(i, { id: newBlockId(), type: 'paragraph', text: '' });

  const insertPhrase = (p: Phrase) => {
    const v = p.currentVersion;
    if (!v) return;
    const paras = v.bodyRaw.split('\n').filter((s) => s.length > 0);
    const newBlocks: Block[] = paras.map((t) => ({ id: newBlockId(), type: 'paragraph', text: t }));
    set([...blocks, ...newBlocks]);
    onPhraseInserted?.(v.id);
    setPhraseOpen(false);
  };
  const insertEvidence = (e: Evidence) => {
    set([...blocks, { id: newBlockId(), type: 'evidenceRef', evidenceId: e.id, displayLabel: e.displayLabel }]);
    setEvidenceOpen(false);
  };

  return (
    <div className="block-editor">
      {disabledReason ? (
        <div className="notice-box aux">
          <Icon name="lock" size={16} label="編集不可" /> {disabledReason}
        </div>
      ) : null}
      {blocks.length === 0 ? <div className="muted aux">本文がありません。「段落を追加」または「文例を挿入」から始めてください。</div> : null}
      {blocks.map((b, i) => {
        const inv = b.type !== 'evidenceRef' ? findInvisible(b.text) : [];
        return (
          <div key={b.id} className="block" data-focus={focusBlockId === b.id ? 'true' : undefined} id={`block-${b.id}`}>
            <div className="block__bar">
              <div className="row">
                {b.type === 'evidenceRef' ? (
                  <span className="badge">証拠参照</span>
                ) : (
                  <Select aria-label={`${i + 1} 番目のブロック種別`} value={b.type} onValueChange={(v) => changeKind(i, v as BlockKind)} options={KIND_OPTIONS} disabled={disabled} />
                )}
                {b.type === 'heading' ? (
                  <Select aria-label="見出しレベル" value={String(b.level)} onValueChange={(v) => updateAt(i, { ...b, level: Number(v) as 1 | 2 | 3 })} options={[1, 2, 3].map((l) => ({ value: String(l), label: `レベル ${l}` }))} disabled={disabled} />
                ) : null}
                {b.type === 'numberedParagraph' ? (
                  <>
                    <Input aria-label="番号（原文のまま。例: 第１、１、（１））" value={b.numberLabel} onValueChange={(v) => updateAt(i, { ...b, numberLabel: v })} placeholder="番号" disabled={disabled} autoComplete="off" />
                    <Select aria-label="階層" value={String(b.level)} onValueChange={(v) => updateAt(i, { ...b, level: Number(v) as 1 | 2 | 3 | 4 })} options={[1, 2, 3, 4].map((l) => ({ value: String(l), label: `階層 ${l}` }))} disabled={disabled} />
                  </>
                ) : null}
              </div>
              <div className="block__tools">
                <Button small variant="quiet" aria-label="上へ" onClick={() => move(i, -1)} disabledReason={disabled ? '編集不可' : i === 0 ? '先頭です' : undefined}>
                  <Icon name="arrow-up" size={16} />
                </Button>
                <Button small variant="quiet" aria-label="下へ" onClick={() => move(i, 1)} disabledReason={disabled ? '編集不可' : i === blocks.length - 1 ? '末尾です' : undefined}>
                  <Icon name="arrow-down" size={16} />
                </Button>
                <Button small variant="quiet" aria-label="この下に段落を挿入" onClick={() => addParagraph(i + 1)} disabledReason={disabled ? '編集不可' : undefined}>
                  <Icon name="plus" size={16} />
                </Button>
                <Button small variant="quiet" aria-label="このブロックを削除" onClick={() => remove(i)} disabledReason={disabled ? '編集不可' : undefined}>
                  <Icon name="close" size={16} />
                </Button>
              </div>
            </div>
            {b.type === 'evidenceRef' ? (
              <div>
                <b>{b.displayLabel}</b> <span className="aux muted mono">evidence: {b.evidenceId.slice(0, 8)}</span>
              </div>
            ) : (
              <TextArea aria-label={`${i + 1} 番目の本文`} value={b.text} onValueChange={(v) => updateAt(i, { ...b, text: v })} disabled={disabled} spellCheck={false} />
            )}
            {inv.length > 0 ? (
              <div className="field__warning" role="status">
                <Icon name="alert" size={16} label="注意" />
                <span>
                  不可視文字が {inv.length} 件あります（{inv.slice(0, 3).map((f) => f.codePoint).join(', ')}）。自動削除はしません。
                </span>
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="row">
        <Button small icon="plus" onClick={() => addParagraph(blocks.length)} disabledReason={disabled ? '編集不可' : undefined}>
          段落を追加
        </Button>
        {phrases ? (
          <Button small icon="quote" onClick={() => setPhraseOpen(true)} disabledReason={disabled ? '編集不可' : phrases.length === 0 ? '承認済みの文例がありません' : undefined}>
            文例を挿入
          </Button>
        ) : null}
        {evidence ? (
          <Button small icon="evidence" onClick={() => setEvidenceOpen(true)} disabledReason={disabled ? '編集不可' : evidence.length === 0 ? 'この案件に証拠がありません' : undefined}>
            証拠参照を追加
          </Button>
        ) : null}
      </div>
      <Dialog open={phraseOpen} title="文例を挿入" onClose={() => setPhraseOpen(false)}>
        <Alert kind="info">承認済み文例でも個別案件への適用は利用者の判断です。挿入後に本文を確認してください。</Alert>
        <div className="candidate-list">
          {(phrases ?? []).map((p) => (
            <button key={p.id} type="button" className="candidate" onClick={() => insertPhrase(p)} disabled={!p.currentVersion}>
              <span>
                <b>{p.title}</b> <span className="aux muted">{p.category}</span> <span className="badge">{PHRASE_STATUS_LABEL[p.currentVersion?.status ?? ''] ?? '版なし'}</span>
              </span>
              <span className="candidate__meta wrap-anywhere">{p.currentVersion?.bodyRaw.slice(0, 120) ?? ''}</span>
            </button>
          ))}
        </div>
      </Dialog>
      <Dialog open={evidenceOpen} title="証拠参照を追加" onClose={() => setEvidenceOpen(false)}>
        <div className="candidate-list">
          {(evidence ?? []).map((e) => (
            <button key={e.id} type="button" className="candidate" onClick={() => insertEvidence(e)}>
              <span>
                <b>{e.displayLabel}</b> <span className="aux muted">{e.titleRaw}</span>
              </span>
              <span className="candidate__meta">
                {e.authorRaw || '作成者不明'} ／ {e.dateRaw || '日付不明'} ／ {e.originalCopy === 'original' ? '原本' : '写し'}
              </span>
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
