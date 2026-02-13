import { MigrationInterface, QueryRunner } from 'typeorm';

export class SettlementLinksManyToMany1707000060000 implements MigrationInterface {
  name = 'SettlementLinksManyToMany1707000060000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create junction table for many-to-many relationship between settlements and settled transactions
    await queryRunner.query(`
      CREATE TABLE settlement_links (
        id BIGSERIAL PRIMARY KEY,
        settlement_tag_id BIGINT NOT NULL,
        settled_tag_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_settlement_links_settlement FOREIGN KEY (settlement_tag_id) REFERENCES transaction_friend_tags(id) ON DELETE CASCADE,
        CONSTRAINT fk_settlement_links_settled FOREIGN KEY (settled_tag_id) REFERENCES transaction_friend_tags(id) ON DELETE CASCADE,
        CONSTRAINT uq_settlement_link UNIQUE (settlement_tag_id, settled_tag_id)
      );
    `);

    await queryRunner.query(
      `CREATE INDEX idx_settlement_links_settlement ON settlement_links (settlement_tag_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_settlement_links_settled ON settlement_links (settled_tag_id);`,
    );

    // Migrate existing data from linked_transaction_id to the new junction table
    await queryRunner.query(`
      INSERT INTO settlement_links (settlement_tag_id, settled_tag_id, created_at)
      SELECT id, linked_transaction_id, created_at
      FROM transaction_friend_tags
      WHERE linked_transaction_id IS NOT NULL;
    `);

    // Remove the old linked_transaction_id column and its constraints
    await queryRunner.query(`DROP INDEX IF EXISTS idx_transaction_friend_tags_linked;`);
    await queryRunner.query(`ALTER TABLE transaction_friend_tags DROP CONSTRAINT IF EXISTS fk_transaction_friend_tags_linked;`);
    await queryRunner.query(`ALTER TABLE transaction_friend_tags DROP COLUMN IF EXISTS linked_transaction_id;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the linked_transaction_id column
    await queryRunner.query(`
      ALTER TABLE transaction_friend_tags 
      ADD COLUMN linked_transaction_id BIGINT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE transaction_friend_tags 
      ADD CONSTRAINT fk_transaction_friend_tags_linked 
      FOREIGN KEY (linked_transaction_id) 
      REFERENCES transaction_friend_tags(id);
    `);

    await queryRunner.query(
      `CREATE INDEX idx_transaction_friend_tags_linked ON transaction_friend_tags (linked_transaction_id);`,
    );

    // Migrate data back (only first link if multiple exist)
    await queryRunner.query(`
      UPDATE transaction_friend_tags tft
      SET linked_transaction_id = (
        SELECT settled_tag_id 
        FROM settlement_links 
        WHERE settlement_tag_id = tft.id 
        LIMIT 1
      )
      WHERE EXISTS (
        SELECT 1 FROM settlement_links WHERE settlement_tag_id = tft.id
      );
    `);

    // Drop the junction table
    await queryRunner.query(`DROP INDEX IF EXISTS idx_settlement_links_settled;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_settlement_links_settlement;`);
    await queryRunner.query(`DROP TABLE IF EXISTS settlement_links;`);
  }
}
