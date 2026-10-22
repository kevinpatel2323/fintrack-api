/**
 * The bill-wise ledger between the user and one friend — every rule about
 * what is pending, applied, netted, written off and owed lives here, as pure
 * functions over plain rows. FriendsService loads the rows, applies a proposed
 * change in memory, and saves it only if no rule newly breaks.
 *
 * Building blocks (all amounts in rupees, compared in paise):
 *
 * - Entry (due): an OWES_ME or I_OWE tag.
 * - Settlement: a SETTLEMENT tag — money that moved between the two.
 * - Link (settlement_links): a settlement applying `amount` to an entry, or —
 *   when the target is another settlement — refunding that settlement's money
 *   on account. `amount = null` is a link made before amounts existed.
 * - Offset line: nets entries of the two sides against each other with no
 *   money moving; per offset, both sides add up to the same amount.
 * - Write-off: closes a leftover on an entry or a settlement with a reason.
 *
 * A settlement's side ('received' / 'paid') follows from what it is applied
 * to: the larger side of the entries it pays off, or the opposite of the
 * settlement it refunds. Entries on the other side inside the same settlement
 * are netted against it — Tally's receipt that knocks off both debit and
 * credit bills. Legacy settlements (any amount-less link) are 'received' and
 * fully applied, and the entries they link count as settled — the reading the
 * app always had.
 */
import { fromPaise, toPaise } from './settlement-allocation';

export type Side = 'received' | 'paid';
export type DueStatus = 'open' | 'partial' | 'settled';

export interface LedgerTag {
  id: string;
  direction: string;
  amount: number;
  /** ISO day of the tag's transaction; orders legacy suggestions. */
  date?: string;
}

export interface LedgerLink {
  sourceId: string;
  targetId: string;
  amount: number | null;
}

export interface LedgerOffsetLine {
  offsetId: string;
  tagId: string;
  amount: number;
}

export interface LedgerWriteOff {
  id: string;
  tagId: string;
  amount: number;
  reason?: string;
}

export interface LedgerRows {
  tags: LedgerTag[];
  links: LedgerLink[];
  offsetLines: LedgerOffsetLine[];
  writeOffs: LedgerWriteOff[];
}

export interface DueFigures {
  kind: 'due';
  /** Paid off by settlements — including netting inside a settlement. */
  settledAmount: number;
  /** Netted off against the other side by a standalone offset. */
  nettedAmount: number;
  writtenOffAmount: number;
  pendingAmount: number;
  settlementStatus: DueStatus;
  settlementLegacy: boolean;
  /** Signed effect on the friend's balance (positive: they owe the user more). */
  balanceDelta: number;
}

export interface SettlementFigures {
  kind: 'settlement';
  /** Applied to entries (net of netting) plus refunds either way. Null when legacy. */
  allocatedAmount: number | null;
  /** The refund part of `allocatedAmount`. Null when legacy. */
  refundedAmount: number | null;
  writtenOffAmount: number;
  /** Money not applied to anything yet — "on account". Null when legacy. */
  unallocatedAmount: number | null;
  settlementSide: Side;
  settlementLegacy: boolean;
  balanceDelta: number;
}

export interface OtherFigures {
  kind: 'other';
  balanceDelta: number;
}

export type TagFigures = DueFigures | SettlementFigures | OtherFigures;

export interface LedgerError {
  code: string;
  tagId: string | null;
  message: string;
}

export interface LedgerTotals {
  net: number;
  openOwesMe: number;
  openIOwe: number;
  onAccountReceived: number;
  onAccountPaid: number;
  /**
   * What the net balance carries that no entry or on-account amount explains
   * — always the residue of legacy settlements whose amounts never matched
   * their entries. Zero once those are reviewed.
   */
  legacyDifference: number;
}

export interface Ledger {
  figures: Map<string, TagFigures>;
  errors: LedgerError[];
  totals: LedgerTotals;
}

