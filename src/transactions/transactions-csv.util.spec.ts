import { Transaction } from '../database/entities/transaction.entity';
import { buildTransactionsCsv } from './transactions-csv.util';

function makeTransaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: '1',
    transactionDate: '2026-01-15',
    accountId: '1',
    statementImportId: null,
    narration: 'Test narration',
    withdrawal: 0,
    deposit: 0,
    balance: 0,
    upiName: null,
    upiDescription: null,
    upiBank: null,
    isManual: false,
    categoryId: '1',
    createdAt: new Date('2026-01-15T00:00:00Z'),
    ...overrides,
  } as Transaction;
}

describe('buildTransactionsCsv', () => {
  it('emits only the header row for an empty list', () => {
    const csv = buildTransactionsCsv([]);
    expect(csv).toBe(
      'Date,Narration,UPI Name,UPI Description,UPI Bank,Type,Amount,Balance,Account',
    );
  });

  it('marks withdrawals as Debit and uses the withdrawal amount', () => {
    const csv = buildTransactionsCsv([
      makeTransaction({
        transactionDate: '2026-02-01',
        narration: 'Coffee',
        withdrawal: 250.5,
        balance: 1000,
        account: { accountNumber: 'Wallet' } as Transaction['account'],
      }),
    ]);
    const [, row] = csv.split('\r\n');
    expect(row).toBe('2026-02-01,Coffee,,,,Debit,250.5,1000,Wallet');
  });

  it('marks deposits as Credit and uses the deposit amount', () => {
    const csv = buildTransactionsCsv([
      makeTransaction({ narration: 'Refund', deposit: 99.99, withdrawal: 0 }),
    ]);
    const [, row] = csv.split('\r\n');
    expect(row).toContain(',Credit,99.99,');
  });

  it('quotes and escapes fields containing commas, quotes, or newlines', () => {
    const csv = buildTransactionsCsv([
      makeTransaction({ narration: 'Paid "rent", April\nadvance', withdrawal: 100 }),
    ]);
    const [, row] = csv.split('\r\n');
    expect(row.startsWith('2026-01-15,"Paid ""rent"", April\nadvance",')).toBe(true);
  });

  it('renders missing UPI metadata and account as empty fields', () => {
    const csv = buildTransactionsCsv([makeTransaction({ narration: 'Bare', withdrawal: 10 })]);
    const [, row] = csv.split('\r\n');
    // UPI Name / Description / Bank and Account are all blank.
    expect(row).toBe('2026-01-15,Bare,,,,Debit,10,0,');
  });
});
