import { describe, expect, it } from 'vitest';
import { applyEdit, buildSheet, EMPTY_MEMORY, isExportable, type Memory } from '../src/engine/sheet';
import { MSG_CORRECOES, MSG_FECHAMENTO, MSG_OUTUBRO } from './fixtures/mensagens';

const NOW = new Date(2026, 9, 29);
const build = (text: string, memory: Memory = EMPTY_MEMORY) => buildSheet(text, memory, NOW);

describe('montagem', () => {
  it('preenche o que a mensagem traz e deixa o resto vazio', () => {
    const { rows } = build(MSG_FECHAMENTO);
    const igor = rows.find((r) => r.matricula === '509')!;
    expect(igor).toMatchObject({ empresa: '', rubrica: '', valor: '705,10', data: '01/10/2026', fixar: '', observacao: '' });
    expect(igor.origem).toContain('IGOR EXEMPLO DIAS');
  });

  it('usa a competência da mensagem e a mais recente para as demais', () => {
    const { rows, competencia } = build([MSG_FECHAMENTO, MSG_OUTUBRO].join('\n'));
    expect(competencia).toEqual({ year: 2026, month: 10 });
    expect(rows.every((r) => r.data === '' || r.data === '01/10/2026')).toBe(true);
  });

  it('aplica o que já foi aprendido', () => {
    const memory: Memory = { empresa: '12345', fixarSim: 'S', rubricas: { DESC_MATERIAL_DIDATICO: '9001', 'SALARIO:PROFESSOR TUTOR': '500' } };
    const { rows } = build(`${MSG_CORRECOES}\n${MSG_FECHAMENTO}`, memory);
    expect(rows.find((r) => r.matricula === '509')).toMatchObject({ empresa: '12345', rubrica: '9001', fixar: '' });
    expect(rows.find((r) => r.matricula === '507')).toMatchObject({ rubrica: '500', fixar: 'S' });
  });

  it('usa a rubrica citada na mensagem e a 153 para sindicato', () => {
    expect(build(MSG_CORRECOES).rows.find((r) => r.origem.includes('HORA AULA PPE'))!.rubrica).toBe('1005');
    expect(build('501 - FULANO EXEMPLO - R$ 80,50 - desconto sindicato').rows[0]!.rubrica).toBe('153');
  });

  it('pedidos sem lançamento ficam só com a matrícula e não entram no arquivo', () => {
    const row = build(MSG_CORRECOES).rows.find((r) => r.matricula === '504')!;
    expect(row).toMatchObject({ empresa: '', rubrica: '', valor: '', data: '' });
    expect(row.origem).toContain('Alterar a carga horária');
    expect(isExportable(row)).toBe(false);
  });

  it('valor sem rubrica entra no arquivo com a rubrica vazia', () => {
    expect(isExportable(build(MSG_FECHAMENTO).rows.find((r) => r.matricula === '509')!)).toBe(true);
  });

  it('cada linha aponta para a linha de origem na mensagem', () => {
    const text = 'Carla\n\nfrase solta sem matrícula\n501 - FULANO EXEMPLO - R$ 10,00 - desconto material didático + R$ 5,00 desconto referente a contraturno\n505 - ELISA AMOSTRA PIRES - ajustar a carga horária abaixo:\n1005 - HORA AULA PPE - correto 9';
    const lines = text.split('\n');
    const { rows } = build(text);
    expect(rows.find((r) => r.origem === 'frase solta sem matrícula')!.line).toBe(2);
    expect(rows.filter((r) => r.matricula === '501').map((r) => r.line)).toEqual([3, 3]);
    expect(lines[rows.find((r) => r.rubrica === '1005')!.line]).toContain('HORA AULA PPE');
  });

  it('nada se perde: linha não reconhecida aparece na tabela', () => {
    const { rows } = build('Carla\nbom dia\n\nvalor total do mês ficou alto\n\n501 - FULANO EXEMPLO - R$ 10,00 - desconto material didático');
    expect(rows.map((r) => r.origem)).toContain('valor total do mês ficou alto');
  });
});

describe('repetições', () => {
  it('mensagem repetida vai para as removidas, sem perder nada', () => {
    const once = build(MSG_FECHAMENTO).rows.length;
    const { rows, removed } = build([MSG_FECHAMENTO, MSG_FECHAMENTO].join('\n'));
    expect(rows).toHaveLength(once);
    expect(removed).toHaveLength(once);
  });
  it('mesma linha repetida na mesma mensagem é mantida', () => {
    const line = '501 - FULANO EXEMPLO - R$ 10,00 - desconto material didático';
    expect(build(`${line}\n${line}`).rows).toHaveLength(2);
  });
  it('valores diferentes entre mensagens são mantidos', () => {
    const a = 'Carla\n501 - FULANO EXEMPLO - R$ 10,00 - desconto material didático';
    const b = 'Beto\n501 - FULANO EXEMPLO - R$ 20,00 - desconto material didático';
    expect(build(`${a}\n${b}`).rows).toHaveLength(2);
  });
});

describe('edição', () => {
  const start = build(MSG_FECHAMENTO + '\n' + MSG_CORRECOES);
  const find = (mat: string) => start.rows.find((r) => r.matricula === mat)!;

  it('rubrica vale para o mesmo tipo e fica aprendida', () => {
    const { rows, memory } = applyEdit(start.rows, EMPTY_MEMORY, find('509').id, 'rubrica', '9001');
    expect(rows.filter((r) => r.categoryKey === 'DESC_MATERIAL_DIDATICO').every((r) => r.rubrica === '9001')).toBe(true);
    expect(rows.find((r) => r.categoryKey === 'SUBST_HORAS')!.rubrica).toBe('');
    expect(memory.rubricas.DESC_MATERIAL_DIDATICO).toBe('9001');
  });

  it('uma linha pode ter rubrica própria, sem mudar as outras nem o que foi aprendido', () => {
    const a = applyEdit(start.rows, EMPTY_MEMORY, find('509').id, 'rubrica', '9001');
    const b = applyEdit(a.rows, a.memory, find('510').id, 'rubrica', '7777');
    expect(b.rows.find((r) => r.matricula === '510')!.rubrica).toBe('7777');
    expect(b.rows.find((r) => r.matricula === '511')!.rubrica).toBe('9001');
    expect(b.memory.rubricas.DESC_MATERIAL_DIDATICO).toBe('9001');
  });

  it('empresa vale para os lançamentos, não para os pedidos sem lançamento', () => {
    const { rows, memory } = applyEdit(start.rows, EMPTY_MEMORY, find('509').id, 'empresa', '12345');
    expect(rows.find((r) => r.matricula === '510')!.empresa).toBe('12345');
    expect(rows.find((r) => r.matricula === '504')!.empresa).toBe('');
    expect(memory.empresa).toBe('12345');
  });

  it('"fixar" vale para as linhas fixas', () => {
    const { rows, memory } = applyEdit(start.rows, EMPTY_MEMORY, find('507').id, 'fixar', 'S');
    expect(rows.filter((r) => r.fixo).every((r) => r.fixar === 'S')).toBe(true);
    expect(rows.filter((r) => !r.fixo).every((r) => r.fixar === '')).toBe(true);
    expect(memory.fixarSim).toBe('S');
  });

  it('valor muda só a própria linha', () => {
    const { rows } = applyEdit(start.rows, EMPTY_MEMORY, find('509').id, 'valor', '1,00');
    expect(rows.find((r) => r.matricula === '510')!.valor).toBe('310,20');
  });
});
