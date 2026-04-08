import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Category } from './category.entity';

const numericTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';

@Entity({ name: 'subscriptions' })
export class Subscription {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer })
  amount!: number;

  /** RFC 5545 RRULE value without the `RRULE:` prefix, e.g. `FREQ=MONTHLY;BYMONTHDAY=15` */
  @Column({ type: 'text' })
  rrule!: string;

  @Index()
  @Column({ name: 'dtstart', type: 'date' })
  dtstart!: string;

  /** ISO date strings (YYYY-MM-DD) excluded from the recurrence */
  @Column({ name: 'exdates', type: 'jsonb' })
  exdates!: string[];

  @Column({ type: 'text', nullable: true })
  timezone!: string | null;

  @Column({ name: 'trial_ends_on', type: 'date', nullable: true })
  trialEndsOn!: string | null;

  @Column({ name: 'trial_started_on', type: 'date', nullable: true })
  trialStartedOn!: string | null;

  @Column({ name: 'is_trial', type: 'boolean', default: false })
  isTrial!: boolean;

  @Index()
  @Column({
    type: 'enum',
    enum: ['active', 'paused', 'cancelled'],
    enumName: 'subscription_status',
    default: 'active',
  })
  status!: SubscriptionStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'merchant_label', type: 'text', nullable: true })
  merchantLabel!: string | null;

  @Index()
  @Column({ name: 'category_id', type: 'bigint', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category?: Category | null;

  @Column({ name: 'remind_days_before', type: 'int', nullable: true })
  remindDaysBefore!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
