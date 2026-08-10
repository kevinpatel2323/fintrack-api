import * as XLSX from 'xlsx';
import { parseHdfcCcStatement, looksLikeCreditCardStatement } from './hdfc-cc.parser';

const D = '~|~';

const CSV_STATEMENT = [
  'Name' + D + 'TEST USER ',
  'Payment Due Date' + D + '10/06/2026 ',
  'Statement Date' + D + '16/05/2026 ',
  'Total Amount Due' + D + '1,994.00 ',
  'Minimum Amount Due' + D + '279.00 ',
  'Credit Limit' + D + '75,000.00 ',
  '',
  'Card No: 5535 83XX XXXX 2209 ',
  '',
  'Domestic / International Transactions',
  ['Transaction type', 'Primary / Addon Customer Name', 'DATE', 'Description', 'AMT', 'Debit /Credit', 'REWARDS'].join(D),
  ['Domestic', 'TEST USER ', '11/05/2026 19:55:29', 'Coffee Shop ', '3.00', '', ''].join(D),
  ['Domestic', 'TEST USER ', '11/05/2026 00:00:00', 'Refunded Item ', '3.00', 'Cr', ''].join(D),
  ['International', 'TEST USER ', '13/05/2026 18:01:08', 'Some SaaS ', '1,915.08', '', '+ 24'].join(D),
  '',
  'Reward Points Summary',
].join('\n');

