import { describe, expect, it } from 'vitest';
import { parseMessages, splitNameAndRemainder } from '../src/engine/MessageParser';
import { MSG_AGOSTO, MSG_CORRECOES, MSG_FECHAMENTO, MSG_OUTUBRO } from './fixtures/mensagens';

const all = [MSG_CORRECOES, MSG_FECHAMENTO, MSG_OUTUBRO, MSG_AGOSTO].join('\n');

describe('mensagens', () => {
  const r = parseMessages(all);

  it('separa as mensagens e lê a competência de cada uma', () => {
    expect(r.competencias).toEqual([null, null, { year: 2026, month: 10 }, { year: 2026, month: 8 }]);
  });

  it('associa sub-itens com rubrica à linha anterior, sem confundir com matrícula', () => {
    const parent = r.entries.find((e) => e.matricula === '505')!;
    expect(parent.subitems.map((s) => [s.code, s.label, s.valueText])).toEqual([
      ['1005', 'HORA AULA PPE', '9'],
      ['1021', 'HORA AULA CONTRATURNO', '31,5'],
    ]);
    expect(r.entries.some((e) => e.matricula === '1005')).toBe(false);
    expect(r.entries.some((e) => e.matricula === '506')).toBe(true);
  });

  it('junta a linha de continuação da hora extra', () => {
    expect(r.entries.find((e) => e.matricula === '524')!.text).toContain('17/10 07:00 as 12:00');
  });

  it('atribui a seção corrente, inclusive a recorrência do cabeçalho', () => {
    expect(r.entries.find((e) => e.matricula === '522')!.section?.kind).toBe('HORA_EXTRA');
    expect(r.entries.find((e) => e.matricula === '507')!.section).toEqual({ kind: 'ACRESCIMOS', recurrent: true });
  });

  it('mantém linhas soltas e a citação de anexo, sem perder nada', () => {
    const out = parseMessages('Carla\nbom dia\n\nvalor total do mês ficou alto\n\n501 - FULANO EXEMPLO - R$ 10,00 - desconto material didático\n\nSegue arquivo do consignado.');
    expect(out.loose.map((l) => l.text)).toEqual(['valor total do mês ficou alto', 'Segue arquivo do consignado.']);
  });

  it('não trata data no início da linha como matrícula', () => {
    const out = parseMessages('17/10 07:00 as 12:00');
    expect(out.entries).toHaveLength(0);
    expect(out.loose).toHaveLength(1);
  });
});

describe('nome e descrição', () => {
  it.each([
    ['FULANA EXEMPLO -Precisa adicionar', 'FULANA EXEMPLO', 'Precisa adicionar'],
    ['BELTRANA EXEMPLO- R$ 310,20 - desconto', 'BELTRANA EXEMPLO', 'R$ 310,20 - desconto'],
    ['CICLANO EXEMPLO  - R$ 610,00', 'CICLANO EXEMPLO', 'R$ 610,00'],
    ['Núbia de Tal Exemplo - R$ 240,15', 'Núbia de Tal Exemplo', 'R$ 240,15'],
    ['MARIA EXEMPLO : 26/09 06:00', 'MARIA EXEMPLO', '26/09 06:00'],
    ['JOAO DE TAL EXEMPLO  descontar 6 aulas', 'JOAO DE TAL EXEMPLO', 'descontar 6 aulas'],
  ])('%s', (input, name, rest) => {
    const s = splitNameAndRemainder(input)!;
    expect(s.rawName.trim()).toBe(name);
    expect(s.remainder.trim()).toBe(rest);
  });

  it('remove caracteres corrompidos do nome', () => {
    expect(parseMessages('525 ZILDA AMOSTRA¿¿¿¿: 13/10 07:00 as 09:30').entries[0]!.name).toBe('ZILDA AMOSTRA');
  });
});
