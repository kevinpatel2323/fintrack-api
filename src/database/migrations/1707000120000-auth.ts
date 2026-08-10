import { MigrationInterface, QueryRunner } from 'typeorm';

export class Auth1707000120000 implements MigrationInterface {
  name = 'Auth1707000120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enrolled passkeys. credential_id / public_key are base64url strings.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id BIGSERIAL PRIMARY KEY,
        credential_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        counter BIGINT NOT NULL DEFAULT 0,
        transports JSONB,
        device_type TEXT,
        backed_up BOOLEAN NOT NULL DEFAULT FALSE,
        label TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ
      );
    `);

    // Active sessions. Only the SHA-256 hex of the bearer token is stored.
    // expires_at is absolute; deleting a credential revokes its sessions.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id BIGSERIAL PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        credential_id BIGINT NOT NULL REFERENCES webauthn_credentials(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_auth_sessions_credential ON auth_sessions (credential_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at);`,
    );

    // Pending WebAuthn challenges (persisted because serverless lambdas share no
    // memory between the /options and /verify calls). Single-use, short-lived.
    // Guarded rather than bare: Postgres has no CREATE TYPE ... IF NOT EXISTS,
    // and this migration has to be re-runnable on a database where the auth
    // objects were applied by hand before the migration was recorded.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'webauthn_challenge_type'
        ) THEN
          CREATE TYPE webauthn_challenge_type
            AS ENUM ('registration', 'authentication');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webauthn_challenges (
        id BIGSERIAL PRIMARY KEY,
        challenge TEXT NOT NULL UNIQUE,
        type webauthn_challenge_type NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges (expires_at);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS webauthn_challenges;`);
    await queryRunner.query(`DROP TYPE IF EXISTS webauthn_challenge_type;`);
    await queryRunner.query(`DROP TABLE IF EXISTS auth_sessions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS webauthn_credentials;`);
  }
}
