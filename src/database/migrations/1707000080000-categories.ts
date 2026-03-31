import { MigrationInterface, QueryRunner } from 'typeorm';

export class Categories1707000080000 implements MigrationInterface {
  name = 'Categories1707000080000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        icon TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS category_id BIGINT
          REFERENCES categories(id) ON DELETE SET NULL;
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_transactions_category;`);
    await queryRunner.query(`ALTER TABLE transactions DROP COLUMN IF EXISTS category_id;`);
    await queryRunner.query(`DROP TABLE IF EXISTS categories;`);
  }
}
