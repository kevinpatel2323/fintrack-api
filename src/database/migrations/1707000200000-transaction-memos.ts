import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Transaction memos: bank, UPI and card SMS captured on the user's iPhone, each
 * with the short memo typed when it arrived, plus the paired devices allowed to
 * send them.
 *
 * Every memo column but id and created_at is nullable and there are no CHECK
 * constraints on the parsed fields, so an SMS in a wording the parser has never
 * seen still lands (as parse_status 'unreadable') instead of being refused.
 * Device keys and pairing codes are kept only as SHA-256 digests; the SMS text
 * and location are stored sealed by the application.
 *
 * Numbered 1707000200000, not 190000: an abandoned card-alerts branch left a
 * compiled 1707000190000 migration in dist/, and it was never applied.
 */
export class TransactionMemos1707000200000 implements MigrationInterface {
  name = 'TransactionMemos1707000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS paired_devices (
        id BIGSERIAL PRIMARY KEY,
        name TEXT,
        token_sha256 TEXT,
        pair_code_sha256 TEXT,
        pair_expires_at TIMESTAMPTZ,
        pair_attempts INTEGER NOT NULL DEFAULT 0,
        last_used_at TIMESTAMPTZ,
        outbox_count INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_paired_devices_token_sha256
      ON paired_devices (token_sha256);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS transaction_memos (
        id BIGSERIAL PRIMARY KEY,
        submission_id TEXT,
        content_hash TEXT,
        device_id BIGINT,
        received_at TIMESTAMPTZ,
        captured_at TIMESTAMPTZ,
        sender TEXT,
        sender_verified BOOLEAN,
        raw_message_sealed TEXT,
        memo TEXT,
        memo_at TIMESTAMPTZ,
        direction TEXT,
        channel TEXT,
        amount NUMERIC(14,2),
        currency TEXT,
        bank TEXT,
        instrument TEXT,
        last4 TEXT,
        merchant TEXT,
        vpa TEXT,
        reference TEXT,
        txn_date DATE,
        card_id BIGINT,
        location_sealed TEXT,
        location_status TEXT,
        parse_status TEXT,
        parse_error TEXT,
        parser_version INTEGER,
        shortcut_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ,
        CONSTRAINT fk_transaction_memos_device FOREIGN KEY (device_id)
          REFERENCES paired_devices(id) ON DELETE SET NULL,
        CONSTRAINT fk_transaction_memos_card FOREIGN KEY (card_id)
          REFERENCES cards(id) ON DELETE SET NULL
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_memos_submission_id
      ON transaction_memos (submission_id);
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_memos_content_hash
      ON transaction_memos (content_hash);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_transaction_memos_device
      ON transaction_memos (device_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_transaction_memos_created
      ON transaction_memos (created_at DESC);
    `);
    // The "No memo" tab and the nav badge count these.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_transaction_memos_without_memo
      ON transaction_memos (created_at DESC)
      WHERE memo IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS transaction_memos;`);
    await queryRunner.query(`DROP TABLE IF EXISTS paired_devices;`);
  }
}
