import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Friend } from './friend.entity';
import { TransactionFriendTag } from './transaction-friend-tag.entity';

const numericTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

/**
 * Nets what a friend owes against what the user owes them, with no money
 * moving. The lines on the OWES_ME side and the I_OWE side add up to the same
 * amount, so an offset never changes the balance — only which entries count
 * as cleared.
 */
@Entity({ name: 'friend_offsets' })
export class FriendOffset {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @Column({ name: 'friend_id', type: 'bigint' })
  friendId!: string;

  @ManyToOne(() => Friend, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'friend_id' })
  friend?: Friend;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @OneToMany(() => FriendOffsetLine, (line) => line.offset, { cascade: true })
  lines?: FriendOffsetLine[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity({ name: 'friend_offset_lines' })
export class FriendOffsetLine {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @Column({ name: 'offset_id', type: 'bigint' })
  offsetId!: string;

  @ManyToOne(() => FriendOffset, (offset) => offset.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offset_id' })
  offset?: FriendOffset;

  @Index()
  @Column({ name: 'tag_id', type: 'bigint' })
  tagId!: string;

  @ManyToOne(() => TransactionFriendTag, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tag_id' })
  tag?: TransactionFriendTag;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  amount!: number;
}
