import { useRef, type ReactNode } from 'react';
import { useApp } from '../state/store';

export function SplitView({ left, right }: { left: ReactNode; right: ReactNode }) {
  const ratio = useApp((s) => s.splitRatio);
  const setRatio = useApp.getState().setSplitRatio;
  const container = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = container.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => setRatio((ev.clientX - rect.left) / rect.width);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={container} className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-col" style={{ width: `${ratio * 100}%` }} aria-label="Mensagem original">
        {left}
      </section>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={20}
        aria-valuemax={75}
        aria-label="Redimensionar painéis"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onDoubleClick={() => setRatio(0.38)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setRatio(ratio - 0.02);
          if (e.key === 'ArrowRight') setRatio(ratio + 0.02);
        }}
        className="relative z-10 w-px shrink-0 cursor-col-resize bg-slate-200 hover:bg-slate-400"
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Movimentações processadas">
        {right}
      </section>
    </div>
  );
}
