import { apiDateToDatetimeLocal, catalogSourceLine, datetimeLocalToApiDate } from '../../frontend/src/app/core/catalog-query';
import { BUSINESS_TIME_ZONE, formatTimestamp } from '../../frontend/src/app/core/format';

describe('formatTimestamp', () => {
  it('converts a UTC Z instant to Europe/Minsk', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Europe/Minsk');
    expect(formatTimestamp('2026-10-09T17:07:00.000Z')).toBe('09.10.2026 20:07');
  });

  it('converts an explicit +00:00 offset the same way', () => {
    expect(formatTimestamp('2026-10-09T17:07:00.000+00:00')).toBe('09.10.2026 20:07');
    expect(formatTimestamp('2026-10-09T17:07:00+00:00')).toBe('09.10.2026 20:07');
  });

  it('rolls the calendar date when Minsk is already the next day', () => {
    expect(formatTimestamp('2026-10-09T21:30:00.000Z')).toBe('10.10.2026 00:30');
  });

  it('keeps the fixed +3 offset in winter and summer', () => {
    expect(formatTimestamp('2026-01-15T17:07:00.000Z')).toBe('15.01.2026 20:07');
    expect(formatTimestamp('2026-07-15T17:07:00.000Z')).toBe('15.07.2026 20:07');
  });

  it('keeps a naive datetime as written', () => {
    expect(formatTimestamp('2026-10-09 17:07:00')).toBe('09.10.2026 17:07');
    expect(formatTimestamp('2026-10-09T17:07')).toBe('09.10.2026 17:07');
  });

  it('keeps a date-only value without a time or a shift', () => {
    expect(formatTimestamp('2026-10-09')).toBe('09.10.2026');
  });

  it('leaves empty and invalid values unchanged', () => {
    expect(formatTimestamp('')).toBe('');
    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
    expect(formatTimestamp('2026-13-40T17:07:00.000Z')).toBe('2026-13-40T17:07:00.000Z');
  });
});

describe('catalog date helpers', () => {
  it('does not apply a timezone offset to wall-clock period values', () => {
    expect(apiDateToDatetimeLocal('2026-10-09 17:07:00')).toBe('2026-10-09T17:07:00');
    expect(datetimeLocalToApiDate('2026-10-09T17:07')).toBe('2026-10-09 17:07:00');
    expect(
      catalogSourceLine({
        search: '',
        filters: [],
        dates: ['2026-10-09 17:07:00', '2026-10-09 18:07:00', 'Europe/Minsk'],
      }),
    ).toBe('Период 09.10.2026 17:07 — 09.10.2026 18:07, Europe/Minsk');
  });
});
