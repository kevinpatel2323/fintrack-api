import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Card } from './card.entity';

const numericTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

export type CardStatementStatus = 'open' | 'closed' | 'paid' | 'overdue';

@Entity({ name: 'card_statements' })
@Unique(['cardId', 'cycleStart'])
export class CardStatement {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @Column({ name: 'card_id', type: 'bigint' })
  cardId!: string;

  @ManyToOne(() => Card, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_id' })
  card?: Card;

  @Column({ name: 'cycle_start', type: 'date' })
  cycleStart!: string;

  @Column({ name: 'cycle_end', type: 'date' })
  cycleEnd!: string;

  @Index()
  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({
    name: 'total_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  totalAmount!: number;

  @Column({
    name: 'min_due',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  minDue!: number;

  @Column({
    name: 'paid_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  paidAmount!: number;

  @Index()
  @Column({
    type: 'enum',
    enum: ['open', 'closed', 'paid', 'overdue'],
    enumName: 'card_statement_status',
    default: 'open',
  })
  status!: CardStatementStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
