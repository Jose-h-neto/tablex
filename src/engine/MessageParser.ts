import { parseCompetencia, type Competencia } from '../domain/competencia';
import { isRecurrent } from './MovementNormalizer';
import { cleanName, collapseSpaces, fold } from './text';

export type SectionKind = 'DESCONTOS' | 'FALTAS' | 'SUBSTITUICOES' | 'HORA_EXTRA' | 'COPARTICIPACAO' | 'REEMBOLSOS' | 'CADASTRAL' | 'ACRESCIMOS' | 'CORRECOES' | 'OUTRA';

export interface SectionInfo {
  kind: SectionKind;
  recurrent: boolean;
}

export interface SubItem {
  code: string;
  label: string;
  valueText: string;
  line: number;
  text: string;
}

export interface EmployeeEntry {
  messageIndex: number;
  line: number;
  matricula: string;
  name: string;
  /** Descrição após o nome, somada às linhas de continuação. */
  text: string;
  subitems: SubItem[];
  section: SectionInfo | null;
}

/** Linha que não virou lançamento e precisa continuar visível (não reconhecida ou citação de anexo). */
export interface LooseLine {
  messageIndex: number;
  line: number;
  text: string;
}

export interface ParseOutput {
  /** Competência informada em cada mensagem (índice = messageIndex). */
  competencias: (Competencia | null)[];
  entries: EmployeeEntry[];
  loose: LooseLine[];
}

const SEPARATOR_RE = /^\s*(?:-{3,}|={3,}|_{3,}|\*{3,})\s*$/;
const RECIPIENT_RE = /^\s*(\p{Lu}\p{Ll}+)(?:\s+(\p{Lu}\p{Ll}+))?\s*[,!.]*\s*$/u;
const RECIPIENT_GREETING_RE = /^\s*(\p{Lu}\p{Ll}+)\s*,\s*(?:bom dia|boa tarde|boa noite|ol[aá]|oi|tudo bem)\b/iu;
const GREETING_RE = /^(bom dia|boa tarde|boa noite|ola\b|oi\b|prezad|espero|tudo bem|segue|seguem|obrigad|att\b|atenciosamente|abs\b|abracos|qualquer duvida|fico no aguardo|grat[ao])/;
const ATTACHMENT_RE = /(segue|seguem|em)\s+(o\s+|os\s+)?(arquivo|anexo|planilha)|\banexo\b/;
const EMPLOYEE_RE = /^\s*(\d{1,7})(?!\d)(?!\s*[/:,.]\s*\d)\s*[-–—.:]?\s*(?=[^\d\s/:])/;
const PAYROLL_TERMS_RE = /\b(hora|horas|aula|aulas|salario|adicional|dsr|gratificacao|desconto|abono|bonus|ppe|contraturno)\b/;
const SUBITEM_VALUE_RE = /[-:=]\s*(?:correto|correta|corrigir para|passa a ser|ajustar para|novo valor)?\s*:?\s*(\d+(?:[.,]\d+)?)\s*$/;
const CONTINUATION_DATA_RE = /\d{1,2}\/\d{1,2}|\d{1,2}[:h]\d{2}|r\$\s*\d/;
const NAME_CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', "d'"]);
const NOT_NAME_START = new Set(['aula', 'aulas', 'hora', 'horas', 'dia', 'dias', 'falta', 'faltas', 'reais', 'de', 'as', 'a', 'h']);

