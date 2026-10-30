import { dynamicKey, isImportable, type DynamicPrefix, type NotImportableKey } from '../domain/categories';
import type { EmployeeEntry, SubItem } from './MessageParser';
import { findBareNumber, findDateIndexes, findDayRange, findMoney, findQuantity, findTimeIntervals, isRecurrent, parseBrNumber } from './MovementNormalizer';
import { collapseSpaces, fold, trimEdges } from './text';

export interface Movement {
  messageIndex: number;
  line: number;
  matricula: string;
  name: string;
  categoryKey: string;
  /** Rubrica citada na própria mensagem (ex.: "1005 - HORA AULA PPE"). */
  rubrica: string | null;
  /** Valor ou quantidade. `null` quando a mensagem não informa: nada é presumido. */
  amount: number | null;
  /** Recorrente ("até dezembro", "deixar fixo"). */
  fixo: boolean;
  source: string;
}

function make(entry: EmployeeEntry, source: string, categoryKey: string, amount: number | null = null): Movement {
  return {
    messageIndex: entry.messageIndex,
    line: entry.line,
    matricula: entry.matricula,
    name: entry.name,
    categoryKey,
    rubrica: null,
    amount,
    fixo: false,
    source: collapseSpaces(trimEdges(source)),
  };
}

/** Pedidos que valem para a linha inteira e não viram lançamento. */
function classifyWhole(entry: EmployeeEntry, text: string): NotImportableKey | null {
  const f = fold(text);
  if (
    entry.section?.kind === 'CADASTRAL' ||
    /passa(ra|r)?\s+a\s+receb|solicitou\s+(a\s+)?(reducao|aumento|alteracao)|(reducao|aumento)\s+de\s+carga|alteracao\s+(de\s+|do\s+|da\s+)?(salario|cargo|funcao|carga)|reajuste\s+salarial|novo\s+salario/.test(f)
  ) {
    return 'ALTERACAO_CADASTRAL';
  }
  if (/\b(checar|conferir|verificar|confira|cheque|verifique)\b/.test(f)) return 'CONFERENCIA';
  if (
    /licenca[\s-]+(maternidade|medica|paternidade|saude)|substituindo\s+a\s+licenca|ate\s+o\s+(dia\s+do\s+)?retorno/.test(f) &&
    !findQuantity(f) &&
    findMoney(f) === null
  ) {
    return 'DEPENDENCIA_EXTERNA';
  }
  if (/\b(ela|ele)\s+e\s+d[oa]s?\b|\bpertence\s+a|transferid|outra\s+(empresa|unidade|filial)/.test(f)) return 'INFO_VINCULO';
  return null;
}

/** Um lançamento por intervalo, com a duração bruta (sem percentual nem desconto de refeição). */
function classifyOvertime(entry: EmployeeEntry, text: string): Movement[] {
  const f = fold(text);
  const intervals = findTimeIntervals(f);
  if (intervals.length === 0) {
    const q = findQuantity(f);
    return [make(entry, text, 'HORA_EXTRA', q?.unit === 'horas' ? q.value : null)];
  }
  const dates = findDateIndexes(f);
  return intervals.map((iv) => {
    const start = [...dates].reverse().find((d) => d < iv.index) ?? iv.index;
    return make(entry, text.slice(start, iv.index + iv.length), 'HORA_EXTRA', iv.hours);
  });
}

const SPLIT_RE = /\s*\+\s*|\s+e\s+(?=(?:pagar|descontar|acrescentar|ajustar|ajustas|alterar|incluir|lancar|adicionar)\b)/g;

export function splitFragments(text: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of fold(text).matchAll(SPLIT_RE)) {
    out.push(text.slice(last, m.index));
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out.map(trimEdges).filter(Boolean);
}

function substitutionKey(frag: string): string {
  const fl = fold(frag);
  if (/fundam[a-z]*\.?\s*(ii|2)\b|\bef\s*-?\s*(ii|2)\b|\bfund\.?\s*(ii|2)\b/.test(fl)) return 'SUBST_AULAS_EF2';
  if (/fundam[a-z]*\.?\s*(i|1)\b|\bef\s*-?\s*(i|1)\b|\bfund\.?\s*(i|1)\b/.test(fl)) return 'SUBST_AULAS_EF1';
  if (/ensino\s+medio/.test(fl) || /\bE\.?M\b/.test(frag)) return 'SUBST_AULAS_EM';
  if (/infantil/.test(fl) || /\bE\.?I\b/.test(frag)) return 'SUBST_AULAS_EI';
  return 'SUBST_AULAS';
}

/** Trecho original correspondente a um grupo capturado sobre o texto normalizado. */
function originalGroup(frag: string, m: RegExpExecArray, group: number): string {
  const g = m[group] ?? '';
  const start = m.index + m[0].lastIndexOf(g);
  return frag.slice(start, start + g.length).trim();
}

/** "assumiu em 27/04/2026 a aula mensalista ... R$ 2500,00 (precisa pagar os dias 27/04 - 30/04)" */
function classifyMensalista(entry: EmployeeEntry, frag: string, year: number): Movement[] {
  const fl = fold(frag);
  const m = /(aula\s+mensalista(?:\s+(?:no|na|do|da|de))?(?:\s+[a-z]+)?)/.exec(fl);
  const descr = m ? originalGroup(frag, m, 1) : 'mensalista';
  const range = findDayRange(fl, year);
  const end = range ? fl.lastIndexOf('(', range.index) : -1;
  const salaryEnd = end > 0 ? end : (range?.index ?? frag.length);

  const monthly = make(entry, frag.slice(0, salaryEnd), dynamicKey('SALARIO', descr), findMoney(fl));
  monthly.fixo = true;
  if (!range) return [monthly];
  return [monthly, make(entry, frag.slice(salaryEnd), dynamicKey('PROPORCIONAL', descr), range.days)];
}

