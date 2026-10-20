import * as fc from 'fast-check';
import {
  DueFigures,
  LedgerRows,
  LedgerTag,
  SettlementFigures,
  computeLedger,
  newErrors,
  suggestLegacyConversion,
  withSettlementLinks,
  withoutTag,
} from './friend-ledger';
import { toPaise } from './settlement-allocation';

const owesMe = (id: string, amount: number, date = '2026-01-01'): LedgerTag => ({ id, direction: 'OWES_ME', amount, date });
const iOwe = (id: string, amount: number, date = '2026-01-01'): LedgerTag => ({ id, direction: 'I_OWE', amount, date });
const settlement = (id: string, amount: number, date = '2026-06-01'): LedgerTag => ({ id, direction: 'SETTLEMENT', amount, date });
const link = (sourceId: string, targetId: string, amount: number | null) => ({ sourceId, targetId, amount });
const rows = (partial: Partial<LedgerRows>): LedgerRows => ({
  tags: [],
  links: [],
  offsetLines: [],
  writeOffs: [],
  ...partial,
});
const due = (l: ReturnType<typeof computeLedger>, id: string) => l.figures.get(id) as DueFigures;
const settle = (l: ReturnType<typeof computeLedger>, id: string) => l.figures.get(id) as SettlementFigures;

// Jayraj's entries when transaction 1069 (₹10,000) came in.
const jayraj = [
  owesMe('41', 8800, '2026-01-03'),
  iOwe('68', 340, '2026-03-30'),
  owesMe('124', 45.46, '2026-04-01'),
  owesMe('112', 230.91, '2026-04-04'),
  owesMe('136', 190, '2026-04-05'),
  owesMe('188', 652.38, '2026-05-15'),
  owesMe('246', 1500, '2026-07-05'),
];

describe('computeLedger — bill-wise settlement', () => {
  const paid1069 = rows({
    tags: [...jayraj, settlement('1069', 10000, '2026-08-27')],
    links: [
      link('1069', '41', 8800),
      link('1069', '124', 45.46),
      link('1069', '112', 230.91),
      link('1069', '136', 190),
      link('1069', '188', 652.38),
      link('1069', '246', 81.25),
    ],
  });

  it('pays five entries in full and the loan in part', () => {
    const l = computeLedger(paid1069);
    expect(l.errors).toEqual([]);
    expect(due(l, '246')).toMatchObject({ settledAmount: 81.25, pendingAmount: 1418.75, settlementStatus: 'partial' });
    expect(due(l, '41').settlementStatus).toBe('settled');
    expect(settle(l, '1069')).toMatchObject({ allocatedAmount: 10000, unallocatedAmount: 0, settlementSide: 'received' });
    expect(l.totals).toEqual({
      net: 1078.75,
      openOwesMe: 1418.75,
      openIOwe: 340,
      onAccountReceived: 0,
      onAccountPaid: 0,
      legacyDifference: 0,
    });
  });

  it('flags settling more than an entry or than the settlement', () => {
    const over = computeLedger(withSettlementLinks(paid1069, '1069', [{ tagId: '246', amount: 1600 }]));
    expect(over.errors.map((e) => e.code)).toEqual(['over_settled']);
    const tooMuch = computeLedger(
      withSettlementLinks(paid1069, '1069', [
        { tagId: '41', amount: 8800 },
        { tagId: '246', amount: 1500 },
      ]),
    );
    expect(tooMuch.errors.map((e) => e.code)).toEqual(['over_applied']);
  });
});

describe('computeLedger — netting inside a settlement', () => {
  // Yash pays ₹10,000; the ₹14,400 the user owes him is netted in, so
  // ₹24,400 of what Yash owes is cleared.
  const yash = rows({
    tags: [
      owesMe('1', 20000, '2026-01-01'),
      owesMe('2', 10000, '2026-02-01'),
      iOwe('3', 14400, '2026-03-01'),
      settlement('9', 10000, '2026-08-01'),
    ],
    links: [link('9', '1', 20000), link('9', '2', 4400), link('9', '3', 14400)],
  });

  it('clears both sides and applies exactly the payment', () => {
    const l = computeLedger(yash);
    expect(l.errors).toEqual([]);
    expect(settle(l, '9')).toMatchObject({ allocatedAmount: 10000, unallocatedAmount: 0, settlementSide: 'received' });
    expect(due(l, '3')).toMatchObject({ pendingAmount: 0, settlementStatus: 'settled' });
    expect(due(l, '2').pendingAmount).toBe(5600);
    // 30,000 − 14,400 − 10,000
    expect(l.totals.net).toBe(5600);
    expect(l.totals.legacyDifference).toBe(0);
  });

  it('reads a settlement as paid when it clears more of what the user owes', () => {
    const l = computeLedger(
      rows({
        tags: [owesMe('1', 100), iOwe('2', 500), settlement('9', 400)],
        links: [link('9', '1', 100), link('9', '2', 500)],
      }),
    );
    expect(l.errors).toEqual([]);
    expect(settle(l, '9')).toMatchObject({ settlementSide: 'paid', allocatedAmount: 400 });
    // 100 − 500 + 400
    expect(l.totals.net).toBe(0);
  });
});

