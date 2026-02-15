import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManualFlag1707000070000 implements MigrationInterface {
  name = 'AddManualFlag1707000070000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT FALSE;`,
    );
    await queryRunner.query(
      `INSERT INTO accounts (account_number)
       SELECT 'Wallet'
       WHERE NOT EXISTS (
         SELECT 1 FROM accounts WHERE account_number = 'Wallet'
       );`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE transactions DROP COLUMN IF EXISTS is_manual;`);
    await queryRunner.query(`DELETE FROM accounts WHERE account_number = 'Wallet';`);
  }
}
