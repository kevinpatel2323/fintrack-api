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

@Entity({ name: 'settlement_links' })
@Index(['settlementTagId', 'settledTagId'], { unique: true })
export class SettlementLink {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @Column({ name: 'settlement_tag_id', type: 'bigint' })
  settlementTagId!: string;

  @ManyToOne(() => TransactionFriendTag)
  @JoinColumn({ name: 'settlement_tag_id' })
  settlementTag?: TransactionFriendTag;

  @Index()
  @Column({ name: 'settled_tag_id', type: 'bigint' })
  settledTagId!: string;

  @ManyToOne(() => TransactionFriendTag)
  @JoinColumn({ name: 'settled_tag_id' })
  settledTag?: TransactionFriendTag;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