describe('computeLedger — offsets without money', () => {
  const base = rows({
    tags: [owesMe('1', 3000), owesMe('2', 500), iOwe('3', 1200)],
    offsetLines: [
      { offsetId: 'o1', tagId: '1', amount: 1200 },
      { offsetId: 'o1', tagId: '3', amount: 1200 },
    ],
  });

  it('clears the same amount on both sides and leaves the balance alone', () => {
    const l = computeLedger(base);
    expect(l.errors).toEqual([]);
    expect(due(l, '1')).toMatchObject({ nettedAmount: 1200, pendingAmount: 1800, settlementStatus: 'partial' });
    expect(due(l, '3').settlementStatus).toBe('settled');
    expect(l.totals.net).toBe(2300);
    expect(l.totals.openOwesMe - l.totals.openIOwe).toBe(2300);
  });

  it('rejects an offset whose sides do not match', () => {
    const l = computeLedger({ ...base, offsetLines: [...base.offsetLines, { offsetId: 'o1', tagId: '2', amount: 100 }] });
    expect(l.errors.map((e) => e.code)).toEqual(['offset_unbalanced']);
  });

  it('removing an entry voids the whole offset it was part of', () => {
    expect(withoutTag(base, '3').offsetLines).toEqual([]);
  });
});

describe('computeLedger — write-offs', () => {
  it('forgives part of an entry and moves the balance by exactly that much', () => {
    const l = computeLedger(
      rows({
        tags: [owesMe('78', 111), settlement('82', 100)],
        links: [link('82', '78', 100)],
        writeOffs: [{ id: 'w', tagId: '78', amount: 11, reason: 'Round-off' }],
      }),
    );
    expect(l.errors).toEqual([]);
    expect(due(l, '78')).toMatchObject({ writtenOffAmount: 11, pendingAmount: 0, settlementStatus: 'settled' });
    expect(l.totals.net).toBe(0);
  });

  it('absorbs a ₹1 overpayment left on account', () => {
    const l = computeLedger(
      rows({
        tags: [owesMe('258', 299), settlement('259', 300)],
        links: [link('259', '258', 299)],
        writeOffs: [{ id: 'w', tagId: '259', amount: 1, reason: 'Round-off' }],
      }),
    );
    expect(settle(l, '259')).toMatchObject({ unallocatedAmount: 0, writtenOffAmount: 1 });
    expect(l.totals).toMatchObject({ net: 0, legacyDifference: 0 });
  });

  it('cannot write off more than is left', () => {
    const l = computeLedger(
      rows({ tags: [owesMe('1', 50)], writeOffs: [{ id: 'w', tagId: '1', amount: 60 }] }),
    );
    expect(l.errors.map((e) => e.code)).toEqual(['over_settled']);
  });
});

