import type {
  MemoChannel,
  MemoDirection,
  MemoInstrument,
  MemoParseStatus,
} from '../database/entities/transaction-memo.entity';

/**
 * Reads a bank, UPI or card SMS into the fields a transaction memo shows.
 *
 * Every field is optional: banks word their SMS in endless ways, and a memo row
 * is still worth keeping when only some of it reads, so nothing here refuses a
 * message except an OTP. `status` says how much was read. Pure and synchronous;
 * bump SMS_PARSER_VERSION when the rules change so older rows can be re-parsed.
 *
 * The date, amount and merchant rules started life in the HDFC credit-card
 * e-mail alert parser and now also cover bank accounts, UPI, IMPS/NEFT/RTGS,
 * ATM withdrawals, mandates and bank charges.
 */
export const SMS_PARSER_VERSION = 1;

export interface ParsedSms {
  direction: MemoDirection | null;
  channel: MemoChannel | null;
  amount: number | null;
  currency: string | null;
  bank: string | null;
  instrument: MemoInstrument | null;
  last4: string | null;
  merchant: string | null;
  vpa: string | null;
  reference: string | null;
  txnDate: string | null;
}

export interface SmsParseResult {
  status: MemoParseStatus;
  fields: ParsedSms;
  // Why a message did not fully read, in words fit for the web app.
  error: string | null;
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** The calendar day in India for an instant, as YYYY-MM-DD. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Odd spaces and curly quotes made plain, every run of whitespace (newlines too) one space. */
export function normaliseSmsText(text: string): string {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── OTPs ────────────────────────────────────────────────────────────────────
// A code next to the word, either way round. "Never share your OTP" footers on
// real alerts carry no code, so they don't trip it.
const CODE_WORDS = String.raw`(?:otp|one[\s-]?time[\s-]?(?:password|passcode|pin|code)|verification code|security code|login code|auth(?:entication)? code)`;
const OTP_CODE = new RegExp(
  String.raw`\b${CODE_WORDS}\b(?:\s+for\b[^:]{0,100}?)?\s*(?:\bis\b|:)\s*\d{4,8}\b|\b\d{4,8}\s+is\s+(?:your\s+|the\s+)?${CODE_WORDS}\b`,
  'i',
);
const USE_CODE = /\b(?:use|enter)\s+\d{4,8}\s+(?:to|for|as)\b/i;

/** True for a one-time password or verification code: these are refused, never stored. */
export function isOtpMessage(text: string): boolean {
  const plain = normaliseSmsText(text);
  return OTP_CODE.test(plain) || USE_CODE.test(plain);
}

// ── Amount ──────────────────────────────────────────────────────────────────
const NUMBER = String.raw`((?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?)`;
const AMOUNT = new RegExp(String.raw`(INR|Rs\.?|₹|USD|US\$|EUR|€|GBP|£|AED|SGD|\$)\s?${NUMBER}`, 'gi');
// SBI's "debited by 20.0" names no currency at all.
const BARE_AMOUNT = new RegExp(
  String.raw`\b(?:debited|credited|withdrawn|deducted)\s+(?:by|for|with|of)\s+${NUMBER}\b`,
  'i',
);
// An amount right after these is a balance or a limit, not the transaction.
const BALANCE_BEFORE = /(?:\bbal(?:ance)?|\blimit|\bavl|\bavailable)\b[^.;]{0,12}$/i;
const CURRENCY: Record<string, string> = {
  inr: 'INR', 'rs.': 'INR', rs: 'INR', '₹': 'INR',
  usd: 'USD', 'us$': 'USD', $: 'USD', eur: 'EUR', '€': 'EUR', gbp: 'GBP', '£': 'GBP',
  aed: 'AED', sgd: 'SGD',
};

function pickAmount(text: string): { amount: number; currency: string } | null {
  AMOUNT.lastIndex = 0;
  for (let match = AMOUNT.exec(text); match; match = AMOUNT.exec(text)) {
    if (BALANCE_BEFORE.test(text.slice(Math.max(0, match.index - 30), match.index))) continue;
    const amount = Number(match[2].replace(/,/g, ''));
    if (Number.isFinite(amount) && amount > 0) {
      return {
        amount: Math.round(amount * 100) / 100,
        currency: CURRENCY[match[1].toLowerCase()] ?? match[1].toUpperCase(),
      };
    }
  }
  const bare = BARE_AMOUNT.exec(text);
  const amount = bare ? Number(bare[1].replace(/,/g, '')) : NaN;
  return Number.isFinite(amount) && amount > 0 ? { amount: Math.round(amount * 100) / 100, currency: 'INR' } : null;
}

// ── Direction ───────────────────────────────────────────────────────────────
// Whichever kind of word comes first wins: "Acct XX123 debited …; XYZ credited"
// is a debit, "credited to your card towards refund" a credit.
const DEBIT_WORDS = /\b(?:debited|spent|sent|paid|withdrawn|withdrawal|purchase|charged|deducted|levied|thank you for using|has been used|was used|transferred from|auto-?debit)\b/i;
const CREDIT_WORDS = /\b(?:credited|received|deposited|refund(?:ed)?|reversed|reversal|cashback)\b/i;
const DECLINED = /\b(?:declined|was not successful|unsuccessful|could not be (?:processed|completed)|has failed|failed due to|transaction failed)\b/i;

function pickDirection(text: string): MemoDirection | null {
  const debit = DEBIT_WORDS.exec(text)?.index ?? -1;
  const credit = CREDIT_WORDS.exec(text)?.index ?? -1;
  if (debit < 0 && credit < 0) return null;
  if (credit < 0) return 'debit';
  if (debit < 0) return 'credit';
  return debit < credit ? 'debit' : 'credit';
}

// ── Card or account, and its last digits ───────────────────────────────────
const ENDING = String.raw`(?:\s*(?:no\.?|number))?\s*(?:ending(?:\s+(?:with|in))?\s*[:-]?\s*)?[x*]*\s*`;
const CARD_REF = new RegExp(String.raw`\b(?:credit\s*card|debit\s*card|card)\b${ENDING}(\d{4})\b`, 'i');
const ACCOUNT_REF = new RegExp(String.raw`\b(?:a\/c|acct|account|ac)\b\.?${ENDING}(\d{3,4})\b`, 'i');

function pickInstrument(text: string): { instrument: MemoInstrument | null; last4: string | null } {
  const card = CARD_REF.exec(text);
  const account = ACCOUNT_REF.exec(text);
  if (card && (!account || card.index <= account.index)) return { instrument: 'card', last4: card[1] };
  if (account) return { instrument: 'account', last4: account[1] };
  if (/\b(?:credit|debit)\s*card\b/i.test(text)) return { instrument: 'card', last4: null };
  if (/\b(?:a\/c|acct|account)\b/i.test(text)) return { instrument: 'account', last4: null };
  return { instrument: null, last4: null };
}

// ── Channel ─────────────────────────────────────────────────────────────────
const CHANNELS: Array<[RegExp, MemoChannel]> = [
  [/\b(?:charges?|fees?|gst|penalty|amc)\b/i, 'charge'],
  [/\b(?:e-?mandate|mandate|autopay|auto-?debit|standing instruction)\b/i, 'mandate'],
  [/\batm\b|\bcash withdrawal\b|\bwithdrawn\b/i, 'atm'],
  [/\bupi\b|\bvpa\b/i, 'upi'],
  [/\bimps\b/i, 'imps'],
  [/\bneft\b/i, 'neft'],
  [/\brtgs\b/i, 'rtgs'],
  [/\bnet\s*banking\b/i, 'netbanking'],
];

function pickChannel(
  text: string,
  direction: MemoDirection | null,
  instrument: MemoInstrument | null,
  vpa: string | null,
): MemoChannel | null {
  for (const [pattern, channel] of CHANNELS) {
    if (channel === 'charge' && direction !== 'debit') continue;
    if (pattern.test(text)) return channel;
  }
  if (vpa) return 'upi';
  return instrument === 'card' ? 'card' : null;
}

// ── UPI handle and reference ────────────────────────────────────────────────
// A handle has no dot after the @ (paytm, okicici, hdfcbank), which keeps
// e-mail addresses like care@hdfcbank.com out.
const VPA = /\b([\w.-]{2,}@[a-z][a-z0-9]{1,30})\b(?!\.?\w)/i;
const REFERENCE = /\b(?:upi\s*(?:txn|transaction)?\s*(?:ref(?:erence)?)?|ref(?:erence)?|rrn|utr|txn\s*(?:id|no\.?))\s*(?:no\.?|number|num|#|id)?\s*(?:is\s*)?[:.-]?\s*(?=[A-Z0-9]*\d)([A-Z0-9]{6,22})\b/i;

// ── Date ────────────────────────────────────────────────────────────────────
const DATE_TEXT = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}[\s-]?[A-Za-z]{3,9},?[\s-]?\d{2,4}|[A-Za-z]{3,9}\s\d{1,2},?\s\d{4})`;
const DATE_AFTER_ON = new RegExp(String.raw`\bon\s+(?:date\s+)?${DATE_TEXT}`, 'i');
const ANY_DATE = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}[\s-]?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*,?[\s-]?\d{2,4})\b/i;
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** A date as banks write it (22-10-26, 22/10/2026, 22 Oct, 2026, 22Oct26, Oct 22, 2026, 2026-10-22) → YYYY-MM-DD. */
export function readSmsDate(raw: string): string | null {
  const text = raw.trim().replace(/,/g, '');
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(text))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[\s-]?([A-Za-z]{3,9})[\s-]?(\d{2,4})$/.exec(text))) {
    d = Number(match[1]);
    m = MONTHS[match[2].slice(0, 3).toLowerCase()] ?? 0;
    y = Number(match[3]);
  } else if ((match = /^([A-Za-z]{3,9})\s(\d{1,2})\s(\d{4})$/.exec(text))) {
    m = MONTHS[match[1].slice(0, 3).toLowerCase()] ?? 0;
    d = Number(match[2]);
    y = Number(match[3]);
  } else {
    return null;
  }
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return check.getUTCDate() === d ? iso : null;
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

// The date in the text when it is plausible (up to 60 days back, 1 ahead of
// arrival), otherwise the day the SMS arrived.
function pickDate(text: string, receivedAt: Date): string {
  const arrived = istDay(receivedAt);
  const raw = DATE_AFTER_ON.exec(text)?.[1] ?? ANY_DATE.exec(text)?.[1] ?? null;
  const read = raw ? readSmsDate(raw) : null;
  if (!read) return arrived;
  const delta = dayDiff(read, arrived);
  return delta <= 1 && delta >= -60 ? read : arrived;
}

// ── Merchant or counterparty ────────────────────────────────────────────────
function cleanName(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,(-]+|[\s.,;:)-]+$/g, '')
    .slice(0, 120)
    .trim();
}

const ON_DATE = String.raw`\s+on\s+(?:date\s+)?(?:\d|[A-Za-z]{3}\s?\d)`;
// Words that start a phrase, not a name, and bare numbers (a helpline, an SMS short code).
const NOT_A_NAME = /^(?:(?:your|the|a\/c|ac|account|acct|on|for|via|vpa)\b|[\d\s+-]+$)/i;
const HANDLE = /^[\w.-]+@[\w.-]+$/;

// Each pattern yields a name in group 1, or a UPI handle in group 1 and the
// name after it in group 2 (the name wins when there is one).
const PAYEE_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:to|towards)\s+(?:VPA\s+)?([\w.-]+@[\w.-]+)\s+\(?(.+?)\)?(?:${ON_DATE}|\.\s|\.$|$)`, 'i'),
  new RegExp(String.raw`\b(?:to|towards)\s+(?:VPA\s+)?([\w.-]+@[\w.-]+)`, 'i'),
  new RegExp(String.raw`\btowards\s+(.+?)${ON_DATE}`, 'i'),
  new RegExp(String.raw`\bat\s+(.+?)${ON_DATE}`, 'i'),
  /\bat\s+([^.]+?)(?:\.\s|\.$|$)/i,
  // ICICI: "spent using … Card XX4321 on 29-Oct-26 on AMAZON."
  /\bon\s+(?:\d{1,2}[-\s]?[A-Za-z]{3}[-\s]?\d{2,4}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s+(?:on|at)\s+([^.]+?)(?:\.\s|\.$|$)/i,
  /;\s*([^;.]+?)\s+credited\b/i,
  /\bupi\/p2[am]\/\d+\/([^/]+?)(?=\s+not you|\/|\.\s|$)/i,
  /\b(?:trf|transfer(?:red)?)\s+to\s+(.+?)(?=\s+ref|\s+on\b|\.\s|\.$|$)/i,
  new RegExp(String.raw`\bto\s+(?!your\b|the\b|a\/c|ac\b|account\b|acct\b)(.+?)(?:${ON_DATE}|\s+ref\b|\.\s|\.$|$)`, 'i'),
  /\btowards\s+([^.]+?)(?:\.\s|\.$|$)/i,
  /\binfo\s*[:-]\s*([^.]+)/i,
];
const PAYER_PATTERNS: RegExp[] = [
  /\b(?:from|by)\s+(?:VPA\s+)?([\w.-]+@[\w.-]+)/i,
  new RegExp(String.raw`\brefund (?:from|by|of)\s+(.+?)(?:${ON_DATE}|\.\s|\.$|$)`, 'i'),
  new RegExp(String.raw`\bfrom\s+(?!your\b|the\b|a\/c|ac\b|account\b|acct\b)(.+?)(?:${ON_DATE}|\s+\(|\.\s|\.$|$)`, 'i'),
];

