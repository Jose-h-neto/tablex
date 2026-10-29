import { parseCompetencia } from '../domain/competencia';
import type {
  Competencia,
  EmployeeEntry,
  ParsedMessage,
  Piece,
  SectionInfo,
  Segment,
  SegmentKind,
  SubItem,
} from '../domain/types';
import { findRecurrence } from './MovementNormalizer';
import { cleanName, collapseSpaces, fold, normalizeInput, splitLines } from './text';

export interface ParseOutput {
  text: string;
  messages: ParsedMessage[];
  segments: Segment[];
  entries: EmployeeEntry[];
}

/* ---------- Classificação de linhas ---------- */

const SEPARATOR_RE = /^\s*(?:-{3,}|={3,}|_{3,}|\*{3,})\s*$/;
const RECIPIENT_RE = /^\s*(\p{Lu}\p{Ll}+)(?:\s+(\p{Lu}\p{Ll}+))?\s*[,!.]*\s*$/u;
const RECIPIENT_GREETING_RE = /^\s*(\p{Lu}\p{Ll}+)\s*,\s*(?:bom dia|boa tarde|boa noite|ol[aá]|oi|tudo bem)\b/iu;
const GREETING_RE =
  /^(bom dia|boa tarde|boa noite|ola\b|oi\b|prezad|espero|tudo bem|segue|seguem|obrigad|att\b|atenciosamente|abs\b|abracos|qualquer duvida|fico no aguardo|grat[ao])/;
const ATTACHMENT_RE = /(segue|seguem|em)\s+(o\s+|os\s+)?(arquivo|anexo|planilha)|\banexo\b/;
const EMPLOYEE_RE = /^\s*(\d{1,7})(?!\d)(?!\s*[/:,.]\s*\d)\s*[-–—.:]?\s*(?=[^\d\s/:])/;
const PAYROLL_TERMS_RE = /\b(hora|horas|aula|aulas|salario|adicional|dsr|gratificacao|desconto|abono|bonus|ppe|contraturno)\b/;
const SUBITEM_VALUE_RE = /[-:=]\s*(?:correto|correta|corrigir para|passa a ser|ajustar para|novo valor)?\s*:?\s*(\d+(?:[.,]\d+)?)\s*$/;
const CONTINUATION_DATA_RE = /\d{1,2}\/\d{1,2}|\d{1,2}[:h]\d{2}|r\$\s*\d/;
const NAME_CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', "d'"]);

export function detectSection(line: string, comp: Competencia | null): SectionInfo | null {
  const f = collapseSpaces(fold(line));
  if (!f || /^\d/.test(f) || f.length > 80) return null;
  const core = f.replace(/[\s:.!]+$/, '');
  const make = (kind: SectionInfo['kind']): SectionInfo => ({ kind, label: collapseSpaces(line).replace(/:\s*$/, ''), recurrence: null });

  if (/^(segue(m)?\s+(as\s+)?)?correc(ao|oes)\b/.test(core) || /^retificac/.test(core)) return make('CORRECOES');
  if (/^(desconto(s)?\s+(por|de)\s+faltas?|faltas?(\s+e\s+atrasos)?)$/.test(core)) return make('FALTAS');
  if (/^descontos?$/.test(core)) return make('DESCONTOS');
  if (/^substitu[a-z]*$/.test(core)) return make('SUBSTITUICOES');
  if (/^horas?\s+extras?$/.test(core)) return make('HORA_EXTRA');
  if (/coparticipa/.test(core) && !/r\$/.test(core)) return make('COPARTICIPACAO');
  if (/^(reembolsos?|ressarcimentos?)$/.test(core)) return make('REEMBOLSOS');
  if (/^alterac(ao|oes)\b/.test(core)) return make('CADASTRAL');
  if (/^(acrescentar|incluir|adicionar|acrescimos?)\b/.test(core) && f.endsWith(':')) {
    const s = make('ACRESCIMOS');
    const rec = comp ? findRecurrence(f, comp) : null;
    s.recurrence = rec ? { ...rec, source: 'secao' } : null;
    return s;
  }
  if (GREETING_RE.test(core)) return null;
  if (f.endsWith(':') && !/\d/.test(f) && core.split(' ').length <= 6) return make('OUTRA');
  return null;
}

