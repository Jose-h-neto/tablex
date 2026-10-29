import { dynamicKey, getCategory, titleCase, type CategoryDef } from '../domain/categories';
import { formatCompetencia, formatIsoBr, parseIso, weekdayShort, MONTH_NAMES } from '../domain/competencia';
import type { Competencia, EmployeeEntry, ExtractionFlag, Movement, ParsedMessage, SubItem } from '../domain/types';
import {
  findBareNumber,
  findDateRanges,
  findDates,
  findMoney,
  findMonthNames,
  findQuantities,
  findRecurrence,
  findTimeIntervals,
  parseBrNumber,
  unitFromWord,
} from './MovementNormalizer';
import { fold, MappedText } from './text';

export type MovementDraft = Omit<Movement, 'id' | 'observation' | 'messageIndex' | 'competenciaFromMessage'>;

interface Ctx {
  entry: EmployeeEntry;
  message: ParsedMessage;
  comp: Competencia;
}

function cat(key: string): CategoryDef {
  const c = getCategory(key);
  if (!c) throw new Error(`Categoria desconhecida: ${key}`);
  return c;
}

function base(ctx: Ctx, frag: MappedText, category: CategoryDef): MovementDraft {
  const t = frag.trim();
  return {
    messageId: ctx.message.id,
    entryId: ctx.entry.id,
    segmentId: ctx.entry.segmentId,
    lineSpan: ctx.entry.lineSpan,
    fragmentSpan: t.length > 0 ? t.span() : ctx.entry.lineSpan,
    sourceText: t.text,
    matricula: ctx.entry.matricula,
    employeeName: ctx.entry.name,
    categoryKey: category.key,
    categoryLabel: category.label,
    nature: category.nature,
    unit: category.unit,
    amount: null,
    competencia: ctx.comp,
    referenceDates: [],
    referenceMonths: [],
    details: [],
    recurrence: null,
    fixed: false,
    explicitRubric: null,
    importable: category.importable,
    flags: [],
  };
}

function flag(d: MovementDraft, code: ExtractionFlag['code'], message: string): void {
  if (!d.flags.some((f) => f.code === code && f.message === message)) d.flags.push({ code, message });
}

const fmtNum = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const fmtMoney = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Datas e meses citados no trecho viram referências (vão para a observação). */
function addRefs(d: MovementDraft, frag: MappedText, comp: Competencia): void {
  for (const m of findDates(frag.folded, comp)) {
    if (m.value.iso) {
      if (!d.referenceDates.includes(m.value.iso)) d.referenceDates.push(m.value.iso);
    } else flag(d, 'DATA_INCONSISTENTE', `Data inválida no texto: “${m.value.raw}”.`);
  }
  for (const m of findMonthNames(frag.folded)) {
    // "até (o final de) dezembro" é recorrência, não mês de referência.
    if (/\bate\s+(o\s+)?((final|fim)\s+)?(de\s+|do\s+mes\s+de\s+)?$/.test(frag.folded.slice(Math.max(0, m.index - 30), m.index))) continue;
    const name = MONTH_NAMES[m.value - 1]!;
    const pretty = name === 'marco' ? 'março' : name;
    if (!d.referenceMonths.includes(pretty)) d.referenceMonths.push(pretty);
  }
}

/** Primeiro valor monetário; sinaliza quando o trecho tem mais de um. */
function takeMoney(d: MovementDraft, frag: MappedText): void {
  const money = findMoney(frag.folded, true);
  const first = money[0];
  if (first) d.amount = first.value;
  if (money.length > 1) {
    flag(
      d,
      'VALOR_MULTIPLO',
      `Mais de um valor no trecho (${money.map((m) => fmtMoney(m.value)).join(', ')}); usado o primeiro. Separe com “+” se forem lançamentos distintos.`,
    );
  }
}

/* ---------- Regras aplicadas à linha inteira ---------- */

