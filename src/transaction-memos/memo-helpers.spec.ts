import { loadMemoKey, seal, unseal } from './secret-box';
import {
  bearerToken,
  formatPairCode,
  looksLikeDeviceKey,
  newDeviceKey,
  newPairCode,
  normalisePairCode,
  sha256Hex,
} from './device-credentials';
import { bankForSender, contentHash, maskCardNumbers, roundLocation } from './sms-privacy';

const KEY = Buffer.alloc(32, 7);

describe('secret-box', () => {
  it('round-trips and never stores the plain text', () => {
    const sealed = seal('Sent Rs.500.00 From HDFC Bank A/C *6714', KEY);
    expect(sealed).not.toContain('6714');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(unseal(sealed, KEY)).toBe('Sent Rs.500.00 From HDFC Bank A/C *6714');
  });

  it('seals the same text differently each time', () => {
    expect(seal('same', KEY)).not.toBe(seal('same', KEY));
  });

  it('refuses a tampered value or the wrong key', () => {
    const sealed = seal('secret', KEY);
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => unseal(parts.join('.'), KEY)).toThrow();
    expect(() => unseal(sealed, Buffer.alloc(32, 8))).toThrow();
    expect(() => unseal('not sealed', KEY)).toThrow();
  });

  it('loads a 32-byte key from hex or base64 and rejects anything else', () => {
    expect(loadMemoKey('07'.repeat(32))?.equals(KEY)).toBe(true);
    expect(loadMemoKey(KEY.toString('base64'))?.equals(KEY)).toBe(true);
    expect(loadMemoKey('short')).toBeNull();
    expect(loadMemoKey('')).toBeNull();
    expect(loadMemoKey(undefined)).toBeNull();
  });
});

describe('device-credentials', () => {
  it('issues 256-bit fintrack_ keys that pass the shape check', () => {
    const key = newDeviceKey();
    expect(key).toMatch(/^fintrack_[A-Za-z0-9_-]{43}$/);
    expect(looksLikeDeviceKey(key)).toBe(true);
    expect(newDeviceKey()).not.toBe(key);
  });

  it('rejects malformed keys before any lookup', () => {
    expect(looksLikeDeviceKey('fintrack_short')).toBe(false);
    expect(looksLikeDeviceKey(`other_${'a'.repeat(43)}`)).toBe(false);
    expect(looksLikeDeviceKey(null)).toBe(false);
  });

  it('makes typeable pairing codes and reads them back however they are typed', () => {
    const code = newPairCode();
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ2-9]{8}$/);
    expect(formatPairCode('K7QXM2PD')).toBe('K7QX-M2PD');
    expect(normalisePairCode(' k7qx-m2pd ')).toBe('K7QXM2PD');
    expect(normalisePairCode('fintrack:pair:K7QXM2PD'.split(':').pop()!)).toBe('K7QXM2PD');
  });

  it('reads only a well-formed bearer header', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer   abc ')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('Bearer a b')).toBeNull();
  });

  it('hashes to lowercase hex', () => {
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sms-privacy', () => {
  it('masks a full card number, spaced or not, keeping the last four', () => {
    expect(maskCardNumbers('Card 4111 1111 1111 1111 used')).toBe('Card XX1111 used');
    expect(maskCardNumbers('Card 4111111111111111 used')).toBe('Card XX1111 used');
  });

  it('leaves references, phone numbers and non-card digits alone', () => {
    const text = 'Ref 630212345678. Call 18002586161. Card 4111111111111112.';
    expect(maskCardNumbers(text)).toBe(text);
  });

  it('knows registered bank headers and nothing else', () => {
    expect(bankForSender('VM-HDFCBK')).toBe('hdfc');
    expect(bankForSender('AX-HDFCBK-S')).toBe('hdfc');
    expect(bankForSender('HDFCBK')).toBe('hdfc');
    expect(bankForSender('JD-ICICIT-S')).toBe('icici');
    expect(bankForSender('+919898794108')).toBeNull();
    expect(bankForSender('XY-ABCDEF')).toBeNull();
    expect(bankForSender(null)).toBeNull();
  });

  it('rounds the location to about 11 m and drops impossible ones', () => {
    expect(roundLocation(23.0225501, 72.5713629)).toEqual({ latitude: 23.0226, longitude: 72.5714 });
    expect(roundLocation(91, 10)).toBeNull();
    expect(roundLocation(null, 10)).toBeNull();
    expect(roundLocation(Number.NaN, 10)).toBeNull();
  });

  it('fingerprints the same SMS the same way, whatever the spacing', () => {
    const a = contentHash({ sender: 'VM-HDFCBK', message: 'Sent Rs.500\nTo X', receivedAt: '2026-10-29T14:32:10+05:30' });
    const b = contentHash({ sender: 'VM-HDFCBK', message: 'Sent  Rs.500 To X ', receivedAt: '2026-10-29T14:32:10+05:30' });
    const c = contentHash({ sender: 'VM-HDFCBK', message: 'Sent Rs.500 To X', receivedAt: '2026-10-29T14:33:10+05:30' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