function findCompetencia(line: string): { comp: Competencia; index: number; length: number } | null {
  const f = fold(line);
  const preferred = /(?:folha|competencia|mes|fechamento|referente\s+a?o?)\D{0,20}?(\d{1,2}\s*\/\s*\d{4})/.exec(f);
  const any = /(?<![\d/])(\d{1,2}\s*\/\s*\d{4})(?![\d/])/.exec(f);
  const m = preferred ?? any;
  if (!m || m[1] === undefined) return null;
  const comp = parseCompetencia(m[1].replace(/\s/g, ''));
  if (!comp) return null;
  return { comp, index: m.index + m[0].length - m[1].length, length: m[1].length };
}

/* ---------- Separação matrícula / nome / descrição ---------- */

interface NameSplit {
  rawName: string;
  nameStart: number;
  remainder: Piece;
}

const SEPARATOR_AFTER_NAME = /\s+[-–—]\s*|[-–—]\s+|\s*:\s*/;

function isUpperWord(w: string): boolean {
  const letters = w.replace(/[^\p{L}]/gu, '');
  return letters.length > 0 && letters === letters.toUpperCase();
}

const NOT_NAME_START = new Set(['aula', 'aulas', 'hora', 'horas', 'dia', 'dias', 'falta', 'faltas', 'reais', 'de', 'as', 'a', 'h']);

