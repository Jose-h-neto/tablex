import {
  competenciaKey,
  firstDayIso,
  formatCompetencia,
  formatIsoBr,
  lastDayIso,
  monthDiff,
  parseIso,
  sameCompetencia,
} from '../domain/competencia';
import type {
  Competencia,
  ImportSettings,
  Issue,
  IssueCode,
  Movement,
  ParsedMessage,
  ResolvedRow,
  ReviewState,
  RubricDictionary,
  Severity,
  Status,
} from '../domain/types';
import { resolveRubric, RUBRIC_CODE_RE } from './RubricMapper';
import { collapseSpaces, fold } from './text';

export const ISSUE_SEVERITY: Record<IssueCode, Severity> = {
  MATRICULA_AUSENTE: 'bloqueio',
  MATRICULA_INVALIDA: 'bloqueio',
  RUBRICA_NAO_CONFIGURADA: 'bloqueio',
  RUBRICA_INVALIDA: 'bloqueio',
  RUBRICA_DA_MENSAGEM: 'atencao',
  VALOR_AUSENTE: 'bloqueio',
  VALOR_INVALIDO: 'bloqueio',
  VALOR_MULTIPLO: 'atencao',
  UNIDADE_INDEFINIDA: 'bloqueio',
  UNIDADE_INFERIDA: 'atencao',
  NAO_IMPORTAVEL: 'bloqueio',
  NAO_INTERPRETADO: 'bloqueio',
  CALCULO_EXTERNO: 'atencao',
  HORA_EXTRA_REGRA: 'atencao',
  DATA_INCONSISTENTE: 'atencao',
  DATA_FORA_COMPETENCIA: 'atencao',
  RECORRENCIA: 'atencao',
  DUPLICADO: 'atencao',
  CONFLITO: 'atencao',
  COMPETENCIA_DIVERGENTE: 'atencao',
  NOME_DIVERGENTE: 'atencao',
  NOME_NORMALIZADO: 'info',
};

/** Rótulos curtos usados no agrupamento de pendências. */
export const ISSUE_LABELS: Record<IssueCode, string> = {
  MATRICULA_AUSENTE: 'Matrícula ausente',
  MATRICULA_INVALIDA: 'Matrícula inválida',
  RUBRICA_NAO_CONFIGURADA: 'Rubrica não configurada',
  RUBRICA_INVALIDA: 'Código de rubrica inválido',
  RUBRICA_DA_MENSAGEM: 'Rubrica citada na mensagem',
  VALOR_AUSENTE: 'Valor/quantidade não informado',
  VALOR_INVALIDO: 'Valor inválido',
  VALOR_MULTIPLO: 'Mais de um valor no trecho',
  UNIDADE_INDEFINIDA: 'Quantidade sem unidade',
  UNIDADE_INFERIDA: 'Unidade inferida',
  NAO_IMPORTAVEL: 'Não importável pela planilha',
  NAO_INTERPRETADO: 'Trecho não interpretado',
  CALCULO_EXTERNO: 'Depende de cálculo no sistema',
  HORA_EXTRA_REGRA: 'Hora extra: confirmar enquadramento',
  DATA_INCONSISTENTE: 'Datas inconsistentes',
  DATA_FORA_COMPETENCIA: 'Data fora da competência',
  RECORRENCIA: 'Lançamento recorrente',
  DUPLICADO: 'Possível duplicidade',
  CONFLITO: 'Conflito entre mensagens',
  COMPETENCIA_DIVERGENTE: 'Competência divergente',
  NOME_DIVERGENTE: 'Nome divergente para a matrícula',
  NOME_NORMALIZADO: 'Nome normalizado',
};

/** Pendências de atenção que podem ser confirmadas em lote sem editar dados. */
export function isAcknowledgeable(code: IssueCode): boolean {
  return ISSUE_SEVERITY[code] === 'atencao';
}

export interface ValidationContext {
  messages: ParsedMessage[];
  settings: ImportSettings;
  dictionary: RubricDictionary;
  sessionCompetencia: Competencia;
  review: ReviewState;
}

const fmtAmount = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

function normName(name: string | null): string {
  return name ? collapseSpaces(fold(name)).toUpperCase() : '';
}

export function computeStatus(issues: Issue[]): Status {
  if (issues.some((i) => i.severity === 'bloqueio')) return 'bloqueado';
  if (issues.some((i) => i.severity === 'atencao' && !i.acknowledged)) return 'atencao';
  return 'valido';
}

