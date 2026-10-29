import { createHash, randomBytes, randomInt } from 'crypto';

// Device keys and pairing codes for the iPhone that sends bank SMS. Only the
// SHA-256 of either is ever stored, so the database cannot be used to call the
// API, and both are checked with safeEqual (auth/setup-token.util.ts).

const DEVICE_KEY_PREFIX = 'fintrack_';
const DEVICE_KEY = /^fintrack_[A-Za-z0-9_-]{43}$/;

// No 0/O, 1/I/L or U: the code is read off a screen and typed on a phone.
const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const PAIR_CODE_LENGTH = 8;

export const PAIR_WINDOW_MS = 10 * 60 * 1000;
export const PAIR_MAX_ATTEMPTS = 5;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** A new 256-bit device key: `fintrack_` + 43 base64url characters. */
export function newDeviceKey(): string {
  return DEVICE_KEY_PREFIX + randomBytes(32).toString('base64url');
}

/** Cheap shape check so a malformed bearer never reaches the database. */
export function looksLikeDeviceKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && DEVICE_KEY.test(value);
}

/** Eight characters from PAIR_ALPHABET (~39 bits), unformatted. */
export function newPairCode(): string {
  let code = '';
  for (let i = 0; i < PAIR_CODE_LENGTH; i += 1) code += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)];
  return code;
}

/** `K7QXM2PD` → `K7QX-M2PD`, for reading off the screen. */
export function formatPairCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** What the user typed, reduced to the bare code: case, spaces and dashes don't matter. */
export function normalisePairCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The bearer token from an `Authorization: Bearer …` header, or null. */
export function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S+)$/i.exec(value?.trim() ?? '');
  return match ? match[1] : null;
}
