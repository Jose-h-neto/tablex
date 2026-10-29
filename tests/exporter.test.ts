import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ImportSettings, type RubricDictionary } from '../src/domain/types';
import { resolveRows } from '../src/engine/MovementValidator';
import { processText } from '../src/engine/pipeline';
import { setMapping } from '../src/engine/RubricMapper';
import {
  prepareExport,
  TEMPLATE_COLUMNS,
  validateTemplate,
  verifyImportWorkbook,
  writeImportWorkbook,
} from '../src/export/ExcelExporter';
import { writePendingReport } from '../src/export/PendingReport';
import { MSG_FECHAMENTO, MSG_OUTUBRO } from '../src/sample/mensagensAnonimizadas';

const OUT = { year: 2026, month: 10 };
const buf = readFileSync(resolve(__dirname, '../src/assets/modelo_movimento_variavel.xlsx'));
const template = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const SETTINGS: ImportSettings = {
  ...DEFAULT_SETTINGS,
  companyCode: '15',
  movementDateRule: 'inicio',
  fixarSim: 'S',
  fixarNao: 'N',
  hourFormat: 'decimal',
  fillObservation: true,
};

function rowsFor(text: string, dict: RubricDictionary, settings = SETTINGS) {
  const p = processText(text, OUT);
  return {
    p,
    rows: resolveRows(p.movements, {
      messages: p.messages,
      settings,
      dictionary: dict,
      sessionCompetencia: OUT,
      review: { overrides: {}, acknowledged: {}, excluded: {} },
    }),
  };
}

async function readBack(file: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  return wb;
}

describe('modelo oficial', () => {
  it('é reconhecido como compatível', async () => {
    expect(await validateTemplate(template)).toEqual({ ok: true, errors: [] });
  });

  it('modelo com colunas diferentes é rejeitado', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Planilha1');
    ws.addRow(['Código empresa', 'Matrícula']);
    const bad = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const check = await validateTemplate(bad);
    expect(check.ok).toBe(false);
    expect(check.errors[0]).toMatch(/Coluna B/);
  });
});

describe('exportação', () => {
  const dict = setMapping(setMapping({}, 'DESC_MATERIAL_DIDATICO', '9001', 'x'), 'SUBST_HORAS', '0450', 'y');

  it('só exporta válidos e preserva a estrutura do modelo', async () => {
    const { rows } = rowsFor(MSG_FECHAMENTO, dict);
    const prepared = prepareExport(rows, SETTINGS);
    // 4 descontos de material + 1 substituição em horas; demais estão pendentes.
    expect(prepared.rows).toHaveLength(5);
    const file = await writeImportWorkbook(template, prepared.rows);
    const wb = await readBack(file);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Planilha1']);
    const ws = wb.getWorksheet('Planilha1')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([...TEMPLATE_COLUMNS]);
    expect(ws.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(ws.getColumn(9).width).toBeCloseTo(35.78, 1);

    const first = ws.getRow(2);
    expect(first.getCell(1).value).toBe(15);
    expect(first.getCell(2).value).toBe(509);
    expect(first.getCell(3).value).toBe(9001);
    expect(first.getCell(4).value).toBe(705.1);
    expect(first.getCell(4).numFmt).toBe('0.00');
    expect((first.getCell(5).value as Date).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(first.getCell(5).numFmt).toBe('mm-dd-yy');
    expect(first.getCell(6).value).toBe('N');
    expect(String(first.getCell(7).value)).toContain('Desconto material didático');
    for (let c = 8; c <= 12; c++) expect(first.getCell(c).value).toBeNull();

    // Código com zero à esquerda permanece texto.
    const subst = ws.getRow(6);
    expect(subst.getCell(3).value).toBe('0450');

    expect(await verifyImportWorkbook(file, prepared.rows)).toEqual({ ok: true, rows: 5, errors: [] });
  });

  it('com a configuração padrão, reproduz o preenchimento da planilha real', async () => {
    // Planilha real 09/2026: empresa/matrícula/rubrica numéricas, valor "0.00", data no 1º dia,
    // "Fixar valor?" e "Observação" vazias, colunas H–L vazias.
    const settings: ImportSettings = { ...DEFAULT_SETTINGS, companyCode: '12345' };
    const d = setMapping({}, 'DESC_SINDICATO', '153', 'x');
    const { rows } = rowsFor('Beto\nbom dia\n\nDescontos:\n509 - IGOR EXEMPLO DIAS - R$ 80,50 - desconto sindicato', d, settings);
    const prepared = prepareExport(rows, settings);
    const wb = await readBack(await writeImportWorkbook(template, prepared.rows));
    const values = (wb.getWorksheet('Planilha1')!.getRow(2).values as unknown[]).slice(1);
    expect(values.slice(0, 4)).toEqual([12345, 509, 153, 80.5]);
    expect((values[4] as Date).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(values.slice(5).every((v) => v === undefined || v === null)).toBe(true);
  });

  it('converte horas para o formato sexagesimal quando configurado', () => {
    const { rows } = rowsFor(MSG_OUTUBRO, setMapping({}, 'SUBST_HORAS', '450', 'x'), { ...SETTINGS, hourFormat: 'sexagesimal' });
    const prepared = prepareExport(rows, { ...SETTINGS, hourFormat: 'sexagesimal' });
    expect(prepared.rows.map((r) => r.amount)).toEqual([5, 10, 4.45]);
  });

  it('consolida lançamentos iguais quando a opção está ativa', () => {
    const d = setMapping({}, 'HORA_EXTRA', '300', 'x');
    const { rows } = rowsFor(MSG_OUTUBRO, d);
    const ack = rows.map((r) => (r.m.categoryKey === 'HORA_EXTRA' ? { ...r, status: 'valido' as const, exportable: true } : r));
    const prepared = prepareExport(ack, { ...SETTINGS, consolidate: true });
    const wanda = prepared.rows.filter((r) => r.matricula === '522');
    expect(wanda).toHaveLength(1);
    expect(wanda[0]!.amount).toBe(13.5);
  });

  it('a verificação detecta divergências', async () => {
    const { rows } = rowsFor(MSG_FECHAMENTO, dict);
    const prepared = prepareExport(rows, SETTINGS);
    const file = await writeImportWorkbook(template, prepared.rows);
    const tampered = prepared.rows.map((r, i) => (i === 0 ? { ...r, amount: 1 } : r));
    const v = await verifyImportWorkbook(file, tampered);
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/Linha 2: valor/);
  });

  it('relatório de pendências lista o que não foi exportado e as linhas não processadas', async () => {
    const { rows, p } = rowsFor(MSG_FECHAMENTO + '\nobservação solta sem matrícula', dict);
    const file = await writePendingReport(rows, p.segments, p.messages, new Set());
    const wb = await readBack(file);
    const ws = wb.getWorksheet('Pendências')!;
    const situacoes = ws.getColumn(1).values.slice(2).map(String);
    expect(situacoes).toContain('Bloqueado');
    expect(situacoes).toContain('Não processado');
    expect(situacoes).not.toContain('Válido');
  });
});
