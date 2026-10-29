import { daysInMonth, monthFromName, MONTH_NAMES, parseIso, toIsoDate } from '../domain/competencia';
import type { Competencia, Unit } from '../domain/types';

/**
 * Normalização determinística de números, datas, horários e unidades.
 * Todas as funções recebem texto já "dobrado" (fold): minúsculas e sem acentos.
 */

/** Número em formato brasileiro: "1.234,56", "2500,00", "13,5", "13.5", "500". */
export function parseBrNumber(raw: string): number | null {
  const s = raw.replace(/\s/g, '');
  if (!s) return null;
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) normalized = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(s)) normalized = s.replace(',', '.');
  else if (/^\d+\.\d{1,2}$/.test(s)) normalized = s;
  else if (/^\d+$/.test(s)) normalized = s;
  else return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface Match<T> {
  value: T;
  index: number;
  length: number;
}

const MONEY_RE = /r\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/g;
/** Valor sem "R$" com centavos obrigatórios: "106,42" (não confunde com "13,5 aulas"). */
const BARE_MONEY_RE = /(?<![\d/.,])(\d{1,3}(?:\.\d{3})*,\d{2})(?![\d/]|\s*(?:aulas?|horas?|h\b|dias?))/g;

export function findMoney(folded: string, allowBare = false): Match<number>[] {
  const out: Match<number>[] = [];
  for (const m of folded.matchAll(MONEY_RE)) {
    const v = parseBrNumber(m[1] ?? '');
    if (v !== null) out.push({ value: v, index: m.index, length: m[0].length });
  }
  if (out.length === 0 && allowBare) {
    for (const m of folded.matchAll(BARE_MONEY_RE)) {
      const v = parseBrNumber(m[1] ?? '');
      if (v !== null) out.push({ value: v, index: m.index, length: m[0].length });
    }
  }
  return out;
}

export interface Quantity {
  value: number;
  unit: Unit;
  /** Palavra original da unidade, para explicar inferências ("falta" → dias). */
  unitWord: string;
  /** Minutos informados no formato 4h45 (para conversão sexagesimal na exportação). */
  hoursMinutes: { h: number; m: number } | null;
}

const UNIT_WORD = '(aulas?|horas?|hotas?|horsa|hrs?|h(?![a-z0-9])|dias?|faltas?)';
const HM_RE = /(?<![\d:])(\d{1,3})\s*h\s*(\d{2})(?:\s*min)?(?:\s*(?:horas?|hotas?|hrs?))?(?![\d:])/g;
const QTY_RE = new RegExp(`(?<![\\d/:,.])(\\d+(?:[.,]\\d+)?)\\s*${UNIT_WORD}`, 'g');

export function unitFromWord(word: string): Unit {
  if (word.startsWith('aula')) return 'aulas';
  if (word.startsWith('dia') || word.startsWith('falta')) return 'dias';
  if (word.startsWith('h')) return 'horas';
  return 'indefinida';
}

