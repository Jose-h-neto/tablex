import { describe, expect, it } from 'vitest';
import { parseMessages, splitNameAndRemainder } from '../src/engine/MessageParser';
import { MSG_AGOSTO, MSG_CORRECOES, MSG_FECHAMENTO, MSG_OUTUBRO } from '../src/sample/mensagensAnonimizadas';

const OUT = { year: 2026, month: 10 };

describe('segmentação de mensagens', () => {
  const all = [MSG_CORRECOES, MSG_FECHAMENTO, MSG_FECHAMENTO, MSG_OUTUBRO, MSG_AGOSTO].join('\n');
  const r = parseMessages(all, OUT);

  it('separa as mensagens pelo destinatário/saudação', () => {
    expect(r.messages.map((m) => m.recipient)).toEqual(['Carla', 'Carla', 'Carla', 'Beto', 'Beto']);
  });

  it('detecta a competência informada no cabeçalho', () => {
    expect(r.messages.map((m) => m.competencia)).toEqual([null, null, null, { year: 2026, month: 10 }, { year: 2026, month: 8 }]);
  });

  it('marca mensagem de correção e mensagem repetida', () => {
    expect(r.messages[0]!.isCorrection).toBe(true);
    expect(r.messages[2]!.duplicateOf).toBe(r.messages[1]!.id);
    expect(r.messages[1]!.duplicateOf).toBeNull();
  });

  it('não perde nenhuma linha não vazia', () => {
    const nonBlank = all.split('\n').filter((l) => l.trim()).length;
    expect(r.segments).toHaveLength(nonBlank);
  });

  it('classifica o anexo como informativo, não como ruído', () => {
    const info = r.segments.find((s) => s.kind === 'info');
    expect(info?.text).toContain('Segue arquivo');
    expect(info?.note).toMatch(/anexo/);
  });

  it('associa os sub-itens com rubrica explícita à linha anterior', () => {
    const parent = r.entries.find((e) => e.matricula === '505')!;
    expect(parent.subitems.map((s) => [s.code, s.label, s.valueText])).toEqual([
      ['1005', 'HORA AULA PPE', '9'],
      ['1021', 'HORA AULA CONTRATURNO', '31,5'],
    ]);
    expect(r.entries.some((e) => e.matricula === '1005')).toBe(false);
    // A linha seguinte (sem valor ao final) volta a ser funcionário.
    expect(r.entries.some((e) => e.matricula === '506')).toBe(true);
  });

  it('anexa linha de continuação da hora extra ao funcionário anterior', () => {
    const e = r.entries.find((x) => x.matricula === '524')!;
    expect(e.continuations.map((c) => c.text)).toEqual(['17/10 07:00 as 12:00']);
  });

  it('atribui a seção corrente a cada linha', () => {
    expect(r.entries.find((e) => e.matricula === '522')!.section?.kind).toBe('HORA_EXTRA');
    expect(r.entries.find((e) => e.matricula === '531')!.section?.kind).toBe('REEMBOLSOS');
    const tutor = r.entries.find((e) => e.matricula === '507')!;
    expect(tutor.section?.kind).toBe('ACRESCIMOS');
    expect(tutor.section?.recurrence).toMatchObject({ untilMonth: 12 });
  });
});

describe('separação de nome e descrição', () => {
  const cases: [string, string, string][] = [
    ['FULANA EXEMPLO -Precisa adicionar', 'FULANA EXEMPLO', 'Precisa adicionar'],
    ['BELTRANA EXEMPLO- R$ 310,20 - desconto', 'BELTRANA EXEMPLO', 'R$ 310,20 - desconto'],
    ['CICLANO EXEMPLO  - R$ 610,00', 'CICLANO EXEMPLO', 'R$ 610,00'],
    ['Núbia de Tal Exemplo - R$ 240,15', 'Núbia de Tal Exemplo', 'R$ 240,15'],
    ['MARIA EXEMPLO : 26/09 06:00', 'MARIA EXEMPLO', '26/09 06:00'],
    ['JOAO DE TAL EXEMPLO  descontar 6 aulas', 'JOAO DE TAL EXEMPLO', 'descontar 6 aulas'],
  ];
  it.each(cases)('%s', (input, name, rest) => {
    const s = splitNameAndRemainder(input, 0)!;
    expect(s.rawName.trim()).toBe(name);
    expect(s.remainder.text.trim()).toBe(rest);
    expect(input.slice(s.remainder.start, s.remainder.start + s.remainder.text.length)).toBe(s.remainder.text);
  });

  it('remove caracteres corrompidos do nome e sinaliza', () => {
    const r = parseMessages('525 ZILDA AMOSTRA¿¿¿¿: 13/10 07:00 as 09:30', OUT);
    expect(r.entries[0]!.name).toBe('ZILDA AMOSTRA');
    expect(r.entries[0]!.nameNormalized).toBe(true);
  });

  it('não trata datas no início da linha como matrícula', () => {
    const r = parseMessages('17/10 07:00 as 12:00', OUT);
    expect(r.entries).toHaveLength(0);
    expect(r.segments[0]!.kind).toBe('unrecognized');
  });
});

describe('linhas não reconhecidas', () => {
  it('são mantidas e sinalizadas', () => {
    const r = parseMessages('Carla\nbom dia\n\nvalor total do mês ficou alto\n\n501 - FULANO EXEMPLO - R$ 10,00 - desconto material didático', OUT);
    const unk = r.segments.filter((s) => s.kind === 'unrecognized');
    expect(unk.map((s) => s.text)).toEqual(['valor total do mês ficou alto']);
    expect(unk[0]!.note).toBeTruthy();
  });
});
