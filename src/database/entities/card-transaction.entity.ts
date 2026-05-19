import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Card } from './card.entity';
import { CardStatement } from './card-statement.entity';
import { Category } from './category.entity';

const numericTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

@Entity({ name: 'card_transactions' })
export class CardTransaction {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @Column({ name: 'card_id', type: 'bigint' })
  cardId!: string;

  @ManyToOne(() => Card, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_id' })
  card?: Card;

  @Index()
  @Column({ name: 'statement_id', type: 'bigint', nullable: true })
  statementId!: string | null;

  @ManyToOne(() => CardStatement, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'statement_id' })
  statement?: CardStatement | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  amount!: number;

  @Column({ type: 'text' })
  merchant!: string;

  @Index()
  @Column({ name: 'txn_date', type: 'date' })
  txnDate!: string;

  @Index()
  @Column({ name: 'category_id', type: 'bigint', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category?: Category | null;

  @Column({ name: 'is_refund', type: 'boolean', default: false })
  isRefund!: boolean;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
