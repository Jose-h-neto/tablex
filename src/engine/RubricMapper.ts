import type { Movement, Overrides, RubricDictionary, RubricSource } from '../domain/types';

export const RUBRIC_CODE_RE = /^[A-Za-z0-9._-]{1,20}$/;

/**
 * Únicos códigos documentados em arquivos reais. Pré-carregados no dicionário e editáveis.
 * (1005 e 1021 vêm citados nas próprias mensagens e são aplicados diretamente.)
 */
export const DOCUMENTED_RUBRICS: RubricDictionary = {
  DESC_SINDICATO: { code: '153', label: 'Desconto sindicato (planilha real 09/2026)', updatedAt: '2026-10-29T00:00:00.000Z' },
};

/**
 * Prioridade: edição manual > código citado na mensagem > dicionário configurado.
 * Nunca há código padrão: sem configuração, a rubrica fica ausente (e o lançamento bloqueado).
 */
export function resolveRubric(
  m: Movement,
  ov: Overrides | undefined,
  dict: RubricDictionary,
): { code: string | null; source: RubricSource | null } {
  const manual = ov?.rubricCode?.trim();
  if (manual) return { code: manual, source: 'manual' };
  if (m.explicitRubric) return { code: m.explicitRubric, source: 'mensagem' };
  const entry = dict[m.categoryKey];
  if (entry) return { code: entry.code, source: 'dicionario' };
  return { code: null, source: null };
}

export function setMapping(dict: RubricDictionary, key: string, code: string, label: string): RubricDictionary {
  const trimmed = code.trim();
  const next = { ...dict };
  if (!trimmed) {
    delete next[key];
    return next;
  }
  if (!RUBRIC_CODE_RE.test(trimmed)) throw new Error(`Código de rubrica inválido: “${code}”`);
  next[key] = { code: trimmed, label, updatedAt: new Date().toISOString() };
  return next;
}

export interface CategoryUsage {
  key: string;
  label: string;
  count: number;
  code: string | null;
}

/** Categorias presentes nos lançamentos + as já configuradas, para a tela do dicionário. */
export function categoryUsage(movements: Movement[], dict: RubricDictionary): CategoryUsage[] {
  const map = new Map<string, CategoryUsage>();
  for (const m of movements) {
    if (!m.importable || m.explicitRubric) continue;
    const u = map.get(m.categoryKey) ?? { key: m.categoryKey, label: m.categoryLabel, count: 0, code: dict[m.categoryKey]?.code ?? null };
    u.count++;
    map.set(m.categoryKey, u);
  }
  for (const [key, e] of Object.entries(dict)) {
    if (!map.has(key)) map.set(key, { key, label: e.label, count: 0, code: e.code });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
}