describe('computeLedger — refunds of money on account', () => {
  // Vraj paid ₹2,000 against a ₹1,850 entry; the user sent the ₹150 back.
  const vraj = rows({
    tags: [
      owesMe('58', 1850, '2026-03-03'),
      owesMe('131', 45.45, '2026-04-01'),
      owesMe('119', 230.9, '2026-04-04'),
      settlement('64', 2000, '2026-03-04'),
      settlement('80', 150, '2026-03-31'),
    ],
    links: [link('64', '58', 1850), link('80', '64', 150)],
  });

  it('turns the refund into money paid and closes both on-account amounts', () => {
    const l = computeLedger(vraj);
    expect(l.errors).toEqual([]);
    expect(settle(l, '80')).toMatchObject({ settlementSide: 'paid', allocatedAmount: 150, refundedAmount: 150, unallocatedAmount: 0 });
    expect(settle(l, '64')).toMatchObject({ settlementSide: 'received', unallocatedAmount: 0 });
    // Exactly his two unpaid entries.
    expect(l.totals.net).toBe(276.35);
    expect(l.totals.legacyDifference).toBe(0);
  });

  it('refuses to refund more than is on account', () => {
    const l = computeLedger(withSettlementLinks(vraj, '80', [{ tagId: '64', amount: 200 }]));
    expect(l.errors.map((e) => e.code)).toContain('over_applied');
  });

  it('refuses to refund a refund', () => {
    const l = computeLedger({
      ...vraj,
      tags: [...vraj.tags, settlement('99', 10)],
      links: [...vraj.links, link('99', '80', 10)],
    });
    expect(l.errors.map((e) => e.code)).toContain('refund_chain');
  });

  it('refuses to refund an unreviewed legacy settlement', () => {
    const l = computeLedger({ ...vraj, links: [link('64', '58', null), link('80', '64', 150)] });
    expect(l.errors.map((e) => e.code)).toContain('refund_legacy');
  });
});

describe('computeLedger — legacy links keep their old reading', () => {
  // Yash's old ₹300 settlement linked, without amounts, to a ₹299 entry.
  const yash = rows({
    tags: [owesMe('258', 299, '2026-07-26'), owesMe('300', 5000, '2026-08-01'), settlement('259', 300, '2026-07-26')],
    links: [link('259', '258', null)],
  });

  it('counts the entry as settled and the settlement as fully applied', () => {
    const l = computeLedger(yash);
    expect(due(l, '258')).toMatchObject({ settlementLegacy: true, pendingAmount: 0, settlementStatus: 'settled' });
    expect(settle(l, '259')).toMatchObject({ settlementLegacy: true, unallocatedAmount: null, settlementSide: 'received' });
  });

  it('shows the ₹1 nothing explains as the legacy difference', () => {
    const l = computeLedger(yash);
    expect(l.totals).toMatchObject({ net: 4999, openOwesMe: 5000, legacyDifference: -1 });
  });

  it('will not take new amounts onto an entry an old link settled', () => {
    const l = computeLedger({
      ...yash,
      tags: [...yash.tags, settlement('400', 10)],
      links: [...yash.links, link('400', '258', 10)],
    });
    expect(l.errors.map((e) => e.code)).toEqual(['due_legacy']);
  });
});

describe('newErrors', () => {
  it('ignores what was already broken and reports what a change breaks', () => {
    const broken = rows({ tags: [owesMe('1', 10), settlement('2', 100)], links: [link('2', '1', 50)] });
    const before = computeLedger(broken);
    expect(before.errors.map((e) => e.code)).toEqual(['over_settled']);
    expect(newErrors(before, computeLedger(broken))).toEqual([]);
    const worse = computeLedger({ ...broken, writeOffs: [{ id: 'w', tagId: '2', amount: 80 }] });
    expect(newErrors(before, worse).map((e) => e.code)).toEqual(['over_applied']);
  });
});

