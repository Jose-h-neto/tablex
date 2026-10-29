import { describe, expect, it } from 'vitest';
import {
  findDateRanges,
  findDates,
  findMoney,
  findQuantities,
  findRecurrence,
  findTimeIntervals,
  parseBrNumber,
  resolveDate,
  toSexagesimal,
} from '../src/engine/MovementNormalizer';
import { fold, MappedText } from '../src/engine/text';

const OUT = { year: 2026, month: 10 };

describe('parseBrNumber', () => {
  it.each([
    ['1234,56', 1234.56],
    ['1.234,56', 1234.56],
    ['13,5', 13.5],
    ['13.5', 13.5],
    ['500', 500],
    ['1.500', 1500],
    ['1,2,3', null],
    ['abc', null],
  ])('%s → %s', (raw, expected) => {
    expect(parseBrNumber(raw)).toBe(expected);
  });
});

describe('valores monetários', () => {
  it('extrai valores com R$', () => {
    expect(findMoney(fold('R$ 150,40 (agosto)')).map((m) => m.value)).toEqual([150.4]);
    expect(findMoney(fold('R$ 6.500,00 + 5%')).map((m) => m.value)).toEqual([6500]);
  });
  it('aceita valor sem R$ apenas com centavos e quando permitido', () => {
    expect(findMoney(fold('diferença de 106,42 de salário'), true).map((m) => m.value)).toEqual([106.42]);
    expect(findMoney(fold('diferença de 106,42 de salário'), false)).toEqual([]);
    expect(findMoney(fold('Pagar 13,50 aulas'), true)).toEqual([]);
  });
});

describe('quantidades', () => {
  it('converte 4h45 em horas decimais sem duplicar "45 horas"', () => {
    const q = findQuantities(fold('Pagar substituição - 4h45 horas'));
    expect(q).toHaveLength(1);
    expect(q[0]!.value).toMatchObject({ value: 4.75, unit: 'horas' });
  });
  it('reconhece erros de digitação e unidades', () => {
    expect(findQuantities(fold('Pagar 10 hotas'))[0]!.value).toMatchObject({ value: 10, unit: 'horas' });
    expect(findQuantities(fold('13,5 aulas'))[0]!.value).toMatchObject({ value: 13.5, unit: 'aulas' });
    expect(findQuantities(fold('1 dias'))[0]!.value).toMatchObject({ value: 1, unit: 'dias' });
    expect(findQuantities(fold('2 faltas'))[0]!.value).toMatchObject({ value: 2, unit: 'dias', unitWord: 'faltas' });
  });
  it('não confunde datas com quantidades', () => {
    expect(findQuantities(fold('(15/10 e 16/10)'))).toEqual([]);
  });
});

describe('datas', () => {
  it('deduz o ano a partir da competência', () => {
    expect(resolveDate(15, 10, null, OUT)).toBe('2026-10-15');
    expect(resolveDate(15, 12, null, { year: 2027, month: 1 })).toBe('2026-12-15');
    expect(resolveDate(5, 1, null, { year: 2026, month: 12 })).toBe('2027-01-05');
    expect(resolveDate(31, 2, 2026, OUT)).toBeNull();
  });
  it('aceita barra colada antes da data', () => {
    expect(findDates(fold('09:30 /17/10 07:00'), OUT).map((d) => d.value.iso)).toEqual(['2026-10-17']);
  });
  it('não reconhece pedaços de datas completas', () => {
    expect(findDates('04/10/2026', OUT).map((d) => d.value.iso)).toEqual(['2026-10-04']);
  });
  it('conta dias de períodos de forma inclusiva', () => {
    const r = findDateRanges(fold('dias de março 27/04 - 30/04 )'), OUT);
    expect(r[0]!.value).toEqual({ from: '2026-04-27', to: '2026-04-30', days: 4 });
  });
});

describe('intervalos de horário', () => {
  it('calcula a duração bruta', () => {
    const iv = findTimeIntervals(fold('26/09 06:00 as 12:00 / 13/10 07:00 às 09:30 / 16/10 06:00 as 18:30'));
    expect(iv.map((i) => i.value?.hours)).toEqual([6, 2.5, 12.5]);
  });
  it('marca virada de dia', () => {
    expect(findTimeIntervals('22:00 as 02:00')[0]!.value).toMatchObject({ hours: 4, overnight: true });
  });
});

describe('recorrência', () => {
  it('reconhece "até o final de dezembro" e "deixar fixo"', () => {
    expect(findRecurrence(fold('Acrescentar até o final de dezembro:'), OUT)).toEqual({ untilMonth: 12, untilYear: 2026 });
    expect(findRecurrence(fold('(deixar fixo até dezembro)'), OUT)).toEqual({ untilMonth: 12, untilYear: 2026 });
    expect(findRecurrence(fold('deixar fixo'), OUT)).toEqual({ untilMonth: null, untilYear: null });
    expect(findRecurrence(fold('até o dia do retorno'), OUT)).toBeNull();
  });
});

describe('formato sexagesimal', () => {
  it.each([
    [4.75, 4.45],
    [2.5, 2.3],
    [6, 6],
    [11.5, 11.3],
  ])('%s h → %s', (dec, sex) => expect(toSexagesimal(dec)).toBe(sex));
});

describe('MappedText', () => {
  it('mantém offsets ao juntar linhas de continuação', () => {
    const src = 'AAA 26/09 06:00\n17/10 07:00';
    const mt = MappedText.join([
      { text: src.slice(4, 15), start: 4 },
      { text: src.slice(16), start: 16 },
    ]);
    const idx = mt.text.indexOf('17/10');
    const span = mt.span(idx, idx + 5);
    expect(src.slice(span.start, span.end)).toBe('17/10');
  });
  it('fold preserva o comprimento', () => {
    const s = 'ZILDA AMOSTRA¿¿¿: Substituções – Fundamental';
    expect(fold(s)).toHaveLength(s.length);
  });
});
