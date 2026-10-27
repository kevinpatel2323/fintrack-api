import { BadRequestException } from '@nestjs/common';

/**
 * Reads the text a person copies off HDFC's "Unbilled Transactions" page
 * (MyCards / NetBanking). HDFC offers no download for unbilled spend, but the
 * page copies cleanly as one block per row:
 *
 *   18 Oct 2026
 *   Upi-allevents Informations Pv
 *   ELIGIBLE FOR SMARTEMI
 *   ₹14,047.20    debit icon
 *
 * The page's own "Total Spent" / "Total Credited" figures are checked against
 * the rows, so a partial copy or a misread amount is rejected instead of
 * quietly saving the wrong spend.
 */

export interface ParsedUnbilledEntry {
  txnDate: string; // YYYY-MM-DD
  merchant: string;
  amount: number;
  isRefund: boolean;
}

export interface ParsedUnbilledPaste {
  entries: ParsedUnbilledEntry[];
  totalSpent: number | null;
  totalCredited: number | null;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const DATE_LINE = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/;
const AMOUNT_LINE = /^(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)\s*(.*)$/i;
// Badges HDFC prints under a merchant; never part of its name.
const BADGE = /^(eligible for smartemi|smartemi|emi)$/i;

function toPaise(raw: string): number {
  return Math.round(Number(raw.replace(/,/g, '')) * 100);
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** The amount on the line after a label such as "Total Spent", if present. */
function figureAfter(all: string[], label: string): number | null {
  const at = all.findIndex((l) => l.toLowerCase() === label);
  if (at < 0) return null;
  const m = all[at + 1]?.match(AMOUNT_LINE);
  return m ? toPaise(m[1]) / 100 : null;
}

export function parseHdfcUnbilledPaste(text: string): ParsedUnbilledPaste {
  const all = lines(text ?? '');
  const entries: ParsedUnbilledEntry[] = [];

  for (let i = 0; i < all.length; i++) {
    const date = all[i].match(DATE_LINE);
    if (!date) continue;
    const month = MONTHS[date[2].toLowerCase()];
    if (!month) continue;

    const nameParts: string[] = [];
    let j = i + 1;
    let amount: RegExpMatchArray | null = null;
    for (; j < all.length && j <= i + 4; j++) {
      if (DATE_LINE.test(all[j])) break;
      amount = all[j].match(AMOUNT_LINE);
      if (amount) break;
      if (!BADGE.test(all[j])) nameParts.push(all[j]);
    }
    if (!amount || nameParts.length === 0) {
      throw new BadRequestException(
        `Could not read the row dated "${all[i]}". Copy the whole list again.`,
      );
    }

    entries.push({
      txnDate: `${date[3]}-${month}-${date[1].padStart(2, '0')}`,
      merchant: nameParts.join(' '),
      amount: toPaise(amount[1]) / 100,
      // The page marks money back on the card with a "credit" icon.
      isRefund: /credit/i.test(amount[2]),
    });
    i = j;
  }

  if (entries.length === 0) {
    throw new BadRequestException(
      'No transactions found. Copy the list from HDFC\'s Unbilled Transactions page, dates and amounts included.',
    );
  }

  const totalSpent = figureAfter(all, 'total spent');
  const totalCredited = figureAfter(all, 'total credited');
  const sum = (refund: boolean) =>
    entries
      .filter((e) => e.isRefund === refund)
      .reduce((s, e) => s + Math.round(e.amount * 100), 0);

  if (totalSpent !== null && sum(false) !== Math.round(totalSpent * 100)) {
    throw new BadRequestException(
      `Rows add up to ₹${(sum(false) / 100).toFixed(2)} but the page says Total Spent ₹${totalSpent.toFixed(2)}. Some rows are missing — scroll to load them all and copy again.`,
    );
  }
  if (totalCredited !== null && sum(true) !== Math.round(totalCredited * 100)) {
    throw new BadRequestException(
      `Credits add up to ₹${(sum(true) / 100).toFixed(2)} but the page says Total Credited ₹${totalCredited.toFixed(2)}. Copy the list again.`,
    );
  }

  return { entries, totalSpent, totalCredited };
}
