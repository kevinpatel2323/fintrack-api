import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Transaction } from './transaction.entity';
import { CardTransaction } from './card-transaction.entity';
import { Friend } from './friend.entity';
import { EntryGroup } from './entry-group.entity';

const numericTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

export enum TransactionFriendDirection {
  IOwe = 'I_OWE',
  OwesMe = 'OWES_ME',
  NothingOutstanding = 'NOTHING_OUTSTANDING',
  Settlement = 'SETTLEMENT',
}

/**
 * A friend tag hangs off exactly one subject: a bank transaction or a card
 * transaction. The either/or is enforced in the database by
 * `chk_transaction_friend_tags_subject`; the uniqueness of (subject, friend)
 * by a partial unique index per kind, so it is not declared here.
 */
@Entity({ name: 'transaction_friend_tags' })
export class TransactionFriendTag {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @Column({ name: 'transaction_id', type: 'bigint', nullable: true })
  transactionId!: string | null;

  @ManyToOne(() => Transaction, { nullable: true })
  @JoinColumn({ name: 'transaction_id' })
  transaction?: Transaction | null;

  @Index()
  @Column({ name: 'card_transaction_id', type: 'bigint', nullable: true })
  cardTransactionId!: string | null;

  @ManyToOne(() => CardTransaction, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_transaction_id' })
  cardTransaction?: CardTransaction | null;

  @Index()
  @Column({ name: 'friend_id', type: 'bigint' })
  friendId!: string;

  @ManyToOne(() => Friend)
  @JoinColumn({ name: 'friend_id' })
  friend?: Friend;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  amount!: number;

  @Column({ type: 'text' })
  direction!: TransactionFriendDirection;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /**
   * A remembered include/exclude choice for the friend's exported ledger.
   *
   * NULL means "no saved choice" — the export still includes the tag, but the
   * decision was never pinned, so re-opening the export picker leaves it free
   * to follow the default. TRUE/FALSE are the pinned answers and survive
   * across exports.
   */
  @Column({ name: 'ledger_included', type: 'boolean', nullable: true })
  ledgerIncluded!: boolean | null;

  /**
   * SETTLEMENT only: which way the money went — 'received' (the friend paid
   * the user) or 'paid'. Derived from what the settlement is applied to and
   * kept in step by FriendsService on every change, so balance queries read
   * one column. NULL on settlements linked before amounts existed, which read
   * as 'received', as they always have.
   */
  @Column({ name: 'settlement_side', type: 'text', nullable: true })
  settlementSide!: 'received' | 'paid' | null;

  /**
   * The entry group this entry is bundled into, if any ("Ketul's wedding").
   * Only entries (OWES_ME / I_OWE / NOTHING_OUTSTANDING) are grouped, never
   * settlements. NULL means ungrouped.
   */
  @Index()
  @Column({ name: 'entry_group_id', type: 'bigint', nullable: true })
  entryGroupId!: string | null;

  @ManyToOne(() => EntryGroup, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'entry_group_id' })
  entryGroup?: EntryGroup | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
