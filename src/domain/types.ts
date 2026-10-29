import { z } from 'zod';

/* ---------- Primitivos ---------- */

export const UnitSchema = z.enum(['valor', 'horas', 'aulas', 'dias', 'indefinida']);
export type Unit = z.infer<typeof UnitSchema>;

export type Nature = 'provento' | 'desconto' | 'informativo';
export type Status = 'valido' | 'atencao' | 'bloqueado';
export type Severity = 'info' | 'atencao' | 'bloqueio';

export const CompetenciaSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});
export type Competencia = z.infer<typeof CompetenciaSchema>;

/** Intervalo de caracteres no texto de entrada (fim exclusivo). */
export interface SourceSpan {
  start: number;
  end: number;
}

/* ---------- Saída do MessageParser ---------- */

export type SectionKind =
  | 'DESCONTOS'
  | 'FALTAS'
  | 'SUBSTITUICOES'
  | 'HORA_EXTRA'
  | 'COPARTICIPACAO'
  | 'REEMBOLSOS'
  | 'CADASTRAL'
  | 'ACRESCIMOS'
  | 'CORRECOES'
  | 'OUTRA';

export interface Recurrence {
  untilMonth: number | null;
  untilYear: number | null;
  source: 'texto' | 'secao';
}

export interface SectionInfo {
  kind: SectionKind;
  label: string;
  recurrence: Recurrence | null;
}

export interface ParsedMessage {
  id: string;
  index: number;
  span: SourceSpan;
  recipient: string | null;
  competencia: Competencia | null;
  competenciaSpan: SourceSpan | null;
  isCorrection: boolean;
  fingerprint: string;
  duplicateOf: string | null;
}

export type SegmentKind =
  | 'recipient'
  | 'greeting'
  | 'info'
  | 'section'
  | 'employee'
  | 'subitem'
  | 'continuation'
  | 'separator'
  | 'unrecognized';

export interface Segment {
  id: string;
  messageId: string;
  kind: SegmentKind;
  span: SourceSpan;
  text: string;
  /** Explicação para trechos informativos ou não reconhecidos. */
  note: string | null;
}

export interface SubItem {
  segmentId: string;
  span: SourceSpan;
  code: string;
  label: string;
  valueText: string;
  valueStart: number;
}

export interface Piece {
  text: string;
  start: number;
}

export interface EmployeeEntry {
  id: string;
  messageId: string;
  segmentId: string;
  lineSpan: SourceSpan;
  matricula: string;
  rawName: string;
  name: string;
  nameNormalized: boolean;
  remainder: Piece;
  continuations: (Piece & { segmentId: string })[];
  subitems: SubItem[];
  section: SectionInfo | null;
}

/* ---------- Movimentação (estrutura interna, independente da planilha) ---------- */

export type IssueCode =
  | 'MATRICULA_AUSENTE'
  | 'MATRICULA_INVALIDA'
  | 'RUBRICA_NAO_CONFIGURADA'
  | 'RUBRICA_INVALIDA'
  | 'RUBRICA_DA_MENSAGEM'
  | 'VALOR_AUSENTE'
  | 'VALOR_INVALIDO'
  | 'VALOR_MULTIPLO'
  | 'UNIDADE_INDEFINIDA'
  | 'UNIDADE_INFERIDA'
  | 'NAO_IMPORTAVEL'
  | 'NAO_INTERPRETADO'
  | 'CALCULO_EXTERNO'
  | 'HORA_EXTRA_REGRA'
  | 'DATA_INCONSISTENTE'
  | 'DATA_FORA_COMPETENCIA'
  | 'RECORRENCIA'
  | 'DUPLICADO'
  | 'CONFLITO'
  | 'COMPETENCIA_DIVERGENTE'
  | 'NOME_DIVERGENTE'
  | 'NOME_NORMALIZADO';

/** Pendência detectada já na extração (antes da validação). */
export interface ExtractionFlag {
  code: IssueCode;
  message: string;
}

