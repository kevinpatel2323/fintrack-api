import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFriendsAndTags1707063000000 implements MigrationInterface {
  name = 'AddFriendsAndTags1707063000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS friends (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_friends_name ON friends (name);`);

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
    await queryRunner.query(`DROP TABLE IF EXISTS friends;`);
  }
}