function pickCounterparty(text: string, direction: MemoDirection | null): string | null {
  const patterns = direction === 'credit' ? [...PAYER_PATTERNS, ...PAYEE_PATTERNS] : PAYEE_PATTERNS;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (match[2] !== undefined) {
      const name = cleanName(match[2]);
      if (name && !HANDLE.test(name) && !NOT_A_NAME.test(name)) return name;
      return cleanName(match[1]);
    }
    const name = cleanName(match[1]);
    if (name && !NOT_A_NAME.test(name)) return name;
  }
  return null;
}

// ── Bank ────────────────────────────────────────────────────────────────────
const BANKS: Array<[RegExp, string]> = [
  [/\bhdfc\b/i, 'hdfc'],
  [/\bicici\b/i, 'icici'],
  [/\bsbi\b|state bank/i, 'sbi'],
  [/\baxis\b/i, 'axis'],
  [/\bkotak\b/i, 'kotak'],
  [/\bamex\b|american express/i, 'amex'],
  [/\bidfc\b/i, 'idfc'],
  [/\byes bank\b/i, 'yes'],
  [/\bau (?:small finance )?bank\b/i, 'au'],
  [/\bfederal bank\b/i, 'federal'],
  [/\bpnb\b|punjab national/i, 'pnb'],
  [/\bbank of baroda\b|\bbob\b/i, 'bob'],
  [/\bcanara\b/i, 'canara'],
  [/\bindusind\b/i, 'indusind'],
  [/\bidbi\b/i, 'idbi'],
  [/\brbl\b/i, 'rbl'],
  [/\bunion bank\b/i, 'union'],
  [/\bpaytm payments bank\b/i, 'paytm'],
  [/\bairtel payments bank\b/i, 'airtel'],
];

