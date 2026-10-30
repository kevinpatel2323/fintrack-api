import type { Account } from '../database/entities/account.entity';
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
 * Last four digits → the holder name of the one account that ends in them, as
 * the web app matches an SMS to an account (`accountNameIndex`): only numbers
 * ending in four digits count, and digits two accounts share find neither.
 */
export function holderNamesByLast4(
  accounts: Pick<Account, 'accountNumber' | 'holderName'>[],
): Map<string, string> {
  const byLast4 = new Map<string, Pick<Account, 'holderName'> | null>();
  for (const account of accounts) {
    const number = String(account.accountNumber ?? '').trim();
    if (number.length <= 4 || !/\d{4}$/.test(number)) continue;
    const last4 = number.slice(-4);
    byLast4.set(last4, byLast4.has(last4) ? null : account);
  }
  const names = new Map<string, string>();
  for (const [last4, account] of byLast4) {
    if (account?.holderName) names.set(last4, account.holderName);
  }
  return names;
}

/** The holder name a bank account's SMS is shown by; null for a card or no match. */
export function memoHolderName(
  row: Pick<TransactionMemo, 'instrument' | 'last4'>,
  names: Map<string, string>,
): string | null {
  return row.instrument === 'account' && row.last4 ? names.get(row.last4) ?? null : null;
}

/**
 * One line the phone shows when it asks for the memo, and the "Add Fintrack
 * memo" shortcut lists: "−₹1,234.00 · AMAZON · HDFC ••2209", or
 * "· Kevin Patel" for a named bank account (`holderName`).
 */
export function memoSummary(row: SummaryFields, holderName: string | null = null): string {
  const sign = row.direction === 'debit' ? '−' : row.direction === 'credit' ? '+' : '';
  const money =
    row.amount === null
      ? null
      : `${sign}${!row.currency || row.currency === 'INR' ? '₹' : `${row.currency} `}${RUPEES.format(row.amount)}`;
  const account =
    holderName ||
    (row.last4 ? `${(row.bank ?? '').toUpperCase()} ••${row.last4}`.trim() : row.bank?.toUpperCase() ?? null);
  return [money, memoPayee(row), account].filter(Boolean).join(' · ') || 'Bank message';
}
