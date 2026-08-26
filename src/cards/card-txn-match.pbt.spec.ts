import fc from 'fast-check';
import {
  MatchableCandidate,
  MatchableEntry,
  matchParsedEntries,
  signedPaise,
} from './card-txn-match';

const isoDate = fc
  .integer({ min: 0, max: 900 })
  .map((offset) =>
    new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10),
  );

const amount = fc
  .integer({ min: 1, max: 500_000 })
  .map((paise) => paise / 100);

const arbEntry: fc.Arbitrary<MatchableEntry> = fc.record({
  txnDate: isoDate,
  amount,
  merchant: fc.string({ maxLength: 20 }),
  isRefund: fc.boolean(),
});

const arbCandidates: fc.Arbitrary<MatchableCandidate[]> = fc
  .array(arbEntry, { maxLength: 12 })
  .map((entries) => entries.map((e, i) => ({ ...e, id: String(i + 1) })));

describe('matchParsedEntries (property-based)', () => {
  it('consumes each statement row and each manual entry at most once', () => {
    fc.assert(
      fc.property(
        fc.array(arbEntry, { maxLength: 12 }),
        arbCandidates,
        (parsed, candidates) => {
          const { matches } = matchParsedEntries(parsed, candidates);
          const parsedIndexes = matches.map((m) => m.parsedIndex);
          const existingIds = matches.map((m) => m.existingId);
          expect(new Set(parsedIndexes).size).toBe(parsedIndexes.length);
          expect(new Set(existingIds).size).toBe(existingIds.length);
        },
      ),
    );
  });

  it('partitions every input index into exactly one of matched or unmatched', () => {
    fc.assert(
      fc.property(
        fc.array(arbEntry, { maxLength: 12 }),
        arbCandidates,
        (parsed, candidates) => {
          const { matches, unmatchedIndexes } = matchParsedEntries(parsed, candidates);
          const seen = [...matches.map((m) => m.parsedIndex), ...unmatchedIndexes].sort(
            (a, b) => a - b,
          );
          expect(seen).toEqual(parsed.map((_, i) => i));
        },
      ),
    );
  });

  it('only ever pairs rows of identical signed paise, inside the window', () => {
    fc.assert(
      fc.property(
        fc.array(arbEntry, { maxLength: 12 }),
        arbCandidates,
        fc.integer({ min: 0, max: 10 }),
        (parsed, candidates, dateWindowDays) => {
          const { matches } = matchParsedEntries(parsed, candidates, { dateWindowDays });
          for (const match of matches) {
            const left = parsed[match.parsedIndex];
            const right = candidates.find((c) => c.id === match.existingId)!;
            expect(signedPaise(left)).toBe(signedPaise(right));
            expect(match.dateDeltaDays).toBeLessThanOrEqual(dateWindowDays);
          }
        },
      ),
    );
  });

  it('is deterministic — the same inputs always give the same pairing', () => {
    fc.assert(
      fc.property(
        fc.array(arbEntry, { maxLength: 12 }),
        arbCandidates,
        (parsed, candidates) => {
          expect(matchParsedEntries(parsed, candidates)).toEqual(
            matchParsedEntries(parsed, candidates),
          );
        },
      ),
    );
  });

  it('matches nothing when no candidates are offered', () => {
    fc.assert(
      fc.property(fc.array(arbEntry, { maxLength: 12 }), (parsed) => {
        const { matches, unmatchedIndexes } = matchParsedEntries(parsed, []);
        expect(matches).toEqual([]);
        expect(unmatchedIndexes).toHaveLength(parsed.length);
      }),
    );
  });
});
