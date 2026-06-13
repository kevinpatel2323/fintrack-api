import { createHash, timingSafeEqual } from 'crypto';

// Constant-time string comparison. Both sides are SHA-256 digested first so the
// buffers handed to timingSafeEqual are always the same length (it throws on a
// length mismatch) and the timing reveals nothing about input length. Used to
// check the break-glass SETUP_TOKEN without leaking its length or value.
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

// True when `provided` matches the configured SETUP_TOKEN. Returns false if no
// token is provided or none is configured (no break-glass = closed).
export function isValidSetupToken(provided: string | undefined | null): boolean {
  const expected = process.env.SETUP_TOKEN;
  if (!expected || !provided) return false;
  return safeEqual(provided, expected);
}
