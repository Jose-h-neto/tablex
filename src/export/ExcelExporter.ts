import ExcelJS from 'exceljs';
import { z } from 'zod';
import { formatIsoBr, parseIso } from '../domain/competencia';
import type { ImportSettings, ResolvedRow } from '../domain/types';
import { round2, toSexagesimal } from '../engine/MovementNormalizer';
import { RUBRIC_CODE_RE } from '../engine/RubricMapper';

import { TEMPLATE_COLUMNS, TEMPLATE_SHEET } from './template';

export { TEMPLATE_COLUMNS, TEMPLATE_SHEET };

export const ExportRowSchema = z.object({
  companyCode: z.string().trim().min(1),
  matricula: z.string().regex(/^\d{1,10}$/),
  rubricCode: z.string().regex(RUBRIC_CODE_RE),
  amount: z.number().finite().positive(),
  movementDate: z.string().refine((s) => parseIso(s) !== null, 'data inválida'),
  fixed: z.string().max(10),
  observation: z.string().max(500),
});
export type ExportRow = z.infer<typeof ExportRowSchema>;

export interface PreparedExport {
  rows: ExportRow[];
  /** Ids dos lançamentos que originaram cada linha (vários quando consolidado). */
  sourceIds: string[][];
}

export function prepareExport(rows: ResolvedRow[], settings: ImportSettings): PreparedExport {
  const items: { row: ExportRow; ids: string[] }[] = [];
  for (const r of rows) {
    if (!r.exportable || !r.matricula || !r.rubricCode || r.amount === null || !r.movementDate) continue;
    const amount = r.unit === 'horas' && settings.hourFormat === 'sexagesimal' ? toSexagesimal(r.amount) : round2(r.amount);
    const row = ExportRowSchema.parse({
      companyCode: settings.companyCode.trim(),
      matricula: r.matricula,
      rubricCode: r.rubricCode,
      amount,
      movementDate: r.movementDate,
      fixed: r.fixed ? settings.fixarSim.trim() : settings.fixarNao.trim(),
      observation: settings.fillObservation ? r.observation.replace(/\s+/g, ' ').trim().slice(0, 500) : '',
    });
    items.push({ row, ids: [r.m.id] });
  }
  if (!settings.consolidate) return { rows: items.map((i) => i.row), sourceIds: items.map((i) => i.ids) };

  // Consolidação opcional: soma lançamentos com mesma matrícula, rubrica, data e "fixar".
  // Horas sexagesimais são somadas a partir do valor decimal para não distorcer minutos.
  const groups = new Map<string, { row: ExportRow; ids: string[]; decimal: number; hours: boolean }>();
  for (const it of items) {
    const src = rows.find((r) => r.m.id === it.ids[0])!;
    const key = [it.row.matricula, it.row.rubricCode, it.row.movementDate, it.row.fixed].join('|');
    const g = groups.get(key);
    const hours = src.unit === 'horas' && settings.hourFormat === 'sexagesimal';
    if (!g) {
      groups.set(key, { row: { ...it.row }, ids: [...it.ids], decimal: src.amount ?? 0, hours });
      continue;
    }
    g.ids.push(...it.ids);
    g.decimal += src.amount ?? 0;
    g.row.amount = g.hours ? toSexagesimal(g.decimal) : round2(g.decimal);
    g.row.observation = `${g.row.observation}; ${it.row.observation}`.slice(0, 500);
  }
  const list = [...groups.values()];
  return { rows: list.map((g) => g.row), sourceIds: list.map((g) => g.ids) };
}

/* ---------- Modelo ---------- */

export interface TemplateCheck {
  ok: boolean;
  errors: string[];
}

function headerOf(ws: ExcelJS.Worksheet): string[] {
  const row = ws.getRow(1);
  return Array.from({ length: Math.max(TEMPLATE_COLUMNS.length, row.cellCount) }, (_, i) => {
    const v = row.getCell(i + 1).value;
    return v === null || v === undefined ? '' : String(typeof v === 'object' && 'richText' in v ? v.richText.map((t) => t.text).join('') : v).trim();
  });
}