function looksLikeName(candidate: string): boolean {
  const c = candidate.replace(/[¿�]/g, '').trim();
  if (c.length < 3 || /\d|r\$/i.test(c)) return false;
  const words = c.split(/\s+/);
  if (NOT_NAME_START.has(fold(words[0] ?? ''))) return false;
  return words.some((w) => /^\p{L}{2,}$/u.test(w.replace(/['’]/g, ''))) && words.length <= 10;
}

/** `afterNumber` é a linha a partir do primeiro caractere do nome. */
export function splitNameAndRemainder(afterNumber: string, offset: number): NameSplit | null {
  const sep = SEPARATOR_AFTER_NAME.exec(afterNumber);
  if (sep && sep.index > 0) {
    const candidate = afterNumber.slice(0, sep.index);
    if (looksLikeName(candidate)) {
      const remStart = sep.index + sep[0].length;
      return {
        rawName: candidate,
        nameStart: offset,
        remainder: { text: afterNumber.slice(remStart), start: offset + remStart },
      };
    }
  }
  // Sem separador: o nome termina na primeira palavra que não pertence ao nome
  // (minúscula fora dos conectores, número ou símbolo), ex.: "FULANO DE TAL  descontar 6 aulas".
  const wordRe = /\S+/g;
  let end = 0;
  let count = 0;
  for (const w of afterNumber.matchAll(wordRe)) {
    const word = w[0];
    const isName = /^[\p{L}'’¿]+$/u.test(word) && (isUpperWord(word) || (count > 0 && NAME_CONNECTORS.has(word.toLowerCase())));
    if (!isName) break;
    end = w.index + word.length;
    count++;
  }
  if (count === 0) {
    return looksLikeName(afterNumber) ? { rawName: afterNumber, nameStart: offset, remainder: { text: '', start: offset + afterNumber.length } } : null;
  }
  const rawName = afterNumber.slice(0, end);
  if (!looksLikeName(rawName)) return null;
  return { rawName, nameStart: offset, remainder: { text: afterNumber.slice(end), start: offset + end } };
}

/* ---------- Parser ---------- */

interface MessageBuilder {
  msg: ParsedMessage;
  hasContent: boolean;
  hasData: boolean;
  fingerprintLines: string[];
  section: SectionInfo | null;
  lastEnd: number;
}

export function parseMessages(rawText: string, fallbackComp: Competencia): ParseOutput {
  const text = normalizeInput(rawText);
  const lines = splitLines(text);
  const messages: ParsedMessage[] = [];
  const segments: Segment[] = [];
  const entries: EmployeeEntry[] = [];

  let cur: MessageBuilder | null = null;
  let prevKind: SegmentKind | 'blank' = 'blank';
  /** Linha de funcionário que anunciou sub-itens ("ajustar a carga horária abaixo:"). */
  let subitemParent: EmployeeEntry | null = null;
  let lastEntry: EmployeeEntry | null = null;

  const closeMessage = () => {
    if (!cur) return;
    const previous = messages[messages.length - 1];
    if (cur.hasContent && !cur.hasData && previous) {
      // Assinatura/saudação final sem dados: pertence à mensagem anterior.
      for (const seg of segments) if (seg.messageId === cur.msg.id) seg.messageId = previous.id;
      previous.span.end = cur.lastEnd;
    } else if (cur.hasContent) {
      cur.msg.span.end = cur.lastEnd;
      cur.msg.fingerprint = cur.fingerprintLines.join('\n');
      messages.push(cur.msg);
    }
    cur = null;
  };

  const openMessage = (start: number): MessageBuilder => {
    closeMessage();
    const index = messages.length;
    const b: MessageBuilder = {
      msg: {
        id: `msg${index + 1}`,
        index,
        span: { start, end: start },
        recipient: null,
        competencia: null,
        competenciaSpan: null,
        isCorrection: false,
        fingerprint: '',
        duplicateOf: null,
      },
      hasContent: false,
      hasData: false,
      fingerprintLines: [],
      section: null,
      lastEnd: start,
    };
    cur = b;
    return b;
  };

  const push = (b: MessageBuilder, kind: SegmentKind, line: Piece, note: string | null = null): Segment => {
    const seg: Segment = {
      id: `seg${segments.length + 1}`,
      messageId: b.msg.id,
      kind,
      span: { start: line.start, end: line.start + line.text.length },
      text: line.text,
      note,
    };
    segments.push(seg);
    b.hasContent = true;
    b.lastEnd = seg.span.end;
    if (kind === 'employee' || kind === 'subitem' || kind === 'continuation' || kind === 'section') {
      b.hasData = true;
      b.fingerprintLines.push(collapseSpaces(fold(line.text)));
    }
    return seg;
  };

  const captureCompetencia = (b: MessageBuilder, line: Piece) => {
    if (b.msg.competencia) return;
    const c = findCompetencia(line.text);
    if (c) {
      b.msg.competencia = c.comp;
      b.msg.competenciaSpan = { start: line.start + c.index, end: line.start + c.index + c.length };
    }
  };

  for (const line of lines) {
    const trimmed = line.text.trim();
    if (!trimmed) {
      prevKind = 'blank';
      subitemParent = null;
      continue;
    }
    const folded = collapseSpaces(fold(trimmed));

    if (SEPARATOR_RE.test(line.text)) {
      const b = cur ?? openMessage(line.start);
      push(b, 'separator', line);
      closeMessage();
      prevKind = 'separator';
      continue;
    }

    const empMatch = EMPLOYEE_RE.exec(line.text);
    const section = empMatch ? null : detectSection(line.text, (cur as MessageBuilder | null)?.msg.competencia ?? fallbackComp);
    const isGreeting = !empMatch && !section && GREETING_RE.test(folded);
    const isRecipient = !empMatch && !section && !isGreeting && (RECIPIENT_RE.test(line.text) || RECIPIENT_GREETING_RE.test(line.text));

    if (isRecipient) {
      const open = cur as MessageBuilder | null;
      const b = !open || open.hasContent ? openMessage(line.start) : open;
      b.msg.recipient = (RECIPIENT_GREETING_RE.exec(line.text)?.[1] ?? RECIPIENT_RE.exec(line.text)?.[1]) || null;
      push(b, 'recipient', line);
      captureCompetencia(b, line);
      prevKind = 'recipient';
      lastEntry = null;
      continue;
    }

    if (isGreeting) {
      let b = cur as MessageBuilder | null;
      if (!b || (b.hasData && prevKind !== 'recipient' && prevKind !== 'greeting' && !ATTACHMENT_RE.test(folded))) b = openMessage(line.start);
      const isAttachment = ATTACHMENT_RE.test(folded);
      push(
        b,
        isAttachment ? 'info' : 'greeting',
        line,
        isAttachment ? 'Menciona arquivo anexo — o conteúdo do anexo não é processado por esta ferramenta.' : null,
      );
      captureCompetencia(b, line);
      prevKind = isAttachment ? 'info' : 'greeting';
      lastEntry = null;
      continue;
    }

    const b: MessageBuilder = cur ?? openMessage(line.start);

    if (section) {
      push(b, 'section', line);
      if (section.kind === 'CORRECOES') b.msg.isCorrection = true;
      b.section = section;
      prevKind = 'section';
      lastEntry = null;
      subitemParent = null;
      continue;
    }

    if (empMatch) {
      const number = empMatch[1]!;
      const nameOffset = empMatch[0].length;
      const afterNumber = line.text.slice(nameOffset);
      const lineFolded = fold(line.text);

      // Sub-item: "1005 - HORA AULA PPE - correto 9" após "... ajustar a carga horária abaixo:"
      const subValue = SUBITEM_VALUE_RE.exec(lineFolded);
      const isSubitem =
        subitemParent !== null &&
        subValue !== null &&
        (PAYROLL_TERMS_RE.test(lineFolded) || /correto|corrigir/.test(lineFolded) || number.length >= 4);
      if (isSubitem && subitemParent && subValue) {
        const seg = push(b, 'subitem', line);
        const valueStart = line.start + subValue.index + subValue[0].lastIndexOf(subValue[1] ?? '');
        const labelText = afterNumber
          .slice(0, subValue.index - nameOffset)
          .replace(/[\s\-–—:]+$/, '')
          .replace(/^[\s\-–—:]+/, '');
        const item: SubItem = {
          segmentId: seg.id,
          span: seg.span,
          code: number,
          label: collapseSpaces(labelText),
          valueText: subValue[1] ?? '',
          valueStart,
        };
        subitemParent.subitems.push(item);
        prevKind = 'subitem';
        continue;
      }

      const split = splitNameAndRemainder(afterNumber, line.start + nameOffset);
      if (split) {
        const seg = push(b, 'employee', line);
        const { name, changed } = cleanName(split.rawName);
        const entry: EmployeeEntry = {
          id: `ent${entries.length + 1}`,
          messageId: b.msg.id,
          segmentId: seg.id,
          lineSpan: seg.span,
          matricula: number,
          rawName: split.rawName,
          name,
          nameNormalized: changed,
          remainder: { ...split.remainder },
          continuations: [],
          subitems: [],
          section: b.section,
        };
        // Remove separadores redundantes no início da descrição (": : 26/09").
        const lead = /^[\s\-–—:]+/.exec(entry.remainder.text);
        if (lead) entry.remainder = { text: entry.remainder.text.slice(lead[0].length), start: entry.remainder.start + lead[0].length };
        entries.push(entry);
        lastEntry = entry;
        subitemParent = /(abaixo|seguinte[s]?)\s*:?\s*$|:\s*$/.test(fold(entry.remainder.text).trim()) ? entry : null;
        prevKind = 'employee';
        continue;
      }
    }

    // Continuação da linha anterior (ex.: hora extra que quebrou de linha).
    if (lastEntry && (prevKind === 'employee' || prevKind === 'continuation') && CONTINUATION_DATA_RE.test(folded)) {
      const seg = push(b, 'continuation', line);
      lastEntry.continuations.push({ text: line.text, start: line.start, segmentId: seg.id });
      prevKind = 'continuation';
      continue;
    }

    push(b, 'unrecognized', line, 'Linha não reconhecida: não contém matrícula nem corresponde a um padrão conhecido.');
    captureCompetencia(b, line);
    prevKind = 'unrecognized';
    lastEntry = null;
  }
  closeMessage();

  // Mensagens repetidas (mesmo conteúdo de dados).
  const seen = new Map<string, string>();
  for (const msg of messages) {
    if (!msg.fingerprint) continue;
    const prev = seen.get(msg.fingerprint);
    if (prev) msg.duplicateOf = prev;
    else seen.set(msg.fingerprint, msg.id);
  }

  return { text, messages, segments, entries };
}