const DUES = new Set(['OWES_ME', 'I_OWE']);
const isDue = (direction: string | undefined) => DUES.has(String(direction));
const opposite = (side: Side): Side => (side === 'received' ? 'paid' : 'received');
const sumPaise = (values: number[]) => values.reduce((s, v) => s + toPaise(v), 0);

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function computeLedger(rows: LedgerRows): Ledger {
  const errors: LedgerError[] = [];
  const err = (code: string, tagId: string | null, message: string) =>
    errors.push({ code, tagId, message });

  const tags = new Map(rows.tags.map((t) => [String(t.id), t]));
  const linksBySource = new Map<string, LedgerLink[]>();
  const linksByTarget = new Map<string, LedgerLink[]>();
  for (const link of rows.links) {
    const source = tags.get(String(link.sourceId));
    const target = tags.get(String(link.targetId));
    if (!source || !target) continue; // belongs to another friend's rows
    if (source.direction !== 'SETTLEMENT') {
      err('link_source', source.id, `Entry #${source.id} is not a settlement, so it cannot settle anything.`);
      continue;
    }
    if (source.id === target.id || !(isDue(target.direction) || target.direction === 'SETTLEMENT')) {
      err('link_target', source.id, `Settlement #${source.id} points at #${target.id}, which cannot be settled.`);
      continue;
    }
    push(linksBySource, source.id, link);
    push(linksByTarget, target.id, link);
  }
  const offsetByTag = new Map<string, LedgerOffsetLine[]>();
  const offsetById = new Map<string, LedgerOffsetLine[]>();
  for (const line of rows.offsetLines) {
    if (!tags.has(String(line.tagId))) continue;
    push(offsetByTag, String(line.tagId), line);
    push(offsetById, String(line.offsetId), line);
  }
  const writeOffByTag = new Map<string, LedgerWriteOff[]>();
  for (const wo of rows.writeOffs) {
    if (!tags.has(String(wo.tagId))) continue;
    push(writeOffByTag, String(wo.tagId), wo);
  }

  const legacySettlement = (id: string) =>
    (linksBySource.get(id) ?? []).some((l) => l.amount === null);
  const legacyDue = (id: string) =>
    (linksByTarget.get(id) ?? []).some((l) => l.amount === null);

  // ── Sides ────────────────────────────────────────────────────────────────
  const baseSide = new Map<string, Side>();
  for (const tag of rows.tags) {
    if (tag.direction !== 'SETTLEMENT') continue;
    if (legacySettlement(tag.id)) {
      baseSide.set(tag.id, 'received');
      continue;
    }
    let owesMe = 0;
    let iOwe = 0;
    for (const l of linksBySource.get(tag.id) ?? []) {
      const target = tags.get(String(l.targetId))!;
      if (target.direction === 'OWES_ME') owesMe += toPaise(l.amount!);
      if (target.direction === 'I_OWE') iOwe += toPaise(l.amount!);
    }
    baseSide.set(tag.id, iOwe > owesMe ? 'paid' : 'received');
  }
  const refundTargetsOf = (id: string) =>
    (linksBySource.get(id) ?? []).filter((l) => tags.get(String(l.targetId))!.direction === 'SETTLEMENT');
  const side = new Map(baseSide);
  for (const [id] of baseSide) {
    if (legacySettlement(id)) continue;
    const refunds = refundTargetsOf(id);
    if (refunds.length === 0) continue;
    const targetSides = new Set<Side>();
    for (const l of refunds) {
      const targetId = String(l.targetId);
      if (refundTargetsOf(targetId).length > 0) {
        err('refund_chain', id, `Settlement #${id} refunds #${targetId}, which is itself a refund.`);
      }
      if (legacySettlement(targetId)) {
        err('refund_legacy', id, `Settlement #${targetId} must be reviewed before its money can be refunded.`);
      }
      targetSides.add(baseSide.get(targetId)!);
    }
    if (targetSides.size > 1) {
      err('refund_mixed', id, `Settlement #${id} refunds money that went both ways.`);
    }
    side.set(id, opposite([...targetSides][0]));
  }

  // ── Figures ──────────────────────────────────────────────────────────────
  const figures = new Map<string, TagFigures>();
  let net = 0;
  let openOwesMe = 0;
  let openIOwe = 0;
  let onAccountReceived = 0;
  let onAccountPaid = 0;

  for (const tag of rows.tags) {
    const id = String(tag.id);
    const amount = toPaise(tag.amount);
    const writtenOff = sumPaise((writeOffByTag.get(id) ?? []).map((w) => w.amount));

    if (isDue(tag.direction)) {
      const sign = tag.direction === 'OWES_ME' ? 1 : -1;
      if (legacyDue(id)) {
        if ((linksByTarget.get(id) ?? []).some((l) => l.amount !== null)) {
          err('due_legacy', id, `Entry #${id} is already settled by an earlier settlement.`);
        }
        if (offsetByTag.has(id) || writtenOff > 0) {
          err('due_legacy', id, `Entry #${id} is settled by an older settlement; review that first.`);
        }
        const delta = sign * amount;
        net += delta;
        figures.set(id, {
          kind: 'due',
          settledAmount: tag.amount,
          nettedAmount: 0,
          writtenOffAmount: 0,
          pendingAmount: 0,
          settlementStatus: 'settled',
          settlementLegacy: true,
          balanceDelta: fromPaise(delta),
        });
        continue;
      }
      const settled = sumPaise((linksByTarget.get(id) ?? []).map((l) => l.amount as number));
      const netted = sumPaise((offsetByTag.get(id) ?? []).map((l) => l.amount));
      const pending = amount - settled - netted - writtenOff;
      if (pending < 0) {
        err('over_settled', id, `Entry #${id} would be settled ₹${fromPaise(-pending)} more than its amount.`);
      }
      const cleared = settled + netted + writtenOff;
      const delta = sign * (amount - writtenOff);
      net += delta;
      if (tag.direction === 'OWES_ME') openOwesMe += Math.max(pending, 0);
      else openIOwe += Math.max(pending, 0);
      figures.set(id, {
        kind: 'due',
        settledAmount: fromPaise(settled),
        nettedAmount: fromPaise(netted),
        writtenOffAmount: fromPaise(writtenOff),
        pendingAmount: fromPaise(Math.max(pending, 0)),
        settlementStatus: cleared <= 0 ? 'open' : pending > 0 ? 'partial' : 'settled',
        settlementLegacy: false,
        balanceDelta: fromPaise(delta),
      });
      continue;
    }

    if (tag.direction === 'SETTLEMENT') {
      const s = side.get(id)!;
      if (legacySettlement(id)) {
        if (writtenOff > 0) {
          err('writeoff_legacy', id, `Settlement #${id} must be reviewed before anything on it can be written off.`);
        }
        if ((linksByTarget.get(id) ?? []).length > 0) {
          err('refund_legacy', id, `Settlement #${id} must be reviewed before its money can be refunded.`);
        }
        const delta = -amount;
        net += delta;
        figures.set(id, {
          kind: 'settlement',
          allocatedAmount: null,
          refundedAmount: null,
          writtenOffAmount: 0,
          unallocatedAmount: null,
          settlementSide: 'received',
          settlementLegacy: true,
          balanceDelta: fromPaise(delta),
        });
        continue;
      }
      const same = s === 'received' ? 'OWES_ME' : 'I_OWE';
      let dueApplied = 0;
      let refunds = 0;
      for (const l of linksBySource.get(id) ?? []) {
        const target = tags.get(String(l.targetId))!;
        if (target.direction === 'SETTLEMENT') refunds += toPaise(l.amount as number);
        else dueApplied += (target.direction === same ? 1 : -1) * toPaise(l.amount as number);
      }
      for (const l of linksByTarget.get(id) ?? []) {
        if (l.amount !== null) refunds += toPaise(l.amount);
      }
      if (dueApplied < 0) {
        err(
          'netting_exceeds',
          id,
          `Settlement #${id} nets off ₹${fromPaise(-dueApplied)} more of the other side than it settles.`,
        );
      }
      const applied = dueApplied + refunds;
      const unallocated = amount - applied - writtenOff;
      if (unallocated < 0) {
        err(
          'over_applied',
          id,
          `Settlement #${id} would apply ₹${fromPaise(applied + writtenOff)}, more than its ₹${fromPaise(amount)}.`,
        );
      }
      const delta = (s === 'received' ? -1 : 1) * (amount - writtenOff);
      net += delta;
      if (s === 'received') onAccountReceived += Math.max(unallocated, 0);
      else onAccountPaid += Math.max(unallocated, 0);
      figures.set(id, {
        kind: 'settlement',
        allocatedAmount: fromPaise(applied),
        refundedAmount: fromPaise(refunds),
        writtenOffAmount: fromPaise(writtenOff),
        unallocatedAmount: fromPaise(Math.max(unallocated, 0)),
        settlementSide: s,
        settlementLegacy: false,
        balanceDelta: fromPaise(delta),
      });
      continue;
    }

    if (writtenOff > 0) {
      err('writeoff_target', id, `Entry #${id} has nothing outstanding to write off.`);
    }
    figures.set(id, { kind: 'other', balanceDelta: 0 });
  }

  for (const [offsetId, lines] of offsetById) {
    let owesMe = 0;
    let iOwe = 0;
    for (const line of lines) {
      const tag = tags.get(String(line.tagId))!;
      if (tag.direction === 'OWES_ME') owesMe += toPaise(line.amount);
      else if (tag.direction === 'I_OWE') iOwe += toPaise(line.amount);
      else err('offset_target', String(line.tagId), `Entry #${line.tagId} cannot be netted off.`);
    }
    if (owesMe !== iOwe || owesMe === 0) {
      err(
        'offset_unbalanced',
        null,
        `Netting #${offsetId} must clear the same amount on both sides (₹${fromPaise(owesMe)} vs ₹${fromPaise(iOwe)}).`,
      );
    }
  }

  return {
    figures,
    errors,
    totals: {
      net: fromPaise(net),
      openOwesMe: fromPaise(openOwesMe),
      openIOwe: fromPaise(openIOwe),
      onAccountReceived: fromPaise(onAccountReceived),
      onAccountPaid: fromPaise(onAccountPaid),
      legacyDifference: fromPaise(net - (openOwesMe - openIOwe - onAccountReceived + onAccountPaid)),
    },
  };
}

