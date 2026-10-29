import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

// Seals the parts of a transaction memo that would hurt most in a database
// leak — the SMS text and where the phone was — with AES-256-GCM. The key
// lives only in the MEMO_DATA_KEY env var (32 bytes, hex or base64), never in
// the database, so a dump or a backup alone reads nothing.

/** The memo sealing key, or null when MEMO_DATA_KEY is unset or not 32 bytes. */
export function loadMemoKey(raw: string | undefined = process.env.MEMO_DATA_KEY): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  return key.length === 32 ? key : null;
}

// One key, separate purposes: a derived sub-key per use keeps a future second
// use of MEMO_DATA_KEY from ever sharing ciphertext space with this one.
function subKey(key: Buffer, purpose: string): Buffer {
  return createHmac('sha256', key).update(purpose).digest();
}

/** `v1.<iv>.<tag>.<ciphertext>`, each part base64url. */
export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', subKey(key, 'seal'), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Opens a value from seal(). Throws if it was tampered with or sealed under another key. */
export function unseal(sealed: string, key: Buffer): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || body === undefined) throw new Error('Not a sealed value.');
  const decipher = createDecipheriv('aes-256-gcm', subKey(key, 'seal'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}
