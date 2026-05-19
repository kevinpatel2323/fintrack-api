import { MigrationInterface, QueryRunner } from 'typeorm';

export class Cards1707000110000 implements MigrationInterface {
  name = 'Cards1707000110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE card_kind AS ENUM ('credit', 'debit');`);
    await queryRunner.query(
      `CREATE TYPE card_statement_status AS ENUM ('open', 'closed', 'paid', 'overdue');`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS cards (
        id BIGSERIAL PRIMARY KEY,
        kind card_kind NOT NULL,
        bank TEXT NOT NULL,
        network TEXT NOT NULL,
        name TEXT NOT NULL,
        nickname TEXT,
        last4 TEXT NOT NULL,
        expiry_month INTEGER NOT NULL,
        expiry_year INTEGER NOT NULL,
        holder TEXT,
        palette TEXT NOT NULL DEFAULT 'obsidian',

        credit_limit NUMERIC(14, 2),
        statement_day INTEGER,
        due_day INTEGER,

        linked_account_number TEXT,
        daily_limit NUMERIC(14, 2),
        atm_limit NUMERIC(14, 2),

        points_label TEXT,
        points_balance INTEGER NOT NULL DEFAULT 0,
        points_value NUMERIC(14, 2) NOT NULL DEFAULT 0,

        frozen BOOLEAN NOT NULL DEFAULT FALSE,
        online_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        contactless_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        international_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,

        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT chk_cards_expiry_month CHECK (expiry_month BETWEEN 1 AND 12),
        CONSTRAINT chk_cards_statement_day CHECK (statement_day IS NULL OR statement_day BETWEEN 1 AND 31),
        CONSTRAINT chk_cards_due_day CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31)
      );
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_cards_kind ON cards (kind);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_cards_bank ON cards (bank);`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_cards_primary ON cards ((1)) WHERE is_primary = TRUE;`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS card_statements (
        id BIGSERIAL PRIMARY KEY,
        card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        cycle_start DATE NOT NULL,
        cycle_end DATE NOT NULL,
        due_date DATE NOT NULL,
        total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        min_due NUMERIC(14, 2) NOT NULL DEFAULT 0,
        paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        status card_statement_status NOT NULL DEFAULT 'open',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(card_id, cycle_start)
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_statements_card ON card_statements (card_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_statements_due ON card_statements (due_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_statements_status ON card_statements (status);`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS card_transactions (
        id BIGSERIAL PRIMARY KEY,
        card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        statement_id BIGINT REFERENCES card_statements(id) ON DELETE SET NULL,
        amount NUMERIC(14, 2) NOT NULL,
        merchant TEXT NOT NULL,
        txn_date DATE NOT NULL,
        category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
        is_refund BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_transactions_card ON card_transactions (card_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_transactions_statement ON card_transactions (statement_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_transactions_date ON card_transactions (txn_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_transactions_category ON card_transactions (category_id);`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS card_payments (
        id BIGSERIAL PRIMARY KEY,
        card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        statement_id BIGINT REFERENCES card_statements(id) ON DELETE SET NULL,
        amount NUMERIC(14, 2) NOT NULL,
        paid_on DATE NOT NULL,
        via_label TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_payments_card ON card_payments (card_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_payments_statement ON card_payments (statement_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_card_payments_date ON card_payments (paid_on);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS card_payments;`);
    await queryRunner.query(`DROP TABLE IF EXISTS card_transactions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS card_statements;`);
    await queryRunner.query(`DROP TABLE IF EXISTS cards;`);
    await queryRunner.query(`DROP TYPE IF EXISTS card_statement_status;`);
    await queryRunner.query(`DROP TYPE IF EXISTS card_kind;`);
  }
}
