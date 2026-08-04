// Name of the session cookie. Host-only (no Domain attribute) so it is scoped
// to the web origin that proxies /api.
export const COOKIE_NAME = 'fintrack_session';

// Stable WebAuthn user handle. Fintrack is single-user, so every passkey is
// enrolled under one fixed handle — this lets authenticators group credentials
// and makes excludeCredentials behave as "this user already registered these".
export const USER_HANDLE = new TextEncoder().encode('fintrack-single-user');

// Display name shown by the authenticator UI during ceremonies.
export const USER_NAME = 'Fintrack';

// How long a pending WebAuthn challenge is valid before it must be re-requested.
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Default absolute session lifetime when SESSION_TTL_MINUTES is unset.
export const DEFAULT_SESSION_TTL_MINUTES = 60;

export function sessionTtlMinutes(): number {
  const n = Number(process.env.SESSION_TTL_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SESSION_TTL_MINUTES;
}

// Local dev bypass — set AUTH_DISABLED=true in .env. Never enable in production.
export function isAuthDisabled(): boolean {
  const v = process.env.AUTH_DISABLED?.trim().toLowerCase();
  return v === 'true' || v === '1';
}