function classifyWhole(ctx: Ctx, full: MappedText): MovementDraft | null {
  const f = full.folded;
  const sec = ctx.entry.section?.kind;
  const notImportable = (key: string, message: string) => {
    const d = base(ctx, full, cat(key));
    const money = findMoney(f, true)[0];
    const qty = findQuantities(f)[0];
    d.amount = money?.value ?? qty?.value.value ?? null;
    if (qty && !money) d.unit = qty.value.unit;
    else if (money) d.unit = 'valor';
    flag(d, 'NAO_IMPORTAVEL', message);
    return d;
  };

  if (
    sec === 'CADASTRAL' ||
    /passa(ra|r)?\s+a\s+receb|solicitou\s+(a\s+)?(reducao|aumento|alteracao)|(reducao|aumento)\s+de\s+carga|alteracao\s+(de\s+|do\s+|da\s+)?(salario|cargo|funcao|carga)|reajuste\s+salarial|novo\s+salario/.test(f)
  ) {
    return notImportable(
      'ALTERACAO_CADASTRAL',
      'Alteração salarial/cadastral: a planilha de movimento variável não altera cadastro. Tratar diretamente no sistema.',
    );
  }
  if (/\b(checar|conferir|verificar|confira|cheque|verifique)\b/.test(f)) {
    return notImportable(
      'CONFERENCIA',
      'Pedido de conferência sem quantidade/valor: consultar ponto ou registros e lançar manualmente.',
    );
  }
  if (
    /licenca[\s-]+(maternidade|medica|paternidade|saude)|substituindo\s+a\s+licenca|ate\s+o\s+(dia\s+do\s+)?retorno/.test(f) &&
    findQuantities(f).length === 0 &&
    findMoney(f, true).length === 0
  ) {
    return notImportable(
      'DEPENDENCIA_EXTERNA',
      'Pagamento depende de dados externos (período até o retorno, salário de referência). A mensagem não traz quantidade nem valor.',
    );
  }
  if (/\b(ela|ele)\s+e\s+d[oa]s?\b|\bpertence\s+a|transferid|outra\s+(empresa|unidade|filial)/.test(f)) {
    return notImportable('INFO_VINCULO', 'Informação de vínculo/empresa, não é uma movimentação. Verificar cadastro do funcionário.');
  }
  return null;
}

/* ---------- Hora extra por intervalos ---------- */

function classifyOvertime(ctx: Ctx, full: MappedText): MovementDraft[] {
  const f = full.folded;
  const intervals = findTimeIntervals(f);
  if (intervals.length === 0) {
    const d = base(ctx, full, cat('HORA_EXTRA'));
    const q = findQuantities(f).find((x) => x.value.unit === 'horas');
    if (q) d.amount = q.value.value;
    addRefs(d, full, ctx.comp);
    flag(d, 'HORA_EXTRA_REGRA', 'Percentual (50%/100%) e enquadramento da hora extra não informados. Confirme a rubrica.');
    return [d];
  }
  const dates = findDates(f, ctx.comp);
  return intervals.map((iv) => {
    const date = [...dates].reverse().find((dm) => dm.index < iv.index);
    const start = date ? date.index : iv.index;
    const d = base(ctx, full.slice(start, iv.index + iv.length), cat('HORA_EXTRA'));
    if (!iv.value) {
      flag(d, 'DATA_INCONSISTENTE', 'Horário inválido no intervalo.');
      return d;
    }
    d.amount = iv.value.hours;
    const iso = date?.value.iso ?? null;
    if (iso) d.referenceDates.push(iso);
    else if (date) flag(d, 'DATA_INCONSISTENTE', `Data inválida no texto: “${date.value.raw}”.`);
    else flag(d, 'DATA_INCONSISTENTE', 'Intervalo de horário sem data associada.');
    const wd = iso ? weekdayShort(iso) : '';
    d.details.push(`${iso ? `${wd} ${formatIsoBr(iso, false)} ` : ''}${iv.value.start}–${iv.value.end}`);
    let msg = `Duração bruta do intervalo: ${fmtNum(iv.value.hours)} h. Percentual (50%/100%), intervalo de refeição e limites de jornada não são aplicados automaticamente.`;
    if (wd === 'sáb' || wd === 'dom') msg += ` A data cai em ${wd === 'sáb' ? 'sábado' : 'domingo'}.`;
    if (iv.value.hours > 8) msg += ' Intervalo superior a 8 h: verificar desconto de refeição.';
    flag(d, 'HORA_EXTRA_REGRA', msg);
    if (iv.value.overnight) flag(d, 'DATA_INCONSISTENTE', 'Horário final menor que o inicial: considerado como virada de dia.');
    return d;
  });
}

