import {
  addMonths,
  buildImportSchedule,
  filenameHint,
  ImportedStatementRef,
  inferStatementDay,
} from './card-import-schedule';

const imported = (
  statementDate: string,
  dueDate: string | null = null,
  filename = 'statement.xlsx',
): ImportedStatementRef => ({ statementDate, dueDate, filename });

// The BizGrow card as it stands: four statements on the 16th, a card setting
// that wrongly says the 1st, and two statements out since the last import.
const bizGrowImports = [
  imported('2026-05-16', '2026-06-10', 'May2026_BilledStatements_2209_03-08-26_00.19.xlsx'),
  imported('2026-06-16', '2026-07-11', 'Jun2026_BilledStatements_2209_03-08-26_01.01.xlsx'),
  imported('2026-07-16', '2026-08-10', 'Jul2026_BilledStatements_2209_03-08-26_01.10.xlsx'),
  imported('2026-08-16', '2026-09-10', 'Aug2026_BilledStatements_2209_26-08-26_12.58.xlsx'),
];

describe('addMonths', () => {
  it('rolls across the year both ways', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(addMonths('2026-10', -5)).toBe('2026-05');
  });
});

describe('inferStatementDay', () => {
  it('takes the day the statements actually land on', () => {
    expect(inferStatementDay(['2026-08-16', '2026-07-16', '2026-06-16'])).toBe(16);
  });
  it('ignores a month-end date that was clamped from a later day', () => {
    // A 30th statement day lands on Feb 28.
    expect(inferStatementDay(['2026-03-30', '2026-02-28', '2026-01-30'])).toBe(30);
  });
  it('reads a 31st off dates that are all month-ends', () => {
    expect(inferStatementDay(['2026-04-30', '2026-03-31', '2026-02-28'])).toBe(31);
  });
  it('follows a bank that moved the statement date on a tie', () => {
    expect(inferStatementDay(['2026-09-20', '2026-08-20', '2026-07-16', '2026-06-16'])).toBe(20);
  });
  it('returns null with nothing imported', () => {
    expect(inferStatementDay([])).toBeNull();
  });
});

describe('filenameHint', () => {
  it('rolls the month token and drops the download timestamp', () => {
    expect(
      filenameHint(
        'Aug2026_BilledStatements_2209_26-08-26_12.58.xlsx',
        '2026-08',
        '2026-09',
        '2209',
      ),
    ).toBe('Sep2026_BilledStatements_2209');
  });
  it('gives no hint for a name that does not follow the pattern', () => {
    expect(filenameHint('my-statement.xlsx', '2026-08', '2026-09', '2209')).toBeNull();
  });
  it('gives no hint when the card number is not in the name', () => {
    expect(filenameHint('Aug2026_Statement.xlsx', '2026-08', '2026-09', '2209')).toBeNull();
  });
});