describe('suggestLegacyConversion', () => {
  it('Yash: suggests ₹299 and leaves the ₹1 on account', () => {
    const r = suggestLegacyConversion(
      rows({ tags: [owesMe('258', 299, '2026-07-26'), settlement('259', 300, '2026-07-26')], links: [link('259', '258', null)] }),
    );
    expect(r.suggestions).toEqual([
      {
        settlementId: '259',
        allocations: [{ tagId: '258', amount: 299 }],
        staleTagIds: [],
        onAccountAfter: 1,
        sideAfter: 'received',
        shortTagIds: [],
        reasons: ['on_account'],
      },
    ]);
    expect([r.netBefore, r.netAfter]).toEqual([-1, -1]);
  });

  it('Viral: two payments on one entry, oldest first, the rest on account', () => {
    const r = suggestLegacyConversion(
      rows({
        tags: [owesMe('245', 3000, '2026-07-05'), settlement('247', 440, '2026-07-08'), settlement('248', 3960, '2026-07-08')],
        links: [link('247', '245', null), link('248', '245', null)],
      }),
    );
    expect(r.suggestions.map((s) => [s.settlementId, s.allocations, s.onAccountAfter])).toEqual([
      ['247', [{ tagId: '245', amount: 440 }], 0],
      ['248', [{ tagId: '245', amount: 2560 }], 1400],
    ]);
  });

  it('Vraj: a link to an entry already paid in full comes out stale', () => {
    const r = suggestLegacyConversion(
      rows({
        tags: [owesMe('28', 2000, '2026-01-27'), settlement('44', 2000, '2026-02-06'), settlement('80', 150, '2026-03-31')],
        links: [link('44', '28', null), link('80', '28', null)],
      }),
    );
    const v80 = r.suggestions.find((s) => s.settlementId === '80')!;
    expect(v80).toMatchObject({ allocations: [], staleTagIds: ['28'], onAccountAfter: 150, reasons: ['on_account', 'stale_link'] });
  });

  it('Home: a short payment leaves the entry pending', () => {
    const r = suggestLegacyConversion(
      rows({ tags: [owesMe('78', 111, '2026-03-23'), settlement('82', 100, '2026-04-01')], links: [link('82', '78', null)] }),
    );
    expect(r.suggestions[0]).toMatchObject({ shortTagIds: ['78'], reasons: ['short'] });
  });

  it('Home: an old settlement on what the user owed becomes money paid', () => {
    const r = suggestLegacyConversion(
      rows({
        tags: [iOwe('145', 500, '2026-04-12'), iOwe('146', 9500, '2026-04-12'), settlement('229', 10000, '2026-06-12')],
        links: [link('229', '145', null), link('229', '146', null)],
      }),
    );
    expect(r.suggestions[0]).toMatchObject({ sideAfter: 'paid', reasons: ['side_change'] });
    // Today: −10,000 − 10,000; reviewed: −10,000 + 10,000.
    expect([r.netBefore, r.netAfter]).toEqual([-20000, 0]);
  });
});

describe('ledger invariants (property-based)', () => {
  const paise = fc.integer({ min: 1, max: 2_000_000 });

  it('without legacy links, open entries and on-account money explain the whole balance', () => {
    fc.assert(
      fc.property(
        fc.array(paise, { minLength: 1, maxLength: 8 }),
        fc.array(paise, { minLength: 1, maxLength: 8 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 16, maxLength: 16 }),
        paise,
        (theyOwe, iOweAmounts, shares, extra) => {
          const tags: LedgerTag[] = [
            ...theyOwe.map((p, i) => owesMe(`o${i}`, p / 100)),
            ...iOweAmounts.map((p, i) => iOwe(`i${i}`, p / 100)),
          ];
          // One received settlement: part of each "they owe" entry, netting in
          // part of each "I owe" entry, plus some money left on account.
          const owed = theyOwe.map((p, i) => Math.floor(p * shares[i]));
          const netted = iOweAmounts.map((p, i) => Math.floor(p * shares[8 + i]));
          const sumOwed = owed.reduce((a, b) => a + b, 0);
          const sumNetted = netted.reduce((a, b) => a + b, 0);
          if (sumOwed <= sumNetted) return true;
          const amountPaise = sumOwed - sumNetted + extra;
          tags.push(settlement('s', amountPaise / 100));
          const links = [
            ...owed.map((p, i) => link('s', `o${i}`, p / 100)).filter((l) => (l.amount as number) > 0),
            ...netted.map((p, i) => link('s', `i${i}`, p / 100)).filter((l) => (l.amount as number) > 0),
          ];
          const l = computeLedger(rows({ tags, links }));
          const s = settle(l, 's');
          return (
            l.errors.length === 0 &&
            l.totals.legacyDifference === 0 &&
            toPaise(s.unallocatedAmount!) === extra &&
            toPaise(l.totals.net) ===
              theyOwe.reduce((a, b) => a + b, 0) - iOweAmounts.reduce((a, b) => a + b, 0) - amountPaise
          );
        },
      ),
    );
  });

  it('an offset never changes the balance', () => {
    fc.assert(
      fc.property(paise, paise, fc.double({ min: 0.01, max: 1, noNaN: true }), (a, b, share) => {
        const tags = [owesMe('a', a / 100), iOwe('b', b / 100)];
        const amount = Math.max(1, Math.floor(Math.min(a, b) * share));
        const without = computeLedger(rows({ tags }));
        const withOffset = computeLedger(
          rows({
            tags,
            offsetLines: [
              { offsetId: 'x', tagId: 'a', amount: amount / 100 },
              { offsetId: 'x', tagId: 'b', amount: amount / 100 },
            ],
          }),
        );
        return withOffset.errors.length === 0 && withOffset.totals.net === without.totals.net;
      }),
    );
  });
});
