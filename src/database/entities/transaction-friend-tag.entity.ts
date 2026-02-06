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
import { Friend } from './friend.entity';

const numericTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

export enum TransactionFriendDirection {
  IOwe = 'I_OWE',
  OwesMe = 'OWES_ME',
}

@Entity({ name: 'transaction_friend_tags' })
@Index(['transactionId', 'friendId'], { unique: true })
export class TransactionFriendTag {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @Column({ name: 'transaction_id', type: 'bigint' })
  transactionId!: string;

  @ManyToOne(() => Transaction)
  @JoinColumn({ name: 'transaction_id' })
  transaction?: Transaction;

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
