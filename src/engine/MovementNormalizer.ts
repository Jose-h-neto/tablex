/**
 * Extração determinística de números, quantidades e períodos.
 * As funções recebem texto já normalizado por `fold`.
 */

export type QuantityUnit = 'horas' | 'aulas' | 'dias' | 'indefinida';

/** Número em formato brasileiro: "2.500,05", "2500,05", "13,5", "13.5", "500". */
export function parseBrNumber(raw: string): number | null {
  const s = raw.replace(/\s/g, '');
  if (!s) return null;
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) normalized = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(s)) normalized = s.replace(',', '.');
  else if (/^\d+\.\d{1,2}$/.test(s) || /^\d+$/.test(s)) normalized = s;
  else return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const MONEY_RE = /r\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/;
/** Valor sem "R$" com centavos obrigatórios: "106,42" (não confunde com "13,5 aulas"). */
const BARE_MONEY_RE = /(?<![\d/.,])(\d{1,3}(?:\.\d{3})*,\d{2})(?![\d/]|\s*(?:aulas?|horas?|h\b|dias?))/;

export function findMoney(folded: string): number | null {
  const m = MONEY_RE.exec(folded) ?? BARE_MONEY_RE.exec(folded);
  return m ? parseBrNumber(m[1] ?? '') : null;
}

export interface Quantity {
  value: number;
  unit: QuantityUnit;
}

export function unitFromWord(word: string): QuantityUnit {
  if (word.startsWith('aula')) return 'aulas';
  if (word.startsWith('dia') || word.startsWith('falta')) return 'dias';
  if (word.startsWith('h')) return 'horas';
  return 'indefinida';
}

const HM_RE = /(?<![\d:])(\d{1,3})\s*h\s*(\d{2})(?![\d:])/;
const QTY_RE = /(?<![\d/:,.])(\d+(?:[.,]\d+)?)\s*(aulas?|horas?|hotas?|hrs?|h(?![a-z0-9])|dias?|faltas?)/;

/** Primeira quantidade do trecho. "4h45" tem prioridade para não virar "45 horas". */
export function findQuantity(folded: string): Quantity | null {
  const hm = HM_RE.exec(folded);
  if (hm && Number(hm[2]) < 60) return { value: round2(Number(hm[1]) + Number(hm[2]) / 60), unit: 'horas' };
  const m = QTY_RE.exec(folded);
  const value = m ? parseBrNumber(m[1] ?? '') : null;
  return m && value !== null ? { value, unit: unitFromWord(m[2] ?? '') } : null;
}

/** Número solto (sem unidade e fora de datas e horários), ex.: "para 54". */
export function findBareNumber(folded: string): number | null {
  const m = /(?<![\d/:,.])(\d+(?:[.,]\d+)?)(?![\d/:])/.exec(folded);
  return m ? parseBrNumber(m[1] ?? '') : null;
}

/** Posição de cada data "dd/mm"; a barra colada antes é aceita ("09:30 /17/10"). */
export function findDateIndexes(folded: string): number[] {
  return [...folded.matchAll(/(?<!\d)(?<!\d\/)\d{1,2}\/\d{1,2}(?:\/(?:\d{4}|\d{2}))?(?![\d/])/g)].map((m) => m.index);
}

export interface DayCount {
  index: number;
  days: number;
}

/** Período "27/04 - 30/04": dias contados de forma inclusiva. */
export function findDayRange(folded: string, year: number): DayCount | null {
  const m = /(?<!\d)(?<!\d\/)(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\s*(?:-|a|ate|ao)\s*(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?(?![\d/])/.exec(folded);
  if (!m) return null;
  const from = Date.UTC(year, Number(m[2]) - 1, Number(m[1]));
  const to = Date.UTC(year, Number(m[4]) - 1, Number(m[3]));
  const days = Math.round((to - from) / 86_400_000) + 1;
  return days > 0 ? { index: m.index, days } : null;
}

export interface TimeInterval {
  index: number;
  length: number;
  hours: number;
}

/** Duração bruta de cada intervalo "06:00 as 12:00". Intervalos inválidos são ignorados. */
export function findTimeIntervals(folded: string): TimeInterval[] {
  const out: TimeInterval[] = [];
  for (const m of folded.matchAll(/(?<!\d)(\d{1,2})[:h](\d{2})\s*(?:as|a|-|ate)\s*(\d{1,2})[:h](\d{2})(?!\d)/g)) {
    const [h1, m1, h2, m2] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
    if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) continue;
    let minutes = h2 * 60 + m2 - (h1 * 60 + m1);
    if (minutes <= 0) minutes += 24 * 60;
    out.push({ index: m.index, length: m[0].length, hours: round2(minutes / 60) });
  }
  return out;
}

const MONTHS = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const RECURRENT_RE = new RegExp(
  `\\bate\\s+(?:o\\s+)?(?:(?:final|fim)\\s+(?:de\\s+|do\\s+mes\\s+de\\s+)?)?(?:${MONTHS})\\b|\\bate\\s+\\d{1,2}/\\d{4}\\b|\\b(?:deixar|manter|valor)\\s+fix[oa]\\b|\\bfixar\\b|\\bfixo\\b`,
);

/** "até dezembro", "até o final de dezembro", "até 12/2026", "deixar fixo". */
export function isRecurrent(folded: string): boolean {
  return RECURRENT_RE.test(folded);
}
