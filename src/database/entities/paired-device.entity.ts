import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * An iPhone allowed to send bank SMS into transaction memos.
 *
 * A row starts as a pairing window: the web app issues a short code (only its
 * SHA-256 is kept) that the phone trades for a long-lived device key within ten
 * minutes. The key itself is never stored either, only its SHA-256, so a
 * database leak hands out nothing that can call the API. Revoking a device
 * stops its key at once; the row stays so its memos keep their device.
 */
@Entity({ name: 'paired_devices' })
export class PairedDevice {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  @Index({ unique: true })
  @Column({ name: 'token_sha256', type: 'text', nullable: true })
  tokenSha256!: string | null;

  @Column({ name: 'pair_code_sha256', type: 'text', nullable: true })
  pairCodeSha256!: string | null;

  @Column({ name: 'pair_expires_at', type: 'timestamptz', nullable: true })
  pairExpiresAt!: Date | null;

  @Column({ name: 'pair_attempts', type: 'integer', default: 0 })
  pairAttempts!: number;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  // How many messages the phone said were still waiting in its outbox on its
  // last call, so the web app can show a phone that has stopped getting through.
  @Column({ name: 'outbox_count', type: 'integer', nullable: true })
  outboxCount!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