/** Errors in `after` that were not already in `before` — what a change broke. */
export function newErrors(before: Ledger, after: Ledger): LedgerError[] {
  const key = (e: LedgerError) => `${e.code}|${e.tagId}`;
  const existing = new Set(before.errors.map(key));
  return after.errors.filter((e) => !existing.has(key(e)));
}

// ── Changes, as pure transforms on rows ────────────────────────────────────

export function withSettlementLinks(
  rows: LedgerRows,
  settlementId: string,
  allocations: Array<{ tagId: string; amount: number }>,
): LedgerRows {
  return {
    ...rows,
    links: [
      ...rows.links.filter((l) => String(l.sourceId) !== String(settlementId)),
      ...allocations.map((a) => ({
        sourceId: String(settlementId),
        targetId: String(a.tagId),
        amount: a.amount,
      })),
    ],
  };
}

export function withoutTag(rows: LedgerRows, tagId: string): LedgerRows {
  const id = String(tagId);
  // An offset is one balanced whole; losing a line voids all of it.
  const voided = new Set(rows.offsetLines.filter((l) => String(l.tagId) === id).map((l) => String(l.offsetId)));
  return {
    tags: rows.tags.filter((t) => String(t.id) !== id),
    links: rows.links.filter((l) => String(l.sourceId) !== id && String(l.targetId) !== id),
    offsetLines: rows.offsetLines.filter((l) => !voided.has(String(l.offsetId))),
    writeOffs: rows.writeOffs.filter((w) => String(w.tagId) !== id),
  };
}

