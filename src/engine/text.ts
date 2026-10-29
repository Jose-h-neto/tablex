import type { Piece, SourceSpan } from '../domain/types';

/** Caracteres corrompidos/invisíveis frequentes em mensagens copiadas de apps de chat. */
const GARBAGE_RANGES: [number, number][] = [[0xbf, 0xbf], [0xfffd, 0xfffd], [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x2029], [0xfeff, 0xfeff]];
const hex = (n: number) => `\\u${n.toString(16).padStart(4, '0')}`;
const GARBAGE_CLASS = `[${GARBAGE_RANGES.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join('')}]`;
export const GARBAGE_CHARS = new RegExp(GARBAGE_CLASS, 'g');
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
 * preservando exatamente o comprimento — índices continuam válidos no texto original.
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
export function cleanName(raw: string): { name: string; changed: boolean } {
  const withoutGarbage = raw.replace(GARBAGE_CHARS, '');
  const name = collapseSpaces(withoutGarbage).replace(/[\s\-:.,;]+$/, '');
  return { name, changed: withoutGarbage !== raw };
}

/**
 * Texto composto por pedaços de posições diferentes do original
 * (ex.: linha de hora extra + linha de continuação), com mapa de offsets.
 */
export class MappedText {
  readonly text: string;
  readonly folded: string;
  private readonly offsets: number[];

  private constructor(text: string, offsets: number[]) {
    this.text = text;
    this.folded = fold(text);
    this.offsets = offsets;
  }

  static from(piece: Piece): MappedText {
    const offsets = Array.from({ length: piece.text.length }, (_, i) => piece.start + i);
    return new MappedText(piece.text, offsets);
  }

  static join(pieces: Piece[], joiner = ' / '): MappedText {
    let text = '';
    const offsets: number[] = [];
    pieces.forEach((p, idx) => {
      if (idx > 0) {
        const anchor = offsets.length > 0 ? (offsets[offsets.length - 1] ?? 0) : p.start;
        for (let i = 0; i < joiner.length; i++) offsets.push(anchor);
        text += joiner;
      }
      for (let i = 0; i < p.text.length; i++) offsets.push(p.start + i);
      text += p.text;
    });
    return new MappedText(text, offsets);
  }

  get length(): number {
    return this.text.length;
  }

  slice(start: number, end = this.text.length): MappedText {
    return new MappedText(this.text.slice(start, end), this.offsets.slice(start, end));
  }

  /** Remove espaços e pontuação de borda, preservando o mapeamento. */
  trim(chars = /[\s\-:;,.+/]/): MappedText {
    let a = 0;
    let b = this.text.length;
    while (a < b && chars.test(this.text.charAt(a))) a++;
    while (b > a && chars.test(this.text.charAt(b - 1))) b--;
    return this.slice(a, b);
  }

  /** Intervalo no texto original coberto por [start, end) deste texto. */
  span(start = 0, end = this.text.length): SourceSpan {
    if (this.offsets.length === 0) return { start: 0, end: 0 };
    const s = this.offsets[Math.min(start, this.offsets.length - 1)] ?? 0;
    const e = (this.offsets[Math.max(Math.min(end, this.offsets.length) - 1, 0)] ?? s) + 1;
    return { start: s, end: Math.max(e, s) };
  }
}

/** Divide em linhas preservando o offset de início de cada uma. */
export function splitLines(text: string): Piece[] {
  const lines: Piece[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charAt(i) === '\n') {
      lines.push({ text: text.slice(start, i), start });
      start = i + 1;
    }
  }
  return lines;
}

/** Normaliza quebras de linha (\r\n → \n). O resultado é o texto-fonte usado em todos os offsets. */
export function normalizeInput(raw: string): string {
  return raw.replace(/\r\n?/g, '\n');
}
