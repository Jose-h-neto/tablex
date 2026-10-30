/** Pedidos que não viram lançamento: aparecem na tabela só para consulta. */
const NOT_IMPORTABLE = new Set(['ALTERACAO_CADASTRAL', 'INFO_VINCULO', 'CONFERENCIA', 'DEPENDENCIA_EXTERNA', 'NAO_INTERPRETADO']);

export type NotImportableKey = 'ALTERACAO_CADASTRAL' | 'INFO_VINCULO' | 'CONFERENCIA' | 'DEPENDENCIA_EXTERNA';
export type DynamicPrefix = 'SALARIO' | 'PROPORCIONAL' | 'REEMBOLSO' | 'ACRESCIMO' | 'RUBRICA';

export function isImportable(key: string): boolean {
  return !NOT_IMPORTABLE.has(key);
}

/** Chave a partir de texto livre (ex.: "SALARIO:PROFESSOR TUTOR"): mesma descrição, mesma rubrica. */
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
