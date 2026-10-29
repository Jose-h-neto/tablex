import type { Competencia } from './types';

export const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** Mês (1–12) a partir do nome por extenso já sem acentos e em minúsculas. */
export function monthFromName(name: string): number | null {
  const i = MONTH_NAMES.indexOf(name as (typeof MONTH_NAMES)[number]);
  return i >= 0 ? i + 1 : null;
}

export function formatCompetencia(c: Competencia): string {
  return `${String(c.month).padStart(2, '0')}/${c.year}`;
}

export function competenciaKey(c: Competencia): string {
  return `${c.year}-${String(c.month).padStart(2, '0')}`;
}

export function sameCompetencia(a: Competencia, b: Competencia): boolean {
  return a.year === b.year && a.month === b.month;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function firstDayIso(c: Competencia): string {
  return toIsoDate(c.year, c.month, 1);
}

export function lastDayIso(c: Competencia): string {
  return toIsoDate(c.year, c.month, daysInMonth(c.year, c.month));
}

export function formatIsoBr(iso: string, withYear = true): string {
  const [y, m, d] = iso.split('-');
  return withYear ? `${d}/${m}/${y}` : `${d}/${m}`;
}

export function parseIso(iso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** "dd/mm/aaaa" → ISO, ou null se inválida. */
export function parseBrDate(text: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const iso = toIsoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return parseIso(iso) ? iso : null;
}

/** "mm/aaaa" ou "aaaa-mm" → competência. */
export function parseCompetencia(text: string): Competencia | null {
  const br = /^\s*(\d{1,2})\/(\d{4})\s*$/.exec(text);
  const iso = /^\s*(\d{4})-(\d{2})\s*$/.exec(text);
  const month = br ? Number(br[1]) : iso ? Number(iso[2]) : NaN;
  const year = br ? Number(br[2]) : iso ? Number(iso[1]) : NaN;
  if (!Number.isInteger(month) || month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return { year, month };
}

export function currentCompetencia(now = new Date()): Competencia {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** Diferença em meses (b - a). */
export function monthDiff(a: Competencia, b: Competencia): number {
  return (b.year - a.year) * 12 + (b.month - a.month);
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function weekdayShort(iso: string): string {
  const p = parseIso(iso);
  if (!p) return '';
  return WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] ?? '';
}
