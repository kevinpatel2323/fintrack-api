import { sha256Hex } from './device-credentials';
import { normaliseSmsText } from './sms-parser';

// What the server does to an SMS before anything is stored: mask any full card
// number, recognise registered bank senders, round the location and fingerprint
// the message so the same SMS sent twice lands once.

// Registered (DLT) SMS headers of the banks we know, without the operator
// prefix: "VM-HDFCBK", "AX-HDFCBK-S" and "HDFCBK" all reduce to HDFCBK.
export const BANK_SENDER_HEADERS: Record<string, string> = {
  HDFCBK: 'hdfc', HDFCBN: 'hdfc',
  ICICIB: 'icici', ICICIT: 'icici', ICICBK: 'icici',
  SBIINB: 'sbi', SBIUPI: 'sbi', SBIPSG: 'sbi', SBICRD: 'sbi', CBSSBI: 'sbi', ATMSBI: 'sbi',
  AXISBK: 'axis', KOTAKB: 'kotak', IDFCFB: 'idfc', IDFCBK: 'idfc',
  YESBNK: 'yes', YESBK: 'yes', AUBANK: 'au', FEDBNK: 'federal', FEDBK: 'federal',
  PNBSMS: 'pnb', BOBTXN: 'bob', BARBSM: 'bob', CNRBNK: 'canara',
  INDBNK: 'indian', INDBKS: 'indian', UCOBNK: 'uco', UBISMS: 'union', IOBSMS: 'iob',
  BOISML: 'boi', DBSBNK: 'dbs', INDUSB: 'indusind', RBLBNK: 'rbl', IDBIBK: 'idbi',
  PAYTMB: 'paytm', AIRBNK: 'airtel', JIOPBS: 'jio', AMEXIN: 'amex', SCBANK: 'sc',
};

const SENDER_HEADER = /^(?:[A-Z]{2}-?)?([A-Z]{5,7})(?:-[A-Z])?$/;

/** The bank behind a registered SMS header, or null for anything else (phone numbers, emails, unknown headers). */
export function bankForSender(sender: string | null | undefined): string | null {
  const match = SENDER_HEADER.exec((sender ?? '').trim().toUpperCase());
  return match ? BANK_SENDER_HEADERS[match[1]] ?? null : null;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// 13–19 digits in one run, or 4-digit groups split by spaces or dashes. Shorter
// numbers (12-digit UPI references, phone numbers) never qualify.
const CARD_NUMBER = /\b(?:\d{13,19}|\d{4}(?:[ -]\d{4}){2,3}(?:[ -]\d{1,3})?)\b/g;

/** Replaces any Luhn-valid card number with `XX` + its last four digits. */
export function maskCardNumbers(text: string): string {
  return text.replace(CARD_NUMBER, (run) => {
    const digits = run.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return run;
    return `XX${digits.slice(-4)}`;
  });
}

/** Latitude/longitude rounded to 4 decimals (~11 m), or null when either is missing or out of range. */
export function roundLocation(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): { latitude: number; longitude: number } | null {
  if (latitude == null || longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return { latitude: round(latitude), longitude: round(longitude) };
}

/**
 * Fingerprint of one received SMS. The same message from the same sender at
 * the same moment is the same SMS, whatever submission id it arrived under.
 * Without an arrival time (a pasted test), the capture minute stands in.
 */
export function contentHash(input: {
  sender?: string | null;
  message: string;
  receivedAt?: string | null;
  capturedAt?: string | null;
}): string {
  const moment = input.receivedAt?.trim() || input.capturedAt?.trim().slice(0, 16) || '';
  return sha256Hex([input.sender?.trim() ?? '', normaliseSmsText(input.message), moment].join('\n'));
}