export function detectSection(line: string): SectionInfo | null {
  const f = collapseSpaces(fold(line));
  if (!f || /^\d/.test(f) || f.length > 80) return null;
  const core = f.replace(/[\s:.!]+$/, '');
  const make = (kind: SectionKind, recurrent = false): SectionInfo => ({ kind, recurrent });

  if (/^(segue(m)?\s+(as\s+)?)?correc(ao|oes)\b/.test(core) || /^retificac/.test(core)) return make('CORRECOES');
  if (/^(desconto(s)?\s+(por|de)\s+faltas?|faltas?(\s+e\s+atrasos)?)$/.test(core)) return make('FALTAS');
  if (/^descontos?$/.test(core)) return make('DESCONTOS');
  if (/^substitu[a-z]*$/.test(core)) return make('SUBSTITUICOES');
  if (/^horas?\s+extras?$/.test(core)) return make('HORA_EXTRA');
  if (/coparticipa/.test(core) && !/r\$/.test(core)) return make('COPARTICIPACAO');
  if (/^(reembolsos?|ressarcimentos?)$/.test(core)) return make('REEMBOLSOS');
  if (/^alterac(ao|oes)\b/.test(core)) return make('CADASTRAL');
  if (/^(acrescentar|incluir|adicionar|acrescimos?)\b/.test(core) && f.endsWith(':')) return make('ACRESCIMOS', isRecurrent(f));
  if (GREETING_RE.test(core)) return null;
  if (f.endsWith(':') && !/\d/.test(f) && core.split(' ').length <= 6) return make('OUTRA');
  return null;
}

function findCompetencia(line: string): Competencia | null {
  const f = fold(line);
  const m = /(?:folha|competencia|mes|fechamento|referente\s+a?o?)\D{0,20}?(\d{1,2}\s*\/\s*\d{4})/.exec(f) ?? /(?<![\d/])(\d{1,2}\s*\/\s*\d{4})(?![\d/])/.exec(f);
  return m?.[1] ? parseCompetencia(m[1].replace(/\s/g, '')) : null;
}

