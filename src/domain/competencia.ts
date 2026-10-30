export interface Competencia {
  year: number;
  month: number;
}

export function currentCompetencia(now = new Date()): Competencia {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function competenciaKey(c: Competencia): string {
  return `${c.year}-${String(c.month).padStart(2, '0')}`;
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

/** A planilha real usa o 1º dia da competência como data do movimento. */
export function firstDayBr(c: Competencia): string {
  return `01/${String(c.month).padStart(2, '0')}/${c.year}`;
}

/** "dd/mm/aaaa" → Date em UTC, ou null se não for uma data válida. */
export function parseBrDate(text: string): Date | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return date.getUTCDate() === Number(m[1]) && date.getUTCMonth() === Number(m[2]) - 1 ? date : null;
}