function classifyFragment(entry: EmployeeEntry, frag: string, state: { subst: boolean }, year: number): Movement[] {
  const fl = fold(frag);
  const sec = entry.section?.kind;
  const q = findQuantity(fl);
  const money = findMoney(fl);
  const dynamic = (prefix: DynamicPrefix, descr: string, amount: number | null) => [make(entry, frag, dynamicKey(prefix, descr), amount)];
  const simple = (key: string, amount: number | null) => [make(entry, frag, key, amount)];

  // Cabeçalho de sub-itens ("ajustar a carga horária abaixo:"): quem gera lançamento são os sub-itens.
  if (/carga\s+horaria/.test(fl) && entry.subitems.length > 0 && money === null) return [];

  if (sec === 'REEMBOLSOS' || /reembols|ressarc/.test(fl)) {
    const topic = /(consignado|estacionamento|combustivel|transporte|alimentacao|curso|exame|material|uber|taxi|pedagio)/.exec(fl);
    return dynamic('REEMBOLSO', topic?.[1] ?? 'outros', money);
  }
  if (/sindica/.test(fl)) return simple('DESC_SINDICATO', money);
  if (/material\s+didatico/.test(fl)) return simple('DESC_MATERIAL_DIDATICO', money);
  if (/desconto.*contraturno|contraturno.*desconto/.test(fl) && !/\bsalario\b/.test(fl)) return simple('DESC_CONTRATURNO', money);
  if (sec === 'COPARTICIPACAO' || /coparticipa|convenio/.test(fl)) return simple('DESC_COPARTICIPACAO', money);

  if (sec === 'FALTAS' || /\bfaltas?\b|\bausencias?\b|\bdescontar\s+\d/.test(fl)) {
    const key = q?.unit === 'aulas' ? 'FALTA_AULAS' : q?.unit === 'horas' ? 'FALTA_HORAS' : 'FALTA_DIAS';
    return simple(key, q?.value ?? null);
  }

  if (state.subst || sec === 'SUBSTITUICOES' || /substitu/.test(fl)) {
    state.subst = true;
    const withoutDates = fl.replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, (s) => ' '.repeat(s.length));
    return simple(q?.unit === 'horas' ? 'SUBST_HORAS' : substitutionKey(frag), q?.value ?? findBareNumber(withoutDates));
  }

  if (/complemento\s+(de\s+)?salari|complemento\s+salarial/.test(fl)) return simple('COMPLEMENTO_SALARIO_DIAS', q?.value ?? null);
  if (/diferenca/.test(fl)) return simple('DIFERENCA_SALARIAL', money);
  if (/mensalista/.test(fl)) return classifyMensalista(entry, frag, year);

  const salario = /\bsalario\s+(?:de\s+)?(.+?)(?=\s*[-(]|\s+r\$|\s+no\s+valor|\s+de\s+r\$|\s*$)/.exec(fl);
  if (salario) return dynamic('SALARIO', originalGroup(frag, salario, 1), money);

  const acresc = /\b(?:acrescentar|adicionar|incluir)\s+(\d+(?:[.,]\d+)?)\s*(?:aulas?|horas?|h(?![a-z]))?\s*(?:[-:]|\bde\b)?\s*(.*?)[\s.;]*$/.exec(fl);
  if (acresc) return dynamic('ACRESCIMO', originalGroup(frag, acresc, 2) || 'sem descricao', parseBrNumber(acresc[1] ?? ''));

  if (/carga\s+horaria/.test(fl)) return simple('ALTERACAO_CADASTRAL', null);

  return [make(entry, frag, 'NAO_INTERPRETADO')];
}

function classifySubitem(entry: EmployeeEntry, sub: SubItem): Movement {
  const m = make(entry, sub.text, dynamicKey('RUBRICA', sub.code), parseBrNumber(sub.valueText));
  m.line = sub.line;
  m.rubrica = sub.code;
  return m;
}

export function classifyEntry(entry: EmployeeEntry, year: number): Movement[] {
  const out: Movement[] = [];
  const f = fold(entry.text);
  const whole = classifyWhole(entry, entry.text);

  if (!entry.text.trim() && entry.subitems.length === 0) out.push(make(entry, '', 'NAO_INTERPRETADO'));
  else if (whole) out.push(make(entry, entry.text, whole));
  else if (entry.section?.kind === 'HORA_EXTRA' || /horas?\s+extras?/.test(f)) out.push(...classifyOvertime(entry, entry.text));
  else {
    const state = { subst: false };
    for (const frag of splitFragments(entry.text)) out.push(...classifyFragment(entry, frag, state, year));
  }
  for (const sub of entry.subitems) out.push(classifySubitem(entry, sub));

  for (const m of out) {
    const canRecur = m.categoryKey !== 'DIFERENCA_SALARIAL' && !m.categoryKey.startsWith('PROPORCIONAL:') && isImportable(m.categoryKey);
    if (canRecur && (isRecurrent(fold(m.source)) || entry.section?.recurrent)) m.fixo = true;
  }
  return out;
}
