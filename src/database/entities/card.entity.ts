import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

const numericTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

const numericNonNullTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

export type CardKind = 'credit' | 'debit';

@Entity({ name: 'cards' })
export class Card {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index()
  @Column({ type: 'enum', enum: ['credit', 'debit'], enumName: 'card_kind' })
  kind!: CardKind;

  @Index()
  @Column({ type: 'text' })
  bank!: string;

  @Column({ type: 'text' })
  network!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  nickname!: string | null;

  @Column({ type: 'text' })
  last4!: string;

  @Column({ name: 'expiry_month', type: 'int' })
  expiryMonth!: number;

  @Column({ name: 'expiry_year', type: 'int' })
  expiryYear!: number;

  @Column({ type: 'text', nullable: true })
  holder!: string | null;

  @Column({ type: 'text', default: 'obsidian' })
  palette!: string;

  @Column({
    name: 'credit_limit',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  creditLimit!: number | null;

  @Column({ name: 'statement_day', type: 'int', nullable: true })
  statementDay!: number | null;

  @Column({ name: 'due_day', type: 'int', nullable: true })
  dueDay!: number | null;

  @Column({ name: 'linked_account_number', type: 'text', nullable: true })
  linkedAccountNumber!: string | null;

  @Column({
    name: 'daily_limit',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  dailyLimit!: number | null;

  @Column({
    name: 'atm_limit',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  atmLimit!: number | null;

  @Column({ name: 'points_label', type: 'text', nullable: true })
  pointsLabel!: string | null;

  @Column({ name: 'points_balance', type: 'int', default: 0 })
  pointsBalance!: number;

  @Column({
    name: 'points_value',
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericNonNullTransformer,
  })
  pointsValue!: number;

  @Column({ type: 'boolean', default: false })
  frozen!: boolean;

  @Column({ name: 'online_enabled', type: 'boolean', default: true })
  onlineEnabled!: boolean;

  @Column({ name: 'contactless_enabled', type: 'boolean', default: true })
  contactlessEnabled!: boolean;

  @Column({ name: 'international_enabled', type: 'boolean', default: false })
  internationalEnabled!: boolean;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
