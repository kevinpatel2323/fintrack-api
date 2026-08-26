import {
  addDaysIso,
  cycleStartFor,
  monthRangeIso,
  openCycleRange,
  statementDateOnOrAfter,
  toIsoDay,
} from './card-cycle';

describe('addDaysIso', () => {
  it('crosses a month boundary', () => {
    expect(addDaysIso('2026-08-31', 1)).toBe('2026-09-01');
  });
  it('crosses a year boundary', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('goes backwards', () => {
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('cycleStartFor', () => {
  it('starts the day after the previous statement date', () => {
    expect(cycleStartFor('2026-08-16')).toBe('2026-07-17');
  });
  it('clamps a 31st onto a short previous month', () => {
    expect(cycleStartFor('2026-03-31')).toBe('2026-03-01');
  });
  it('walks back across January', () => {
    expect(cycleStartFor('2026-01-16')).toBe('2025-12-17');
  });
});

describe('statementDateOnOrAfter', () => {
  it('takes this month when the day is still ahead', () => {
    expect(statementDateOnOrAfter(16, '2026-08-10')).toBe('2026-08-16');
  });
  it('is inclusive of the day itself', () => {
    expect(statementDateOnOrAfter(16, '2026-08-16')).toBe('2026-08-16');
  });
  it('rolls to next month once the day has passed', () => {
    expect(statementDateOnOrAfter(16, '2026-08-27')).toBe('2026-09-16');
  });
  it('rolls across the year', () => {
    expect(statementDateOnOrAfter(16, '2026-12-20')).toBe('2027-01-16');
  });
  it('clamps a 31st to a short month', () => {
    expect(statementDateOnOrAfter(31, '2026-02-01')).toBe('2026-02-28');
  });
});

describe('monthRangeIso', () => {
  it('spans the calendar month', () => {
    expect(monthRangeIso('2026-08-27')).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
    });
  });
  it('handles February', () => {
    expect(monthRangeIso('2026-02-10')).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
  });
});

describe('openCycleRange', () => {
  // The reported case: statement day 16, statement for the 16th already
  // imported, looking at the card on the 25th.
  it('opens the day after the last statement closed', () => {
    expect(openCycleRange(16, '2026-08-16', '2026-08-25')).toEqual({
      start: '2026-08-17',
      end: '2026-09-16',
    });
  });

  it('puts the statement date itself in the closed cycle, not the open one', () => {
    // The old derivation started the open cycle *on* the statement day, which
    // pulled the 16th out of the statement that had just billed it.
    const { start } = openCycleRange(16, '2026-08-16', '2026-08-25');
    expect(start > '2026-08-16').toBe(true);
  });

  it('derives a cycle with no statements at all', () => {
    expect(openCycleRange(16, null, '2026-08-25')).toEqual({
      start: '2026-08-17',
      end: '2026-09-16',
    });
  });

  it('ignores a stale statement and uses the cycle containing today', () => {
    expect(openCycleRange(16, '2026-05-16', '2026-08-25')).toEqual({
      start: '2026-08-17',
      end: '2026-09-16',
    });
  });

  it('rolls forward rather than inverting when a statement runs ahead', () => {
    const range = openCycleRange(16, '2026-09-16', '2026-08-25');
    expect(range).toEqual({ start: '2026-09-17', end: '2026-10-16' });
    expect(range.start <= range.end).toBe(true);
  });

  it('falls back to the calendar month with no statement day', () => {
    expect(openCycleRange(null, null, '2026-08-25')).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
    });
  });

  it('never returns an inverted range', () => {
    for (const day of [1, 5, 16, 28, 29, 31]) {
      for (const today of ['2026-01-01', '2026-02-28', '2026-08-25', '2026-12-31']) {
        for (const last of [null, '2026-01-31', '2026-08-16', '2027-01-16']) {
          const { start, end } = openCycleRange(day, last, today);
          expect(start <= end).toBe(true);
        }
      }
    }
  });

  it('leaves no gap against the statement that just closed', () => {
    const lastCycleEnd = '2026-08-16';
    const { start } = openCycleRange(16, lastCycleEnd, '2026-08-25');
    expect(start).toBe(addDaysIso(lastCycleEnd, 1));
  });
});

describe('toIsoDay', () => {
  it('passes through an ISO string', () => {
    expect(toIsoDay('2026-08-16')).toBe('2026-08-16');
  });
  it('trims a timestamp', () => {
    expect(toIsoDay('2026-08-16T00:00:00.000Z')).toBe('2026-08-16');
  });
  it('reads a Date', () => {
    expect(toIsoDay(new Date(Date.UTC(2026, 7, 16)))).toBe('2026-08-16');
  });
});
