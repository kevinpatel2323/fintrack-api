import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconciliation tools on top of bill-wise settlement.
 *
 * `transaction_friend_tags.settlement_side` — which way a settlement's money
 * went: 'received' (the friend paid the user) or 'paid' (the user paid the
 * friend). It is derived from what the settlement is applied to — the larger
 * side of the entries it pays off, or the opposite of the settlement it
 * refunds — and stored so every balance query reads one column instead of
 * re-deriving it. NULL means a settlement linked before amounts existed, read
 * as 'received' exactly as before.
 *
 * `tag_write_offs` — closes a small leftover with a recorded reason (Tally's
 * round-off): part of an entry still pending, or settlement money on account.
 *
 * `friend_offsets` / `friend_offset_lines` — nets what a friend owes against
 * what the user owes them without any money moving. Each offset's lines on
 * the two sides add up to the same amount.
 *
 * Settlement links may now also point at another settlement: a refund of that
 * settlement's money on account. That needs no schema change.
 */
export class SettlementReconciliation1707000170000 implements MigrationInterface {
  name = 'SettlementReconciliation1707000170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE transaction_friend_tags
      ADD COLUMN IF NOT EXISTS settlement_side TEXT;
    `);
    await queryRunner.query(`
      ALTER TABLE transaction_friend_tags
      ADD CONSTRAINT chk_transaction_friend_tags_settlement_side
      CHECK (settlement_side IS NULL OR settlement_side IN ('received', 'paid'));
    `);
    // Settlements already allocated with amounts were single-sided, so any
    // amount on an I_OWE entry means the user paid. Settlements with any
    // amount-less (pre-allocation) link stay NULL.
    await queryRunner.query(`
      UPDATE transaction_friend_tags s
      SET settlement_side = CASE
        WHEN EXISTS (
          SELECT 1 FROM settlement_links l
          JOIN transaction_friend_tags d ON d.id = l.settled_tag_id
          WHERE l.settlement_tag_id = s.id AND l.amount IS NOT NULL AND d.direction = 'I_OWE'
        ) THEN 'paid'
        ELSE 'received'
      END
      WHERE s.direction = 'SETTLEMENT'
        AND NOT EXISTS (
          SELECT 1 FROM settlement_links l
          WHERE l.settlement_tag_id = s.id AND l.amount IS NULL
        );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tag_write_offs (
        id BIGSERIAL PRIMARY KEY,
        tag_id BIGINT NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_tag_write_offs_tag FOREIGN KEY (tag_id)
          REFERENCES transaction_friend_tags(id) ON DELETE CASCADE,
        CONSTRAINT chk_tag_write_offs_amount_positive CHECK (amount > 0)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_tag_write_offs_tag ON tag_write_offs (tag_id);`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS friend_offsets (
        id BIGSERIAL PRIMARY KEY,
        friend_id BIGINT NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_friend_offsets_friend FOREIGN KEY (friend_id)
          REFERENCES friends(id) ON DELETE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_friend_offsets_friend ON friend_offsets (friend_id);`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS friend_offset_lines (
        id BIGSERIAL PRIMARY KEY,
        offset_id BIGINT NOT NULL,
        tag_id BIGINT NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        CONSTRAINT fk_friend_offset_lines_offset FOREIGN KEY (offset_id)
          REFERENCES friend_offsets(id) ON DELETE CASCADE,
        CONSTRAINT fk_friend_offset_lines_tag FOREIGN KEY (tag_id)
          REFERENCES transaction_friend_tags(id) ON DELETE CASCADE,
        CONSTRAINT chk_friend_offset_lines_amount_positive CHECK (amount > 0),
        CONSTRAINT uq_friend_offset_line UNIQUE (offset_id, tag_id)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_friend_offset_lines_tag ON friend_offset_lines (tag_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS friend_offset_lines;`);
    await queryRunner.query(`DROP TABLE IF EXISTS friend_offsets;`);
    await queryRunner.query(`DROP TABLE IF EXISTS tag_write_offs;`);
    await queryRunner.query(
      `ALTER TABLE transaction_friend_tags DROP CONSTRAINT IF EXISTS chk_transaction_friend_tags_settlement_side;`,
    );
    await queryRunner.query(
      `ALTER TABLE transaction_friend_tags DROP COLUMN IF EXISTS settlement_side;`,
    );
  }
}
