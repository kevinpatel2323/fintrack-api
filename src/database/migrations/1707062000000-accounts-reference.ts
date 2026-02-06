import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountsReference1707062000000 implements MigrationInterface {
  name = 'AccountsReference1707062000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: superseded by initial creation which already contains the final schema.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op: superseded by initial creation which already contains the final schema.
  }
}