function checkHeader(ws: ExcelJS.Worksheet | undefined): string[] {
  if (!ws) return [`Aba “${TEMPLATE_SHEET}” não encontrada no modelo.`];
  const header = headerOf(ws);
  const errors: string[] = [];
  TEMPLATE_COLUMNS.forEach((col, i) => {
    if (header[i] !== col) errors.push(`Coluna ${String.fromCharCode(65 + i)}: esperado “${col}”, encontrado “${header[i] ?? ''}”.`);
  });
  header.slice(TEMPLATE_COLUMNS.length).forEach((extra, i) => {
    if (extra) errors.push(`Coluna extra ${String.fromCharCode(65 + TEMPLATE_COLUMNS.length + i)}: “${extra}”.`);
  });
  return errors;
}

export async function validateTemplate(template: ArrayBuffer): Promise<TemplateCheck> {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(template);
    const errors = checkHeader(wb.getWorksheet(TEMPLATE_SHEET));
    return { ok: errors.length === 0, errors };
  } catch (e) {
    return { ok: false, errors: [`Arquivo não pôde ser lido como XLSX: ${(e as Error).message}`] };
  }
}

/* ---------- Escrita ---------- */

function codeCell(s: string): string | number {
  // Números sem zero à esquerda viram número; os demais permanecem texto para não perder dígitos.
  return /^[1-9]\d{0,14}$/.test(s) ? Number(s) : s;
}

function dateCell(iso: string): Date {
  const p = parseIso(iso)!;
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

export async function writeImportWorkbook(template: ArrayBuffer, rows: ExportRow[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template);
  const ws = wb.getWorksheet(TEMPLATE_SHEET);
  const errors = checkHeader(ws);
  if (!ws || errors.length) throw new Error(`Modelo incompatível: ${errors.join(' ')}`);
  if (ws.rowCount > 1) ws.spliceRows(2, ws.rowCount - 1);

  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    row.getCell(1).value = codeCell(r.companyCode);
    row.getCell(2).value = codeCell(r.matricula);
    row.getCell(3).value = codeCell(r.rubricCode);
    // Formatos idênticos aos da planilha real: "0.00" no valor e data curta (formato interno 14 do Excel).
    const amount = row.getCell(4);
    amount.value = r.amount;
    amount.numFmt = '0.00';
    const date = row.getCell(5);
    date.value = dateCell(r.movementDate);
    date.numFmt = 'mm-dd-yy';
    row.getCell(6).value = r.fixed || null;
    row.getCell(7).value = r.observation || null;
  });
  const out = await wb.xlsx.writeBuffer();
  return new Uint8Array(out as ArrayBuffer);
}

/* ---------- Verificação do arquivo gerado ---------- */

export interface Verification {
  ok: boolean;
  rows: number;
  errors: string[];
}

export async function verifyImportWorkbook(file: Uint8Array, expected: ExportRow[]): Promise<Verification> {
  const errors: string[] = [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  if (wb.worksheets.length !== 1) errors.push(`Esperada 1 aba, encontradas ${wb.worksheets.length}.`);
  const ws = wb.getWorksheet(TEMPLATE_SHEET);
  errors.push(...checkHeader(ws));
  if (!ws) return { ok: false, rows: 0, errors };
  const dataRows = ws.actualRowCount - 1;
  if (dataRows !== expected.length) errors.push(`Linhas gravadas (${dataRows}) diferente do esperado (${expected.length}).`);
  expected.forEach((e, i) => {
    const row = ws.getRow(i + 2);
    const mat = String(row.getCell(2).value ?? '');
    const rub = String(row.getCell(3).value ?? '');
    const amt = Number(row.getCell(4).value);
    const dt = row.getCell(5).value;
    const iso = dt instanceof Date ? dt.toISOString().slice(0, 10) : '';
    if (mat !== e.matricula) errors.push(`Linha ${i + 2}: matrícula ${mat} ≠ ${e.matricula}.`);
    if (rub !== e.rubricCode) errors.push(`Linha ${i + 2}: rubrica ${rub} ≠ ${e.rubricCode}.`);
    if (Math.abs(amt - e.amount) > 1e-9) errors.push(`Linha ${i + 2}: valor ${amt} ≠ ${e.amount}.`);
    if (iso !== e.movementDate) errors.push(`Linha ${i + 2}: data ${iso ? formatIsoBr(iso) : '—'} ≠ ${formatIsoBr(e.movementDate)}.`);
  });
  return { ok: errors.length === 0, rows: Math.max(dataRows, 0), errors };
}
