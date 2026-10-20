import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bill-wise settlement: how much of a settlement went to each entry it settles.
 *
 * A settlement link used to say only *that* a payment settled an entry, never
 * *how much* of it. A payment that covers part of a friend's dues — or one due
 * paid off over several payments — could not be recorded. `amount` is the
 * share of the settlement applied to that entry; what an entry still has
 * pending, and what a settlement still has unapplied ("on account"), are both
 * derived from it.
 *
 *   NULL      a link made before amounts existed. Read exactly as before: the
 *             entry counts as settled and the settlement as fully applied.
 *   > 0       the amount applied to that entry.
 *
 * Existing links are deliberately not backfilled. Their amounts were never
 * recorded, and several do not add up (a ₹150 payment linked to a ₹2,000
 * entry), so any guessed number would rewrite history.
 */
export class SettlementAllocationAmounts1707000160000 implements MigrationInterface {
  name = 'SettlementAllocationAmounts1707000160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE settlement_links
      ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2);
    `);
    await queryRunner.query(`
      ALTER TABLE settlement_links
      ADD CONSTRAINT chk_settlement_links_amount_positive
      CHECK (amount IS NULL OR amount > 0);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE settlement_links DROP CONSTRAINT IF EXISTS chk_settlement_links_amount_positive;`,
    );
    await queryRunner.query(`ALTER TABLE settlement_links DROP COLUMN IF EXISTS amount;`);
  }
}
