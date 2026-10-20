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

const nullableNumericTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

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

  /**
   * How much of the settlement was applied to the settled entry. NULL on links
   * made before amounts were recorded: those keep their old reading — entry
   * settled, settlement fully applied — and are never guessed at.
   */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  amount!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
