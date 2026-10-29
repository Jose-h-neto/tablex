import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip leve, posicionado em "fixed" para não ser cortado pela rolagem da tabela.
 */
export function Tip({ content, children, className }: { content: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const above = r.bottom + 120 > window.innerHeight;
      setPos({ x: Math.min(r.left, window.innerWidth - 380), y: above ? r.top - 6 : r.bottom + 6, above });
    }, 250);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setPos(null);
  };

  return (
    <span ref={ref} className={className} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-50 max-w-[360px] rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[12px] leading-snug text-slate-100 shadow-lg"
            style={{ left: Math.max(8, pos.x), top: pos.y, transform: pos.above ? 'translateY(-100%)' : undefined }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
