import * as XLSX from 'xlsx';
import { parseHdfcStatement } from './hdfc.parser';

// The parser reads the account number from row 14 / column E, and the
// transaction body from row 21 up to the trailing 18 footer rows.
function buildStatement(options: { row14ColE?: string; body?: unknown[][] }): Buffer {
  const rows: unknown[][] = Array.from({ length: 21 }, () => []);
  // Anchor the sheet range at A1 — aoa_to_sheet drops leading empty rows, which
  // would shift every row index the parser depends on.
  rows[0] = ['HDFC BANK LTD'];
  if (options.row14ColE !== undefined) {
    rows[14] = ['', '', '', '', options.row14ColE];
  }
  rows.push(...(options.body ?? []));
  // Footer rows must carry content too — trailing empty rows are dropped on
  // write, which would shrink the `rows.length - 18` body window.
  rows.push(...Array.from({ length: 18 }, (_, i) => [`footer ${i}`]));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

// [_, narration, _, date, withdrawal, deposit, balance]
const TXN_ROW = ['', 'UPI-JOHN DOE@okhdfc-payment', '', '05/05/26', '250.50', '', '1000.00'];

describe('parseHdfcStatement', () => {
  it('extracts the account number and transactions', () => {
    const buffer = buildStatement({
      row14ColE: 'Account No :50100123456789 ',
      body: [TXN_ROW],
    });

    const result = parseHdfcStatement(buffer);

    expect(result.accountNumber).toBe('50100123456789');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      transactionDateIso: '2026-05-05',
      withdrawal: 250.5,
      deposit: 0,
      balance: 1000,
      upiName: 'JOHN DOE',
    });
  });

  // A cell too short to contain an account number used to slice to "" and be
  // returned as though it were a real account number.
  it.each([
    ['a placeholder cell', '-'],
    ['a short cell', 'Account No :'],
    ['a non-statement header', 'Transaction type'],
  ])('returns null for %s rather than an empty string', (_label, row14ColE) => {
    const result = parseHdfcStatement(buildStatement({ row14ColE, body: [TXN_ROW] }));

    expect(result.accountNumber).toBeNull();
  });

  it('returns no entries when row 14 is missing entirely', () => {
    const result = parseHdfcStatement(buildStatement({}));

    expect(result.accountNumber).toBeNull();
    expect(result.entries).toEqual([]);
  });

  it('skips rows without a parseable date', () => {
    const result = parseHdfcStatement(
      buildStatement({
        row14ColE: 'Account No :50100123456789 ',
        body: [TXN_ROW, ['', 'Opening Balance', '', '', '', '', '']],
      }),
    );

    expect(result.entries).toHaveLength(1);
  });
});
