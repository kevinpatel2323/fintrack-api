const XLSX = require('xlsx');

function extractUpiName(upiString) {
  if (!upiString) return null;
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

function extractUpiDescription(upiString) {
  if (!upiString) return null;
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

function parseDateDDMMYY(value) {
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

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/,/g, '').trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function dateToIso(date) {
  if (!date) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseHdfcStatement(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Mirror the reference logic: drop header/footer noise and unused columns
  const body = rows.slice(21, rows.length - 18);
  const trimmed = body.filter((row, idx) => idx !== 1); // drop row index 1

  const entries = [];
  for (const row of trimmed) {
    const narration = String(row[1] || '').trim();
    const dateValue = row[3];
    const withdrawalValue = row[4];
    const depositValue = row[5];
    const balanceValue = row[6];

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

  return entries;
}

module.exports = { parseHdfcStatement };
