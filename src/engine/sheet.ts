import { isImportable } from '../domain/categories';
import { currentCompetencia, firstDayBr, type Competencia } from '../domain/competencia';
import { parseMessages } from './MessageParser';
import { classifyEntry } from './MovementClassifier';
import { collapseSpaces, fold } from './text';

/** Uma linha da planilha, como aparece na tela. Campo não informado fica vazio. */
export interface SheetRow {
  id: string;
  /** Posição na mensagem: mantém a ordem ao recolocar linhas. */
  order: number;
  empresa: string;
  matricula: string;
  rubrica: string;
  valor: string;
  data: string;
  fixar: string;
  observacao: string;
  /** Trecho da mensagem, só para consulta: não vai para o arquivo. */
  origem: string;
  /** Linha da mensagem que originou o lançamento (-1 se adicionada à mão). */
  line: number;
  categoryKey: string | null;
  fixo: boolean;
}

export type EditableField = 'empresa' | 'matricula' | 'rubrica' | 'valor' | 'data' | 'fixar' | 'observacao';

/** O que o app lembra entre usos, aprendido com o que o usuário digita na tabela. */
export interface Memory {
  empresa: string;
  fixarSim: string;
  rubricas: Record<string, string>;
}

/** Único código documentado em arquivo real (planilha de 09/2026). */
export const EMPTY_MEMORY: Memory = { empresa: '', fixarSim: '', rubricas: { DESC_SINDICATO: '153' } };

export interface Sheet {
  rows: SheetRow[];
  /** Linhas repetidas entre mensagens: fora da tabela, mas recuperáveis. */
  removed: SheetRow[];
  competencia: Competencia;
}

export function formatValor(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

/** Competência mais recente citada nas mensagens. */
function latest(list: (Competencia | null)[]): Competencia | null {
  let best: Competencia | null = null;
  for (const c of list) if (c && (!best || c.year * 12 + c.month > best.year * 12 + best.month)) best = c;
  return best;
}

export function blankRow(id: string, order: number, origem = '', line = -1): SheetRow {
  return { id, order, empresa: '', matricula: '', rubrica: '', valor: '', data: '', fixar: '', observacao: '', origem, line, categoryKey: null, fixo: false };
}

/** Monta a planilha inteira de uma vez a partir do texto colado. */
export function buildSheet(raw: string, memory: Memory, now = new Date()): Sheet {
  const { competencias, entries, loose } = parseMessages(raw);
  const competencia = latest(competencias) ?? currentCompetencia(now);
  const rows: SheetRow[] = [];
  const removed: SheetRow[] = [];
  const seen = new Map<string, number>();

  const place = (row: SheetRow, messageIndex: number, key: string) => {
    const first = seen.get(key);
    if (first !== undefined && first !== messageIndex) removed.push(row);
    else {
      seen.set(key, messageIndex);
      rows.push(row);
    }
  };

  for (const entry of entries) {
    const comp = competencias[entry.messageIndex] ?? competencia;
    classifyEntry(entry, comp.year).forEach((m, n) => {
      const importable = isImportable(m.categoryKey);
      const row = blankRow(`${entry.line}.${n}`, entry.line + n / 100, [m.name, m.source].filter(Boolean).join(' — '), m.line);
      row.matricula = m.matricula;
      row.categoryKey = m.categoryKey;
      row.fixo = m.fixo;
      if (importable) {
        row.empresa = memory.empresa;
        row.rubrica = m.rubrica ?? memory.rubricas[m.categoryKey] ?? '';
        row.valor = m.amount === null ? '' : formatValor(m.amount);
        row.data = firstDayBr(comp);
        row.fixar = m.fixo ? memory.fixarSim : '';
      }
      const key = [comp.year, comp.month, m.matricula, m.categoryKey, m.amount, collapseSpaces(fold(m.source))].join('|');
      place(row, m.messageIndex, key);
    });
  }
  for (const l of loose) place(blankRow(`l${l.line}`, l.line, l.text, l.line), l.messageIndex, `solta|${collapseSpaces(fold(l.text))}`);

  rows.sort((a, b) => a.order - b.order);
  return { rows, removed, competencia };
}

/** Linha sem rubrica e sem valor não é um lançamento: fica só na tela. */
export function isExportable(r: SheetRow): boolean {
  return r.rubrica.trim() !== '' || r.valor.trim() !== '';
}

/**
 * Aplica a edição de uma célula. Empresa acompanha todos os lançamentos e "fixar", as linhas fixas.
 * Rubrica só preenche as linhas vazias do mesmo tipo: assim uma linha pode ter código próprio
 * (ex.: hora extra 100%), e o código só é lembrado quando todas as linhas do tipo o usam.
 */
export function applyEdit(rows: SheetRow[], memory: Memory, id: string, field: EditableField, value: string): { rows: SheetRow[]; memory: Memory } {
  const target = rows.find((r) => r.id === id);
  if (!target) return { rows, memory };
  const old = target[field];
  const follows = (r: SheetRow) => {
    if (r.id === id) return true;
    if (field === 'rubrica') return r.rubrica === '' && target.categoryKey !== null && r.categoryKey === target.categoryKey;
    if (r[field] !== '' && r[field] !== old) return false;
    if (field === 'empresa') return r.data !== '' || r.rubrica !== '' || r.valor !== '';
    if (field === 'fixar') return target.fixo && r.fixo;
    return false;
  };
  const next = rows.map((r) => (follows(r) ? { ...r, [field]: value } : r));

  let learned = memory;
  if (field === 'empresa') learned = { ...memory, empresa: value };
  else if (field === 'fixar' && target.fixo) learned = { ...memory, fixarSim: value };
  else if (
    field === 'rubrica' &&
    target.categoryKey &&
    !target.categoryKey.startsWith('RUBRICA:') &&
    isImportable(target.categoryKey) &&
    next.every((r) => r.categoryKey !== target.categoryKey || r.rubrica === value)
  ) {
    const rubricas = { ...memory.rubricas };
    if (value) rubricas[target.categoryKey] = value;
    else delete rubricas[target.categoryKey];
    learned = { ...memory, rubricas };
  }
  return { rows: next, memory: learned };
}
