import type { TransactionMemo } from '../database/entities/transaction-memo.entity';

type SummaryFields = Pick<
  TransactionMemo,
  'direction' | 'amount' | 'currency' | 'merchant' | 'vpa' | 'sender' | 'bank' | 'last4'
>;

const RUPEES = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Who the money went to or came from, falling back to the handle, then the SMS sender. */
export function memoPayee(row: Pick<SummaryFields, 'merchant' | 'vpa' | 'sender'>): string | null {
  return row.merchant || row.vpa || row.sender || null;
}

/**
 * One line the phone shows when it asks for the memo, and the "Add Fintrack
 * memo" shortcut lists: "−₹1,234.00 · AMAZON · HDFC ••2209".
 */
export function memoSummary(row: SummaryFields): string {
  const sign = row.direction === 'debit' ? '−' : row.direction === 'credit' ? '+' : '';
  const money =
    row.amount === null
      ? null
      : `${sign}${!row.currency || row.currency === 'INR' ? '₹' : `${row.currency} `}${RUPEES.format(row.amount)}`;
  const account = row.last4 ? `${(row.bank ?? '').toUpperCase()} ••${row.last4}`.trim() : row.bank?.toUpperCase() ?? null;
  return [money, memoPayee(row), account].filter(Boolean).join(' · ') || 'Bank message';
}
