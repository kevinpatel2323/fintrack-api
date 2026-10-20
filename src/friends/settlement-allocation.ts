/**
 * Money helpers and SQL fragments shared by the friend ledger
 * (`friend-ledger.ts`, where every settlement rule lives) and the queries that
 * aggregate balances in SQL (friend summary, dashboard).
 *
 * Money is compared in paise so that ₹0.10 + ₹0.20 is exactly ₹0.30.
 */

export const DUE_DIRECTIONS = ['OWES_ME', 'I_OWE'] as const;

export function toPaise(amount: number): number {
  return Math.round(Number(amount) * 100);
}

export function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

/**
 * A settlement's amount when the user paid it to the friend, 0 otherwise.
 * Reads the stored `settlement_side`, which FriendsService keeps in step with
 * what each settlement is applied to; NULL (legacy) reads as received.
 */
export function settlementPaidAmountSql(tagAlias: string): string {
  return `CASE WHEN ${tagAlias}.direction = 'SETTLEMENT' AND ${tagAlias}.settlement_side = 'paid'
    THEN ${tagAlias}.amount ELSE 0 END`;
}

/**
 * How much a tag's write-offs move the friend's balance, signed: writing off
 * part of what the friend owes lowers it, part of what the user owes raises
 * it, and absorbing settlement money on account undoes that much of the
 * settlement's own effect.
 */
export function writeOffAdjustmentSql(tagAlias: string): string {
  return `(SELECT COALESCE(SUM(w.amount), 0) FROM tag_write_offs w WHERE w.tag_id = ${tagAlias}.id)
    * CASE
        WHEN ${tagAlias}.direction = 'OWES_ME' THEN -1
        WHEN ${tagAlias}.direction = 'I_OWE' THEN 1
        WHEN ${tagAlias}.direction = 'SETTLEMENT' AND ${tagAlias}.settlement_side = 'paid' THEN -1
        WHEN ${tagAlias}.direction = 'SETTLEMENT' THEN 1
        ELSE 0
      END`;
}
