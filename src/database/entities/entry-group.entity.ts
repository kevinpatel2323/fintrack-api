import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Friend } from './friend.entity';

/**
 * Several of a friend's entries bundled under one title ("Ketul's wedding").
 * The entries keep everything of their own; the group's totals are always
 * derived from them (see `groupFigures` in friends/friend-ledger.ts), so
 * grouping never moves a balance and ungrouping loses nothing.
 */
@Entity({ name: 'entry_groups' })
export class EntryGroup {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @Column({ name: 'friend_id', type: 'bigint' })
  friendId!: string;

  @ManyToOne(() => Friend, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'friend_id' })
  friend?: Friend;

  @Column({ type: 'text' })
  title!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