export function resolveRows(movements: Movement[], ctx: ValidationContext): ResolvedRow[] {
  const { review, dictionary, settings, sessionCompetencia } = ctx;
  const msgNumber = new Map(ctx.messages.map((m) => [m.id, m.index + 1]));

  const rows: ResolvedRow[] = movements.map((m) => {
    const ov = review.overrides[m.id];
    const matricula = (ov?.matricula ?? m.matricula)?.trim() || null;
    const rubric = resolveRubric(m, ov, dictionary);
    const amount = ov && 'amount' in ov ? (ov.amount ?? null) : m.amount;
    const unit = ov?.unit ?? m.unit;
    const competencia = ov?.competencia ?? (m.competenciaFromMessage ? m.competencia : sessionCompetencia);
    const derivedDate =
      settings.movementDateRule === 'inicio' ? firstDayIso(competencia) : settings.movementDateRule === 'fim' ? lastDayIso(competencia) : null;
    const movementDate = ov?.movementDate ?? derivedDate;
    const issues: Issue[] = [];
    const add = (code: IssueCode, message: string, related: string[] = []) => {
      issues.push({ code, severity: ISSUE_SEVERITY[code], message, acknowledged: false, related });
    };

    if (!matricula) add('MATRICULA_AUSENTE', 'Matrícula não identificada.');
    else if (!/^\d{1,10}$/.test(matricula)) add('MATRICULA_INVALIDA', `Matrícula “${matricula}” deve conter apenas dígitos.`);

    if (m.importable) {
      if (!rubric.code) {
        add('RUBRICA_NAO_CONFIGURADA', `Sem código de rubrica para “${m.categoryLabel}”. Configure no dicionário para aplicar a todos os lançamentos deste tipo.`);
      } else if (!RUBRIC_CODE_RE.test(rubric.code)) {
        add('RUBRICA_INVALIDA', `Código “${rubric.code}” contém caracteres não permitidos.`);
      }
      if (amount === null) add('VALOR_AUSENTE', 'Valor ou quantidade não identificado no trecho. Informe manualmente ou envie para tratamento manual.');
      else if (!Number.isFinite(amount) || amount <= 0) add('VALOR_INVALIDO', `Valor ${amount} inválido: deve ser maior que zero.`);
      if (amount !== null && unit === 'indefinida') add('UNIDADE_INDEFINIDA', 'Quantidade sem unidade definida (aulas, horas ou dias). Defina a unidade.');
    }

    for (const f of m.flags) {
      if (f.code === 'NAO_INTERPRETADO' && ov?.rubricCode) continue; // classificado manualmente
      if (f.code === 'UNIDADE_INFERIDA' && ov?.unit) continue;
      add(f.code, f.message);
    }

    if (!sameCompetencia(competencia, sessionCompetencia)) {
      add(
        'COMPETENCIA_DIVERGENTE',
        `Competência ${formatCompetencia(competencia)} (informada na mensagem) diferente da folha selecionada ${formatCompetencia(sessionCompetencia)}.`,
      );
    }
    for (const iso of m.referenceDates) {
      const p = parseIso(iso);
      if (!p) continue;
      if (iso > lastDayIso(competencia)) {
        add('DATA_FORA_COMPETENCIA', `Data citada ${formatIsoBr(iso)} é posterior à competência ${formatCompetencia(competencia)}.`);
      } else if (monthDiff({ year: p.year, month: p.month }, competencia) > 2) {
        add('DATA_FORA_COMPETENCIA', `Data citada ${formatIsoBr(iso)} é anterior a mais de 2 meses da competência ${formatCompetencia(competencia)}.`);
      }
    }
    if (ov?.movementDate && !parseIso(ov.movementDate)) add('DATA_INCONSISTENTE', 'Data do movimento inválida.');

    return {
      m,
      matricula,
      rubricCode: rubric.code,
      rubricSource: rubric.source,
      amount,
      unit,
      competencia,
      movementDate,
      dateOverridden: ov?.movementDate !== undefined,
      fixed: ov?.fixed ?? m.fixed,
      observation: ov?.observation ?? m.observation,
      issues,
      status: 'valido' as Status,
      exclusion: review.excluded[m.id] ?? null,
      exportable: false,
    };
  });

  /* ---------- Verificações entre lançamentos (ignorando excluídos) ---------- */
  const active = rows.filter((r) => !r.exclusion);
  const refKey = (r: ResolvedRow) => [r.m.referenceDates.join(','), r.m.referenceMonths.join(','), r.m.details.join(',')].join('|');
  const NO_REF = '||';
  const msgList = (rs: ResolvedRow[]) => [...new Set(rs.map((o) => `#${msgNumber.get(o.m.messageId)}`))].join(', ');

  const groups = new Map<string, ResolvedRow[]>();
  for (const r of active) {
    if (!r.m.importable) continue;
    const k = [competenciaKey(r.competencia), r.matricula ?? '', r.m.categoryKey].join('|');
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Duplicidade: mesmo tipo e valor, com as mesmas referências ou com uma ocorrência sem referência
    // (ex.: "5 horas" numa mensagem e "5 horas (15/10)" em outra).
    for (const r of group) {
      const dups = group.filter(
        (o) => o !== r && o.amount === r.amount && (refKey(o) === refKey(r) || refKey(o) === NO_REF || refKey(r) === NO_REF),
      );
      if (dups.length === 0) continue;
      const exact = dups.every((o) => refKey(o) === refKey(r));
      const what = `${r.m.categoryLabel}, ${r.amount === null ? 'sem valor' : fmtAmount(r.amount)}`;
      r.issues.push({
        code: 'DUPLICADO',
        severity: ISSUE_SEVERITY.DUPLICADO,
        message: exact
          ? `Lançamento idêntico (${what}) também na(s) mensagem(ns) ${msgList(dups)}.`
          : `Mesmo tipo e valor (${what}) na(s) mensagem(ns) ${msgList(dups)}, uma das ocorrências sem data de referência: possível repetição.`,
        acknowledged: false,
        related: dups.map((o) => o.m.id),
      });
    }
    // Conflito: mesmas referências, valores diferentes, mensagens diferentes.
    {
      for (const r of group) {
        const diff = group.filter((o) => refKey(o) === refKey(r) && o.amount !== r.amount && o.m.messageId !== r.m.messageId);
        if (diff.length === 0) continue;
        const desc = diff
          .map((o) => `${o.amount === null ? 'sem valor' : fmtAmount(o.amount)} (msg #${msgNumber.get(o.m.messageId)})`)
          .join('; ');
        r.issues.push({
          code: 'CONFLITO',
          severity: ISSUE_SEVERITY.CONFLITO,
          message: `Mesmo tipo de lançamento com valor diferente em outra mensagem: ${desc}. Mantenha apenas a versão correta.`,
          acknowledged: false,
          related: diff.map((o) => o.m.id),
        });
      }
    }
  }

  const namesByMatricula = new Map<string, Set<string>>();
  const matriculasByName = new Map<string, Set<string>>();
  for (const r of active) {
    if (!r.matricula || !r.m.employeeName) continue;
    const n = normName(r.m.employeeName);
    namesByMatricula.set(r.matricula, (namesByMatricula.get(r.matricula) ?? new Set()).add(n));
    matriculasByName.set(n, (matriculasByName.get(n) ?? new Set()).add(r.matricula));
  }
  for (const r of active) {
    if (!r.matricula || !r.m.employeeName) continue;
    const names = namesByMatricula.get(r.matricula);
    const mats = matriculasByName.get(normName(r.m.employeeName));
    if (names && names.size > 1) {
      r.issues.push({
        code: 'NOME_DIVERGENTE',
        severity: ISSUE_SEVERITY.NOME_DIVERGENTE,
        message: `Matrícula ${r.matricula} aparece com nomes diferentes: ${[...names].join(' / ')}.`,
        acknowledged: false,
        related: [],
      });
    } else if (mats && mats.size > 1) {
      r.issues.push({
        code: 'NOME_DIVERGENTE',
        severity: ISSUE_SEVERITY.NOME_DIVERGENTE,
        message: `O nome ${r.m.employeeName} aparece com matrículas diferentes: ${[...mats].join(', ')}.`,
        acknowledged: false,
        related: [],
      });
    }
  }

  /* ---------- Confirmações e status ---------- */
  for (const r of rows) {
    const ack = new Set(review.acknowledged[r.m.id] ?? []);
    for (const i of r.issues) if (i.severity === 'atencao' && ack.has(i.code)) i.acknowledged = true;
    r.status = computeStatus(r.issues);
    r.exportable = !r.exclusion && r.status === 'valido';
  }
  return rows;
}

