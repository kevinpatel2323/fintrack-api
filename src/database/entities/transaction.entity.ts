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
import { StatementImport } from './statement-import.entity';

const numericTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

@Entity({ name: 'transactions' })
export class Transaction {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @Column({ name: 'transaction_date', type: 'date' })
  transactionDate!: string;

  @Index()
  @Column({ name: 'account_id', type: 'bigint' })
  accountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account?: Account;

  @Index()
  @Column({ name: 'statement_import_id', type: 'bigint', nullable: true })
  statementImportId!: string | null;

  @ManyToOne(() => StatementImport, { nullable: true })
  @JoinColumn({ name: 'statement_import_id' })
  statementImport?: StatementImport | null;

  @Column({ type: 'text' })
  narration!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  withdrawal!: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  deposit!: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  balance!: number;

  @Column({ name: 'upi_name', type: 'text', nullable: true })
  upiName!: string | null;

  @Column({ name: 'upi_description', type: 'text', nullable: true })
  upiDescription!: string | null;

  @Column({ name: 'upi_bank', type: 'text', nullable: true })
  upiBank!: string | null;

  @Column({ name: 'is_manual', type: 'boolean', default: false })
  isManual!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
