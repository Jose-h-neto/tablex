import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ImportSettings, type ReviewState, type RubricDictionary } from '../src/domain/types';
import { checkConfig, countRows, groupIssues, pickSuperseded, resolveRows } from '../src/engine/MovementValidator';
import { processText } from '../src/engine/pipeline';
import { setMapping } from '../src/engine/RubricMapper';
import { MSG_AGOSTO, MSG_CORRECOES, MSG_FECHAMENTO, MSG_OUTUBRO } from '../src/sample/mensagensAnonimizadas';

const OUT = { year: 2026, month: 10 };
const SETTINGS: ImportSettings = {
  ...DEFAULT_SETTINGS,
  companyCode: '1',
  movementDateRule: 'inicio',
  fixarSim: 'S',
  fixarNao: 'N',
  hourFormat: 'decimal',
};
const emptyReview = (): ReviewState => ({ overrides: {}, acknowledged: {}, excluded: {} });

function run(text: string, dict: RubricDictionary = {}, review = emptyReview(), settings = SETTINGS) {
  const p = processText(text, OUT);
  const rows = resolveRows(p.movements, { messages: p.messages, settings, dictionary: dict, sessionCompetencia: OUT, review });
  return { p, rows };
}

describe('rubricas', () => {
  it('sem dicionário, nenhum lançamento é válido (não há código padrão)', () => {
    const { rows } = run(MSG_FECHAMENTO);
    const importable = rows.filter((r) => r.m.importable && !r.m.explicitRubric);
    expect(importable.every((r) => r.issues.some((i) => i.code === 'RUBRICA_NAO_CONFIGURADA'))).toBe(true);
    expect(importable.every((r) => r.status === 'bloqueado')).toBe(true);
  });

  it('configurar uma vez aplica a todos os lançamentos do mesmo tipo', () => {
    const dict = setMapping({}, 'DESC_MATERIAL_DIDATICO', '9001', 'Desconto material didático');
    const { rows } = run(MSG_FECHAMENTO, dict);
    const mat = rows.filter((r) => r.m.categoryKey === 'DESC_MATERIAL_DIDATICO');
    expect(mat).toHaveLength(4);
    expect(mat.every((r) => r.rubricCode === '9001' && r.rubricSource === 'dicionario' && r.status === 'valido')).toBe(true);
    expect(mat[0]!.movementDate).toBe('2026-10-01');
  });

  it('edição manual tem prioridade sobre o dicionário', () => {
    const dict = setMapping({}, 'DESC_MATERIAL_DIDATICO', '9001', 'x');
    const { p } = run(MSG_FECHAMENTO, dict);
    const id = p.movements[0]!.id;
    const { rows } = run(MSG_FECHAMENTO, dict, { ...emptyReview(), overrides: { [id]: { rubricCode: '7777' } } });
    expect(rows[0]!.rubricCode).toBe('7777');
    expect(rows[0]!.rubricSource).toBe('manual');
  });

  it('rejeita código inválido no dicionário', () => {
    expect(() => setMapping({}, 'X', 'abc def', 'x')).toThrow();
  });
});