export function withTagChanged(
  rows: LedgerRows,
  tagId: string,
  change: { direction?: string; amount?: number },
): LedgerRows {
  return {
    ...rows,
    tags: rows.tags.map((t) => (String(t.id) === String(tagId) ? { ...t, ...change } : t)),
  };
}

// ── Reviewing legacy settlements ─────────────────────────────────────────────

export type ReviewReason = 'on_account' | 'stale_link' | 'short' | 'side_change';

export interface LegacySuggestion {
  settlementId: string;
  allocations: Array<{ tagId: string; amount: number }>;
  /** Links whose suggestion came out at zero — the entry was already fully paid. */
  staleTagIds: string[];
  onAccountAfter: number;
  sideAfter: Side;
  /** Entries this settlement links that would still have something pending. */
  shortTagIds: string[];
  reasons: ReviewReason[];
}

const byDateThenId = (a: LedgerTag, b: LedgerTag) =>
  (a.date ?? '').localeCompare(b.date ?? '') || Number(a.id) - Number(b.id);

/**
 * Gives each legacy settlement the amounts its links most plausibly meant:
 * oldest settlement first, each linked entry (oldest first) takes as much as
 * the settlement has left and the entry still needs. What comes out is a
 * suggestion for the user to accept or adjust — never applied on its own.
 */
