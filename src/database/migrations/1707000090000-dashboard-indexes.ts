import { MigrationInterface, QueryRunner } from 'typeorm';

export class DashboardIndexes1707000090000 implements MigrationInterface {
  name = 'DashboardIndexes1707000090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index for date range + account filtering
    // Optimizes queries like: WHERE transaction_date BETWEEN ? AND ? AND account_id = ?
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_date_account 
      ON transactions(transaction_date, account_id);
    `);

    // Composite index for category aggregation queries with date filtering
    // Optimizes queries like: WHERE category_id = ? AND transaction_date BETWEEN ? AND ? AND withdrawal > 0
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_category_date_withdrawal 
      ON transactions(category_id, transaction_date) 
      WHERE withdrawal > 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_transactions_category_date_withdrawal;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_transactions_date_account;`);
  }
}
