import type { DocumentAST } from '@raylow/template-schema';

/** 本文 AST を書面風（白地・黒文字）に表示。全角・番号文字列はそのまま */
export function AstView({ ast, highlightBlockId }: { ast: DocumentAST; highlightBlockId?: string | null | undefined }) {
  if (ast.blocks.length === 0) return <div className="paper muted">（本文なし）</div>;
  return (
    <div className="paper">
      {ast.blocks.map((b) => {
        const hl = highlightBlockId === b.id ? { outline: 'var(--focus-ring)', outlineOffset: '4px' } : undefined;
        switch (b.type) {
          case 'heading':
            return (
              <div key={b.id} className="paper__heading" id={`block-${b.id}`} style={hl}>
                {b.text}
              </div>
            );
          case 'paragraph':
            return (
              <p key={b.id} id={`block-${b.id}`} style={hl}>
                {b.text}
              </p>
            );
          case 'numberedParagraph':
            return (
              <div key={b.id} className="paper__numbered" id={`block-${b.id}`} style={{ ...hl, paddingLeft: `${(b.level - 1) * 1.5}em` }}>
                <span className="paper__numbered-label">{b.numberLabel}</span>
                <span>{b.text}</span>
              </div>
            );
          case 'evidenceRef':
            return (
              <p key={b.id} id={`block-${b.id}`} className="paper__evidence" style={hl}>
                {b.displayLabel}
              </p>
            );
        }
      })}
    </div>
  );
}
