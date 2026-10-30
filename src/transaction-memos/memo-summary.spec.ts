import type { TransactionMemo } from '../database/entities/transaction-memo.entity';
import { holderNamesByLast4, memoHolderName, memoSummary } from './memo-summary';

const memo = (fields: Partial<TransactionMemo>) =>
  ({
    direction: 'debit',
    amount: 1234,
    currency: 'INR',
    merchant: 'AMAZON',
    vpa: null,
    sender: null,
    bank: 'hdfc',
    last4: '6714',
    instrument: 'account',
    ...fields,
  }) as TransactionMemo;

describe('holderNamesByLast4', () => {
  it('names the one account ending in the digits, once it is named', () => {
    const names = holderNamesByLast4([
      { accountNumber: '50100123456714', holderName: 'Kevin Patel' },
      { accountNumber: '50100555552209', holderName: null },
      { accountNumber: 'Wallet', holderName: 'Cash' },
    ]);
    expect(names.get('6714')).toBe('Kevin Patel');
    expect(names.has('2209')).toBe(false);
    expect(names.size).toBe(1);
  });

  it('names neither account when two end in the same digits', () => {
    const names = holderNamesByLast4([
      { accountNumber: '50100123456714', holderName: 'Kevin Patel' },
      { accountNumber: '60200000006714', holderName: 'Mom' },
    ]);
    expect(names.has('6714')).toBe(false);
  });
});

describe('memoSummary with a holder name', () => {
  const names = new Map([['6714', 'Kevin Patel']]);

  it('shows a bank account SMS by its holder', () => {
    const row = memo({});
    expect(memoHolderName(row, names)).toBe('Kevin Patel');
    expect(memoSummary(row, memoHolderName(row, names))).toBe('−₹1,234.00 · AMAZON · Kevin Patel');
  });

  it('keeps the bank and digits for a card, an unknown account or no name', () => {
    expect(memoHolderName(memo({ instrument: 'card' }), names)).toBeNull();
    expect(memoHolderName(memo({ last4: '2209' }), names)).toBeNull();
    expect(memoSummary(memo({}))).toBe('−₹1,234.00 · AMAZON · HDFC ••6714');
  });
});
