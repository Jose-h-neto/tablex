import { describe, expect, it } from 'vitest';
import { processText } from '../src/engine/pipeline';
import type { Movement } from '../src/domain/types';
import { MSG_AGOSTO, MSG_CORRECOES, MSG_FECHAMENTO, MSG_OUTUBRO } from '../src/sample/mensagensAnonimizadas';

const OUT = { year: 2026, month: 10 };

function byMat(text: string, mat: string): Movement[] {
  return processText(text, OUT).movements.filter((m) => m.matricula === mat);
}

const pick = (m: Movement) => ({ key: m.categoryKey, unit: m.unit, amount: m.amount });
const codes = (m: Movement) => m.flags.map((f) => f.code);

describe('descontos', () => {
  it('dois descontos diferentes na mesma linha geram dois lançamentos', () => {
    const ms = byMat(MSG_CORRECOES, '502');
    expect(ms.map(pick)).toEqual([
      { key: 'DESC_MATERIAL_DIDATICO', unit: 'valor', amount: 210.1 },
      { key: 'DESC_CONTRATURNO', unit: 'valor', amount: 480 },
    ]);
    expect(ms[0]!.nature).toBe('desconto');
  });

  it('vários funcionários com a mesma categoria', () => {
    const r = processText(MSG_FECHAMENTO, OUT).movements.filter((m) => m.categoryKey === 'DESC_MATERIAL_DIDATICO');
    expect(r.map((m) => [m.matricula, m.amount])).toEqual([
      ['509', 705.1],
      ['510', 310.2],
      ['511', 240.15],
      ['502', 210.1],
    ]);
  });

  it('coparticipação por mês de referência', () => {
    const ms = byMat(MSG_OUTUBRO, '526');
    expect(ms.map((m) => [m.amount, m.referenceMonths])).toEqual([
      [150.4, ['agosto']],
      [38.9, ['setembro']],
    ]);
  });

  it('faltas em dias, aulas e horas', () => {
    expect(byMat(MSG_OUTUBRO, '527').map(pick)).toEqual([{ key: 'FALTA_HORAS', unit: 'horas', amount: 5 }]);
    const dia = byMat(MSG_OUTUBRO, '528')[0]!;
    expect(pick(dia)).toEqual({ key: 'FALTA_DIAS', unit: 'dias', amount: 1 });
    expect(codes(dia)).toContain('UNIDADE_INFERIDA');
    expect(byMat(MSG_OUTUBRO, '529')[0]!.referenceDates).toEqual(['2026-09-24', '2026-09-28']);
    expect(byMat(MSG_AGOSTO, '534').map(pick)).toEqual([{ key: 'FALTA_AULAS', unit: 'aulas', amount: 6 }]);
  });
});

describe('substituições', () => {
  it('horas, inclusive no formato 4h45 e com erro de digitação', () => {
    expect(byMat(MSG_OUTUBRO, '521').map(pick)).toEqual([{ key: 'SUBST_HORAS', unit: 'horas', amount: 4.75 }]);
    const ul = byMat(MSG_OUTUBRO, '520')[0]!;
    expect(pick(ul)).toEqual({ key: 'SUBST_HORAS', unit: 'horas', amount: 10 });
    expect(ul.referenceDates).toEqual(['2026-10-15', '2026-10-16']);
  });

  it('aulas por nível, com herança do contexto "substituição" após o "+"', () => {
    expect(byMat(MSG_FECHAMENTO, '516').map(pick)).toEqual([
      { key: 'SUBST_AULAS_EF1', unit: 'aulas', amount: 2 },
      { key: 'SUBST_AULAS_EM', unit: 'aulas', amount: 2 },
    ]);
    expect(byMat(MSG_OUTUBRO, '519').map(pick)).toEqual([
      { key: 'SUBST_AULAS_EF2', unit: 'aulas', amount: 13.5 },
      { key: 'SUBST_AULAS_EM', unit: 'aulas', amount: 1 },
    ]);
    expect(byMat(MSG_FECHAMENTO, '514').map(pick)).toEqual([{ key: 'SUBST_AULAS_EF2', unit: 'aulas', amount: 1 }]);
  });
});

describe('hora extra por intervalos', () => {
  it('gera um lançamento por intervalo, com a data correta', () => {
    const ms = byMat(MSG_OUTUBRO, '522');
    expect(ms.map((m) => [m.amount, m.referenceDates[0]])).toEqual([
      [6, '2026-09-26'],
      [2.5, '2026-10-13'],
      [5, '2026-10-17'],
    ]);
    expect(ms.every((m) => codes(m).includes('HORA_EXTRA_REGRA'))).toBe(true);
    expect(ms[0]!.flags.find((f) => f.code === 'HORA_EXTRA_REGRA')!.message).toMatch(/sábado/);
  });

  it('inclui a linha de continuação', () => {
    const ms = byMat(MSG_OUTUBRO, '524');
    expect(ms.map((m) => m.details[0])).toEqual(['sáb 26/09 06:00–12:00', 'ter 13/10 07:00–09:30', 'sáb 17/10 07:00–12:00']);
    const text = processText(MSG_OUTUBRO, OUT).text;
    expect(text.slice(ms[2]!.fragmentSpan.start, ms[2]!.fragmentSpan.end)).toBe('17/10 07:00 as 12:00');
  });

  it('alerta sobre intervalo longo', () => {
    const long = byMat(MSG_OUTUBRO, '523')[1]!;
    expect(long.amount).toBe(11.5);
    expect(long.flags.find((f) => f.code === 'HORA_EXTRA_REGRA')!.message).toMatch(/refeição/);
  });
});