/* ---------- Fragmentos ---------- */

const SPLIT_RE = /\s*\+\s*|\s+e\s+(?=(?:pagar|descontar|acrescentar|ajustar|ajustas|alterar|incluir|lancar|adicionar)\b)/g;

export function splitFragments(full: MappedText): MappedText[] {
  const out: MappedText[] = [];
  let last = 0;
  for (const m of full.folded.matchAll(SPLIT_RE)) {
    out.push(full.slice(last, m.index));
    last = m.index + m[0].length;
  }
  out.push(full.slice(last));
  return out.map((p) => p.trim()).filter((p) => p.length > 0);
}

interface FragState {
  subst: boolean;
}

function substitutionKey(frag: MappedText): string {
  const fl = frag.folded;
  if (/fundam[a-z]*\.?\s*(ii|2)\b|\bef\s*-?\s*(ii|2)\b|\bfund\.?\s*(ii|2)\b/.test(fl)) return 'SUBST_AULAS_EF2';
  if (/fundam[a-z]*\.?\s*(i|1)\b|\bef\s*-?\s*(i|1)\b|\bfund\.?\s*(i|1)\b/.test(fl)) return 'SUBST_AULAS_EF1';
  if (/ensino\s+medio/.test(fl) || /\bE\.?M\b/.test(frag.text)) return 'SUBST_AULAS_EM';
  if (/infantil/.test(fl) || /\bE\.?I\b/.test(frag.text)) return 'SUBST_AULAS_EI';
  return 'SUBST_AULAS';
}

function originalSlice(frag: MappedText, m: RegExpExecArray, group: number): string {
  const g = m[group] ?? '';
  const start = m.index + m[0].lastIndexOf(g);
  return frag.text.slice(start, start + g.length).trim();
}

