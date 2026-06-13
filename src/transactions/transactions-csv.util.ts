import { Transaction } from '../database/entities/transaction.entity';

/**
 * Serializes a list of transactions to CSV text (RFC 4180 quoting).
 *
 * Kept as a pure function so it is trivial to unit test and reuse. The caller is
 * responsible for transport concerns (Content-Type, filename, the UTF-8 BOM that
 * makes Excel read non-ASCII narrations correctly).
 */

const CSV_HEADERS = [
  'Date',
  'Narration',
  'UPI Name',
  'UPI Description',
  'UPI Bank',
  'Type',
  'Amount',
  'Balance',
  'Account',
] as const;

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Quote fields containing the delimiter, quotes, or newlines; escape inner quotes.
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(',');
}

export function buildTransactionsCsv(transactions: Transaction[]): string {
  const rows: string[] = [toRow([...CSV_HEADERS])];

  for (const t of transactions) {
    const isCredit = Number(t.deposit) > 0;
    rows.push(
      toRow([
        t.transactionDate,
        t.narration,
        t.upiName ?? '',
        t.upiDescription ?? '',
        t.upiBank ?? '',
        isCredit ? 'Credit' : 'Debit',
        isCredit ? t.deposit : t.withdrawal,
        t.balance,
        t.account?.accountNumber ?? '',
      ]),
    );
  }

  return rows.join('\r\n');
}
