import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a friend tag hang off a card transaction as well as a bank transaction.
 *
 * `transaction_friend_tags` becomes polymorphic. The live database also
 * carries a "manual" tag variant (`manual_date` and friends, guarded by
 * `chk_transaction_or_manual`) that predates the repo's migrations, so the
 * subject check is rebuilt to allow all three kinds — bank, card, manual — and
 * is generated dynamically because those manual columns do not exist on a
 * database provisioned purely from this migration series.
 *
 * The old `(transaction_id, friend_id)` uniqueness is a table CONSTRAINT, not
 * a bare index, and is replaced by one partial unique index per subject kind:
 * a composite over nullable columns would not stop the same friend being
 * tagged twice on one card transaction.
 */
export class CardTransactionFriendTags1707000140000
  implements MigrationInterface
{
  name = 'CardTransactionFriendTags1707000140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE transaction_friend_tags ALTER COLUMN transaction_id DROP NOT NULL;`,
    );

    await queryRunner.query(`
      ALTER TABLE transaction_friend_tags
      ADD COLUMN IF NOT EXISTS card_transaction_id BIGINT
      REFERENCES card_transactions(id) ON DELETE CASCADE;
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_transaction_friend_tags_card_tx ON transaction_friend_tags (card_transaction_id);`,
    );

    // Drop the old (transaction_id, friend_id) uniqueness however it was
    // declared — as a table constraint here, but as a TypeORM-named index on
    // databases built from the entity.
    await queryRunner.query(`
      DO $$
      DECLARE obj TEXT;
      BEGIN
        FOR obj IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'transaction_friend_tags'::regclass
            AND contype = 'u'
            AND pg_get_constraintdef(oid) ILIKE '%(transaction_id, friend_id)%'
        LOOP
          EXECUTE format(
            'ALTER TABLE transaction_friend_tags DROP CONSTRAINT %I', obj);
        END LOOP;

        FOR obj IN
          SELECT indexname FROM pg_indexes
          WHERE tablename = 'transaction_friend_tags'
            AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
            AND indexdef ILIKE '%(transaction_id, friend_id)%'
        LOOP
          EXECUTE format('DROP INDEX IF EXISTS %I', obj);
        END LOOP;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_friend_tags_tx_friend
      ON transaction_friend_tags (transaction_id, friend_id)
      WHERE transaction_id IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_friend_tags_card_tx_friend
      ON transaction_friend_tags (card_transaction_id, friend_id)
      WHERE card_transaction_id IS NOT NULL;
    `);

    // Exactly one subject per tag. The manual arm is only included when this
    // database actually has the manual columns.
    await queryRunner.query(`
      DO $$
      DECLARE
        has_manual BOOLEAN;
        expr TEXT;
      BEGIN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'transaction_friend_tags'
            AND column_name = 'manual_date'
        ) INTO has_manual;

        ALTER TABLE transaction_friend_tags
          DROP CONSTRAINT IF EXISTS chk_transaction_or_manual;
        ALTER TABLE transaction_friend_tags
          DROP CONSTRAINT IF EXISTS chk_transaction_friend_tags_subject;

        IF has_manual THEN
          expr := '('
            || '(transaction_id IS NOT NULL AND card_transaction_id IS NULL AND manual_date IS NULL)'
            || ' OR (card_transaction_id IS NOT NULL AND transaction_id IS NULL AND manual_date IS NULL)'
            || ' OR (transaction_id IS NULL AND card_transaction_id IS NULL AND manual_date IS NOT NULL)'
            || ')';
        ELSE
          expr := '(num_nonnulls(transaction_id, card_transaction_id) = 1)';
        END IF;

        EXECUTE format(
          'ALTER TABLE transaction_friend_tags ADD CONSTRAINT chk_transaction_friend_tags_subject CHECK %s',
          expr);
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Card-backed tags have no home in the old shape.
    await queryRunner.query(
      `DELETE FROM transaction_friend_tags WHERE card_transaction_id IS NOT NULL;`,
    );

    await queryRunner.query(
      `ALTER TABLE transaction_friend_tags DROP CONSTRAINT IF EXISTS chk_transaction_friend_tags_subject;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_transaction_friend_tags_card_tx_friend;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_transaction_friend_tags_tx_friend;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_transaction_friend_tags_card_tx;`,
    );
    await queryRunner.query(
      `ALTER TABLE transaction_friend_tags DROP COLUMN IF EXISTS card_transaction_id;`,
    );
    await queryRunner.query(`
      ALTER TABLE transaction_friend_tags
      ADD CONSTRAINT uq_transaction_friend UNIQUE (transaction_id, friend_id);
    `);

    // Restore the manual-tag check where those columns exist.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'transaction_friend_tags'
            AND column_name = 'manual_date'
        ) THEN
          ALTER TABLE transaction_friend_tags
            ADD CONSTRAINT chk_transaction_or_manual CHECK (
              (transaction_id IS NOT NULL AND manual_date IS NULL AND manual_description IS NULL)
              OR (transaction_id IS NULL AND manual_date IS NOT NULL)
            );
        END IF;
      END $$;
    `);
  }
}