function isUpperWord(w: string): boolean {
  const letters = w.replace(/[^\p{L}]/gu, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}

function looksLikeName(candidate: string): boolean {
  const c = cleanName(candidate);
  if (c.length < 3 || /\d|r\$/i.test(c)) return false;
  const words = c.split(/\s+/);
  if (NOT_NAME_START.has(fold(words[0] ?? ''))) return false;
  return words.some((w) => /^\p{L}{2,}$/u.test(w.replace(/['’]/g, ''))) && words.length <= 10;
}

/** Separa nome e descrição: "NOME - desc", "NOME -desc", "NOME- desc", "NOME: desc" ou "NOME  desc". */
export function splitNameAndRemainder(text: string): { rawName: string; remainder: string } | null {
  const sep = /\s+[-–—]\s*|[-–—]\s+|\s*:\s*/.exec(text);
  if (sep && sep.index > 0 && looksLikeName(text.slice(0, sep.index))) {
    return { rawName: text.slice(0, sep.index), remainder: text.slice(sep.index + sep[0].length) };
  }
  // Sem separador: o nome termina na primeira palavra que não pertence a ele.
  let end = 0;
  let count = 0;
  for (const w of text.matchAll(/\S+/g)) {
    const isName = /^[\p{L}'’¿]+$/u.test(w[0]) && (isUpperWord(w[0]) || (count > 0 && NAME_CONNECTORS.has(w[0].toLowerCase())));
    if (!isName) break;
    end = w.index + w[0].length;
    count++;
  }
  if (count === 0) return looksLikeName(text) ? { rawName: text, remainder: '' } : null;
  const rawName = text.slice(0, end);
  return looksLikeName(rawName) ? { rawName, remainder: text.slice(end) } : null;
}

export function parseMessages(rawText: string): ParseOutput {
  const lines = rawText.replace(/\r\n?/g, '\n').split('\n');
  const competencias: (Competencia | null)[] = [];
  const entries: EmployeeEntry[] = [];
  const loose: LooseLine[] = [];

  // Estado da mensagem corrente.
  let index = -1;
  let hasContent = false;
  let hasData = false;
  let section: SectionInfo | null = null;
  let prev: 'blank' | 'greeting' | 'recipient' | 'employee' | 'subitem' | 'continuation' | 'other' = 'blank';
  let lastEntry: EmployeeEntry | null = null;
  /** Linha de funcionário que anunciou sub-itens ("ajustar a carga horária abaixo:"). */
  let subitemParent: EmployeeEntry | null = null;

  const open = () => {
    index++;
    competencias[index] = null;
    hasContent = false;
    hasData = false;
    section = null;
    lastEntry = null;
    subitemParent = null;
  };
  const capture = (line: string) => {
    if (index >= 0 && !competencias[index]) competencias[index] = findCompetencia(line);
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      prev = 'blank';
      subitemParent = null;
      return;
    }
    if (SEPARATOR_RE.test(line)) {
      open();
      prev = 'blank';
      return;
    }
    const folded = collapseSpaces(fold(trimmed));
    const empMatch = EMPLOYEE_RE.exec(line);
    const sectionInfo = empMatch ? null : detectSection(line);
    const isGreeting = !empMatch && !sectionInfo && GREETING_RE.test(folded);
    const isRecipient = !empMatch && !sectionInfo && !isGreeting && (RECIPIENT_RE.test(line) || RECIPIENT_GREETING_RE.test(line));

    if (isRecipient) {
      if (index < 0 || hasContent) open();
      hasContent = true;
      capture(line);
      prev = 'recipient';
      lastEntry = null;
      return;
    }
    if (isGreeting) {
      const attachment = ATTACHMENT_RE.test(folded);
      if (index < 0 || (hasData && prev !== 'recipient' && prev !== 'greeting' && !attachment)) open();
      hasContent = true;
      capture(line);
      if (attachment) loose.push({ messageIndex: index, line: i, text: trimmed });
      prev = 'greeting';
      lastEntry = null;
      return;
    }

    if (index < 0) open();
    hasContent = true;

    if (sectionInfo) {
      section = sectionInfo;
      hasData = true;
      prev = 'other';
      lastEntry = null;
      subitemParent = null;
      return;
    }

    if (empMatch) {
      const number = empMatch[1]!;
      const nameOffset = empMatch[0].length;
      const lineFolded = fold(line);
      const subValue = SUBITEM_VALUE_RE.exec(lineFolded);
      const parent = subitemParent as EmployeeEntry | null;
      // Sub-item: "1005 - HORA AULA PPE - correto 9" após "... ajustar a carga horária abaixo:".
      if (parent && subValue && (PAYROLL_TERMS_RE.test(lineFolded) || /correto|corrigir/.test(lineFolded) || number.length >= 4)) {
        parent.subitems.push({
          code: number,
          label: collapseSpaces(line.slice(nameOffset, subValue.index).replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')),
          valueText: subValue[1] ?? '',
          line: i,
          text: trimmed,
        });
        hasData = true;
        prev = 'subitem';
        return;
      }
      const split = splitNameAndRemainder(line.slice(nameOffset));
      if (split) {
        const entry: EmployeeEntry = {
          messageIndex: index,
          line: i,
          matricula: number,
          name: cleanName(split.rawName),
          text: split.remainder.replace(/^[\s\-–—:]+/, ''),
          subitems: [],
          section,
        };
        entries.push(entry);
        hasData = true;
        lastEntry = entry;
        subitemParent = /(abaixo|seguinte[s]?)\s*:?\s*$|:\s*$/.test(fold(entry.text).trim()) ? entry : null;
        prev = 'employee';
        return;
      }
    }

    // Continuação da linha anterior (ex.: hora extra que quebrou de linha).
    const last = lastEntry as EmployeeEntry | null;
    if (last && (prev === 'employee' || prev === 'continuation') && CONTINUATION_DATA_RE.test(folded)) {
      last.text = `${last.text} / ${trimmed}`;
      prev = 'continuation';
      return;
    }

    loose.push({ messageIndex: index, line: i, text: trimmed });
    capture(line);
    prev = 'other';
    lastEntry = null;
  });

  return { competencias, entries, loose };
}
