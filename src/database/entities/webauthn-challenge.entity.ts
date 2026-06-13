import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type WebauthnChallengeType = 'registration' | 'authentication';

// A pending WebAuthn challenge. Persisted (not in-memory) because Vercel lambdas
// share no memory between the /options and /verify calls. Single-use: consumed
// atomically with a DELETE ... RETURNING at verify time.
@Entity({ name: 'webauthn_challenges' })
export class WebauthnChallenge {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'text', unique: true })
  challenge!: string;

  @Column({
    type: 'enum',
    enum: ['registration', 'authentication'],
    enumName: 'webauthn_challenge_type',
  })
  type!: WebauthnChallengeType;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
