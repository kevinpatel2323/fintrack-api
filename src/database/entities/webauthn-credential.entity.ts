import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

// WebAuthn signature counters are unsigned 32-bit at the protocol level but are
// stored BIGINT for headroom; they comfortably fit a JS number.
const counterTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number(value)),
};

// A single enrolled passkey. The public key + credential id are stored as
// base64url strings (never plain base64 — padding mismatches break lookups).
@Entity({ name: 'webauthn_credentials' })
export class WebauthnCredential {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'credential_id', type: 'text', unique: true })
  credentialId!: string;

  @Column({ name: 'public_key', type: 'text' })
  publicKey!: string;

  @Column({ type: 'bigint', default: 0, transformer: counterTransformer })
  counter!: number;

  @Column({ type: 'jsonb', nullable: true })
  transports!: AuthenticatorTransportFuture[] | null;

  @Column({ name: 'device_type', type: 'text', nullable: true })
  deviceType!: string | null;

  @Column({ name: 'backed_up', type: 'boolean', default: false })
  backedUp!: boolean;

  @Column({ type: 'text', nullable: true })
  label!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;
}