describe('estados', () => {
  const dict = ['SUBST_HORAS', 'HORA_EXTRA', 'SALARIO:PROFESSOR TUTOR', 'DIFERENCA_SALARIAL'].reduce(
    (d, k) => setMapping(d, k, '100', k),
    {} as RubricDictionary,
  );

  it('atenção pode ser confirmada; bloqueio não', () => {
    const { rows, p } = run(MSG_CORRECOES, dict);
    const tutor = rows.find((r) => r.m.matricula === '507')!;
    expect(tutor.status).toBe('atencao');
    const ack = { ...emptyReview(), acknowledged: { [tutor.m.id]: ['RECORRENCIA' as const] } };
    const after = resolveRows(p.movements, { messages: p.messages, settings: SETTINGS, dictionary: dict, sessionCompetencia: OUT, review: ack });
    expect(after.find((r) => r.m.id === tutor.m.id)!.status).toBe('valido');

    const cad = rows.find((r) => r.m.matricula === '504')!;
    expect(cad.status).toBe('bloqueado');
  });

  it('valor ausente bloqueia; preencher manualmente desbloqueia', () => {
    const { rows, p } = run(MSG_CORRECOES, dict);
    const dif = rows.find((r) => r.m.matricula === '508' && r.m.categoryKey === 'DIFERENCA_SALARIAL')!;
    expect(dif.issues.map((i) => i.code)).toContain('VALOR_AUSENTE');
    const review = { ...emptyReview(), overrides: { [dif.m.id]: { amount: 120.5 } } };
    const after = resolveRows(p.movements, { messages: p.messages, settings: SETTINGS, dictionary: dict, sessionCompetencia: OUT, review });
    expect(after.find((r) => r.m.id === dif.m.id)!.status).toBe('valido');
  });

  it('quantidade sem unidade bloqueia até definir a unidade', () => {
    const d = setMapping({}, 'ACRESCIMO:REDACAO ENEM', '200', 'x');
    const { rows } = run(MSG_CORRECOES, d);
    const r = rows.find((x) => x.m.categoryKey === 'ACRESCIMO:REDACAO ENEM')!;
    expect(r.issues.find((i) => i.code === 'UNIDADE_INDEFINIDA')?.severity).toBe('bloqueio');
  });

  it('competência da mensagem diferente da folha gera atenção', () => {
    const { rows } = run(MSG_AGOSTO, setMapping({}, 'DESC_MATERIAL_DIDATICO', '9001', 'x'));
    expect(rows[0]!.issues.map((i) => i.code)).toContain('COMPETENCIA_DIVERGENTE');
  });
});

describe('duplicidades e conflitos', () => {
  const dict = setMapping({}, 'DESC_MATERIAL_DIDATICO', '9001', 'x');

  it('mensagens repetidas geram duplicidade e a resolução mantém uma ocorrência', () => {
    const text = [MSG_FECHAMENTO, MSG_FECHAMENTO].join('\n');
    const { rows, p } = run(text, dict);
    const mat = rows.filter((r) => r.m.categoryKey === 'DESC_MATERIAL_DIDATICO');
    expect(mat.every((r) => r.issues.some((i) => i.code === 'DUPLICADO'))).toBe(true);

    const drop = pickSuperseded(rows, 'DUPLICADO', p.messages);
    const excluded = Object.fromEntries(drop.map((id) => [id, { reason: 'duplicidade' as const, note: null }]));
    const after = resolveRows(p.movements, {
      messages: p.messages,
      settings: SETTINGS,
      dictionary: dict,
      sessionCompetencia: OUT,
      review: { ...emptyReview(), excluded },
    });
    const remaining = after.filter((r) => !r.exclusion && r.m.categoryKey === 'DESC_MATERIAL_DIDATICO');
    expect(remaining).toHaveLength(4);
    expect(remaining.every((r) => r.m.messageId === p.messages[1]!.id)).toBe(true);
    expect(remaining.every((r) => !r.issues.some((i) => i.code === 'DUPLICADO'))).toBe(true);
  });

  it('valores diferentes entre mensagens geram conflito; mensagem de correção prevalece', () => {
    const v1 = 'Carla\nbom dia\n\n502 - Beatriz Exemplo Lima - R$ 210,10 - desconto material didático';
    const v2 = 'Carla\nSegue correções:\n\n502 - Beatriz Exemplo Lima - R$ 250,00 - desconto material didático';
    const { rows, p } = run([v2, v1].join('\n\n'), dict);
    expect(rows.every((r) => r.issues.some((i) => i.code === 'CONFLITO'))).toBe(true);
    const drop = pickSuperseded(rows, 'CONFLITO', p.messages);
    expect(drop).toHaveLength(1);
    expect(rows.find((r) => r.m.id === drop[0])!.amount).toBe(210.1);
  });

  it('mesmo valor com e sem data de referência é possível duplicidade; datas diferentes não são', () => {
    const d = setMapping({}, 'SUBST_HORAS', '450', 'x');
    const a = 'Carla\nbom dia\n\n513 - MARIO DEMO FARIAS - Pagar substituição - 5 horas';
    const b = 'Beto\nbom dia\n\n513 MARIO DEMO FARIAS - Pagar 5 horas substituição (15/10)\n513 MARIO DEMO FARIAS - Pagar 5 horas substituição (16/10)';
    const { rows, p } = run([a, b].join('\n\n'), d);
    const [semData, dia15, dia16] = rows;
    expect(semData!.issues.find((i) => i.code === 'DUPLICADO')!.message).toMatch(/possível repetição/);
    expect(dia15!.issues.find((i) => i.code === 'DUPLICADO')!.related).toEqual([semData!.m.id]);
    // Resolver mantém as duas ocorrências datadas da mensagem mais recente.
    expect(pickSuperseded(rows, 'DUPLICADO', p.messages)).toEqual([semData!.m.id]);
    expect(dia16!.issues.some((i) => i.code === 'DUPLICADO' && i.related.includes(dia15!.m.id))).toBe(false);
  });

  it('meses diferentes de coparticipação não são duplicidade nem conflito', () => {
    const { rows } = run(MSG_OUTUBRO, setMapping({}, 'DESC_COPARTICIPACAO', '9002', 'x'));
    const cop = rows.filter((r) => r.m.categoryKey === 'DESC_COPARTICIPACAO');
    expect(cop.flatMap((r) => r.issues.map((i) => i.code))).not.toContain('CONFLITO');
    expect(cop.flatMap((r) => r.issues.map((i) => i.code))).not.toContain('DUPLICADO');
  });

  it('mesma matrícula com grafias equivalentes não é divergência; nomes diferentes são', () => {
    const ok = run('501 - Núbia Exemplo - R$ 10,00 - desconto material didático\n\n501 - NUBIA EXEMPLO - R$ 20,00 (estacionamento) reembolso', dict);
    expect(ok.rows.flatMap((r) => r.issues.map((i) => i.code))).not.toContain('NOME_DIVERGENTE');
    const bad = run('501 - NUBIA EXEMPLO - R$ 10,00 - desconto material didático\n501 - OUTRA PESSOA - R$ 20,00 - reembolso estacionamento', dict);
    expect(bad.rows.flatMap((r) => r.issues.map((i) => i.code))).toContain('NOME_DIVERGENTE');
  });
});

