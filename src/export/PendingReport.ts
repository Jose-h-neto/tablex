import ExcelJS from 'exceljs';
import type { ParsedMessage, ResolvedRow, Segment } from '../domain/types';

const STATUS_LABEL = { valido: 'Válido', atencao: 'Atenção', bloqueado: 'Bloqueado' } as const;
const EXCLUSION_LABEL = {
  duplicidade: 'Excluído — duplicidade',
  versao_substituida: 'Excluído — versão substituída',
  tratamento_manual: 'Tratamento manual',
  descartado: 'Excluído pelo usuário',
} as const;

/**
 * Relatório separado (não altera o modelo oficial) com tudo que NÃO entrou na exportação:
 * pendências, excluídos e linhas da mensagem que não foram processadas.
 */
export async function writePendingReport(
  rows: ResolvedRow[],
  segments: Segment[],
  messages: ParsedMessage[],
  exportedIds: Set<string>,
): Promise<Uint8Array> {
  const msgNumber = new Map(messages.map((m) => [m.id, m.index + 1]));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Pendências');
  ws.columns = [
    { header: 'Situação', key: 'situacao', width: 26 },
    { header: 'Pendências', key: 'pendencias', width: 70 },
    { header: 'Mensagem', key: 'msg', width: 10 },
    { header: 'Matrícula', key: 'matricula', width: 11 },
    { header: 'Funcionário', key: 'nome', width: 34 },
    { header: 'Tipo', key: 'tipo', width: 34 },
    { header: 'Qtd/Valor', key: 'valor', width: 12 },
    { header: 'Unidade', key: 'unidade', width: 10 },
    { header: 'Rubrica', key: 'rubrica', width: 10 },
    { header: 'Trecho original', key: 'trecho', width: 80 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    if (exportedIds.has(r.m.id) || (r.exportable && !r.exclusion)) continue;
    const open = r.issues.filter((i) => i.severity !== 'info' && !i.acknowledged);
    ws.addRow({
      situacao: r.exclusion ? EXCLUSION_LABEL[r.exclusion.reason] : STATUS_LABEL[r.status],
      pendencias: open.map((i) => i.message).join(' | ') || (r.exclusion?.note ?? ''),
      msg: msgNumber.get(r.m.messageId) ?? '',
      matricula: r.matricula ?? '',
      nome: r.m.employeeName ?? '',
      tipo: r.m.categoryLabel,
      valor: r.amount ?? '',
      unidade: r.unit,
      rubrica: r.rubricCode ?? '',
      trecho: r.m.sourceText,
    });
  }
  for (const s of segments) {
    if (s.kind !== 'unrecognized' && s.kind !== 'info') continue;
    ws.addRow({
      situacao: s.kind === 'info' ? 'Informativo (não processado)' : 'Não processado',
      pendencias: s.note ?? '',
      msg: msgNumber.get(s.messageId) ?? '',
      trecho: s.text.trim(),
    });
  }
  ws.autoFilter = { from: 'A1', to: 'J1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const out = await wb.xlsx.writeBuffer();
  return new Uint8Array(out as ArrayBuffer);
}
