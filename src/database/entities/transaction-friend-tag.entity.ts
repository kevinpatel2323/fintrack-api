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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