export function findQuantities(folded: string): Match<Quantity>[] {
  const out: Match<Quantity>[] = [];
  const taken: [number, number][] = [];
  for (const m of folded.matchAll(HM_RE)) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (min >= 60) continue;
    out.push({
      value: { value: round2(h + min / 60), unit: 'horas', unitWord: 'h', hoursMinutes: { h, m: min } },
      index: m.index,
      length: m[0].length,
    });
    taken.push([m.index, m.index + m[0].length]);
  }
  for (const m of folded.matchAll(QTY_RE)) {
    const overlaps = taken.some(([a, b]) => m.index < b && m.index + m[0].length > a);
    if (overlaps) continue;
    const v = parseBrNumber(m[1] ?? '');
    const word = m[2] ?? '';
    if (v === null) continue;
    out.push({
      value: { value: v, unit: unitFromWord(word), unitWord: word, hoursMinutes: null },
      index: m.index,
      length: m[0].length,
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Número solto (sem unidade), ex.: "Acrescentar 13,5". */
export function findBareNumber(folded: string): Match<number> | null {
  const m = /(?<![\d/:,.])(\d+(?:[.,]\d+)?)(?![\d/:])/.exec(folded);
  if (!m) return null;
  const v = parseBrNumber(m[1] ?? '');
  return v === null ? null : { value: v, index: m.index, length: m[0].length };
}

/**
 * Resolve o ano de uma data sem ano a partir da competência:
 * datas muito à frente da competência pertencem ao ano anterior (ex.: 15/12 na folha 01/2027).
 */
export function resolveDate(day: number, month: number, year: number | null, comp: Competencia): string | null {
  if (month < 1 || month > 12) return null;
  let y = year;
  if (y !== null && y < 100) y += 2000;
  if (y === null) {
    y = comp.year;
    if (month - comp.month > 2) y -= 1;
    else if (comp.month - month > 9) y += 1;
  }
  if (day < 1 || day > daysInMonth(y, month)) return null;
  return toIsoDate(y, month, day);
}

/** A barra colada antes da data é aceita ("09:30 /17/10"), mas não o meio de outra data. */
const DATE_RE = /(?<!\d)(?<!\d\/)(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g;

export interface DateMatch {
  iso: string | null;
  raw: string;
}

export function findDates(folded: string, comp: Competencia): Match<DateMatch>[] {
  const out: Match<DateMatch>[] = [];
  for (const m of folded.matchAll(DATE_RE)) {
    const iso = resolveDate(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, comp);
    out.push({ value: { iso, raw: m[0] }, index: m.index, length: m[0].length });
  }
  return out;
}

const RANGE_RE =
  /(?<!\d)(?<!\d\/)(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*(?:-|a|ate|ao)\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?![\d/])/g;

export interface DateRange {
  from: string;
  to: string;
  days: number;
}

export function findDateRanges(folded: string, comp: Competencia): Match<DateRange | null>[] {
  const out: Match<DateRange | null>[] = [];
  for (const m of folded.matchAll(RANGE_RE)) {
    const [a] = findDates(m[1] ?? '', comp);
    const [b] = findDates(m[2] ?? '', comp);
    const from = a?.value.iso;
    const to = b?.value.iso;
    if (!from || !to) {
      out.push({ value: null, index: m.index, length: m[0].length });
      continue;
    }
    const pa = parseIso(from)!;
    const pb = parseIso(to)!;
    const days = Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000) + 1;
    out.push({ value: days > 0 ? { from, to, days } : null, index: m.index, length: m[0].length });
  }
  return out;
}

export interface TimeInterval {
  start: string;
  end: string;
  hours: number;
  overnight: boolean;
}

const INTERVAL_RE = /(?<!\d)(\d{1,2})[:h](\d{2})\s*(?:as|a|-|ate)\s*(\d{1,2})[:h](\d{2})(?!\d)/g;

export function findTimeIntervals(folded: string): Match<TimeInterval | null>[] {
  const out: Match<TimeInterval | null>[] = [];
  for (const m of folded.matchAll(INTERVAL_RE)) {
    const h1 = Number(m[1]);
    const m1 = Number(m[2]);
    const h2 = Number(m[3]);
    const m2 = Number(m[4]);
    if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) {
      out.push({ value: null, index: m.index, length: m[0].length });
      continue;
    }
    let minutes = h2 * 60 + m2 - (h1 * 60 + m1);
    const overnight = minutes <= 0;
    if (overnight) minutes += 24 * 60;
    out.push({
      value: {
        start: `${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')}`,
        end: `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}`,
        hours: round2(minutes / 60),
        overnight,
      },
      index: m.index,
      length: m[0].length,
    });
  }
  return out;
}

const MONTH_RE = new RegExp(`\\b(${MONTH_NAMES.join('|')})\\b`, 'g');

export function findMonthNames(folded: string): Match<number>[] {
  const out: Match<number>[] = [];
  for (const m of folded.matchAll(MONTH_RE)) {
    const v = monthFromName(m[1] ?? '');
    if (v !== null) out.push({ value: v, index: m.index, length: m[0].length });
  }
  return out;
}

/** "até dezembro", "até o final de dezembro", "até 12/2026", "deixar fixo". */
export function findRecurrence(
  folded: string,
  comp: Competencia,
): { untilMonth: number | null; untilYear: number | null } | null {
  const byName = new RegExp(`\\bate\\s+(?:o\\s+)?(?:(?:final|fim)\\s+(?:de\\s+|do\\s+mes\\s+de\\s+)?)?(${MONTH_NAMES.join('|')})\\b`).exec(
    folded,
  );
  if (byName) {
    const month = monthFromName(byName[1] ?? '')!;
    return { untilMonth: month, untilYear: month >= comp.month ? comp.year : comp.year + 1 };
  }
  const byNum = /\bate\s+(\d{1,2})\/(\d{4})\b/.exec(folded);
  if (byNum) return { untilMonth: Number(byNum[1]), untilYear: Number(byNum[2]) };
  if (/\b(deixar|manter|valor)\s+fix[oa]\b|\bfixar\b|\bfixo\b/.test(folded)) return { untilMonth: null, untilYear: null };
  return null;
}

/** Conversão de horas decimais para o formato sexagesimal usado por alguns sistemas (4,75 → 4,45). */
export function toSexagesimal(hours: number): number {
  const h = Math.floor(hours + 1e-9);
  const m = Math.round((hours - h) * 60);
  return m === 60 ? h + 1 : round2(h + m / 100);
}
