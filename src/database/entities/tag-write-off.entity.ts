import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TransactionFriendTag } from './transaction-friend-tag.entity';

const numericTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

/**
 * Closes a small leftover with a recorded reason — Tally's round-off. On an
 * entry it forgives part of what is pending; on a settlement it absorbs money
 * left on account. Either way the friend's balance moves by exactly `amount`.
 */
@Entity({ name: 'tag_write_offs' })
export class TagWriteOff {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @Column({ name: 'tag_id', type: 'bigint' })
  tagId!: string;

  @ManyToOne(() => TransactionFriendTag, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tag_id' })
  tag?: TransactionFriendTag;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  amount!: number;

  @Column({ type: 'text' })
  reason!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
