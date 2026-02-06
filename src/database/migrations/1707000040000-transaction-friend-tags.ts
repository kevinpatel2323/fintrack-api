import { MigrationInterface, QueryRunner } from 'typeorm';

export class TransactionFriendTags1707000040000 implements MigrationInterface {
  name = 'TransactionFriendTags1707000040000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS transaction_friend_tags (
        id BIGSERIAL PRIMARY KEY,
        transaction_id BIGINT NOT NULL,
        friend_id BIGINT NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        direction TEXT NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_transaction_friend_tags_tx FOREIGN KEY (transaction_id) REFERENCES transactions(id),
        CONSTRAINT fk_transaction_friend_tags_friend FOREIGN KEY (friend_id) REFERENCES friends(id),
        CONSTRAINT uq_transaction_friend UNIQUE (transaction_id, friend_id)
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_transaction_friend_tags_tx ON transaction_friend_tags (transaction_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_transaction_friend_tags_friend ON transaction_friend_tags (friend_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS transaction_friend_tags;`);
  }
}
