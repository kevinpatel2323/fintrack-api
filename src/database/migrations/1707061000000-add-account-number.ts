import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountNumber1707061000000 implements MigrationInterface {
  name = 'AddAccountNumber1707061000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: superseded by accounts reference migration.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op: superseded by accounts reference migration.
  }
}
