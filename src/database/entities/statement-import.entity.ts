import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from './account.entity';

@Entity({ name: 'statement_imports' })
export class StatementImport {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'source_bank', type: 'text', default: 'HDFC' })
  sourceBank!: string;

  @Column({ type: 'text', nullable: true })
  filename!: string | null;

  @Column({ name: 'account_id', type: 'bigint', nullable: true })
  accountId!: string | null;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account?: Account | null;

  @Column({ name: 'period_start', type: 'date', nullable: true })
  periodStart!: string | null;

  @Column({ name: 'period_end', type: 'date', nullable: true })
  periodEnd!: string | null;

  @Column({ name: 'last_tx_date_before', type: 'date', nullable: true })
  lastTxDateBefore!: string | null;

  @Column({ name: 'total_rows', type: 'int', default: 0 })
  totalRows!: number;

  @Column({ name: 'inserted_rows', type: 'int', default: 0 })
  insertedRows!: number;

  @Index()
  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt!: Date;
}
