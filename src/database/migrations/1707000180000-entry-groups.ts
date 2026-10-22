import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Entry groups: several of a friend's entries bundled under one title, e.g.
 * "Ketul's wedding" for the grocery, outfit and bhano entries around it.
 *
 * The entries themselves are untouched — each still hangs off its own bank or
 * card transaction and keeps its own settlement links, netting and write-offs.
 * A group only names them as one; its total, paid and pending amounts are
 * always derived from its entries, so grouping can never move a balance.
 * Deleting a group (ungrouping) leaves every entry exactly as it was.
 */
export class EntryGroups1707000180000 implements MigrationInterface {
  name = 'EntryGroups1707000180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS entry_groups (
        id BIGSERIAL PRIMARY KEY,
        friend_id BIGINT NOT NULL,
        title TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_entry_groups_friend FOREIGN KEY (friend_id)
          REFERENCES friends(id) ON DELETE CASCADE,
        CONSTRAINT chk_entry_groups_title_not_blank CHECK (length(btrim(title)) > 0)
      );
    `);
    // One title per friend, ignoring case, so "Ketul's wedding" is never two groups.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_entry_groups_friend_title
      ON entry_groups (friend_id, lower(btrim(title)));
    `);
    await queryRunner.query(`
      ALTER TABLE transaction_friend_tags
      ADD COLUMN IF NOT EXISTS entry_group_id BIGINT;
    `);
    await queryRunner.query(`
      ALTER TABLE transaction_friend_tags
      ADD CONSTRAINT fk_transaction_friend_tags_entry_group FOREIGN KEY (entry_group_id)
        REFERENCES entry_groups(id) ON DELETE SET NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_transaction_friend_tags_entry_group
      ON transaction_friend_tags (entry_group_id)
      WHERE entry_group_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_transaction_friend_tags_entry_group;`);
    await queryRunner.query(
      `ALTER TABLE transaction_friend_tags DROP CONSTRAINT IF EXISTS fk_transaction_friend_tags_entry_group;`,
    );
    await queryRunner.query(`ALTER TABLE transaction_friend_tags DROP COLUMN IF EXISTS entry_group_id;`);
    await queryRunner.query(`DROP TABLE IF EXISTS entry_groups;`);
  }
}