export function suggestLegacyConversion(rows: LedgerRows): {
  suggestions: LegacySuggestion[];
  rowsAfter: LedgerRows;
  netBefore: number;
  netAfter: number;
} {
  const tags = new Map(rows.tags.map((t) => [String(t.id), t]));
  const legacyIds = new Set(
    rows.links.filter((l) => l.amount === null && tags.has(String(l.sourceId))).map((l) => String(l.sourceId)),
  );
  const legacy = [...legacyIds].map((id) => tags.get(id)!).sort(byDateThenId);

  // What each entry still needs once everything with real amounts is counted.
  const before = computeLedger(rows);
  const remaining = new Map<string, number>();
  for (const tag of rows.tags) {
    if (!isDue(tag.direction)) continue;
    const amount = toPaise(tag.amount);
    const known =
      sumPaise(rows.links.filter((l) => String(l.targetId) === tag.id && l.amount !== null).map((l) => l.amount as number)) +
      sumPaise(rows.offsetLines.filter((l) => String(l.tagId) === tag.id).map((l) => l.amount)) +
      sumPaise(rows.writeOffs.filter((w) => String(w.tagId) === tag.id).map((w) => w.amount));
    remaining.set(tag.id, Math.max(amount - known, 0));
  }

  const plans = new Map<string, { allocations: Array<{ tagId: string; amount: number }>; stale: string[] }>();
  for (const settlement of legacy) {
    let left = toPaise(settlement.amount);
    const targets = rows.links
      .filter((l) => String(l.sourceId) === settlement.id)
      .map((l) => tags.get(String(l.targetId)))
      .filter((t): t is LedgerTag => Boolean(t) && isDue(t!.direction))
      .sort(byDateThenId);
    const allocations: Array<{ tagId: string; amount: number }> = [];
    const stale: string[] = [];
    for (const target of targets) {
      const take = Math.max(Math.min(left, remaining.get(target.id) ?? 0), 0);
      if (take === 0) {
        stale.push(target.id);
        continue;
      }
      allocations.push({ tagId: target.id, amount: fromPaise(take) });
      remaining.set(target.id, (remaining.get(target.id) ?? 0) - take);
      left -= take;
    }
    plans.set(settlement.id, { allocations, stale });
  }

  let rowsAfter = rows;
  for (const [id, plan] of plans) rowsAfter = withSettlementLinks(rowsAfter, id, plan.allocations);
  const after = computeLedger(rowsAfter);

  const suggestions = legacy.map((settlement) => {
    const plan = plans.get(settlement.id)!;
    const fig = after.figures.get(settlement.id) as SettlementFigures;
    const linkedIds = rows.links
      .filter((l) => String(l.sourceId) === settlement.id)
      .map((l) => String(l.targetId));
    const shortTagIds = linkedIds.filter((tagId) => {
      const due = after.figures.get(tagId);
      return due?.kind === 'due' && due.pendingAmount > 0;
    });
    const reasons: ReviewReason[] = [];
    if ((fig.unallocatedAmount ?? 0) > 0) reasons.push('on_account');
    if (plan.stale.length > 0) reasons.push('stale_link');
    if (shortTagIds.length > 0) reasons.push('short');
    if (fig.settlementSide === 'paid') reasons.push('side_change');
    return {
      settlementId: settlement.id,
      allocations: plan.allocations,
      staleTagIds: plan.stale,
      onAccountAfter: fig.unallocatedAmount ?? 0,
      sideAfter: fig.settlementSide,
      shortTagIds,
      reasons,
    };
  });

  return { suggestions, rowsAfter, netBefore: before.totals.net, netAfter: after.totals.net };
}