function classifyFragment(ctx: Ctx, frag: MappedText, state: FragState): MovementDraft[] {
  const fl = frag.folded;
  const sec = ctx.entry.section?.kind;
  const quantities = findQuantities(fl);
  const q = quantities[0]?.value;

  // Cabeçalho de sub-itens ("ajustar a carga horária abaixo:") — os sub-itens geram os lançamentos.
  if (/carga\s+horaria/.test(fl) && ctx.entry.subitems.length > 0 && findMoney(fl, true).length === 0) return [];

  if (sec === 'REEMBOLSOS' || /reembols|ressarc/.test(fl)) {
    const topic = /(consignado|estacionamento|combustivel|transporte|alimentacao|curso|exame|material|uber|taxi|pedagio)/.exec(fl);
    const d = base(ctx, frag, cat(dynamicKey('REEMBOLSO', topic?.[1] ?? 'outros')));
    takeMoney(d, frag);
    addRefs(d, frag, ctx.comp);
    return [d];
  }

  if (/sindica/.test(fl)) {
    const d = base(ctx, frag, cat('DESC_SINDICATO'));
    takeMoney(d, frag);
    addRefs(d, frag, ctx.comp);
    return [d];
  }

  if (/material\s+didatico/.test(fl)) {
    const d = base(ctx, frag, cat('DESC_MATERIAL_DIDATICO'));
    takeMoney(d, frag);
    addRefs(d, frag, ctx.comp);
    return [d];
  }

  if (/desconto.*contraturno|contraturno.*desconto/.test(fl) && !/\bsalario\b/.test(fl)) {
    const d = base(ctx, frag, cat('DESC_CONTRATURNO'));
    takeMoney(d, frag);
    addRefs(d, frag, ctx.comp);
    return [d];
  }

  if (sec === 'COPARTICIPACAO' || /coparticipa|convenio/.test(fl)) {
    const d = base(ctx, frag, cat('DESC_COPARTICIPACAO'));
    takeMoney(d, frag);
    addRefs(d, frag, ctx.comp);
    return [d];
  }

  if (sec === 'FALTAS' || /\bfaltas?\b|\bausencias?\b|\bdescontar\s+\d/.test(fl)) {
    const unit = q?.unit ?? 'dias';
    const key = unit === 'aulas' ? 'FALTA_AULAS' : unit === 'horas' ? 'FALTA_HORAS' : 'FALTA_DIAS';
    const d = base(ctx, frag, cat(key));
    addRefs(d, frag, ctx.comp);
    if (q) {
      d.amount = q.value;
      if (q.unitWord.startsWith('falta')) {
        flag(d, 'UNIDADE_INFERIDA', '“falta” interpretada como dia(s) de falta. Confirme se não se trata de aulas ou horas.');
      }
      if (unit === 'dias' && d.referenceDates.length > 0 && d.referenceDates.length !== q.value) {
        flag(d, 'DATA_INCONSISTENTE', `Quantidade (${fmtNum(q.value)}) diferente do número de datas citadas (${d.referenceDates.length}).`);
      }
    }
    return [d];
  }

  if (state.subst || sec === 'SUBSTITUICOES' || /substitu/.test(fl)) {
    state.subst = true;
    const key = q?.unit === 'horas' ? 'SUBST_HORAS' : substitutionKey(frag);
    const d = base(ctx, frag, cat(key));
    addRefs(d, frag, ctx.comp);
    if (q && (q.unit === 'horas' || q.unit === 'aulas')) d.amount = q.value;
    else if (q) {
      d.amount = q.value;
      d.unit = 'indefinida';
    } else {
      const bare = findBareNumber(fl.replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, (s) => ' '.repeat(s.length)));
      if (bare) {
        d.amount = bare.value;
        d.unit = 'indefinida';
      }
    }
    return [d];
  }

  if (/complemento\s+(de\s+)?salari|complemento\s+salarial/.test(fl)) {
    const d = base(ctx, frag, cat('COMPLEMENTO_SALARIO_DIAS'));
    addRefs(d, frag, ctx.comp);
    if (q) {
      d.amount = q.value;
      if (q.unit !== 'dias') d.unit = q.unit;
    }
    return [d];
  }

  if (/diferen[c]a/.test(fl)) {
    const d = base(ctx, frag, cat('DIFERENCA_SALARIAL'));
    takeMoney(d, frag);
    addRefs(d, frag, ctx.comp);
    return [d];
  }

  if (/mensalista/.test(fl)) return classifyMensalista(ctx, frag);

  const salario = /\bsalario\s+(?:de\s+)?(.+?)(?=\s*[-(]|\s+r\$|\s+no\s+valor|\s+de\s+r\$|\s*$)/.exec(fl);
  if (salario) {
    const descr = originalSlice(frag, salario, 1) || 'não especificado';
    const d = base(ctx, frag, cat(dynamicKey('SALARIO', descr)));
    d.categoryLabel = `Salário — ${titleCase(descr)}`;
    takeMoney(d, frag);
    addRefs(d, frag, ctx.comp);
    return [d];
  }

  const acresc = /\b(?:acrescentar|adicionar|incluir)\s+(\d+(?:[.,]\d+)?)\s*(aulas?|horas?|h(?![a-z]))?\s*(?:[-:]|\bde\b)?\s*(.*?)[\s.;]*$/.exec(fl);
  if (acresc) {
    const descr = originalSlice(frag, acresc, 3) || 'sem descrição';
    const d = base(ctx, frag, cat(dynamicKey('ACRESCIMO', descr)));
    d.categoryLabel = `Acréscimo — ${titleCase(descr)}`;
    d.amount = parseBrNumber(acresc[1] ?? '');
    d.unit = acresc[2] ? unitFromWord(acresc[2]) : 'indefinida';
    return [d];
  }

  if (/carga\s+horaria/.test(fl)) {
    const d = base(ctx, frag, cat('ALTERACAO_CADASTRAL'));
    const n = findBareNumber(fl);
    d.amount = q?.value ?? n?.value ?? null;
    flag(d, 'NAO_IMPORTAVEL', 'Alteração de carga horária é cadastral: a planilha de movimento variável não altera cadastro.');
    return [d];
  }

  const d = base(ctx, frag, cat('NAO_INTERPRETADO'));
  const money = findMoney(fl, true)[0];
  if (money) {
    d.amount = money.value;
    d.unit = 'valor';
  } else if (q) {
    d.amount = q.value;
    d.unit = q.unit;
  }
  addRefs(d, frag, ctx.comp);
  flag(
    d,
    'NAO_INTERPRETADO',
    'Tipo de movimentação não identificado. Informe a rubrica manualmente (e confira valor e unidade) ou envie para tratamento manual.',
  );
  return [d];
}

