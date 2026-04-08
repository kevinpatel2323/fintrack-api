import {
  expandOccurrenceDates,
  normalizeRruleBody,
  validateRrule,
} from './subscription-rrule.util';

describe('subscription-rrule.util', () => {
  describe('normalizeRruleBody', () => {
    it('strips RRULE: prefix', () => {
      expect(normalizeRruleBody('RRULE:FREQ=MONTHLY;BYMONTHDAY=1')).toBe('FREQ=MONTHLY;BYMONTHDAY=1');
    });
  });

  describe('validateRrule', () => {
    it('accepts monthly by month day', () => {
      expect(() => validateRrule('FREQ=MONTHLY;BYMONTHDAY=15', '2025-01-15')).not.toThrow();
    });

    it('throws on garbage', () => {
      expect(() => validateRrule('NOT_A_RULE', '2025-01-15')).toThrow();
    });
  });

  describe('expandOccurrenceDates', () => {
    it('expands monthly charges in range', () => {
      const dates = expandOccurrenceDates(
        'FREQ=MONTHLY;BYMONTHDAY=15',
        '2025-01-15',
        [],
        '2025-03-01',
        '2025-05-31',
      );
      expect(dates).toContain('2025-03-15');
      expect(dates).toContain('2025-04-15');
      expect(dates).toContain('2025-05-15');
      expect(dates).not.toContain('2025-03-14');
    });

    it('respects EXDATE list', () => {
      const dates = expandOccurrenceDates(
        'FREQ=MONTHLY;BYMONTHDAY=15',
        '2025-01-15',
        ['2025-04-15'],
        '2025-03-01',
        '2025-05-31',
      );
      expect(dates).toContain('2025-03-15');
      expect(dates).not.toContain('2025-04-15');
      expect(dates).toContain('2025-05-15');
    });

    it('returns empty when end before start', () => {
      expect(
        expandOccurrenceDates('FREQ=DAILY', '2025-01-01', [], '2025-02-01', '2025-01-01'),
      ).toEqual([]);
    });
  });
});
