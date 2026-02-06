import * as XLSX from 'xlsx';

export type ParsedEntry = {
  transactionDate: Date;
  transactionDateIso: string;
  narration: string;
  withdrawal: number;
  deposit: number;
  balance: number;
  upiName: string | null;
  upiDescription: string | null;
  upiBank: string | null;
};

export type ParsedStatement = {
  accountNumber: string | null;
  entries: ParsedEntry[];
};

function extractUpiName(upiString: string): string | null {
  if (upiString.startsWith('UPI-')) {
    const parts = upiString.split('-');
    return parts.length > 1 ? parts[1] : null;
  }
  if (upiString.startsWith('POS')) {
    const parts = upiString.split(' ');
    return parts.length > 2 ? parts[2] : null;
  }
  if (upiString.includes('RTGS') || upiString.includes('NEFT')) {
    const parts = upiString.split('-');
    return parts.length > 2 ? parts[2] : null;
  }
  if (upiString.startsWith('CASH DEPOSIT BY')) {
    const parts = upiString.split('-');
    return parts.length > 1 ? parts[1].trim() : null;
  }
  return null;
}

function extractUpiDescription(upiString: string): string | null {
  if (upiString.startsWith('POS')) {
    const parts = upiString.split(' ');
    return parts.length > 2 ? parts.slice(2).join(' ') : null;
  }
  if (upiString.includes('RTGS') || upiString.includes('NEFT')) {
    const parts = upiString.split('-');
    return parts.length > 2 ? parts[parts.length - 2] : parts[parts.length - 1];
  }
  if (upiString.startsWith('CASH DEPOSIT BY')) {
    const parts = upiString.split('-');
    return parts.length > 2 ? parts[parts.length - 1].trim() : null;
  }
  const parts = upiString.split('-');
  return parts[parts.length - 1];
}

function parseDateDDMMYY(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  const str = String(value).trim();
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = 2000 + Number(match[3]);
  return new Date(Date.UTC(year, month, day));
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/,/g, '').trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function dateToIso(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function extractAccountNumber(rows: unknown[]): string | null {
  const targetRow = rows[14];
  if (!Array.isArray(targetRow)) return null;
  const cellValue = targetRow[4];
  console.log(cellValue);
  if (!cellValue) return null;
  const text = String(cellValue);
  const match = text.slice(12,26)
  console.log(match);
  return match;
}

export function parseHdfcStatement(buffer: Buffer): ParsedStatement {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[];

  // Mirror the reference logic: drop header/footer noise and unused columns
  const body = rows.slice(21, rows.length - 18);
  const trimmed = body;

  const entries: ParsedEntry[] = [];
  for (const row of trimmed) {
    if (!Array.isArray(row)) {
      continue;
    }
    const cells = row as unknown[];
    const narration = String(cells[1] || '').trim();
    const dateValue = cells[3];
    const withdrawalValue = cells[4];
    const depositValue = cells[5];
    const balanceValue = cells[6];

    const parsedDate = parseDateDDMMYY(dateValue);
    if (!parsedDate) continue;

    const withdrawal = toNumber(withdrawalValue);
    const deposit = toNumber(depositValue);
    const balance = toNumber(balanceValue);

    const upiRaw = narration.split('@')[0];
    const upiName = extractUpiName(upiRaw);
    const upiDescription = extractUpiDescription(narration);
    const upiBankMatch = narration.match(/@(.*?)-/);
    const upiBank = upiBankMatch ? upiBankMatch[1] : null;

    entries.push({
      transactionDate: parsedDate,
      transactionDateIso: dateToIso(parsedDate),
      narration,
      withdrawal,
      deposit,
      balance,
      upiName,
      upiDescription,
      upiBank,
    });
  }

  return { accountNumber: extractAccountNumber(rows), entries };
}
