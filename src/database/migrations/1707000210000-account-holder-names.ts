import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Account holder names: each bank account can carry the name of the person who
 * holds it ("Kevin Patel"), and the app shows that name wherever it would
 * otherwise print the account number.
 *
 * NULL means "not named yet" and the app falls back to the number; a name is
 * never blank. The number stays the account's identity — statements are still
 * matched to an account by it.
 */
export class AccountHolderNames1707000210000 implements MigrationInterface {
  name = 'AccountHolderNames1707000210000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE accounts
      ADD COLUMN IF NOT EXISTS holder_name TEXT;
    `);
    await queryRunner.query(`
      ALTER TABLE accounts
      ADD CONSTRAINT chk_accounts_holder_name_not_blank
        CHECK (holder_name IS NULL OR length(btrim(holder_name)) > 0);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE accounts DROP CONSTRAINT IF EXISTS chk_accounts_holder_name_not_blank;`,
    );
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS holder_name;`);
  }
}
