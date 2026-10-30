import { describe, expect, it } from 'vitest';
import { parseMessages } from '../src/engine/MessageParser';
import { classifyEntry, type Movement } from '../src/engine/MovementClassifier';
import { MSG_AGOSTO, MSG_CORRECOES, MSG_FECHAMENTO, MSG_OUTUBRO } from './fixtures/mensagens';

function byMat(text: string, mat: string): Movement[] {
  return parseMessages(text)
    .entries.filter((e) => e.matricula === mat)
    .flatMap((e) => classifyEntry(e, 2026));
}
const pick = (m: Movement) => [m.categoryKey, m.amount];

describe('descontos', () => {
  it('dois descontos na mesma linha geram dois lançamentos', () => {
    expect(byMat(MSG_CORRECOES, '502').map(pick)).toEqual([
      ['DESC_MATERIAL_DIDATICO', 210.1],
      ['DESC_CONTRATURNO', 480],
    ]);
  });
  it('coparticipação por mês', () => {
    expect(byMat(MSG_OUTUBRO, '526').map(pick)).toEqual([
      ['DESC_COPARTICIPACAO', 150.4],
      ['DESC_COPARTICIPACAO', 38.9],
    ]);
  });
  it('faltas em dias, aulas e horas', () => {
    expect(byMat(MSG_OUTUBRO, '527').map(pick)).toEqual([['FALTA_HORAS', 5]]);
    expect(byMat(MSG_OUTUBRO, '528').map(pick)).toEqual([['FALTA_DIAS', 1]]);
    expect(byMat(MSG_AGOSTO, '534').map(pick)).toEqual([['FALTA_AULAS', 6]]);
  });
  it('desconto sindicato', () => {
    expect(byMat('501 - FULANO EXEMPLO - R$ 80,50 - desconto sindicato', '501').map(pick)).toEqual([['DESC_SINDICATO', 80.5]]);
  });
});

describe('substituições', () => {
  it('horas, com 4h45 e erro de digitação', () => {
    expect(byMat(MSG_OUTUBRO, '521').map(pick)).toEqual([['SUBST_HORAS', 4.75]]);
    expect(byMat(MSG_OUTUBRO, '520').map(pick)).toEqual([['SUBST_HORAS', 10]]);
  });
  it('aulas por nível, herdando "substituição" após o "+"', () => {
    expect(byMat(MSG_FECHAMENTO, '516').map(pick)).toEqual([
      ['SUBST_AULAS_EF1', 2],
      ['SUBST_AULAS_EM', 2],
    ]);
    expect(byMat(MSG_OUTUBRO, '519').map(pick)).toEqual([
      ['SUBST_AULAS_EF2', 13.5],
      ['SUBST_AULAS_EM', 1],
    ]);
  });
});

describe('hora extra', () => {
  it('um lançamento por intervalo, com a data certa no trecho', () => {
    const ms = byMat(MSG_OUTUBRO, '522');
    expect(ms.map((m) => m.amount)).toEqual([6, 2.5, 5]);
    expect(ms.map((m) => m.source)).toEqual(['26/09 06:00 as 12:00', '13/10 07:00 as 09:30', '17/10 07:00 as 12:00']);
  });
  it('inclui a linha de continuação', () => {
    expect(byMat(MSG_OUTUBRO, '524').map((m) => m.source)).toContain('17/10 07:00 as 12:00');
  });
});

describe('salários e recorrência', () => {
  it('herda a recorrência do cabeçalho, exceto na diferença', () => {
    const [salario, acresc, dif] = byMat(MSG_CORRECOES, '508');
    expect(salario!.fixo).toBe(true);
    expect(pick(acresc!)).toEqual(['ACRESCIMO:REDACAO ENEM', 13.5]);
    expect(acresc!.fixo).toBe(true);
    expect(pick(dif!)).toEqual(['DIFERENCA_SALARIAL', null]);
    expect(dif!.fixo).toBe(false);
  });
  it('sem valor na mensagem, o valor fica vazio', () => {
    const [m] = byMat(MSG_CORRECOES, '501');
    expect(pick(m!)).toEqual(['SALARIO:COMPLEMENTAR DO CONTRATURNO', null]);
    expect(m!.fixo).toBe(true);
  });
  it('aula mensalista: valor mensal e dias proporcionais', () => {
    const [mensal, prop] = byMat(MSG_FECHAMENTO, '515');
    expect(pick(mensal!)).toEqual(['SALARIO:AULA MENSALISTA NO CONTRATURNO', 2500]);
    expect(mensal!.fixo).toBe(true);
    expect(pick(prop!)).toEqual(['PROPORCIONAL:AULA MENSALISTA NO CONTRATURNO', 4]);
  });
  it('diferença sem "R$" e complemento em dias', () => {
    expect(pick(byMat(MSG_CORRECOES, '505')[0]!)).toEqual(['DIFERENCA_SALARIAL', 98.3]);
    expect(pick(byMat(MSG_CORRECOES, '503')[0]!)).toEqual(['COMPLEMENTO_SALARIO_DIAS', 1]);
  });
});

describe('outros', () => {
  it('sub-itens carregam a rubrica citada', () => {
    expect(byMat(MSG_CORRECOES, '505').slice(1).map((m) => [m.rubrica, m.amount])).toEqual([
      ['1005', 9],
      ['1021', 31.5],
    ]);
  });
  it('reembolsos pelo assunto, inclusive pela seção', () => {
    expect(byMat(MSG_OUTUBRO, '531').map(pick)).toEqual([['REEMBOLSO:CONSIGNADO', 790.3]]);
    expect(byMat(MSG_OUTUBRO, '532').map(pick)).toEqual([['REEMBOLSO:ESTACIONAMENTO', 130]]);
  });
  it.each([
    [MSG_CORRECOES, '504', 'ALTERACAO_CADASTRAL'],
    [MSG_CORRECOES, '506', 'INFO_VINCULO'],
    [MSG_FECHAMENTO, '512', 'DEPENDENCIA_EXTERNA'],
    [MSG_FECHAMENTO, '517', 'CONFERENCIA'],
    [MSG_OUTUBRO, '530', 'ALTERACAO_CADASTRAL'],
    [MSG_AGOSTO, '501', 'ALTERACAO_CADASTRAL'],
  ])('pedido sem lançamento %#', (msg, mat, key) => {
    expect(byMat(msg, mat).map(pick)).toEqual([[key, null]]);
  });
  it('trecho desconhecido continua na lista', () => {
    expect(byMat('501 - FULANO EXEMPLO - bônus de natal', '501').map((m) => m.categoryKey)).toEqual(['NAO_INTERPRETADO']);
  });
});
