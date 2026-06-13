import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WebauthnCredential } from './webauthn-credential.entity';

// An authenticated session. The raw bearer token is never stored — only its
// SHA-256 hex digest. `expires_at` is absolute (set once at mint time); it is
// never extended, so a session is good for exactly SESSION_TTL_MINUTES.
@Entity({ name: 'auth_sessions' })
export class AuthSession {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash!: string;

  @Index()
  @Column({ name: 'credential_id', type: 'bigint' })
  credentialId!: string;

  // Deleting a passkey cascades to its sessions (revokes them) — deliberate.
  @ManyToOne(() => WebauthnCredential, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'credential_id' })
  credential?: WebauthnCredential;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