// ── The whole message ───────────────────────────────────────────────────────
export function parseSms(input: { text: string; receivedAt: Date; senderBank?: string | null }): SmsParseResult {
  const text = normaliseSmsText(input.text);
  const money = pickAmount(text);
  const direction = pickDirection(text);
  const { instrument, last4 } = pickInstrument(text);
  const vpa = VPA.exec(text)?.[1] ?? null;
  const fields: ParsedSms = {
    direction,
    channel: pickChannel(text, direction, instrument, vpa),
    amount: money?.amount ?? null,
    currency: money?.currency ?? null,
    bank: input.senderBank ?? BANKS.find(([pattern]) => pattern.test(text))?.[1] ?? null,
    instrument,
    last4,
    merchant: pickCounterparty(text, direction),
    vpa,
    reference: REFERENCE.exec(text)?.[1] ?? null,
    txnDate: pickDate(text, input.receivedAt),
  };

  if (DECLINED.test(text)) {
    return { status: 'partial', fields, error: 'Looks like a declined or failed transaction.' };
  }
  if (fields.amount !== null && fields.direction && (fields.last4 || fields.vpa || fields.merchant)) {
    return { status: 'parsed', fields, error: null };
  }
  if (fields.amount !== null || fields.direction) {
    const missing = [
      fields.amount === null && 'amount',
      !fields.direction && 'debit or credit',
      !(fields.last4 || fields.vpa || fields.merchant) && 'account, card or payee',
    ].filter(Boolean);
    return { status: 'partial', fields, error: `Could not read the ${missing.join(', ')}.` };
  }
  return { status: 'unreadable', fields, error: 'No amount or debit/credit wording found.' };
}
