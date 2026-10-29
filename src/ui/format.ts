import type { Severity, Unit } from '../domain/types';
import type { RowState } from '../state/derived';

export const UNIT_LABEL: Record<Unit, string> = {
  valor: 'R$',
  horas: 'h',
  aulas: 'aulas',
  dias: 'dias',
  indefinida: '?',
};

export const UNIT_OPTIONS: Unit[] = ['valor', 'horas', 'aulas', 'dias', 'indefinida'];

export function formatAmount(n: number | null, unit: Unit): string {
  if (n === null) return '—';
  if (unit === 'valor') return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export function formatAmountInput(n: number | null): string {
  return n === null ? '' : String(n).replace('.', ',');
}

/** Aceita "1.234,56", "1234,56", "1234.56", "4h45". */
export function parseAmountInput(raw: string): number | null | 'invalid' {
  const s = raw.trim().replace(/^r\$\s*/i, '');
  if (!s) return null;
  const hm = /^(\d{1,3})h(\d{2})$/i.exec(s);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  let norm = s;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) norm = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(s)) norm = s.replace(',', '.');
  else if (!/^\d+(\.\d+)?$/.test(s)) return 'invalid';
  const n = Number(norm);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 'invalid';
}

export const STATE_LABEL: Record<RowState, string> = {
  valido: 'Válido',
  atencao: 'Atenção',
  bloqueado: 'Bloqueado',
  excluido: 'Excluído',
};

export const STATE_TEXT: Record<RowState, string> = {
  valido: 'text-ok',
  atencao: 'text-warn',
  bloqueado: 'text-block',
  excluido: 'text-slate-400',
};

export const STATE_DOT: Record<RowState, string> = {
  valido: 'bg-ok',
  atencao: 'bg-warn',
  bloqueado: 'bg-block',
  excluido: 'bg-slate-300',
};

export const STATE_BORDER: Record<RowState, string> = {
  valido: 'border-l-ok',
  atencao: 'border-l-warn',
  bloqueado: 'border-l-block',
  excluido: 'border-l-slate-300',
};

export const STATE_UNDERLINE: Record<RowState, string> = {
  valido: 'decoration-ok/60',
  atencao: 'decoration-warn/70',
  bloqueado: 'decoration-block/70',
  excluido: 'decoration-slate-300',
};

export const SEVERITY_TEXT: Record<Severity, string> = {
  bloqueio: 'text-block',
  atencao: 'text-warn',
  info: 'text-slate-500',
};

export const SEVERITY_DOT: Record<Severity, string> = {
  bloqueio: 'bg-block',
  atencao: 'bg-warn',
  info: 'bg-slate-400',
};

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}