/* ---------- Configuração global de importação ---------- */

export type ConfigIssueCode = 'EMPRESA' | 'DATA_REGRA' | 'FIXAR' | 'HORAS';

export interface ConfigIssue {
  code: ConfigIssueCode;
  message: string;
}

export function checkConfig(settings: ImportSettings, rows: ResolvedRow[]): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  if (!settings.companyCode.trim()) out.push({ code: 'EMPRESA', message: 'Código da empresa não informado.' });
  if (!settings.movementDateRule) {
    out.push({ code: 'DATA_REGRA', message: 'Regra da “Data do movimento” não definida (1º ou último dia da competência).' });
  }
  if (!settings.fixarSim.trim() && rows.some((r) => r.exportable && r.fixed)) {
    out.push({ code: 'FIXAR', message: 'Texto da coluna “Fixar valor?” para lançamentos fixos não definido (há lançamentos fixos a exportar).' });
  }
  if (!settings.hourFormat && rows.some((r) => r.exportable && r.unit === 'horas')) {
    out.push({ code: 'HORAS', message: 'Formato das horas não definido (decimal 4,75 ou sexagesimal 4,45).' });
  }
  return out;
}

export interface Counters {
  total: number;
  valido: number;
  atencao: number;
  bloqueado: number;
  excluido: number;
}

