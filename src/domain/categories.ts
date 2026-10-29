import type { Nature, Unit } from './types';

export interface CategoryDef {
  key: string;
  label: string;
  nature: Nature;
  unit: Unit;
  importable: boolean;
}

/**
 * Tipos de movimentação reconhecidos. Os códigos de rubrica NÃO estão aqui:
 * são configurados pelo usuário no dicionário (RubricMapper).
 */
export const STATIC_CATEGORIES: readonly CategoryDef[] = [
  { key: 'DESC_MATERIAL_DIDATICO', label: 'Desconto material didático', nature: 'desconto', unit: 'valor', importable: true },
  { key: 'DESC_CONTRATURNO', label: 'Desconto contraturno', nature: 'desconto', unit: 'valor', importable: true },
  { key: 'DESC_SINDICATO', label: 'Desconto sindicato', nature: 'desconto', unit: 'valor', importable: true },
  { key: 'DESC_COPARTICIPACAO', label: 'Desconto coparticipação convênio', nature: 'desconto', unit: 'valor', importable: true },
  { key: 'FALTA_DIAS', label: 'Falta (dias)', nature: 'desconto', unit: 'dias', importable: true },
  { key: 'FALTA_AULAS', label: 'Falta (aulas)', nature: 'desconto', unit: 'aulas', importable: true },
  { key: 'FALTA_HORAS', label: 'Falta (horas)', nature: 'desconto', unit: 'horas', importable: true },
  { key: 'SUBST_HORAS', label: 'Substituição (horas)', nature: 'provento', unit: 'horas', importable: true },
  { key: 'SUBST_AULAS_EI', label: 'Substituição Ed. Infantil (aulas)', nature: 'provento', unit: 'aulas', importable: true },
  { key: 'SUBST_AULAS_EF1', label: 'Substituição Fund. I (aulas)', nature: 'provento', unit: 'aulas', importable: true },
  { key: 'SUBST_AULAS_EF2', label: 'Substituição Fund. II (aulas)', nature: 'provento', unit: 'aulas', importable: true },
  { key: 'SUBST_AULAS_EM', label: 'Substituição Ens. Médio (aulas)', nature: 'provento', unit: 'aulas', importable: true },
  { key: 'SUBST_AULAS', label: 'Substituição (aulas, nível não informado)', nature: 'provento', unit: 'aulas', importable: true },
  { key: 'HORA_EXTRA', label: 'Hora extra', nature: 'provento', unit: 'horas', importable: true },
  { key: 'COMPLEMENTO_SALARIO_DIAS', label: 'Complemento de salário (dias)', nature: 'provento', unit: 'dias', importable: true },
  { key: 'DIFERENCA_SALARIAL', label: 'Diferença salarial', nature: 'provento', unit: 'valor', importable: true },
  { key: 'ALTERACAO_CADASTRAL', label: 'Alteração salarial/cadastral', nature: 'informativo', unit: 'indefinida', importable: false },
  { key: 'INFO_VINCULO', label: 'Informação de vínculo/empresa', nature: 'informativo', unit: 'indefinida', importable: false },
  { key: 'CONFERENCIA', label: 'Solicitação de conferência', nature: 'informativo', unit: 'indefinida', importable: false },
  { key: 'DEPENDENCIA_EXTERNA', label: 'Pagamento dependente de informação externa', nature: 'informativo', unit: 'indefinida', importable: false },
  { key: 'NAO_INTERPRETADO', label: 'Trecho não interpretado', nature: 'informativo', unit: 'indefinida', importable: false },
];

const STATIC_BY_KEY = new Map(STATIC_CATEGORIES.map((c) => [c.key, c]));

/**
 * Prefixos de categorias dinâmicas: a descrição do texto compõe a chave
 * (ex.: "SALARIO:PROFESSOR TUTOR"), de modo que mapear uma vez vale para todos os equivalentes.
 */
export const DYNAMIC_PREFIXES = {
  SALARIO: { labelPrefix: 'Salário', nature: 'provento', unit: 'valor' },
  PROPORCIONAL: { labelPrefix: 'Dias proporcionais', nature: 'provento', unit: 'dias' },
  REEMBOLSO: { labelPrefix: 'Reembolso', nature: 'provento', unit: 'valor' },
  ACRESCIMO: { labelPrefix: 'Acréscimo', nature: 'provento', unit: 'indefinida' },
  RUBRICA: { labelPrefix: 'Rubrica citada', nature: 'provento', unit: 'indefinida' },
} as const satisfies Record<string, { labelPrefix: string; nature: Nature; unit: Unit }>;

export type DynamicPrefix = keyof typeof DYNAMIC_PREFIXES;

export function getCategory(key: string): CategoryDef | null {
  const s = STATIC_BY_KEY.get(key);
  if (s) return s;
  const [prefix, ...rest] = key.split(':');
  const dyn = DYNAMIC_PREFIXES[prefix as DynamicPrefix];
  if (!dyn || rest.length === 0) return null;
  const descr = rest.join(':');
  return {
    key,
    label: `${dyn.labelPrefix} — ${titleCase(descr)}`,
    nature: dyn.nature,
    unit: dyn.unit,
    importable: true,
  };
}

/** Chave estável a partir de texto livre: sem acentos, maiúsculas, só letras/dígitos. */
export function dynamicKey(prefix: DynamicPrefix, description: string): string {
  const norm = description
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${prefix}:${norm}`;
}

const LOWER_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'no', 'na', 'em', 'a', 'o']);

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
