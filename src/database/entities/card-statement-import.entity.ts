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
import { CardStatement } from './card-statement.entity';

const numericTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

@Entity({ name: 'card_statement_imports' })
@Unique(['cardId', 'statementDate'])
export class CardStatementImport {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @Column({ name: 'card_id', type: 'bigint' })
  cardId!: string;

  @ManyToOne(() => Card, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'card_id' })
  card?: Card;

  @Column({ name: 'statement_id', type: 'bigint', nullable: true })
  statementId!: string | null;

  @ManyToOne(() => CardStatement, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'statement_id' })
  statement?: CardStatement | null;

  @Column({ type: 'text' })
  filename!: string;

  @Column({ name: 'statement_date', type: 'date' })
  statementDate!: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({
    name: 'total_due',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  totalDue!: number;

  @Column({
    name: 'min_due',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  minDue!: number;

  @Column({ name: 'total_rows', type: 'integer', default: 0 })
  totalRows!: number;

  @Column({ name: 'inserted_rows', type: 'integer', default: 0 })
  insertedRows!: number;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt!: Date;
}
