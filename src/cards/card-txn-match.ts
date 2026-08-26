/**
 * Matches rows parsed off a credit-card statement against card transactions the
 * user already entered by hand.
 *
 * Spend made after the statement date has nowhere to sit until the next
 * statement arrives, so it is entered manually and left unbilled
 * (`statement_id IS NULL`). When that statement finally lands it contains the
 * very same charges. Inserting them blindly double-counts the spend in every
 * friend ledger, and deleting the manual row to compensate takes its friend
 * tags with it (`transaction_friend_tags.card_transaction_id` cascades). So the
 * import matches instead: the existing row is billed in place and keeps its id,
 * category, notes and tags.
 *
 * The rule is the one Actual Budget and YNAB settled on — an exact amount match
 * inside a small date window — because a statement's merchant string rarely
 * resembles what a person typed. Merchant text therefore only breaks ties.
 *
 * Amounts are compared in integer paise; a refund carries a negative sign, so a
 * refund can never match a purchase of the same magnitude.
 */

export const DEFAULT_DATE_WINDOW_DAYS = 3;

export interface MatchableEntry {
  txnDate: string;
  amount: number;
  isRefund: boolean;
  merchant: string;
}

export interface MatchableCandidate extends MatchableEntry {
  id: string;
}

export interface EntryMatch {
  parsedIndex: number;
  existingId: string;
  dateDeltaDays: number;
}

export interface MatchResult {
  matches: EntryMatch[];
  unmatchedIndexes: number[];
}

/** Signed paise: refunds subtract, purchases add. */
export const signedPaise = (entry: MatchableEntry): number =>
  Math.round(entry.amount * 100) * (entry.isRefund ? -1 : 1);

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

export const diffDays = (a: string, b: string): number =>
  Math.abs(dayNumber(a) - dayNumber(b));

const normalizeMerchant = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Tie-breaker only: 2 = identical text, 1 = one contains the other, 0 = neither. */
function merchantAffinity(a: string, b: string): number {
  const left = normalizeMerchant(a);
  const right = normalizeMerchant(b);
  if (!left || !right) return 0;
  if (left === right) return 2;
  return left.includes(right) || right.includes(left) ? 1 : 0;
}

/**
 * Greedy one-to-one matching. Every pair within the window is scored, the pairs
 * are ordered best-first, and each side is consumed at most once — so two
 * identical charges on one statement can never both claim the same manual row.
 */
export function matchParsedEntries(
  parsed: MatchableEntry[],
  candidates: MatchableCandidate[],
  opts: { dateWindowDays?: number } = {},
): MatchResult {
  const windowDays = opts.dateWindowDays ?? DEFAULT_DATE_WINDOW_DAYS;

  const pairs: Array<EntryMatch & { affinity: number }> = [];
  parsed.forEach((entry, parsedIndex) => {
    const entryPaise = signedPaise(entry);
    for (const candidate of candidates) {
      if (signedPaise(candidate) !== entryPaise) continue;
      const dateDeltaDays = diffDays(entry.txnDate, candidate.txnDate);
      if (dateDeltaDays > windowDays) continue;
      pairs.push({
        parsedIndex,
        existingId: candidate.id,
        dateDeltaDays,
        affinity: merchantAffinity(entry.merchant, candidate.merchant),
      });
    }
  });

  // Closest date first, then the better merchant text. The last two keys only
  // make the result deterministic when everything else ties.
  pairs.sort(
    (a, b) =>
      a.dateDeltaDays - b.dateDeltaDays ||
      b.affinity - a.affinity ||
      a.parsedIndex - b.parsedIndex ||
      a.existingId.localeCompare(b.existingId),
  );

  const usedParsed = new Set<number>();
  const usedExisting = new Set<string>();
  const matches: EntryMatch[] = [];
  for (const pair of pairs) {
    if (usedParsed.has(pair.parsedIndex) || usedExisting.has(pair.existingId)) continue;
    usedParsed.add(pair.parsedIndex);
    usedExisting.add(pair.existingId);
    matches.push({
      parsedIndex: pair.parsedIndex,
      existingId: pair.existingId,
      dateDeltaDays: pair.dateDeltaDays,
    });
  }

  matches.sort((a, b) => a.parsedIndex - b.parsedIndex);
  const unmatchedIndexes = parsed
    .map((_, i) => i)
    .filter((i) => !usedParsed.has(i));

  return { matches, unmatchedIndexes };
}
