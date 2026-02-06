import { MigrationInterface, QueryRunner } from 'typeorm';

export class StatementImports1707000010000 implements MigrationInterface {
  name = 'StatementImports1707000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_statement_imports_account FOREIGN KEY (account_id) REFERENCES accounts(id)
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_statement_imports_uploaded_at ON statement_imports (uploaded_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_statement_imports_account ON statement_imports (account_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS statement_imports;`);
  }
}
