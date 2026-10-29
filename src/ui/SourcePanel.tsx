import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatCompetencia } from '../domain/competencia';
import type { ParsedMessage, Segment } from '../domain/types';
import { splitLines } from '../engine/text';
import { useDerived, worstState, type RowState } from '../state/derived';
import { useApp } from '../state/store';
import { STATE_BORDER, STATE_LABEL, STATE_UNDERLINE, plural } from './format';
import { IconAlert, IconDown, IconEdit } from './Icons';
import { Tip } from './Tooltip';

interface Range {
  start: number;
  end: number;
  kind: 'mov' | 'comp';
  ids: string[];
  state: RowState | null;
}

const MUTED_KINDS = new Set<Segment['kind']>(['recipient', 'greeting', 'separator']);

export function SourcePanel() {
  const d = useDerived()!;
  const { selection, focusedId, sourceFocus } = useApp(
    useShallow((s) => ({ selection: s.selection, focusedId: s.focusedId, sourceFocus: s.sourceFocus })),
  );
  const { select, focus, focusSource, backToInput } = useApp.getState();
  const scroller = useRef<HTMLDivElement>(null);
  const [unkIndex, setUnkIndex] = useState(-1);

  const { text, segments, messages } = d.result;
  const lines = useMemo(() => splitLines(text), [text]);
  const segByStart = useMemo(() => new Map(segments.map((s) => [s.span.start, s])), [segments]);
  const msgByStart = useMemo(() => new Map(messages.map((m) => [m.span.start, m])), [messages]);

  /** Trechos que originaram lançamentos, recortados por linha. */
  const rangesBySeg = useMemo(() => {
    const map = new Map<string, Range[]>();
    for (const seg of segments) {
      const ids = d.bySegment.get(seg.id) ?? [];
      const groups = new Map<string, Range>();
      for (const id of ids) {
        const r = d.byId.get(id);
        if (!r) continue;
        const start = Math.max(r.m.fragmentSpan.start, seg.span.start);
        const end = Math.min(r.m.fragmentSpan.end, seg.span.end);
        if (end <= start) continue;
        const k = `${start}-${end}`;
        const g = groups.get(k) ?? { start, end, kind: 'mov' as const, ids: [], state: null };
        g.ids.push(id);
        groups.set(k, g);
      }
      const ranges = [...groups.values()];
      for (const g of ranges) g.state = worstState(g.ids.map((id) => d.byId.get(id)!));
      const msg = messages.find((m) => m.id === seg.messageId);
      const cs = msg?.competenciaSpan;
      if (cs && cs.start >= seg.span.start && cs.end <= seg.span.end) ranges.push({ ...cs, kind: 'comp', ids: [], state: null });
      ranges.sort((a, b) => a.start - b.start);
      // Remove sobreposições (mantém o primeiro trecho).
      const clean: Range[] = [];
      for (const r of ranges) if (!clean.length || r.start >= clean[clean.length - 1]!.end) clean.push(r);
      if (clean.length) map.set(seg.id, clean);
    }
    return map;
  }, [segments, messages, d.bySegment, d.byId]);

  const activeIds = useMemo(() => {
    const s = new Set(selection);
    if (focusedId) s.add(focusedId);
    return s;
  }, [selection, focusedId]);

  useEffect(() => {
    if (!sourceFocus || !scroller.current) return;
    const root = scroller.current;
    const frag = root.querySelector<HTMLElement>(`[data-fstart="${sourceFocus.start}"]`);
    const line = [...root.querySelectorAll<HTMLElement>('[data-lstart]')].find(
      (el) => Number(el.dataset.lstart) <= sourceFocus.start && sourceFocus.start <= Number(el.dataset.lend),
    );
    const target = frag ?? line;
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }, [sourceFocus]);

  const pickIds = (ids: string[]) => {
    if (!ids.length) return;
    select(ids);
    focus(ids[0]!, { scrollSource: false, scrollTable: true });
  };

  const nextUnrecognized = () => {
    if (!d.unrecognized.length) return;
    const i = (unkIndex + 1) % d.unrecognized.length;
    setUnkIndex(i);
    const seg = d.unrecognized[i]!;
    focusSource(seg.span.start, seg.span.end);
  };

  const movCount = (m: ParsedMessage) => d.rows.filter((r) => r.m.messageId === m.id).length;

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <h2 className="text-[12px] font-semibold text-slate-800">Mensagem original</h2>
        <span className="text-[11px] text-slate-500">
          {plural(messages.length, 'mensagem', 'mensagens')} · {plural(segments.length, 'linha', 'linhas')}
        </span>
        <div className="flex-1" />
        {d.unrecognized.length > 0 && (
          <Tip content="Linhas sem matrícula que não correspondem a nenhum padrão. Não geram lançamento e entram no relatório de pendências. Clique para percorrer.">
            <button type="button" className="btn btn-sm border-block/30 bg-block-bg text-block" onClick={nextUnrecognized}>
              <IconAlert /> {plural(d.unrecognized.length, 'não interpretada', 'não interpretadas')} <IconDown />
            </button>
          </Tip>
        )}
        <Tip content="Volta ao texto colado. Reprocessar descarta as edições feitas na conferência.">
          <button type="button" className="btn btn-sm" onClick={backToInput}>
            <IconEdit /> Editar texto
          </button>
        </Tip>
      </div>

      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-auto bg-white pb-8 font-mono text-[12px] leading-[1.7]">
        {lines.map((line, idx) => {
          const msg = msgByStart.get(line.start);
          const seg = segByStart.get(line.start);
          return (
            <Fragment key={line.start}>
              {msg && <MessageHeader msg={msg} count={movCount(msg)} />}
              <Line
                lineNo={idx + 1}
                text={line.text}
                start={line.start}
                seg={seg}
                ranges={seg ? (rangesBySeg.get(seg.id) ?? []) : []}
                lineIds={seg ? (d.bySegment.get(seg.id) ?? []) : []}
                activeIds={activeIds}
                lineState={seg ? worstState((d.bySegment.get(seg.id) ?? []).map((id) => d.byId.get(id)!)) : null}
                onPick={pickIds}
              />
            </Fragment>
          );
        })}
      </div>
    </>
  );
}

