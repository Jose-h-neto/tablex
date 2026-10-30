import { useEffect, useMemo, useRef } from 'react';
import { useApp } from '../state/store';

/** Mensagem original, somente leitura. Destaca a linha da célula em foco. */
export function SourcePanel() {
  const text = useApp((s) => s.text);
  const activeLine = useApp((s) => s.activeLine);
  const lines = useMemo(() => text.replace(/\r\n?/g, '\n').split('\n'), [text]);
  const active = useRef<HTMLDivElement>(null);

  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest' });
  }, [activeLine]);

  return (
    <aside className="w-[32%] shrink-0 overflow-auto border-r border-line bg-canvas px-3 py-4 text-[13px] leading-relaxed" aria-label="Mensagem original">
      {lines.map((line, i) => (
        <div
          key={i}
          ref={i === activeLine ? active : undefined}
          className={`min-h-[1.6em] rounded border-l-2 px-2 break-words whitespace-pre-wrap ${i === activeLine ? 'border-accent bg-accent-soft text-ink' : 'border-transparent text-ink-soft'}`}
        >
          {line}
        </div>
      ))}
    </aside>
  );
}
