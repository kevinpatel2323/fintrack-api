import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTables1707060000000 implements MigrationInterface {
  name = 'CreateTables1707060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id BIGSERIAL PRIMARY KEY,
        account_number TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (transaction_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions (account_id, transaction_date);`,
    );
    await queryRunner.query(
      `ALTER TABLE transactions ADD CONSTRAINT fk_transactions_account FOREIGN KEY (account_id) REFERENCES accounts(id);`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS statement_imports (
        id BIGSERIAL PRIMARY KEY,
        source_bank TEXT NOT NULL DEFAULT 'HDFC',
        filename TEXT,
        account_id BIGINT,
        period_start DATE,
        period_end DATE,
        last_tx_date_before DATE,
        total_rows INT NOT NULL DEFAULT 0,
        inserted_rows INT NOT NULL DEFAULT 0,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_statement_imports_uploaded_at ON statement_imports (uploaded_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_statement_imports_account ON statement_imports (account_id);`,
    );
    await queryRunner.query(
      `ALTER TABLE statement_imports ADD CONSTRAINT fk_statement_imports_account FOREIGN KEY (account_id) REFERENCES accounts(id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS statement_imports;`);
    await queryRunner.query(`DROP TABLE IF EXISTS transactions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS accounts;`);
  }
}
