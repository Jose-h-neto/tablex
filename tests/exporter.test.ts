import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { blankRow, type SheetRow } from '../src/engine/sheet';
import { TEMPLATE_COLUMNS, writeImportWorkbook } from '../src/export/ExcelExporter';

const buf = readFileSync(resolve(__dirname, '../src/assets/modelo_movimento_variavel.xlsx'));
const template = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

const row = (over: Partial<SheetRow>): SheetRow => ({ ...blankRow('1', 1), ...over });

async function write(rows: SheetRow[]) {
  const file = await writeImportWorkbook(template, rows);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  return wb;
}

describe('exportação', () => {
  it('preserva aba, cabeçalho e formatação do modelo', async () => {
    const wb = await write([row({ matricula: '509' })]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Planilha1']);
    const ws = wb.getWorksheet('Planilha1')!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual([...TEMPLATE_COLUMNS]);
    expect(ws.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(ws.getColumn(9).width).toBeCloseTo(35.78, 1);
  });

  it('grava como na planilha real: códigos numéricos, valor 0.00, data real', async () => {
    const wb = await write([row({ empresa: '12345', matricula: '509', rubrica: '153', valor: '80,50', data: '01/10/2026' })]);
    const r = wb.getWorksheet('Planilha1')!.getRow(2);
    expect(r.getCell(1).value).toBe(12345);
    expect(r.getCell(2).value).toBe(509);
    expect(r.getCell(3).value).toBe(153);
    expect(r.getCell(4).value).toBe(80.5);
    expect(r.getCell(4).numFmt).toBe('0.00');
    expect((r.getCell(5).value as Date).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(r.getCell(5).numFmt).toBe('mm-dd-yy');
  });

  it('o que está vazio na tela fica vazio no arquivo', async () => {
    const wb = await write([row({ matricula: '509', valor: '10,00' })]);
    const r = wb.getWorksheet('Planilha1')!.getRow(2);
    for (const c of [1, 3, 5, 6, 7, 8, 9, 10, 11, 12]) expect(r.getCell(c).value).toBeNull();
  });

  it('mantém código com zero à esquerda e texto digitado', async () => {
    const wb = await write([row({ matricula: '509', rubrica: '0450', valor: 'ver', data: 'a definir', fixar: 'S', observacao: 'nota' })]);
    const r = wb.getWorksheet('Planilha1')!.getRow(2);
    expect(r.getCell(3).value).toBe('0450');
    expect(r.getCell(4).value).toBe('ver');
    expect(r.getCell(5).value).toBe('a definir');
    expect(r.getCell(6).value).toBe('S');
    expect(r.getCell(7).value).toBe('nota');
  });

  it('recusa modelo com colunas diferentes', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Planilha1').addRow(['Código empresa', 'Matrícula']);
    const bad = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    await expect(writeImportWorkbook(bad, [])).rejects.toThrow(/colunas/);
  });
});