/** "assumiu em 27/04/2026 a aula mensalista ... no valor de R$ 2500,00 (precisa pagar os dias 27/04 - 30/04)" */
function classifyMensalista(ctx: Ctx, frag: MappedText): MovementDraft[] {
  const fl = frag.folded;
  const descrMatch = /(aula\s+mensalista(?:\s+(?:no|na|do|da|de))?(?:\s+[a-z]+)?)/.exec(fl);
  const descr = descrMatch ? originalSlice(frag, descrMatch, 1) : 'mensalista';
  const money = findMoney(fl, true)[0];
  const startMatch = /assumiu\s+(?:em\s+)?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/.exec(fl);
  const startIso = startMatch ? (findDates(startMatch[1] ?? '', ctx.comp)[0]?.value.iso ?? null) : null;

  const ranges = findDateRanges(fl, ctx.comp);
  const firstRange = ranges[0];
  const salaryEnd = firstRange ? Math.max(0, fl.lastIndexOf('(', firstRange.index)) || firstRange.index : frag.length;

  const monthly = base(ctx, frag.slice(0, salaryEnd), cat(dynamicKey('SALARIO', descr)));
  monthly.categoryLabel = `Salário — ${titleCase(descr)}`;
  monthly.amount = money?.value ?? null;
  monthly.fixed = true;
  monthly.recurrence = { untilMonth: null, untilYear: null, source: 'texto' };
  if (startIso) monthly.referenceDates.push(startIso);
  const out = [monthly];

  if (firstRange) {
    const prop = base(ctx, frag.slice(salaryEnd), cat(dynamicKey('PROPORCIONAL', descr)));
    prop.categoryLabel = `Dias proporcionais — ${titleCase(descr)}`;
    if (firstRange.value) {
      const r = firstRange.value;
      prop.amount = r.days;
      prop.referenceDates.push(r.from, r.to);
      flag(
        prop,
        'CALCULO_EXTERNO',
        `Pagamento proporcional lançado como ${r.days} dia(s) (${formatIsoBr(r.from, false)}–${formatIsoBr(r.to, false)})${
          money ? ` do valor mensal de ${fmtMoney(money.value)}` : ''
        }. A ferramenta não calcula o valor proporcional: confirme se a rubrica calcula pelos dias.`,
      );
      const rangeMonth = parseIso(r.from)!.month;
      const cited = findMonthNames(fl).map((m) => m.value);
      if (cited.length > 0 && !cited.includes(rangeMonth)) {
        const name = MONTH_NAMES[cited[0]! - 1]!;
        flag(
          prop,
          'DATA_INCONSISTENTE',
          `O texto cita “${name === 'marco' ? 'março' : name}”, mas o período informado é ${formatIsoBr(r.from, false)}–${formatIsoBr(r.to, false)}.`,
        );
      }
      if (startIso && startIso !== r.from) {
        flag(prop, 'DATA_INCONSISTENTE', `Data de início (${formatIsoBr(startIso)}) diferente do início do período pago (${formatIsoBr(r.from)}).`);
      }
    } else {
      flag(prop, 'DATA_INCONSISTENTE', 'Período de datas inválido.');
    }
    out.push(prop);
  }
  return out;
}

