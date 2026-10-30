import { formatCompetencia, formatIsoBr } from '../domain/competencia';
import type { Competencia, EmployeeEntry, Exclusion, Movement, ParsedMessage, Segment } from '../domain/types';
import { classifyEntry, type MovementDraft } from './MovementClassifier';
import { parseMessages } from './MessageParser';

export interface ProcessResult {
  text: string;
  messages: ParsedMessage[];
  segments: Segment[];
  entries: EmployeeEntry[];
  movements: Movement[];
}

/** Observação padrão: descrição + referências citadas (datas, meses, intervalos, recorrência). */
export function buildObservation(d: MovementDraft): string {
  const parts: string[] = [d.categoryLabel];
  if (d.details.length) parts.push(d.details.join(', '));
  else if (d.referenceDates.length) parts.push(`ref. ${d.referenceDates.map((x) => formatIsoBr(x, false)).join(', ')}`);
  if (d.referenceMonths.length) parts.push(`ref. ${d.referenceMonths.join('/')}`);
  if (d.recurrence) {
    parts.push(
      d.recurrence.untilMonth !== null && d.recurrence.untilYear !== null
        ? `fixo até ${formatCompetencia({ month: d.recurrence.untilMonth, year: d.recurrence.untilYear })}`
        : 'fixo',
    );
  }
  return parts.join(' — ').slice(0, 200);
}

/** Competência mais recente citada nas mensagens: dispensa o usuário de informá-la. */
export function detectCompetencia(messages: ParsedMessage[]): Competencia | null {
  let best: Competencia | null = null;
  for (const m of messages) {
    const c = m.competencia;
    if (c && (!best || c.year * 12 + c.month > best.year * 12 + best.month)) best = c;
  }
  return best;
}

/** Lançamentos de mensagens idênticas a uma anterior: ignorados de início, sempre visíveis em "Fora". */
export function repeatedMessageExclusions(result: ProcessResult): Record<string, Exclusion> {
  const repeated = new Set(result.messages.filter((m) => m.duplicateOf).map((m) => m.id));
  const excluded: Record<string, Exclusion> = {};
  for (const m of result.movements) {
    if (repeated.has(m.messageId)) excluded[m.id] = { reason: 'duplicidade', note: 'Mensagem repetida' };
  }
  return excluded;
}

/**
 * Pipeline determinístico: texto colado → mensagens/segmentos → lançamentos tipados.
 * Não depende de React nem de estado da interface.
 */
export function processText(raw: string, sessionCompetencia: Competencia): ProcessResult {
  const parsed = parseMessages(raw, sessionCompetencia);
  const msgById = new Map(parsed.messages.map((m) => [m.id, m]));
  const movements: Movement[] = [];
  const perMessage = new Map<string, number>();

  for (const entry of parsed.entries) {
    const message = msgById.get(entry.messageId);
    if (!message) continue;
    const comp = message.competencia ?? sessionCompetencia;
    for (const draft of classifyEntry(entry, message, comp, parsed.text)) {
      const n = (perMessage.get(message.id) ?? 0) + 1;
      perMessage.set(message.id, n);
      movements.push({
        ...draft,
        id: `${message.index + 1}.${n}`,
        messageIndex: message.index,
        competenciaFromMessage: message.competencia !== null,
        observation: buildObservation(draft),
      });
    }
  }
  return { ...parsed, movements };
}
