import { describe, expect, it } from 'vitest';
import { findDateIndexes, findDayRange, findMoney, findQuantity, findTimeIntervals, isRecurrent, parseBrNumber } from '../src/engine/MovementNormalizer';
import { fold } from '../src/engine/text';

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
  ])('%s → %s', (raw, expected) => expect(parseBrNumber(raw)).toBe(expected));
});

describe('valores monetários', () => {
  it('reconhece com e sem R$, sem confundir com quantidade', () => {
    expect(findMoney(fold('R$ 150,40 (agosto)'))).toBe(150.4);
    expect(findMoney(fold('R$ 6.500,00 + 5%'))).toBe(6500);
    expect(findMoney(fold('diferença de 106,42 de salário'))).toBe(106.42);
    expect(findMoney(fold('Pagar 13,50 aulas'))).toBeNull();
  });
});

describe('quantidades', () => {
  it('converte 4h45 sem virar 45 horas', () => {
    expect(findQuantity(fold('Pagar substituição - 4h45 horas'))).toEqual({ value: 4.75, unit: 'horas' });
  });
  it('reconhece erros de digitação e unidades', () => {
    expect(findQuantity(fold('Pagar 10 hotas'))).toEqual({ value: 10, unit: 'horas' });
    expect(findQuantity(fold('13,5 aulas'))).toEqual({ value: 13.5, unit: 'aulas' });
    expect(findQuantity(fold('1 dias'))).toEqual({ value: 1, unit: 'dias' });
    expect(findQuantity(fold('2 faltas'))).toEqual({ value: 2, unit: 'dias' });
  });
  it('não confunde datas com quantidades', () => {
    expect(findQuantity(fold('(15/10 e 16/10)'))).toBeNull();
  });
});

describe('datas e horários', () => {
  it('aceita barra colada antes da data', () => {
    expect(findDateIndexes('09:30 /17/10 07:00')).toEqual([7]);
  });
  it('conta dias de períodos de forma inclusiva', () => {
    expect(findDayRange(fold('dias de março 27/04 - 30/04 )'), 2026)?.days).toBe(4);
  });
  it('calcula a duração bruta, inclusive com virada de dia', () => {
    expect(findTimeIntervals(fold('26/09 06:00 as 12:00 / 13/10 07:00 às 09:30')).map((i) => i.hours)).toEqual([6, 2.5]);
    expect(findTimeIntervals('22:00 as 02:00')[0]!.hours).toBe(4);
  });
});

describe('recorrência', () => {
  it('reconhece prazos e "fixo", mas não "até o retorno"', () => {
    expect(isRecurrent(fold('Acrescentar até o final de dezembro:'))).toBe(true);
    expect(isRecurrent(fold('(deixar fixo até dezembro)'))).toBe(true);
    expect(isRecurrent(fold('deixar fixo'))).toBe(true);
    expect(isRecurrent(fold('até o dia do retorno'))).toBe(false);
  });
});

describe('fold', () => {
  it('preserva o comprimento', () => {
    const s = 'ZILDA AMOSTRA¿¿¿: Substituções – Fundamental';
    expect(fold(s)).toHaveLength(s.length);
  });
});