/* ---------- Sub-itens com rubrica explícita ---------- */

function classifySubitem(ctx: Ctx, sub: SubItem, text: string): MovementDraft {
  const frag = MappedText.from({ text: text.slice(sub.span.start, sub.span.end), start: sub.span.start });
  const d = base(ctx, frag, cat(dynamicKey('RUBRICA', sub.code)));
  d.categoryLabel = `${sub.code} — ${sub.label}`;
  d.explicitRubric = sub.code;
  d.amount = parseBrNumber(sub.valueText);
  const fl = fold(sub.label);
  d.unit = /aula/.test(fl) ? 'aulas' : /hora/.test(fl) ? 'horas' : /dia/.test(fl) ? 'dias' : 'indefinida';
  flag(
    d,
    'RUBRICA_DA_MENSAGEM',
    `Código ${sub.code} citado na mensagem como ajuste (“${sub.label} – ${sub.valueText}”). Confirme se deve ser lançado como movimento variável com quantidade ${sub.valueText}.`,
  );
  return d;
}

/* ---------- Entrada principal ---------- */

export function classifyEntry(entry: EmployeeEntry, message: ParsedMessage, comp: Competencia, sourceText: string): MovementDraft[] {
  const ctx: Ctx = { entry, message, comp };
  const full = MappedText.join([entry.remainder, ...entry.continuations]);
  const out: MovementDraft[] = [];

  if (full.trim().length === 0 && entry.subitems.length === 0) {
    const d = base(ctx, MappedText.from({ text: sourceText.slice(entry.lineSpan.start, entry.lineSpan.end), start: entry.lineSpan.start }), cat('NAO_INTERPRETADO'));
    flag(d, 'NAO_INTERPRETADO', 'Linha com matrícula e nome, mas sem descrição da movimentação.');
    out.push(d);
  } else {
    const whole = classifyWhole(ctx, full);
    if (whole) out.push(whole);
    else if (entry.section?.kind === 'HORA_EXTRA' || /horas?\s+extras?/.test(full.folded)) out.push(...classifyOvertime(ctx, full));
    else {
      const state: FragState = { subst: false };
      for (const frag of splitFragments(full)) out.push(...classifyFragment(ctx, frag, state));
    }
  }
  for (const sub of entry.subitems) out.push(classifySubitem(ctx, sub, sourceText));

  const sectionRec = entry.section?.kind === 'ACRESCIMOS' ? entry.section.recurrence : null;
  for (const d of out) {
    if (d.importable && !d.recurrence && d.categoryKey !== 'DIFERENCA_SALARIAL' && !d.categoryKey.startsWith('PROPORCIONAL:')) {
      const rec = findRecurrence(fold(d.sourceText), comp);
      if (rec) d.recurrence = { ...rec, source: 'texto' };
      else if (sectionRec) d.recurrence = sectionRec;
    }
    if (d.recurrence) {
      d.fixed = true;
      const until =
        d.recurrence.untilMonth !== null && d.recurrence.untilYear !== null
          ? `Recorrente até ${formatCompetencia({ month: d.recurrence.untilMonth, year: d.recurrence.untilYear })}`
          : 'Valor fixo sem data de término informada';
      const origin = d.recurrence.source === 'secao' ? ` (herdado do cabeçalho “${entry.section?.label ?? ''}”)` : '';
      flag(
        d,
        'RECORRENCIA',
        `${until}${origin}. A planilha não tem campo de data final: será exportado com “Fixar valor?” = sim. Confirme e programe o encerramento no sistema.`,
      );
    }
    if (entry.nameNormalized) flag(d, 'NOME_NORMALIZADO', `Caracteres inválidos removidos do nome (“${entry.rawName.trim()}”).`);
  }
  return out;
}
