import templateUrl from '../assets/modelo_movimento_variavel.xlsx?url';
import { competenciaKey } from '../domain/competencia';
import type { Derived } from '../state/derived';
import { useApp, type ExportRecord } from '../state/store';

let defaultTemplate: ArrayBuffer | null = null;

/** Modelo oficial embutido na aplicação (carregado localmente, sem rede externa). */
export async function loadDefaultTemplate(): Promise<ArrayBuffer> {
  if (defaultTemplate) return defaultTemplate.slice(0);
  const res = await fetch(templateUrl);
  if (!res.ok) throw new Error('Modelo padrão não encontrado.');
  defaultTemplate = await res.arrayBuffer();
  return defaultTemplate.slice(0);
}

export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]+/g, '') || 'empresa';
}

export async function exportImportFile(d: Derived): Promise<ExportRecord> {
  // ExcelJS é carregado sob demanda para manter a abertura da aplicação rápida.
  const { prepareExport, verifyImportWorkbook, writeImportWorkbook } = await import('../export/ExcelExporter');
  const s = useApp.getState();
  const template = s.customTemplate ? s.customTemplate.buffer.slice(0) : await loadDefaultTemplate();
  const prepared = prepareExport(d.rows, s.settings);
  if (prepared.rows.length === 0) throw new Error('Nenhum lançamento válido para exportar.');
  const file = await writeImportWorkbook(template, prepared.rows);
  const verification = await verifyImportWorkbook(file, prepared.rows);
  const fileName = `movimento_variavel_imp_${safe(s.settings.companyCode)}_${competenciaKey(s.sessionCompetencia)}.xlsx`;
  if (!verification.ok) {
    throw new Error(`O arquivo gerado não passou na verificação e não foi baixado: ${verification.errors.slice(0, 3).join(' ')}`);
  }
  downloadBytes(file, fileName);
  const record: ExportRecord = {
    ids: new Set(prepared.sourceIds.flat()),
    fileName,
    rows: prepared.rows.length,
    verified: verification.ok,
    errors: verification.errors,
    at: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    version: s.version,
  };
  s.setExported(record);
  return record;
}

export async function exportPendingReport(d: Derived): Promise<void> {
  const { writePendingReport } = await import('../export/PendingReport');
  const s = useApp.getState();
  const file = await writePendingReport(d.rows, d.result.segments, d.result.messages, s.exported?.ids ?? new Set());
  downloadBytes(file, `pendencias_${competenciaKey(s.sessionCompetencia)}.xlsx`);
}
