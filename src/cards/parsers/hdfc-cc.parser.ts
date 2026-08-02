import { BadRequestException } from '@nestjs/common';

export interface ParsedCcEntry {
  txnDate: string; // YYYY-MM-DD
  merchant: string;
  amount: number;
  isRefund: boolean;
  isInternational: boolean;
}

export interface ParsedCcStatement {
  last4: string;
  statementDate: string; // YYYY-MM-DD
  dueDate: string | null;
  totalDue: number;
  minDue: number;
  creditLimit: number | null;
  entries: ParsedCcEntry[];
}

const DELIMITER = '~|~';
const TXN_SECTION_HEADER = 'Domestic / International Transactions';
const TXN_COLUMN_HEADER_PREFIX = 'Transaction type' + DELIMITER;

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const value = Number(cleaned);
  if (Number.isNaN(value)) {
    throw new BadRequestException(`Could not parse amount "${raw.trim()}"`);
  }
  return value;
}

// DD/MM/YYYY (optionally followed by HH:mm:ss) → YYYY-MM-DD
function parseDateDDMMYYYY(raw: string): string {
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) {
    throw new BadRequestException(`Could not parse date "${raw.trim()}"`);
  }
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function metadataValue(line: string): string {
  const parts = line.split(DELIMITER);
  return (parts[1] ?? '').trim();
}

export function parseHdfcCcStatement(buffer: Buffer): ParsedCcStatement {
  const lines = buffer.toString('utf8').split(/\r?\n/);

  let last4: string | null = null;
  let statementDate: string | null = null;
  let dueDate: string | null = null;
  let totalDue = 0;
  let minDue = 0;
  let creditLimit: number | null = null;
  const entries: ParsedCcEntry[] = [];

  let inTxnSection = false;
  let pastColumnHeader = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (inTxnSection) {
      if (!pastColumnHeader) {
        if (line.startsWith(TXN_COLUMN_HEADER_PREFIX)) pastColumnHeader = true;
        continue;
      }
      if (!line) {
        // Blank line ends the transaction section.
        inTxnSection = false;
        continue;
      }
      const cells = line.split(DELIMITER);
      if (cells.length < 6) {
        inTxnSection = false;
        continue;
      }
      const [type, , date, description, amt, drcr] = cells;
      entries.push({
        txnDate: parseDateDDMMYYYY(date),
        merchant: description.trim(),
        amount: parseAmount(amt),
        isRefund: drcr.trim() === 'Cr',
        isInternational: type.trim().toLowerCase() === 'international',
      });
      continue;
    }

    if (line === TXN_SECTION_HEADER) {
      inTxnSection = true;
      pastColumnHeader = false;
      continue;
    }

    if (line.startsWith('Card No:')) {
      const match = line.match(/(\d{4})\s*$/);
      if (match) last4 = match[1];
      continue;
    }
    if (line.startsWith('Payment Due Date' + DELIMITER)) {
      const value = metadataValue(line);
      if (value) dueDate = parseDateDDMMYYYY(value);
      continue;
    }
    if (line.startsWith('Statement Date' + DELIMITER)) {
      const value = metadataValue(line);
      if (value) statementDate = parseDateDDMMYYYY(value);
      continue;
    }
    if (line.startsWith('Total Amount Due' + DELIMITER)) {
      totalDue = parseAmount(metadataValue(line));
      continue;
    }
    if (line.startsWith('Minimum Amount Due' + DELIMITER)) {
      minDue = parseAmount(metadataValue(line));
      continue;
    }
    if (line.startsWith('Credit Limit' + DELIMITER)) {
      creditLimit = parseAmount(metadataValue(line));
      continue;
    }
  }

  if (!last4) {
    throw new BadRequestException(
      'Could not find the card number in this file — is it an HDFC credit card statement CSV?',
    );
  }
  if (!statementDate) {
    throw new BadRequestException('Could not find the statement date in this file.');
  }

  return { last4, statementDate, dueDate, totalDue, minDue, creditLimit, entries };
}