export interface Movement {
  id: string;
  messageId: string;
  messageIndex: number;
  entryId: string;
  segmentId: string;
  lineSpan: SourceSpan;
  fragmentSpan: SourceSpan;
  sourceText: string;
  matricula: string | null;
  employeeName: string | null;
  categoryKey: string;
  categoryLabel: string;
  nature: Nature;
  unit: Unit;
  amount: number | null;
  competencia: Competencia;
  /** true quando a competência veio do cabeçalho da mensagem; senão segue a competência selecionada. */
  competenciaFromMessage: boolean;
  /** Datas citadas no trecho (ISO yyyy-mm-dd). */
  referenceDates: string[];
  /** Meses citados por extenso (ex.: "agosto"). */
  referenceMonths: string[];
  /** Detalhes como intervalos de hora extra ("26/09 06:00–12:00"). */
  details: string[];
  recurrence: Recurrence | null;
  fixed: boolean;
  explicitRubric: string | null;
  importable: boolean;
  flags: ExtractionFlag[];
  observation: string;
}

/* ---------- Estado de revisão (edições do usuário) ---------- */

export interface Overrides {
  matricula?: string;
  rubricCode?: string;
  amount?: number | null;
  unit?: Unit;
  movementDate?: string;
  fixed?: boolean;
  observation?: string;
  competencia?: Competencia;
}

export type ExclusionReason = 'duplicidade' | 'versao_substituida' | 'tratamento_manual' | 'descartado';

export interface Exclusion {
  reason: ExclusionReason;
  note: string | null;
}

export interface ReviewState {
  overrides: Record<string, Overrides>;
  acknowledged: Record<string, IssueCode[]>;
  excluded: Record<string, Exclusion>;
}

export interface Issue {
  code: IssueCode;
  severity: Severity;
  message: string;
  acknowledged: boolean;
  /** Ids relacionados (duplicidades, conflitos). */
  related: string[];
}

export type RubricSource = 'manual' | 'mensagem' | 'dicionario';

export interface ResolvedRow {
  m: Movement;
  matricula: string | null;
  rubricCode: string | null;
  rubricSource: RubricSource | null;
  amount: number | null;
  unit: Unit;
  competencia: Competencia;
  movementDate: string | null;
  /** Data do movimento editada manualmente (em vez de derivada da competência). */
  dateOverridden: boolean;
  fixed: boolean;
  observation: string;
  issues: Issue[];
  status: Status;
  exclusion: Exclusion | null;
  exportable: boolean;
}

/* ---------- Configuração persistida (não sensível) ---------- */

/**
 * Padrões documentados pela planilha real preenchida (09/2026): data do movimento no 1º dia
 * da competência, "Fixar valor?" vazio para lançamentos não fixos e "Observação" vazia.
 * O texto para "fixo" e o formato de horas não aparecem em nenhum exemplo: continuam sem padrão.
 */
export const ImportSettingsSchema = z.object({
  companyCode: z.string().max(30).default(''),
  movementDateRule: z.enum(['inicio', 'fim']).nullable().default('inicio'),
  fixarSim: z.string().max(10).default(''),
  fixarNao: z.string().max(10).default(''),
  hourFormat: z.enum(['decimal', 'sexagesimal']).nullable().default(null),
  fillObservation: z.boolean().default(false),
  consolidate: z.boolean().default(false),
});
export type ImportSettings = z.infer<typeof ImportSettingsSchema>;

export const RubricEntrySchema = z.object({
  code: z.string().min(1).max(20),
  label: z.string().max(200),
  updatedAt: z.string(),
});
export type RubricEntry = z.infer<typeof RubricEntrySchema>;

export const RubricDictionarySchema = z.record(z.string(), RubricEntrySchema);
export type RubricDictionary = z.infer<typeof RubricDictionarySchema>;

export const DEFAULT_SETTINGS: ImportSettings = ImportSettingsSchema.parse({});
