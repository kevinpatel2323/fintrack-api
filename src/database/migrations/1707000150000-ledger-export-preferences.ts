import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remembers which friend tags belong in an exported ledger.
 *
 * The export picker has always let you uncheck rows, but the choice died with
 * the modal. `ledger_included` is that choice made durable:
 *
 *   NULL   no saved choice — the export includes the row by default
 *   TRUE   pinned in
 *   FALSE  pinned out
 *
 * Nullable rather than `NOT NULL DEFAULT TRUE` on purpose: "never decided" and
 * "decided to include" have to stay distinguishable, otherwise the UI cannot
 * show which rows the user actually pinned.
 *
 * The partial index only covers pinned rows, which is the minority and the
 * only set anything ever filters on.
 */
export class LedgerExportPreferences1707000150000 implements MigrationInterface {
  name = 'LedgerExportPreferences1707000150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE transaction_friend_tags
      ADD COLUMN IF NOT EXISTS ledger_included BOOLEAN;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_transaction_friend_tags_ledger_included
      ON transaction_friend_tags (friend_id, ledger_included)
      WHERE ledger_included IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_transaction_friend_tags_ledger_included;`,
    );
    await queryRunner.query(
      `ALTER TABLE transaction_friend_tags DROP COLUMN IF EXISTS ledger_included;`,
    );
  }
}
