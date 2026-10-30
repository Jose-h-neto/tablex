import ExcelJS from 'exceljs';
import { parseBrDate } from '../domain/competencia';
import { parseBrNumber } from '../engine/MovementNormalizer';
import type { SheetRow } from '../engine/sheet';

/** Estrutura do modelo oficial (movimento_variavel_imp.xlsx). */
export const TEMPLATE_SHEET = 'Planilha1';
export const TEMPLATE_COLUMNS = [
  'Código empresa',
  'Matricula',
  'Código da Rubrica',
  'Quantidade/Valor',
  'Data do movimento',
  'Fixar valor?',
  'Observação',
  'CPF do pensionista',
  'Código da administradora de benefícios',
  'Código do produto do benefícios',
  'Item do produto do benefício',
  'Data demissão',
] as const;

/** Código numérico vira número (como na planilha real); zero à esquerda ou texto ficam como estão. */
function codeCell(s: string): string | number | null {
  const v = s.trim();
  if (!v) return null;
  return /^[1-9]\d{0,14}$/.test(v) ? Number(v) : v;
}

/** Preenche o modelo oficial a partir da linha 2. O que está vazio na tela fica vazio no arquivo. */
export async function writeImportWorkbook(template: ArrayBuffer, rows: SheetRow[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template);
  const ws = wb.getWorksheet(TEMPLATE_SHEET);
  const header = ws ? TEMPLATE_COLUMNS.map((_, i) => String(ws.getRow(1).getCell(i + 1).value ?? '').trim()) : [];
  if (!ws || TEMPLATE_COLUMNS.some((c, i) => header[i] !== c)) throw new Error('O modelo de importação não tem as colunas esperadas.');
  if (ws.rowCount > 1) ws.spliceRows(2, ws.rowCount - 1);

  rows.forEach((r, i) => {
    const row = ws.getRow(i + 2);
    row.getCell(1).value = codeCell(r.empresa);
    row.getCell(2).value = codeCell(r.matricula);
    row.getCell(3).value = codeCell(r.rubrica);
    // Formatos da planilha real: "0.00" no valor e data curta (formato interno 14 do Excel).
    const amount = row.getCell(4);
    amount.value = parseBrNumber(r.valor) ?? (r.valor.trim() || null);
    amount.numFmt = '0.00';
    const date = row.getCell(5);
    date.value = parseBrDate(r.data) ?? (r.data.trim() || null);
    date.numFmt = 'mm-dd-yy';
    row.getCell(6).value = r.fixar.trim() || null;
    row.getCell(7).value = r.observacao.trim() || null;
  });
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
