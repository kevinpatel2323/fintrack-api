import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

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

// HDFC ships the same billed statement in several shapes: a `~|~` delimited CSV
// (with or without trailing delimiters) and a spreadsheet that is sometimes a
// real .xlsx and sometimes a legacy OLE2 workbook under an .xlsx name. Every
// shape is read into the same `string[][]` grid and parsed by column *label*,
// never by fixed position, so a reordered or inserted column cannot silently
// shift an amount into the wrong field.

const DELIMITER = '~|~';
const TXN_SECTION_HEADER = 'Domestic / International Transactions';

const SPREADSHEET_MAGICS = [
  [0x50, 0x4b, 0x03, 0x04], // ZIP  → .xlsx
  [0xd0, 0xcf, 0x11, 0xe0], // OLE2 → .xls mislabelled as .xlsx
];

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// Column labels vary by export ("DATE" vs "Date & Time", "Debit /Credit" vs
// "Debit / Credit"), so match on a whitespace-free lowercase key.
const COLUMN_KEYS = {
  type: ['transactiontype'],
  date: ['date', 'date&time'],
  description: ['description'],
  amount: ['amt', 'amount'],
  drcr: ['debit/credit', 'debitcredit'],
} as const;

const METADATA_KEYS = {
  dueDate: 'paymentduedate',
  statementDate: 'statementdate',
  totalDue: 'totalamountdue',
  minDue: 'minimumamountdue',
  creditLimit: 'creditlimit',
} as const;

function isSpreadsheetBuffer(buffer: Buffer): boolean {
  return SPREADSHEET_MAGICS.some((magic) => magic.every((byte, i) => buffer[i] === byte));
}

function cellText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Whitespace-free lowercase form used to compare labels across exports. */
function labelKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/:$/, '');
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const value = Number(cleaned);
  if (Number.isNaN(value)) {
    throw new BadRequestException(`Could not parse amount "${raw.trim()}"`);
  }
  return value;
}

/**
 * Accepts every date shape these statements use — `DD/MM/YYYY` optionally
 * followed by a time (`11/05/2026 19:55:29`, `11/05/2026 / 19:55`) and the
 * spreadsheet's `16 May, 2026` — and returns YYYY-MM-DD.
 */
function parseStatementDate(raw: string): string | null {
  const text = raw.trim();

  const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (numeric) {
    const [, day, month, year] = numeric;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const named = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) return `${named[3]}-${month}-${named[1].padStart(2, '0')}`;
  }

  return null;
}

function requireDate(raw: string, field: string): string {
  const parsed = parseStatementDate(raw);
  if (!parsed) {
    throw new BadRequestException(`Could not parse ${field} "${raw.trim()}"`);
  }
  return parsed;
}

/** Read any supported container into a uniform grid of trimmed cells. */
function toRows(buffer: Buffer): string[][] {
  if (isSpreadsheetBuffer(buffer)) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
    return rows.map((row) => (Array.isArray(row) ? row.map(cellText) : []));
  }

  return buffer
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.split(DELIMITER).map(cellText));
}

/** First non-empty cell after the label, wherever the export padded it to. */
function valueAfterLabel(row: string[]): string | undefined {
  return row.slice(1).find((cell) => cell !== '');
}

function extractLast4(rows: string[][]): string | null {
  for (const row of rows) {
    for (const cell of row) {
      // "Card No: 5535 83XX XXXX 2209" / "Credit Card No.: 553583XXXXXX2209"
      if (!/^(credit\s*)?card\s*(no|number)\.?\s*:/i.test(cell)) continue;
      const digits = cell.match(/(\d{4})\s*$/);
      if (digits) return digits[1];
    }
  }
  return null;
}

function findTxnHeader(rows: string[][]): number {
  return rows.findIndex((row) => row.some((cell) => labelKey(cell) === COLUMN_KEYS.type[0]));
}

function parseEntries(rows: string[][], headerIndex: number): ParsedCcEntry[] {
  const header = rows[headerIndex];
  const columnOf = (keys: readonly string[]) =>
    header.findIndex((cell) => keys.includes(labelKey(cell)));

  const typeCol = columnOf(COLUMN_KEYS.type);
  const dateCol = columnOf(COLUMN_KEYS.date);
  const descCol = columnOf(COLUMN_KEYS.description);
  const amountCol = columnOf(COLUMN_KEYS.amount);
  const drcrCol = columnOf(COLUMN_KEYS.drcr);

  if (dateCol === -1 || amountCol === -1) {
    throw new BadRequestException(
      'Could not find the date and amount columns in the transaction table.',
    );
  }

  const at = (row: string[], column: number) => (column === -1 ? '' : (row[column] ?? ''));
  const entries: ParsedCcEntry[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const type = at(row, typeCol);
    const date = at(row, dateCol);
    // A row missing both the type and the date is the end of the table (blank
    // line in the CSV, padding row in the spreadsheet).
    if (!type && !date) break;
    // Trailing delimiters and merged cells can yield stray rows inside the
    // table; skip anything that carries no date rather than aborting.
    if (!date) continue;

    entries.push({
      txnDate: requireDate(date, 'transaction date'),
      merchant: at(row, descCol),
      amount: parseAmount(at(row, amountCol)),
      isRefund: at(row, drcrCol).toLowerCase() === 'cr',
      isInternational: type.toLowerCase() === 'international',
    });
  }

  return entries;
}

/**
 * True if the buffer looks like an HDFC *credit card* statement in any of its
 * shapes, used to give a clearer error when one reaches the bank importer.
 */
export function looksLikeCreditCardStatement(buffer: Buffer): boolean {
  try {
    const rows = toRows(buffer);
    return (
      extractLast4(rows) !== null ||
      findTxnHeader(rows) !== -1 ||
      rows.some((row) => row.some((cell) => cell === TXN_SECTION_HEADER))
    );
  } catch {
    return false;
  }
}

export function parseHdfcCcStatement(buffer: Buffer): ParsedCcStatement {
  const rows = toRows(buffer);

  let statementDate: string | null = null;
  let dueDate: string | null = null;
  let totalDue = 0;
  let minDue = 0;
  let creditLimit: number | null = null;

  const seen = new Set<string>();
  for (const row of rows) {
    const key = labelKey(row[0] ?? '');
    // First occurrence wins — these labels reappear as column headers in the
    // "Past Dues" summary table further down.
    if (!key || seen.has(key)) continue;
    const value = valueAfterLabel(row);
    if (!value) continue;

    switch (key) {
      case METADATA_KEYS.dueDate:
        dueDate = requireDate(value, 'payment due date');
        break;
      case METADATA_KEYS.statementDate:
        statementDate = requireDate(value, 'statement date');
        break;
      case METADATA_KEYS.totalDue:
        totalDue = parseAmount(value);
        break;
      case METADATA_KEYS.minDue:
        minDue = parseAmount(value);
        break;
      case METADATA_KEYS.creditLimit:
        creditLimit = parseAmount(value);
        break;
      default:
        continue;
    }
    seen.add(key);
  }

  const last4 = extractLast4(rows);
  if (!last4) {
    throw new BadRequestException(
      'Could not find the card number in this file — is it an HDFC credit card statement?',
    );
  }
  if (!statementDate) {
    throw new BadRequestException('Could not find the statement date in this file.');
  }

  const headerIndex = findTxnHeader(rows);
  const entries = headerIndex === -1 ? [] : parseEntries(rows, headerIndex);

  return { last4, statementDate, dueDate, totalDue, minDue, creditLimit, entries };
}