describe('agrupamento e configuração', () => {
  it('agrupa rubricas faltantes por categoria para configuração em lote', () => {
    const { rows } = run(MSG_FECHAMENTO);
    const g = groupIssues(rows).find((x) => x.code === 'RUBRICA_NAO_CONFIGURADA')!;
    expect(g.categories.find((c) => c.key === 'DESC_MATERIAL_DIDATICO')!.count).toBe(4);
    expect(groupIssues(rows)[0]!.severity).toBe('bloqueio');
  });

  it('exige a configuração de importação antes de exportar', () => {
    const { rows } = run(MSG_FECHAMENTO, {}, emptyReview(), DEFAULT_SETTINGS);
    // Data (1º dia) e "não fixo" (vazio) vêm da planilha real; o código da empresa nunca é presumido.
    expect(checkConfig(DEFAULT_SETTINGS, rows).map((c) => c.code)).toEqual(['EMPRESA']);
    expect(checkConfig({ ...DEFAULT_SETTINGS, movementDateRule: null }, rows).map((c) => c.code)).toEqual(['EMPRESA', 'DATA_REGRA']);
  });

  it('exige o texto de "fixo" somente quando há lançamento fixo a exportar', () => {
    const d = setMapping({}, 'SALARIO:PROFESSOR TUTOR', '500', 'x');
    const p = processText(MSG_CORRECOES, OUT);
    const tutor = p.movements.find((m) => m.matricula === '507')!;
    const review = { ...emptyReview(), acknowledged: { [tutor.id]: ['RECORRENCIA' as const] } };
    const settings = { ...SETTINGS, fixarSim: '' };
    const rows = resolveRows(p.movements, { messages: p.messages, settings, dictionary: d, sessionCompetencia: OUT, review });
    expect(checkConfig(settings, rows).map((c) => c.code)).toEqual(['FIXAR']);
    expect(checkConfig(SETTINGS, rows)).toEqual([]);
  });

  it('contadores somam o total', () => {
    const { rows } = run([MSG_CORRECOES, MSG_FECHAMENTO, MSG_OUTUBRO, MSG_AGOSTO].join('\n'));
    const c = countRows(rows);
    expect(c.valido + c.atencao + c.bloqueado + c.excluido).toBe(c.total);
  });
});
