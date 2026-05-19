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

const numericTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

@Entity({ name: 'card_payments' })
export class CardPayment {
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

  @Index()
  @Column({ name: 'paid_on', type: 'date' })
  paidOn!: string;

  @Column({ name: 'via_label', type: 'text', nullable: true })
  viaLabel!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
