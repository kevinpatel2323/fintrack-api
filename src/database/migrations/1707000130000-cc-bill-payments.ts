import { MigrationInterface, QueryRunner } from 'typeorm';

export class CcBillPayments1707000130000 implements MigrationInterface {
  name = 'CcBillPayments1707000130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS card_statement_imports (
        id BIGSERIAL PRIMARY KEY,
        card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        statement_id BIGINT REFERENCES card_statements(id) ON DELETE SET NULL,
        filename TEXT NOT NULL,
        statement_date DATE NOT NULL,
        due_date DATE,
        total_due NUMERIC(14, 2) NOT NULL DEFAULT 0,
        min_due NUMERIC(14, 2) NOT NULL DEFAULT 0,
        total_rows INTEGER NOT NULL DEFAULT 0,
        inserted_rows INTEGER NOT NULL DEFAULT 0,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(card_id, statement_date)
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_statement_imports_card ON card_statement_imports (card_id);`,
    );

    await queryRunner.query(
      `ALTER TABLE card_payments ADD COLUMN IF NOT EXISTS bank_transaction_id BIGINT REFERENCES transactions(id) ON DELETE RESTRICT;`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_card_payments_bank_transaction ON card_payments (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;`,
    );

    await queryRunner.query(
      `ALTER TABLE card_transactions ADD COLUMN IF NOT EXISTS paid_by_payment_id BIGINT REFERENCES card_payments(id) ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_transactions_paid_by ON card_transactions (paid_by_payment_id);`,
    );

    await queryRunner.query(
      `ALTER TABLE card_transactions ADD COLUMN IF NOT EXISTS card_import_id BIGINT REFERENCES card_statement_imports(id) ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_transactions_import ON card_transactions (card_import_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE card_transactions DROP COLUMN IF EXISTS card_import_id;`,
    );
    await queryRunner.query(
      `ALTER TABLE card_transactions DROP COLUMN IF EXISTS paid_by_payment_id;`,
    );
    await queryRunner.query(
      `ALTER TABLE card_payments DROP COLUMN IF EXISTS bank_transaction_id;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS card_statement_imports;`);
  }
}