// ── Entry groups ─────────────────────────────────────────────────────────────

export interface GroupFigures {
  entryCount: number;
  /** What the entries add up to, signed: positive when the friend owes the user. */
  totalAmount: number;
  owesMeAmount: number;
  iOweAmount: number;
  pendingOwesMe: number;
  pendingIOwe: number;
  /** What is still open, signed like `totalAmount`. */
  pendingNet: number;
  /** Settled, netted or written off so far, across both sides. */
  clearedAmount: number;
  /** open: nothing cleared yet · partial · settled: nothing left open. */
  status: DueStatus;
  /** The group's effect on the balance — the sum of its entries'. */
  balanceDelta: number;
}

/**
 * A group's figures, derived only from its entries' own figures in `ledger`.
 * Nothing about a group is stored but its title and membership, so these can
 * never drift from the entries. Entries settled by legacy (amount-less) links
 * count as fully cleared, exactly as they do on their own.
 */
export function groupFigures(memberIds: string[], ledger: Ledger, tags: LedgerTag[]): GroupFigures {
  const byId = new Map(tags.map((t) => [String(t.id), t]));
  let owesMe = 0;
  let iOwe = 0;
  let pendingOwesMe = 0;
  let pendingIOwe = 0;
  let delta = 0;
  let count = 0;
  for (const id of memberIds) {
    const tag = byId.get(String(id));
    const fig = ledger.figures.get(String(id));
    if (!tag || !fig) continue;
    count += 1;
    delta += toPaise(fig.balanceDelta);
    if (fig.kind !== 'due') continue;
    if (tag.direction === 'OWES_ME') {
      owesMe += toPaise(tag.amount);
      pendingOwesMe += toPaise(fig.pendingAmount);
    } else {
      iOwe += toPaise(tag.amount);
      pendingIOwe += toPaise(fig.pendingAmount);
    }
  }
  const pending = pendingOwesMe + pendingIOwe;
  const cleared = owesMe + iOwe - pending;
  return {
    entryCount: count,
    totalAmount: fromPaise(owesMe - iOwe),
    owesMeAmount: fromPaise(owesMe),
    iOweAmount: fromPaise(iOwe),
    pendingOwesMe: fromPaise(pendingOwesMe),
    pendingIOwe: fromPaise(pendingIOwe),
    pendingNet: fromPaise(pendingOwesMe - pendingIOwe),
    clearedAmount: fromPaise(cleared),
    status: pending === 0 ? 'settled' : cleared <= 0 ? 'open' : 'partial',
    balanceDelta: fromPaise(delta),
  };
}
