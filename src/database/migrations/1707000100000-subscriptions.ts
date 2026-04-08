import { MigrationInterface, QueryRunner } from 'typeorm';

export class Subscriptions1707000100000 implements MigrationInterface {
  name = 'Subscriptions1707000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE subscription_status AS ENUM ('active', 'paused', 'cancelled');
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        amount NUMERIC(14, 2) NOT NULL,
        rrule TEXT NOT NULL,
        dtstart DATE NOT NULL,
        exdates JSONB NOT NULL DEFAULT '[]'::jsonb,
        timezone TEXT,
        trial_ends_on DATE,
        trial_started_on DATE,
        is_trial BOOLEAN NOT NULL DEFAULT FALSE,
        status subscription_status NOT NULL DEFAULT 'active',
        notes TEXT,
        merchant_label TEXT,
        category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
        remind_days_before INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_dtstart ON subscriptions (dtstart);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_subscriptions_category ON subscriptions (category_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS subscriptions;`);
    await queryRunner.query(`DROP TYPE IF EXISTS subscription_status;`);
  }
}