// The .xlsx export spreads the same data across padded columns and uses
// "16 May, 2026" style dates plus a "DD/MM/YYYY / HH:mm" transaction stamp.
function buildSpreadsheet(bookType: 'xlsx' | 'xls'): Buffer {
  const pad = (index: number, value: string) => {
    const row = new Array(24).fill('');
    row[index] = value;
    return row;
  };
  const at = (pairs: [number, string][]) => {
    const row = new Array(24).fill('');
    for (const [index, value] of pairs) row[index] = value;
    return row;
  };

  const rows = [
    pad(0, 'Name'),
    pad(0, 'Address'),
    at([[0, 'Address'], [13, 'Credit Card No.: 553583XXXXXX2209']]),
    at([[0, 'CKYC ID'], [13, 'Alternate Account Number: 0001016430005552202']]),
    pad(0, 'Customer GSTN'),
    at([[0, 'Payment Due Date'], [4, '10 Jun, 2026']]),
    at([[0, 'Statement Date'], [4, '16 May, 2026']]),
    at([[0, 'Total Amount Due'], [4, '1,994.00'], [10, 'Past Dues (If any)']]),
    at([[0, 'Minimum Amount Due'], [4, '279.00'], [10, 'Overlimit']]),
    at([[0, 'Credit Limit'], [4, '75,000'], [10, '0.00']]),
    at([[0, 'Available Limit'], [4, '73,006']]),
    [],
    at([[0, 'Transaction type'], [4, 'Primary / Addon Customer Name'], [9, 'Date & Time'], [12, 'Description'], [18, 'REWARDS'], [20, 'AMT'], [23, 'Debit / Credit']]),
    at([[0, 'Domestic'], [4, 'TEST USER '], [9, '11/05/2026 / 19:55'], [12, 'Coffee Shop '], [20, '3.00']]),
    at([[0, 'Domestic'], [4, 'TEST USER '], [9, '11/05/2026 / 00:00'], [12, 'Refunded Item '], [20, '3.00'], [23, 'Cr']]),
    at([[0, 'International'], [4, 'TEST USER '], [9, '13/05/2026 / 18:01'], [12, 'Some SaaS '], [18, '+ 24'], [20, '1,915.08']]),
    [],
    pad(0, 'Reward Points Summary'),
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Statement');
  return XLSX.write(workbook, { type: 'buffer', bookType });
}

// Some exports terminate every transaction row with a trailing delimiter.
const CSV_TRAILING_DELIMITERS = CSV_STATEMENT.split('\n')
  .map((line) => (line.includes(D) ? `${line}${D}` : line))
  .join('\n');

// Columns must be located by label, so a reordered table has to parse the same.
const CSV_REORDERED_COLUMNS = [
  'Card No: 5535 83XX XXXX 2209 ',
  'Statement Date' + D + '16/05/2026 ',
  'Payment Due Date' + D + '10/06/2026 ',
  'Total Amount Due' + D + '1,994.00 ',
  'Minimum Amount Due' + D + '279.00 ',
  'Credit Limit' + D + '75,000.00 ',
  '',
  'Domestic / International Transactions',
  ['Description', 'AMT', 'Debit /Credit', 'DATE', 'Transaction type', 'REWARDS'].join(D),
  ['Coffee Shop ', '3.00', '', '11/05/2026 19:55:29', 'Domestic', ''].join(D),
  ['Refunded Item ', '3.00', 'Cr', '11/05/2026 00:00:00', 'Domestic', ''].join(D),
  ['Some SaaS ', '1,915.08', '', '13/05/2026 18:01:08', 'International', '+ 24'].join(D),
  '',
].join('\n');

describe('parseHdfcCcStatement', () => {
  it('parses the CSV export', () => {
    const result = parseHdfcCcStatement(Buffer.from(CSV_STATEMENT, 'utf8'));

    expect(result.last4).toBe('2209');
    expect(result.statementDate).toBe('2026-05-16');
    expect(result.dueDate).toBe('2026-06-10');
    expect(result.totalDue).toBe(1994);
    expect(result.minDue).toBe(279);
    expect(result.creditLimit).toBe(75000);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[1]).toMatchObject({ isRefund: true, amount: 3 });
    expect(result.entries[2]).toMatchObject({ isInternational: true, amount: 1915.08 });
  });

  // Every shape HDFC has been observed to emit must agree exactly — including
  // the "xlsx" download, which is really a legacy OLE2 workbook.
  it.each([
    ['trailing delimiters', () => Buffer.from(CSV_TRAILING_DELIMITERS, 'utf8')],
    ['reordered columns', () => Buffer.from(CSV_REORDERED_COLUMNS, 'utf8')],
    ['an xlsx workbook', () => buildSpreadsheet('xlsx')],
    ['a legacy OLE2 workbook', () => buildSpreadsheet('xls')],
  ])('parses %s identically to the CSV', (_label, build) => {
    const baseline = parseHdfcCcStatement(Buffer.from(CSV_STATEMENT, 'utf8'));
    const variant = parseHdfcCcStatement(build());

    const shape = (statement: typeof baseline) => ({
      last4: statement.last4,
      statementDate: statement.statementDate,
      dueDate: statement.dueDate,
      totalDue: statement.totalDue,
      minDue: statement.minDue,
      creditLimit: statement.creditLimit,
      entries: statement.entries.map((entry) => [
        entry.txnDate, entry.amount, entry.isRefund, entry.isInternational,
      ]),
    });

    expect(shape(variant)).toEqual(shape(baseline));
  });

  it('accepts the "16 May, 2026" date style used by the spreadsheet', () => {
    const result = parseHdfcCcStatement(buildSpreadsheet('xlsx'));

    expect(result.statementDate).toBe('2026-05-16');
    expect(result.dueDate).toBe('2026-06-10');
  });

  it('rejects a file that is not a credit card statement', () => {
    expect(() => parseHdfcCcStatement(Buffer.from('nothing to see here', 'utf8'))).toThrow(
      /Could not find the card number/,
    );
  });
});

describe('looksLikeCreditCardStatement', () => {
  it.each([
    ['CSV', () => Buffer.from(CSV_STATEMENT, 'utf8')],
    ['xlsx', () => buildSpreadsheet('xlsx')],
    ['xls', () => buildSpreadsheet('xls')],
  ])('detects the %s export', (_label, build) => {
    expect(looksLikeCreditCardStatement(build())).toBe(true);
  });

  it('does not flag unrelated content', () => {
    expect(looksLikeCreditCardStatement(Buffer.from('Date,Narration,Withdrawal', 'utf8'))).toBe(false);
  });

  it('does not throw on a corrupt buffer', () => {
    expect(looksLikeCreditCardStatement(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))).toBe(false);
  });
});
