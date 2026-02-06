import { MigrationInterface, QueryRunner } from 'typeorm';

export class Transactions1707000020000 implements MigrationInterface {
  name = 'Transactions1707000020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id BIGSERIAL PRIMARY KEY,
        transaction_date DATE NOT NULL,
        account_id BIGINT NOT NULL,
        narration TEXT NOT NULL,
        withdrawal NUMERIC(14,2) NOT NULL DEFAULT 0,
        deposit NUMERIC(14,2) NOT NULL DEFAULT 0,
        balance NUMERIC(14,2) NOT NULL DEFAULT 0,
        upi_name TEXT,
        upi_description TEXT,
        upi_bank TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        statement_import_id BIGINT,
        CONSTRAINT fk_transactions_account FOREIGN KEY (account_id) REFERENCES accounts(id),
        CONSTRAINT fk_transactions_statement_import FOREIGN KEY (statement_import_id) REFERENCES statement_imports(id)
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (transaction_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions (account_id, transaction_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_statement_import ON transactions (statement_import_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS transactions;`);
  }
}
