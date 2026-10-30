import { Fragment, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ParsedMessage, Segment } from '../domain/types';
import { splitLines } from '../engine/text';
import { useDerived, worstState, type RowState } from '../state/derived';
import { useApp } from '../state/store';

interface Range {
  start: number;
  end: number;
  ids: string[];
  state: RowState | null;
}

const MUTED_KINDS = new Set<Segment['kind']>(['recipient', 'greeting', 'separator', 'info']);

/** Texto original, sem enfeites: só o que está pendente ganha marcação. */
export function SourcePanel() {
  const d = useDerived()!;
  const { selection, sourceFocus } = useApp(useShallow((s) => ({ selection: s.selection, sourceFocus: s.sourceFocus })));
  const select = useApp.getState().select;
  const scroller = useRef<HTMLDivElement>(null);

  const { text, segments, messages } = d.result;
  const lines = useMemo(() => splitLines(text), [text]);
  const segByStart = useMemo(() => new Map(segments.map((s) => [s.span.start, s])), [segments]);
  const msgByStart = useMemo(() => new Map(messages.map((m) => [m.span.start, m])), [messages]);

  const rangesBySeg = useMemo(() => {
    const map = new Map<string, Range[]>();
    for (const seg of segments) {
      const groups = new Map<string, Range>();
      for (const id of d.bySegment.get(seg.id) ?? []) {
        const r = d.byId.get(id);
        if (!r) continue;
        const start = Math.max(r.m.fragmentSpan.start, seg.span.start);
        const end = Math.min(r.m.fragmentSpan.end, seg.span.end);
        if (end <= start) continue;
        const k = `${start}-${end}`;
        const g = groups.get(k) ?? { start, end, ids: [], state: null };
        g.ids.push(id);
        groups.set(k, g);
      }
      const ranges = [...groups.values()].sort((a, b) => a.start - b.start);
      for (const g of ranges) g.state = worstState(g.ids.map((id) => d.byId.get(id)!));
      const clean: Range[] = [];
      for (const r of ranges) if (!clean.length || r.start >= clean[clean.length - 1]!.end) clean.push(r);
      if (clean.length) map.set(seg.id, clean);
    }
    return map;
  }, [segments, d.bySegment, d.byId]);

  useEffect(() => {
    if (!sourceFocus || !scroller.current) return;
    const root = scroller.current;
    const target =
      root.querySelector<HTMLElement>(`[data-fstart="${sourceFocus.start}"]`) ??
      [...root.querySelectorAll<HTMLElement>('[data-lstart]')].find(
        (el) => Number(el.dataset.lstart) <= sourceFocus.start && sourceFocus.start <= Number(el.dataset.lend),
      );
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [sourceFocus]);

  return (
    <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-auto bg-white px-6 pt-4 pb-10 text-[13px] leading-[1.7]">
      {lines.map((line) => {
        const msg = msgByStart.get(line.start);
        const seg = segByStart.get(line.start);
        return (
          <Fragment key={line.start}>
            {msg && msg.index > 0 && <Separator msg={msg} />}
            <Line text={line.text} start={line.start} seg={seg} ranges={seg ? (rangesBySeg.get(seg.id) ?? []) : []} lineIds={seg ? (d.bySegment.get(seg.id) ?? []) : []} selection={selection} onPick={select} />
          </Fragment>
        );
      })}
    </div>
  );
}

function Separator({ msg }: { msg: ParsedMessage }) {
  return (
    <div className="mt-6 mb-3 flex items-center gap-3 text-[11px] text-slate-400">
      <span className="h-px flex-1 bg-slate-200" />
      {msg.duplicateOf ? 'Mensagem repetida, ignorada' : msg.isCorrection ? 'Correção' : `Mensagem ${msg.index + 1}`}
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function rangeClass(state: RowState | null, active: boolean): string {
  if (active) return 'rounded-[2px] bg-blue-100 text-slate-900';
  if (state === 'excluido') return 'text-slate-300';
  if (state === 'valido') return 'hover:bg-slate-100';
  return 'underline decoration-amber-400 decoration-dotted decoration-1 underline-offset-[3px] hover:bg-slate-100';
}

interface LineProps {
  text: string;
  start: number;
  seg: Segment | undefined;
  ranges: Range[];
  lineIds: string[];
  selection: Set<string>;
  onPick: (ids: string[]) => void;
}

function Line({ text, start, seg, ranges, lineIds, selection, onPick }: LineProps) {
  const kind = seg?.kind;
  const pieces: React.ReactNode[] = [];
  let cursor = start;
  for (const r of ranges) {
    if (r.start > cursor) pieces.push(text.slice(cursor - start, r.start - start));
    pieces.push(
      <span
        key={r.start}
        data-fstart={r.start}
        onClick={(e) => {
          e.stopPropagation();
          onPick(r.ids);
        }}
        className={`cursor-pointer ${rangeClass(r.state, r.ids.some((id) => selection.has(id)))}`}
      >
        {text.slice(r.start - start, r.end - start)}
      </span>,
    );
    cursor = r.end;
  }
  if (cursor < start + text.length) pieces.push(text.slice(cursor - start));

  const tone = kind && MUTED_KINDS.has(kind) ? 'text-slate-400' : kind === 'section' ? 'font-medium text-slate-800' : kind === 'unrecognized' ? 'text-block underline decoration-wavy decoration-1 underline-offset-4' : 'text-slate-700';

  return (
    <div data-lstart={start} data-lend={start + text.length} onClick={() => lineIds.length && onPick(lineIds)} className={`break-words whitespace-pre-wrap ${tone} ${lineIds.length ? 'cursor-pointer' : ''}`} title={seg?.note ?? undefined}>
      {pieces.length ? pieces : <>&nbsp;</>}
    </div>
  );
}