function MessageHeader({ msg, count }: { msg: ParsedMessage; count: number }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 border-y border-slate-200 bg-slate-50 px-3 py-1 font-sans text-[11px] text-slate-500 first:mt-0">
      <span className="font-semibold text-slate-700">Mensagem {msg.index + 1}</span>
      {msg.recipient && <span>· para {msg.recipient}</span>}
      <span>
        · competência{' '}
        {msg.competencia ? (
          <b className="font-semibold text-slate-700">{formatCompetencia(msg.competencia)}</b>
        ) : (
          <span className="italic">não informada (usa a selecionada)</span>
        )}
      </span>
      <span>· {plural(count, 'lançamento', 'lançamentos')}</span>
      {msg.isCorrection && <span className="rounded bg-sel-bg px-1.5 font-medium text-sel">Correção</span>}
      {msg.duplicateOf && (
        <span className="rounded bg-warn-bg px-1.5 font-medium text-warn">Repetição da mensagem {msg.duplicateOf.replace('msg', '')}</span>
      )}
    </div>
  );
}

interface LineProps {
  lineNo: number;
  text: string;
  start: number;
  seg: Segment | undefined;
  ranges: Range[];
  lineIds: string[];
  activeIds: Set<string>;
  lineState: RowState | null;
  onPick: (ids: string[]) => void;
}

function Line({ lineNo, text, start, seg, ranges, lineIds, activeIds, lineState, onPick }: LineProps) {
  const kind = seg?.kind;
  const isActive = lineIds.some((id) => activeIds.has(id));
  const pieces: React.ReactNode[] = [];
  let cursor = start;
  for (const r of ranges) {
    if (r.start > cursor) pieces.push(text.slice(cursor - start, r.start - start));
    const content = text.slice(r.start - start, r.end - start);
    if (r.kind === 'comp') {
      pieces.push(
        <span key={`c${r.start}`} className="rounded-[2px] bg-slate-200/80 px-0.5 font-semibold text-slate-700" title="Competência detectada">
          {content}
        </span>,
      );
    } else {
      const active = r.ids.some((id) => activeIds.has(id));
      pieces.push(
        <span
          key={`m${r.start}`}
          data-fstart={r.start}
          role="button"
          tabIndex={-1}
          title={r.state ? `${r.ids.length > 1 ? `${r.ids.length} lançamentos` : '1 lançamento'} · ${STATE_LABEL[r.state]}` : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onPick(r.ids);
          }}
          className={`cursor-pointer rounded-[2px] underline decoration-2 underline-offset-[3px] ${r.state ? STATE_UNDERLINE[r.state] : ''} ${
            active ? 'bg-sel-bg text-slate-900 ring-1 ring-sel/50' : 'hover:bg-slate-100'
          } ${r.state === 'excluido' ? 'line-through' : ''}`}
        >
          {content}
        </span>,
      );
    }
    cursor = r.end;
  }
  if (cursor < start + text.length) pieces.push(text.slice(cursor - start));

  const border = lineState ? STATE_BORDER[lineState] : kind === 'unrecognized' ? 'border-l-block' : 'border-l-transparent';
  const tone =
    kind && MUTED_KINDS.has(kind)
      ? 'text-slate-400'
      : kind === 'section'
        ? 'font-semibold text-slate-700'
        : kind === 'info'
          ? 'italic text-slate-500'
          : kind === 'unrecognized'
            ? 'text-slate-700 underline decoration-block/60 decoration-wavy underline-offset-4'
            : 'text-slate-800';

  return (
    <div
      data-lstart={start}
      data-lend={start + text.length}
      onClick={() => onPick(lineIds)}
      className={`flex border-l-2 ${border} ${isActive ? 'bg-sel-bg/50' : lineIds.length ? 'hover:bg-slate-50' : ''} ${lineIds.length ? 'cursor-pointer' : ''}`}
    >
      <span className="w-10 shrink-0 pr-2 text-right text-[10.5px] text-slate-300 select-none">{lineNo}</span>
      <span className={`min-w-0 flex-1 pr-3 break-words whitespace-pre-wrap ${tone}`}>{pieces.length ? pieces : ' '}</span>
      {kind === 'unrecognized' && (
        <Tip content={seg?.note ?? ''} className="shrink-0 pr-2">
          <span className="rounded bg-block-bg px-1.5 font-sans text-[10px] font-medium text-block">não interpretado</span>
        </Tip>
      )}
      {kind === 'info' && (
        <Tip content={seg?.note ?? ''} className="shrink-0 pr-2">
          <span className="rounded bg-slate-100 px-1.5 font-sans text-[10px] font-medium text-slate-500">informativo</span>
        </Tip>
      )}
    </div>
  );
}