describe('buildImportSchedule', () => {
  it('lists every statement out since the last import, oldest first', () => {
    const s = buildImportSchedule({
      cardStatementDay: 1,
      last4: '2209',
      imports: bizGrowImports,
      todayIso: '2026-10-19',
    });

    expect(s.status).toBe('ready');
    expect(s.statementDay).toBe(16);
    expect(s.statementDaySource).toBe('history');
    expect(s.statementDayMismatch).toBe(true);
    expect(s.lastImported).toEqual({
      month: '2026-08',
      label: 'Aug 2026',
      statementDate: '2026-08-16',
    });
    expect(s.pending.map((p) => p.label)).toEqual(['Sep 2026', 'Oct 2026']);
    expect(s.next).toEqual({
      month: '2026-09',
      label: 'Sep 2026',
      expectedDate: '2026-09-16',
      daysAway: -33,
      estimatedDueDate: '2026-10-11',
      filenameHint: 'Sep2026_BilledStatements_2209',
    });
    expect(s.gaps).toEqual([]);
    expect(s.timeline).toEqual([
      { month: '2026-06', label: 'Jun 2026', state: 'imported' },
      { month: '2026-07', label: 'Jul 2026', state: 'imported' },
      { month: '2026-08', label: 'Aug 2026', state: 'imported' },
      { month: '2026-09', label: 'Sep 2026', state: 'ready' },
      { month: '2026-10', label: 'Oct 2026', state: 'ready' },
      { month: '2026-11', label: 'Nov 2026', state: 'upcoming' },
    ]);
  });

  it('waits for the next statement once everything out is imported', () => {
    const s = buildImportSchedule({
      cardStatementDay: 16,
      last4: '2209',
      imports: [...bizGrowImports, imported('2026-10-16'), imported('2026-09-16')],
      todayIso: '2026-10-19',
    });

    expect(s.status).toBe('waiting');
    expect(s.statementDayMismatch).toBe(false);
    expect(s.pending).toEqual([]);
    expect(s.next?.label).toBe('Nov 2026');
    expect(s.next?.expectedDate).toBe('2026-11-16');
    expect(s.next?.daysAway).toBe(28);
    expect(s.timeline.at(-1)).toEqual({
      month: '2026-11',
      label: 'Nov 2026',
      state: 'upcoming',
    });
  });

  it('counts a statement dated today as out', () => {
    const s = buildImportSchedule({
      cardStatementDay: null,
      last4: '2209',
      imports: bizGrowImports,
      todayIso: '2026-09-16',
    });
    expect(s.status).toBe('ready');
    expect(s.next?.daysAway).toBe(0);
  });

  it('flags months skipped between imports', () => {
    const s = buildImportSchedule({
      cardStatementDay: null,
      last4: '2209',
      imports: [imported('2026-05-16'), imported('2026-08-16')],
      todayIso: '2026-08-20',
    });

    expect(s.gaps.map((g) => g.label)).toEqual(['Jun 2026', 'Jul 2026']);
    expect(s.timeline.map((t) => t.state)).toEqual([
      'imported',
      'missing',
      'missing',
      'imported',
      'upcoming',
    ]);
  });

  it('starts a card with no imports from its latest statement', () => {
    const s = buildImportSchedule({
      cardStatementDay: 25,
      last4: '1111',
      imports: [],
      todayIso: '2026-10-19',
    });

    expect(s.status).toBe('ready');
    expect(s.statementDaySource).toBe('card');
    expect(s.lastImported).toBeNull();
    expect(s.pending.map((p) => p.expectedDate)).toEqual(['2026-09-25']);
    expect(s.next?.estimatedDueDate).toBeNull();
    expect(s.next?.filenameHint).toBeNull();
    expect(s.timeline.map((t) => [t.label, t.state])).toEqual([
      ['Sep 2026', 'ready'],
      ['Oct 2026', 'upcoming'],
    ]);
  });

  it('clamps a 31st statement day into short months', () => {
    const s = buildImportSchedule({
      cardStatementDay: null,
      last4: '1111',
      imports: [imported('2027-01-31')],
      todayIso: '2027-03-05',
    });
    expect(s.pending.map((p) => p.expectedDate)).toEqual(['2027-02-28']);
    expect(s.next?.label).toBe('Feb 2027');
  });

  it('rolls the next statement across the year', () => {
    const s = buildImportSchedule({
      cardStatementDay: null,
      last4: '1111',
      imports: [imported('2026-12-16')],
      todayIso: '2027-01-20',
    });
    expect(s.next?.label).toBe('Jan 2027');
    expect(s.next?.expectedDate).toBe('2027-01-16');
  });

  it('cannot say anything without imports or a statement day', () => {
    const s = buildImportSchedule({
      cardStatementDay: null,
      last4: '1111',
      imports: [],
      todayIso: '2026-10-19',
    });
    expect(s.status).toBe('unknown');
    expect(s.next).toBeNull();
    expect(s.timeline).toEqual([]);
  });
});
