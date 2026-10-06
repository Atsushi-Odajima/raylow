import { useId, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  disabledReason?: string | undefined;
}
export interface TabsProps<K extends string> {
  items: TabItem<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  children?: ((k: K) => ReactNode) | undefined;
}

/** aria-selected + 2px 下線。矢印キーで移動 */
export function Tabs<K extends string>({ items, value, onChange, label, children }: TabsProps<K>) {
  const id = useId();
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = items.findIndex((i) => i.key === value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      for (let step = 1; step <= items.length; step++) {
        const next = items[(idx + dir * step + items.length * step) % items.length];
        if (next && !next.disabledReason) {
          onChange(next.key);
          document.getElementById(`${id}-tab-${next.key}`)?.focus();
          return;
        }
      }
    }
  };
  return (
    <div>
      <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
        {items.map((it) => {
          const selected = it.key === value;
          return (
            <button
              key={it.key}
              id={`${id}-tab-${it.key}`}
              type="button"
              role="tab"
              className="tab"
              aria-selected={selected}
              aria-controls={`${id}-panel-${it.key}`}
              tabIndex={selected ? 0 : -1}
              disabled={!!it.disabledReason}
              title={it.disabledReason}
              onClick={() => onChange(it.key)}
            >
              {it.label}
              {it.disabledReason ? <span className="sr-only">（{it.disabledReason}）</span> : null}
            </button>
          );
        })}
      </div>
      {children ? (
        <div id={`${id}-panel-${value}`} role="tabpanel" aria-labelledby={`${id}-tab-${value}`} className="tabpanel">
          {children(value)}
        </div>
      ) : null}
    </div>
  );
}
