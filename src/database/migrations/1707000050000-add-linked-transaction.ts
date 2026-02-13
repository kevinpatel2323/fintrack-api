import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLinkedTransaction1707000050000 implements MigrationInterface {
  name = 'AddLinkedTransaction1707000050000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add linked_transaction_id column with self-referencing FK
    await queryRunner.query(`
      ALTER TABLE transaction_friend_tags 
      ADD COLUMN linked_transaction_id BIGINT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE transaction_friend_tags 
      ADD CONSTRAINT fk_transaction_friend_tags_linked 
      FOREIGN KEY (linked_transaction_id) 
      REFERENCES transaction_friend_tags(id);
    `);

    await queryRunner.query(
      `CREATE INDEX idx_transaction_friend_tags_linked ON transaction_friend_tags (linked_transaction_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_transaction_friend_tags_linked;`);
    await queryRunner.query(`ALTER TABLE transaction_friend_tags DROP CONSTRAINT IF EXISTS fk_transaction_friend_tags_linked;`);
    await queryRunner.query(`ALTER TABLE transaction_friend_tags DROP COLUMN IF EXISTS linked_transaction_id;`);
  }
}
