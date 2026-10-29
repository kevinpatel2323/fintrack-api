// End-to-end check of transaction memos (device + web routes) against a LOCAL
// test database — never point it at Supabase: it creates and deletes rows.
//
//   1. A throwaway Postgres with all migrations run, and one credit card with
//      last4 2209 (the card-link check expects it to be card id 1).
//   2. The API on it with the web bypass on, so web routes need no session:
//        PORT=3999 DATABASE_URL=postgres://…/fintrack_test MEMO_DATA_KEY=<64 hex> \
//        AUTH_DISABLED=true node dist/main.js
//   3. node scripts/transaction-memos-e2e.mjs http://localhost:3999
//
// The device routes ignore AUTH_DISABLED, so this also proves they still
// demand a device key with the bypass on.
const BASE = process.argv[2] ?? 'http://localhost:3999';
let failures = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures += 1; console.log(`  ✗ ${label}`, extra === undefined ? '' : JSON.stringify(extra)); }
};
async function call(method, path, { body, key, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const nowIso = () => new Date().toISOString();
const sub = (tag) => `20261029T1432-${tag}-${Math.floor(Math.random() * 1e5)}`;

console.log('Hidden routes');
const unknown = await call('POST', '/api/v1/definitely-not-a-route');
const noKey = await call('POST', '/api/v1/memos', { body: { submissionId: 'abcdef', message: 'x' } });
ok(noKey.status === 404, 'POST /memos without a key → 404', noKey);
ok(JSON.stringify(Object.keys(noKey.json)) === JSON.stringify(Object.keys(unknown.json)) && noKey.json.error === unknown.json.error, 'its body looks like a missing route', { noKey: noKey.json, unknown: unknown.json });
const badKey = await call('GET', '/api/v1/devices/me', { key: `fintrack_${'A'.repeat(43)}` });
ok(badKey.status === 404, 'well-formed but unknown key → 404');
const noWindow = await call('POST', '/api/v1/devices/pair', { body: { code: 'ABCD-EFGH' } });
ok(noWindow.status === 404, '/pair with no open window → 404', noWindow);

console.log('Pairing');
const pc = await call('POST', '/transaction-memos/devices/pair-code', { body: { name: 'Test iPhone' } });
ok(pc.status === 201 && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(pc.json.code) && pc.json.setupText.startsWith('fintrack:pair:'), 'web issues a pairing code', pc.json);
const wrong = await call('POST', '/api/v1/devices/pair', { body: { code: 'ZZZZ-ZZZZ' } });
ok(wrong.status === 404, 'wrong code → 404');
const paired = await call('POST', '/api/v1/devices/pair', { body: { code: pc.json.setupText.split(':').pop().toLowerCase(), name: 'Kevin iPhone' } });
ok(paired.status === 200 && /^fintrack_[A-Za-z0-9_-]{43}$/.test(paired.json.key), 'right code (any case) → device key', paired.json);
const KEY = paired.json.key;
const reuse = await call('POST', '/api/v1/devices/pair', { body: { code: pc.json.code } });
ok(reuse.status === 404, 'the code works only once');
const me = await call('GET', '/api/v1/devices/me', { key: KEY });
ok(me.status === 200 && me.json.status === 'ok' && me.json.name === 'Kevin iPhone', 'device key authenticates', me.json);

console.log('Capture');
const A = sub('a');
const smsA = 'Sent Rs.500.00\nFrom HDFC Bank A/C *6714\nTo RAHUL SHAH\nOn 29/10/26\nRef 630212345678\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808';
const payloadA = {
  submissionId: A, message: smsA, memo: 'dinner split', sender: 'VM-HDFCBK', receivedAt: '2026-10-29T14:32:10+05:30',
  capturedAt: nowIso(), shortcutVersion: '2.0', contractVersion: '1', locationStatus: 'captured',
  location: { latitude: '23.0225501', longitude: '72.5713629' }, filter: { version: '1', senderRecognised: 'true' }, outboxCount: '0',
};
const a1 = await call('POST', '/api/v1/memos', { key: KEY, body: payloadA });
ok(a1.status === 200 && a1.json.status === 'accepted' && a1.json.id, 'capture accepted', a1.json);
ok(a1.json.summary === '−₹500.00 · RAHUL SHAH · HDFC ••6714', 'reply carries the one-line summary', a1.json.summary);
const a2 = await call('POST', '/api/v1/memos', { key: KEY, body: payloadA });
ok(a2.json.status === 'accepted' && a2.json.id === a1.json.id && a2.json.duplicate === true, 'same submissionId → same row', a2.json);
const a3 = await call('POST', '/api/v1/memos', { key: KEY, body: { ...payloadA, submissionId: sub('a-again') } });
ok(a3.json.id === a1.json.id && a3.json.duplicate === true, 'same SMS under another submissionId (double trigger) → same row', a3.json);

console.log('Exactly what the Fintrack Memos shortcut sends');
// Shortcuts dictionaries carry every value as text, and the location arrives as
// flat keys added after the first save (scripts/ios-shortcuts/build.py).
const shortcutPayload = {
  filter: { version: '1', senderRecognised: 'true' }, shortcutVersion: '2.0', contractVersion: '1',
  submissionId: '20261029T143210-12345-23456-34567', message: 'Rs.75.00 debited from HDFC Bank A/c XX6714 to VPA tea@ybl on 29-10-26. UPI Ref 630212349999',
  capturedAt: '2026-10-29T14:32:10+05:30', locationStatus: 'captured', outboxCount: '2', sender: 'VM-HDFCBK',
  receivedAt: '2026-10-29T14:32:08+05:30', memo: 'chai with Rahul', latitude: '23.0225501', longitude: '72.5713629',
};
const sp = await call('POST', '/api/v1/memos', { key: KEY, body: shortcutPayload });
ok(sp.status === 200 && sp.json.status === 'accepted', 'shortcut-shaped payload accepted', sp.json);
const spd = await call('GET', `/transaction-memos/${sp.json.id}`);
ok(spd.json.memo === 'chai with Rahul' && spd.json.location?.latitude === 23.0226, 'its memo and flat location are stored', spd.json);
const spDevices = await call('GET', '/transaction-memos/devices');
ok(spDevices.json.data.some((d) => d.outboxCount === 2), 'outboxCount reaches the Devices panel', spDevices.json);

console.log('Burst: SMS sent before its memo was typed');
const B = sub('b');
const smsB = 'Spent Rs.1234 On HDFC Bank Card 2209 At AMAZON On 2026-10-29:12:34:56.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 2209 to 7308080808';
const b1 = await call('POST', '/api/v1/memos', { key: KEY, body: { submissionId: B, message: smsB, sender: 'AX-HDFCBK-S', capturedAt: nowIso() } });
ok(b1.json.status === 'accepted', 'SMS without memo accepted', b1.json);
const b2 = await call('POST', '/api/v1/memos', { key: KEY, body: { submissionId: B, message: smsB, memo: 'phone case for Het', sender: 'AX-HDFCBK-S', capturedAt: nowIso() } });
ok(b2.json.id === b1.json.id, 'resend with memo hits the same row', b2.json);
const bd = await call('GET', `/transaction-memos/${b1.json.id}`);
ok(bd.json.memo === 'phone case for Het', 'memo merged into the row', bd.json.memo);
ok(bd.json.cardId === '1' && bd.json.channel === 'card' && bd.json.last4 === '2209', 'card spend linked to the 2209 card', bd.json);
ok(bd.json.senderVerified === true, 'registered header is verified');

console.log('Memo-only files');
const C = sub('c');
const c0 = await call('POST', '/api/v1/memos', { key: KEY, body: { submissionId: C, memo: 'later', capturedAt: nowIso() } });
ok(c0.json.status === 'retry', 'memo for an SMS not here yet → retry (kept)', c0.json);
const cOld = await call('POST', '/api/v1/memos', { key: KEY, body: { submissionId: C, memo: 'later', capturedAt: '2026-01-01T00:00:00Z' } });
ok(cOld.json.status === 'invalid', 'memo for an unknown SMS older than 7 days → invalid', cOld.json);
const c1 = await call('POST', '/api/v1/memos', { key: KEY, body: { submissionId: C, message: 'Rs.20.00 has been debited from your HDFC Bank RuPay Credit Card XX9164 to paytmqr281005050101@paytm SURESH TEA STALL on 29-10-26. Your UPI transaction reference number is 529512345678.', capturedAt: nowIso() } });
const c2 = await call('POST', '/api/v1/memos', { key: KEY, body: { submissionId: C, memo: 'chai', capturedAt: nowIso() } });
ok(c2.json.status === 'accepted' && c2.json.id === c1.json.id, 'memo-only after its SMS → accepted on that row', c2.json);

console.log('Refusals and privacy');
const before = (await call('GET', '/transaction-memos/summary')).json.total;
const otp = await call('POST', '/api/v1/memos', { key: KEY, body: { submissionId: sub('otp'), message: '482913 is the OTP for your transaction of Rs 450 at AMAZON on HDFC Bank Credit Card ending 2209.', capturedAt: nowIso() } });
ok(otp.json.status === 'refused', 'OTP refused', otp.json);
ok((await call('GET', '/transaction-memos/summary')).json.total === before, 'nothing stored for the OTP');
const luhn = await call('POST', '/api/v1/memos', { key: KEY, body: { submissionId: sub('luhn'), message: 'Rs 99 spent on card 4111 1111 1111 1111 at CAFE on 29-10-26', sender: '+919898794108', capturedAt: nowIso() } });
const ld = await call('GET', `/transaction-memos/${luhn.json.id}`);
ok(ld.json.rawMessage.includes('XX1111') && !ld.json.rawMessage.includes('4111 1111'), 'full card number masked before storing', ld.json.rawMessage);
ok(ld.json.senderVerified === false, 'phone-number sender is not verified');
const bad = await call('POST', '/api/v1/memos', { key: KEY, body: { submissionId: 'no spaces allowed!', message: 'x' } });
ok(bad.status === 400 && bad.json.status === 'invalid', 'bad payload with a valid key → invalid', bad.json);
const extra = await call('POST', '/api/v1/memos', { key: KEY, body: { submissionId: sub('x'), message: 'x', surprise: 1 } });
ok(extra.json.status === 'invalid', 'unknown field → invalid (not a silent drop)', extra.json);
const big = await call('POST', '/api/v1/memos', { key: KEY, body: { submissionId: sub('big'), message: 'x'.repeat(20000) } });
ok(big.status === 413 && big.json.status === 'invalid', 'oversized body refused', big.json);

console.log('Pending + web');
const pend = await call('GET', '/api/v1/memos/pending', { key: KEY });
ok(pend.json.status === 'ok' && pend.json.data.some((p) => p.summary.includes('CAFE')), 'pending lists rows without a memo', pend.json);
const ad = await call('GET', `/transaction-memos/${a1.json.id}`);
ok(ad.json.location && ad.json.location.latitude === 23.0226 && ad.json.location.longitude === 72.5714, 'location rounded and readable on the web', ad.json.location);
ok(ad.json.memo === 'dinner split' && ad.json.reference === '630212345678', 'detail has memo and parsed fields');
const list = await call('GET', '/transaction-memos?tab=no-memo');
ok(list.json.data.every((m) => m.memo === null) && list.json.count >= 1, 'No memo tab', list.json.count);
const search = await call('GET', '/transaction-memos?q=amazon');
ok(search.json.count === 1 && search.json.data[0].merchant === 'AMAZON', 'search', search.json.count);
const byAmount = await call('GET', '/transaction-memos?q=₹1,234');
ok(byAmount.json.count === 1, 'search by amount');
const patch = await call('PATCH', `/transaction-memos/${luhn.json.id}`, { body: { memo: '  coffee  ' } });
ok(patch.json.memo === 'coffee', 'web edits a memo', patch.json);
const clear = await call('PATCH', `/transaction-memos/${luhn.json.id}`, { body: { memo: null } });
ok(clear.json.memo === null, 'web clears a memo');
const rp = await call('POST', `/transaction-memos/${a1.json.id}/reparse`);
ok(rp.json.merchant === 'RAHUL SHAH', 're-parse one');
const rpa = await call('POST', '/transaction-memos/reparse-all');
ok(typeof rpa.json.updated === 'number', 're-parse all', rpa.json);
const sum = await call('GET', '/transaction-memos/summary');
ok(sum.json.total >= 4 && typeof sum.json.withoutMemo === 'number', 'summary', sum.json);
const devs = await call('GET', '/transaction-memos/devices');
ok(devs.json.data.some((d) => d.status === 'active' && d.name === 'Kevin iPhone'), 'device listed as active', devs.json);

console.log('Revoke');
const devId = devs.json.data.find((d) => d.status === 'active').id;
await call('DELETE', `/transaction-memos/devices/${devId}`);
const after = await call('POST', '/api/v1/memos', { key: KEY, body: payloadA });
ok(after.status === 404, 'revoked key → 404', after);
const del = await call('DELETE', `/transaction-memos/${luhn.json.id}`);
ok(del.json.deleted === true, 'web deletes a memo');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
