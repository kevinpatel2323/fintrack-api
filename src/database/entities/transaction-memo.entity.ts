import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PairedDevice } from './paired-device.entity';
import { Card } from './card.entity';

const numericTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

export type MemoDirection = 'debit' | 'credit';
export type MemoChannel =
  | 'upi'
  | 'card'
  | 'imps'
  | 'neft'
  | 'rtgs'
  | 'atm'
  | 'netbanking'
  | 'charge'
  | 'mandate';
export type MemoInstrument = 'card' | 'account';
export type MemoParseStatus = 'parsed' | 'partial' | 'unreadable';

/**
 * A bank, UPI or card SMS captured on the user's iPhone, with the short memo
 * they typed when it arrived ("phone case for Het") so the spend is easy to
 * recognise when the real accounts are written up.
 *
 * Everything except the id and created_at is nullable on purpose: banks word
 * their SMS in endless ways, and a row is still worth keeping when only part of
 * it reads. The SMS itself and the location are stored sealed (AES-256-GCM, see
 * transaction-memos/secret-box.ts); the parsed fields are plain so the list can
 * sort and search them. Memos are reference notes only — they never create or
 * change a transaction.
 */
@Entity({ name: 'transaction_memos' })
export class TransactionMemo {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  // The phone's id for this SMS. Re-sending it (retries, a memo typed after the
  // first send) updates the same row instead of adding another.
  @Index({ unique: true })
  @Column({ name: 'submission_id', type: 'text', nullable: true })
  submissionId!: string | null;

  // SHA-256 of sender + message + arrival time: catches the same SMS sent under
  // two submission ids, e.g. when two automations fire for one message.
  @Index({ unique: true })
  @Column({ name: 'content_hash', type: 'text', nullable: true })
  contentHash!: string | null;

  @Index()
  @Column({ name: 'device_id', type: 'bigint', nullable: true })
  deviceId!: string | null;

  @ManyToOne(() => PairedDevice, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'device_id' })
  device?: PairedDevice | null;

  @Column({ name: 'received_at', type: 'timestamptz', nullable: true })
  receivedAt!: Date | null;

  @Column({ name: 'captured_at', type: 'timestamptz', nullable: true })
  capturedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  sender!: string | null;

  // True only for a registered bank SMS header (e.g. VM-HDFCBK). Anyone can
  // text a message that looks like a bank's, so the UI flags the rest.
  @Column({ name: 'sender_verified', type: 'boolean', nullable: true })
  senderVerified!: boolean | null;

  @Column({ name: 'raw_message_sealed', type: 'text', nullable: true })
  rawMessageSealed!: string | null;

  @Column({ type: 'text', nullable: true })
  memo!: string | null;

  @Column({ name: 'memo_at', type: 'timestamptz', nullable: true })
  memoAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  direction!: MemoDirection | null;

  @Column({ type: 'text', nullable: true })
  channel!: MemoChannel | null;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  amount!: number | null;

  @Column({ type: 'text', nullable: true })
  currency!: string | null;

  @Column({ type: 'text', nullable: true })
  bank!: string | null;

  @Column({ type: 'text', nullable: true })
  instrument!: MemoInstrument | null;

  @Column({ type: 'text', nullable: true })
  last4!: string | null;

  @Column({ type: 'text', nullable: true })
  merchant!: string | null;

  @Column({ type: 'text', nullable: true })
  vpa!: string | null;

  @Column({ type: 'text', nullable: true })
  reference!: string | null;

  @Column({ name: 'txn_date', type: 'date', nullable: true })
  txnDate!: string | null;

  @Column({ name: 'card_id', type: 'bigint', nullable: true })
  cardId!: string | null;

  @ManyToOne(() => Card, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'card_id' })
  card?: Card | null;

  @Column({ name: 'location_sealed', type: 'text', nullable: true })
  locationSealed!: string | null;

  @Column({ name: 'location_status', type: 'text', nullable: true })
  locationStatus!: string | null;

  @Column({ name: 'parse_status', type: 'text', nullable: true })
  parseStatus!: MemoParseStatus | null;

  @Column({ name: 'parse_error', type: 'text', nullable: true })
  parseError!: string | null;

  @Column({ name: 'parser_version', type: 'integer', nullable: true })
  parserVersion!: number | null;

  @Column({ name: 'shortcut_version', type: 'text', nullable: true })
  shortcutVersion!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;
}