export function countRows(rows: ResolvedRow[]): Counters {
  const c: Counters = { total: rows.length, valido: 0, atencao: 0, bloqueado: 0, excluido: 0 };
  for (const r of rows) {
    if (r.exclusion) c.excluido++;
    else c[r.status]++;
  }
  return c;
}

export interface IssueGroup {
  code: IssueCode;
  severity: Severity;
  label: string;
  rowIds: string[];
  /** Para rubricas: categorias distintas sem código. */
  categories: { key: string; label: string; count: number }[];
}

/** Agrupa pendências não resolvidas por tipo (para ações em lote). */
export function groupIssues(rows: ResolvedRow[]): IssueGroup[] {
  const map = new Map<IssueCode, IssueGroup>();
  for (const r of rows) {
    if (r.exclusion) continue;
    for (const i of r.issues) {
      if (i.severity === 'info' || i.acknowledged) continue;
      const g = map.get(i.code) ?? { code: i.code, severity: i.severity, label: ISSUE_LABELS[i.code], rowIds: [], categories: [] };
      if (!g.rowIds.includes(r.m.id)) g.rowIds.push(r.m.id);
      if (i.code === 'RUBRICA_NAO_CONFIGURADA') {
        const c = g.categories.find((x) => x.key === r.m.categoryKey);
        if (c) c.count++;
        else g.categories.push({ key: r.m.categoryKey, label: r.m.categoryLabel, count: 1 });
      }
      map.set(i.code, g);
    }
  }
  const order: Record<Severity, number> = { bloqueio: 0, atencao: 1, info: 2 };
  return [...map.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.rowIds.length - a.rowIds.length);
}

/**
 * Ids a excluir para resolver duplicidades/conflitos: mantém a versão mais recente
 * (mensagem de correção tem prioridade; depois a última mensagem colada).
 */
export function pickSuperseded(rows: ResolvedRow[], code: 'DUPLICADO' | 'CONFLITO', messages: ParsedMessage[]): string[] {
  const msgById = new Map(messages.map((m) => [m.id, m]));
  const rank = (r: ResolvedRow) => {
    const msg = msgById.get(r.m.messageId);
    return (msg?.isCorrection ? 1_000_000 : 0) + (msg?.index ?? 0) * 1000 + r.m.fragmentSpan.start / 1e6;
  };
  const byId = new Map(rows.map((r) => [r.m.id, r]));
  const visited = new Set<string>();
  const drop: string[] = [];
  for (const r of rows) {
    if (r.exclusion || visited.has(r.m.id)) continue;
    const issue = r.issues.find((i) => i.code === code && !i.acknowledged);
    if (!issue) continue;
    // Componente conexo de lançamentos relacionados.
    const cluster: ResolvedRow[] = [];
    const stack = [r];
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur.m.id)) continue;
      visited.add(cur.m.id);
      cluster.push(cur);
      for (const i of cur.issues) {
        if (i.code !== code) continue;
        for (const id of i.related) {
          const o = byId.get(id);
          if (o && !o.exclusion && !visited.has(id)) stack.push(o);
        }
      }
    }
    if (cluster.length < 2) continue;
    // Vários lançamentos da mesma mensagem vencedora podem coexistir (ex.: meses diferentes).
    const best = cluster.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    for (const c of cluster) if (c.m.messageId !== best.m.messageId) drop.push(c.m.id);
    if (code === 'DUPLICADO') {
      // Duplicata dentro da própria mensagem vencedora: mantém só a primeira.
      const sameMsg = cluster.filter((c) => c.m.messageId === best.m.messageId).sort((a, b) => a.m.fragmentSpan.start - b.m.fragmentSpan.start);
      const seen = new Set<string>();
      for (const c of sameMsg) {
        const k = `${c.m.categoryKey}|${c.amount}|${c.m.referenceDates.join(',')}|${c.m.referenceMonths.join(',')}|${c.m.details.join(',')}`;
        if (seen.has(k)) drop.push(c.m.id);
        seen.add(k);
      }
    }
  }
  return drop;
}