describe('recorrências e salários', () => {
  it('herda "até o final de dezembro" do cabeçalho da seção', () => {
    const tutor = byMat(MSG_CORRECOES, '507')[0]!;
    expect(pick(tutor)).toEqual({ key: 'SALARIO:PROFESSOR TUTOR', unit: 'valor', amount: 450 });
    expect(tutor.fixed).toBe(true);
    expect(tutor.recurrence).toEqual({ untilMonth: 12, untilYear: 2026, source: 'secao' });
    expect(codes(tutor)).toContain('RECORRENCIA');
  });

  it('não torna recorrente a diferença salarial dentro da seção', () => {
    const [acresc, dif] = byMat(MSG_CORRECOES, '508').slice(1);
    expect(pick(acresc!)).toEqual({ key: 'ACRESCIMO:REDACAO ENEM', unit: 'indefinida', amount: 13.5 });
    expect(acresc!.fixed).toBe(true);
    expect(pick(dif!)).toEqual({ key: 'DIFERENCA_SALARIAL', unit: 'valor', amount: null });
    expect(dif!.fixed).toBe(false);
    expect(dif!.referenceMonths).toEqual(['abril']);
  });

  it('salário sem valor fica sem quantia (não inventa)', () => {
    const m = byMat(MSG_CORRECOES, '501')[0]!;
    expect(pick(m)).toEqual({ key: 'SALARIO:COMPLEMENTAR DO CONTRATURNO', unit: 'valor', amount: null });
    expect(m.recurrence).toMatchObject({ untilMonth: 12, source: 'texto' });
    expect(m.referenceMonths).toEqual([]);
  });

  it('aula mensalista: valor mensal + dias proporcionais, com alerta de mês divergente', () => {
    const [mensal, prop] = byMat(MSG_FECHAMENTO, '515');
    expect(pick(mensal!)).toEqual({ key: 'SALARIO:AULA MENSALISTA NO CONTRATURNO', unit: 'valor', amount: 2500 });
    expect(mensal!.fixed).toBe(true);
    expect(pick(prop!)).toEqual({ key: 'PROPORCIONAL:AULA MENSALISTA NO CONTRATURNO', unit: 'dias', amount: 4 });
    expect(codes(prop!)).toEqual(expect.arrayContaining(['CALCULO_EXTERNO', 'DATA_INCONSISTENTE']));
    expect(prop!.flags.find((f) => f.code === 'DATA_INCONSISTENTE')!.message).toMatch(/março/);
  });

  it('diferença salarial sem "R$" e complemento em dias', () => {
    expect(pick(byMat(MSG_CORRECOES, '505')[0]!)).toEqual({ key: 'DIFERENCA_SALARIAL', unit: 'valor', amount: 98.3 });
    const c = byMat(MSG_CORRECOES, '503')[0]!;
    expect(pick(c)).toEqual({ key: 'COMPLEMENTO_SALARIO_DIAS', unit: 'dias', amount: 1 });
    expect(c.referenceDates).toEqual(['2026-05-04']);
  });
});

describe('rubricas citadas na mensagem', () => {
  it('sub-itens carregam o código explícito e pedem confirmação', () => {
    const subs = byMat(MSG_CORRECOES, '505').slice(1);
    expect(subs.map((m) => [m.explicitRubric, m.amount, m.unit])).toEqual([
      ['1005', 9, 'aulas'],
      ['1021', 31.5, 'aulas'],
    ]);
    expect(subs.every((m) => codes(m).includes('RUBRICA_DA_MENSAGEM'))).toBe(true);
  });
});

describe('reembolsos', () => {
  it('identifica o assunto, inclusive pela seção', () => {
    expect(pick(byMat(MSG_OUTUBRO, '531')[0]!)).toEqual({ key: 'REEMBOLSO:CONSIGNADO', unit: 'valor', amount: 790.3 });
    expect(pick(byMat(MSG_OUTUBRO, '532')[0]!)).toEqual({ key: 'REEMBOLSO:ESTACIONAMENTO', unit: 'valor', amount: 130 });
  });
});

describe('solicitações não importáveis', () => {
  it.each([
    [MSG_CORRECOES, '504', 'ALTERACAO_CADASTRAL'],
    [MSG_CORRECOES, '506', 'INFO_VINCULO'],
    [MSG_FECHAMENTO, '512', 'DEPENDENCIA_EXTERNA'],
    [MSG_FECHAMENTO, '517', 'CONFERENCIA'],
    [MSG_OUTUBRO, '530', 'ALTERACAO_CADASTRAL'],
    [MSG_AGOSTO, '501', 'ALTERACAO_CADASTRAL'],
  ])('matrícula %#', (msg, mat, key) => {
    const ms = byMat(msg, mat);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.categoryKey).toBe(key);
    expect(ms[0]!.importable).toBe(false);
    expect(codes(ms[0]!)).toContain('NAO_IMPORTAVEL');
  });

  it('trecho desconhecido vira lançamento bloqueado, nunca é descartado', () => {
    const ms = byMat('501 - FULANO EXEMPLO - bônus de natal R$ 50,00', '501');
    expect(ms).toHaveLength(1);
    expect(ms[0]!.categoryKey).toBe('NAO_INTERPRETADO');
    expect(ms[0]!.amount).toBe(50);
  });
});

describe('rastreabilidade', () => {
  it('cada lançamento aponta para um trecho dentro da própria linha', () => {
    const r = processText([MSG_CORRECOES, MSG_FECHAMENTO, MSG_OUTUBRO, MSG_AGOSTO].join('\n'), OUT);
    for (const m of r.movements) {
      const frag = r.text.slice(m.fragmentSpan.start, m.fragmentSpan.end);
      expect(frag.length).toBeGreaterThan(0);
      expect(m.sourceText).toBe(frag);
    }
  });
});
