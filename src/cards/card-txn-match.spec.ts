import {
  DEFAULT_DATE_WINDOW_DAYS,
  MatchableCandidate,
  MatchableEntry,
  matchParsedEntries,
  signedPaise,
} from './card-txn-match';

const entry = (
  txnDate: string,
  amount: number,
  merchant = 'Zomato',
  isRefund = false,
): MatchableEntry => ({ txnDate, amount, merchant, isRefund });

const candidate = (
  id: string,
  txnDate: string,
  amount: number,
  merchant = 'Zomato',
  isRefund = false,
): MatchableCandidate => ({ id, txnDate, amount, merchant, isRefund });

describe('matchParsedEntries', () => {
  it('matches a manual entry on the same date and amount', () => {
    const result = matchParsedEntries(
      [entry('2026-08-20', 840)],
      [candidate('7', '2026-08-20', 840)],
    );
    expect(result.matches).toEqual([
      { parsedIndex: 0, existingId: '7', dateDeltaDays: 0 },
    ]);
    expect(result.unmatchedIndexes).toEqual([]);
  });

  it('matches inside the date window and reports the drift', () => {
    const result = matchParsedEntries(
      [entry('2026-08-22', 310)],
      [candidate('9', '2026-08-20', 310)],
    );
    expect(result.matches).toEqual([
      { parsedIndex: 0, existingId: '9', dateDeltaDays: 2 },
    ]);
  });

  it('leaves an entry unmatched past the date window', () => {
    const result = matchParsedEntries(
      [entry('2026-08-25', 310)],
      [candidate('9', '2026-08-20', 310)],
    );
    expect(result.matches).toEqual([]);
    expect(result.unmatchedIndexes).toEqual([0]);
  });

  it('prefers the exact date over one inside the window', () => {
    const result = matchParsedEntries(
      [entry('2026-08-20', 500)],
      [candidate('1', '2026-08-18', 500), candidate('2', '2026-08-20', 500)],
    );
    expect(result.matches).toEqual([
      { parsedIndex: 0, existingId: '2', dateDeltaDays: 0 },
    ]);
  });

  it('breaks a date tie on merchant text', () => {
    const result = matchParsedEntries(
      [entry('2026-08-20', 500, 'BOOKMYSHOW MUMBAI')],
      [
        candidate('1', '2026-08-20', 500, 'Uber'),
        candidate('2', '2026-08-20', 500, 'bookmyshow'),
      ],
    );
    expect(result.matches[0].existingId).toBe('2');
  });

  it('never lets two statement rows claim the same manual entry', () => {
    const result = matchParsedEntries(
      [entry('2026-08-20', 250), entry('2026-08-20', 250)],
      [candidate('4', '2026-08-20', 250)],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.unmatchedIndexes).toHaveLength(1);
  });

  it('does not match a refund against a purchase of the same magnitude', () => {
    const result = matchParsedEntries(
      [entry('2026-08-20', 900, 'Amazon', true)],
      [candidate('5', '2026-08-20', 900, 'Amazon', false)],
    );
    expect(result.matches).toEqual([]);
  });

  it('does not match amounts that differ by a single paisa', () => {
    const result = matchParsedEntries(
      [entry('2026-08-20', 840.0)],
      [candidate('6', '2026-08-20', 840.01)],
    );
    expect(result.matches).toEqual([]);
  });

  it('matches amounts that only float arithmetic would separate', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; paise rounding fixes it.
    const result = matchParsedEntries(
      [entry('2026-08-20', 0.1 + 0.2)],
      [candidate('8', '2026-08-20', 0.3)],
    );
    expect(result.matches).toHaveLength(1);
  });

  it('returns every index when there are no candidates', () => {
    const result = matchParsedEntries(
      [entry('2026-08-20', 100), entry('2026-08-21', 200)],
      [],
    );
    expect(result.matches).toEqual([]);
    expect(result.unmatchedIndexes).toEqual([0, 1]);
  });

  it('honours a widened date window', () => {
    const result = matchParsedEntries(
      [entry('2026-08-27', 310)],
      [candidate('9', '2026-08-20', 310)],
      { dateWindowDays: 7 },
    );
    expect(result.matches).toHaveLength(1);
  });
});

describe('signedPaise', () => {
  it('signs refunds negative', () => {
    expect(signedPaise(entry('2026-08-20', 12.34))).toBe(1234);
    expect(signedPaise(entry('2026-08-20', 12.34, 'x', true))).toBe(-1234);
  });

  it('uses a three-day window by default', () => {
    expect(DEFAULT_DATE_WINDOW_DAYS).toBe(3);
  });
});
