import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { IssueCode, ResolvedRow, Segment, Status } from '../domain/types';
import {
  checkConfig,
  countRows,
  groupIssues,
  isAcknowledgeable,
  resolveRows,
  type ConfigIssue,
  type Counters,
  type IssueGroup,
} from '../engine/MovementValidator';
import type { ProcessResult } from '../engine/pipeline';
import { useApp } from './store';

export interface Derived {
  result: ProcessResult;
  rows: ResolvedRow[];
  byId: Map<string, ResolvedRow>;
  groups: IssueGroup[];
  counters: Counters;
  config: ConfigIssue[];
  msgNumber: Map<string, number>;
  /** Lançamentos ligados a cada segmento (linha) da mensagem original. */
  bySegment: Map<string, string[]>;
  /** Pendências de atenção ainda não confirmadas, por lançamento. */
  openAttention: Map<string, IssueCode[]>;
  unrecognized: Segment[];
}

const DerivedContext = createContext<Derived | null>(null);

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

export function DerivedProvider({ children }: { children: ReactNode }) {
  const { result, review, settings, dictionary, sessionCompetencia } = useApp(
    useShallow((s) => ({
      result: s.result,
      review: s.review,
      settings: s.settings,
      dictionary: s.dictionary,
      sessionCompetencia: s.sessionCompetencia,
    })),
  );

  const value = useMemo<Derived | null>(() => {
    if (!result) return null;
    const rows = resolveRows(result.movements, { messages: result.messages, settings, dictionary, sessionCompetencia, review });
    const bySegment = new Map<string, string[]>();
    for (const seg of result.segments) {
      const ids = rows.filter((r) => overlaps(r.m.fragmentSpan, seg.span) || r.m.segmentId === seg.id).map((r) => r.m.id);
      if (ids.length) bySegment.set(seg.id, ids);
    }
    const openAttention = new Map<string, IssueCode[]>();
    for (const r of rows) {
      const codes = r.issues.filter((i) => isAcknowledgeable(i.code) && !i.acknowledged).map((i) => i.code);
      if (codes.length) openAttention.set(r.m.id, codes);
    }
    return {
      result,
      rows,
      byId: new Map(rows.map((r) => [r.m.id, r])),
      groups: groupIssues(rows),
      counters: countRows(rows),
      config: checkConfig(settings, rows),
      msgNumber: new Map(result.messages.map((m) => [m.id, m.index + 1])),
      bySegment,
      openAttention,
      unrecognized: result.segments.filter((s) => s.kind === 'unrecognized'),
    };
  }, [result, review, settings, dictionary, sessionCompetencia]);

  return <DerivedContext.Provider value={value}>{children}</DerivedContext.Provider>;
}

export function useDerived(): Derived | null {
  return useContext(DerivedContext);
}

export type RowState = Status | 'excluido';

export function rowState(r: ResolvedRow): RowState {
  return r.exclusion ? 'excluido' : r.status;
}

const RANK: Record<RowState, number> = { bloqueado: 3, atencao: 2, valido: 1, excluido: 0 };

export function worstState(rows: ResolvedRow[]): RowState | null {
  if (rows.length === 0) return null;
  return rows.map(rowState).reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
}
