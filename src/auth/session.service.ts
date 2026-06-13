import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { randomBytes, createHash } from 'crypto';
import { AuthSession } from '../database/entities/auth-session.entity';
import { sessionTtlMinutes } from './auth.constants';

export interface MintedSession {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
  ) {}

  // The raw token is what goes in the cookie; only its hash is ever persisted.
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // Mint a new session bound to a credential. expires_at is absolute and set
  // once here — it is never extended on subsequent validations.
  async create(credentialId: string): Promise<MintedSession> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + sessionTtlMinutes() * 60 * 1000);
    await this.sessions.insert({
      tokenHash: this.hash(token),
      credentialId,
      expiresAt,
    });
    return { token, expiresAt };
  }

  // Look up a session by raw token. Returns null for missing/expired tokens.
  // Expired rows are deleted lazily here; validity never extends the expiry.
  async validate(token: string | undefined): Promise<AuthSession | null> {
    if (!token) return null;
    const session = await this.sessions.findOne({
      where: { tokenHash: this.hash(token) },
    });
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessions.delete({ id: session.id });
      return null;
    }
    return session;
  }

  // Revoke a single session (logout). No-op if the token is unknown.
  async destroy(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.sessions.delete({ tokenHash: this.hash(token) });
  }

  // Best-effort cleanup of expired rows. Called at login time only (cheap, and
  // gentle on the small connection pool).
  async purgeExpired(): Promise<void> {
    await this.sessions.delete({ expiresAt: LessThan(new Date()) });
  }
}
