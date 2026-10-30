/** Caracteres corrompidos/invisíveis frequentes em mensagens copiadas de apps de chat. */
const GARBAGE_RANGES: [number, number][] = [[0xbf, 0xbf], [0xfffd, 0xfffd], [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x2029], [0xfeff, 0xfeff]];
const hex = (n: number) => `\\u${n.toString(16).padStart(4, '0')}`;
const GARBAGE_CLASS = `[${GARBAGE_RANGES.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join('')}]`;
const GARBAGE_CHARS = new RegExp(GARBAGE_CLASS, 'g');
const IS_GARBAGE = new RegExp(`^${GARBAGE_CLASS}$`);
const NBSP = String.fromCharCode(0xa0);
const DASHES = new Set([0x2013, 0x2014, 0x2212].map((c) => String.fromCharCode(c)));

function foldChar(ch: string): string {
  if (IS_GARBAGE.test(ch)) return ' ';
  if (ch === NBSP || ch === '\t') return ' ';
  if (DASHES.has(ch)) return '-';
  const base = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return base.length === 0 ? ' ' : base.charAt(0);
}

/**
 * Normaliza para comparação (minúsculas, sem acentos, traços unificados)
 * preservando o comprimento: índices continuam válidos no texto original.
 */
export function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) out += foldChar(s.charAt(i));
  return out;
}

export function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Remove caracteres corrompidos e espaços duplicados de um nome. */
export function cleanName(raw: string): string {
  return collapseSpaces(raw.replace(GARBAGE_CHARS, '')).replace(/[\s\-:.,;]+$/, '');
}

/** Remove espaços e pontuação das bordas. */
export function trimEdges(s: string): string {
  return s.replace(/^[\s\-:;,.+/]+|[\s\-:;,.+/]+$/g, '');
}
