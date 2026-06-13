import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { WebauthnCredential } from '../database/entities/webauthn-credential.entity';
import { WebauthnChallenge } from '../database/entities/webauthn-challenge.entity';
import {
  CHALLENGE_TTL_MS,
  USER_HANDLE,
  USER_NAME,
} from './auth.constants';

@Injectable()
export class WebauthnService {
  constructor(
    @InjectRepository(WebauthnCredential)
    private readonly credentials: Repository<WebauthnCredential>,
    @InjectRepository(WebauthnChallenge)
    private readonly challenges: Repository<WebauthnChallenge>,
    private readonly dataSource: DataSource,
  ) {}

  private get rpID(): string {
    const id = process.env.RP_ID;
    if (!id) throw new Error('RP_ID is not configured');
    return id;
  }

  private get rpName(): string {
    return process.env.RP_NAME || 'Fintrack';
  }

  // RP_ORIGIN may be a comma-separated list (e.g. multiple deploy aliases).
  private get origins(): string[] {
    return (process.env.RP_ORIGIN || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  // ── Registration ──────────────────────────────────────────────────────────

  async getRegistrationOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const existing = await this.credentials.find();
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userID: USER_HANDLE,
      userName: USER_NAME,
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports ?? undefined,
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
    });
    await this.persistChallenge(options.challenge, 'registration');
    return options;
  }

  async verifyRegistration(
    response: RegistrationResponseJSON,
    label?: string,
  ): Promise<WebauthnCredential> {
    const expectedChallenge = await this.consumeChallenge(response, 'registration');

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origins,
      expectedRPID: this.rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Passkey registration could not be verified');
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    const entity = this.credentials.create({
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? response.response.transports ?? null,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      label: label?.trim() || null,
    });
    return this.credentials.save(entity);
  }

  // ── Authentication ──────────────────────────────────────────────────────────

  async getAuthenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const existing = await this.credentials.find();
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'preferred',
      allowCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports ?? undefined,
      })),
    });
    await this.persistChallenge(options.challenge, 'authentication');
    return options;
  }

  // Verifies an assertion and returns the matched credential (with refreshed
  // counter persisted). Throws 401 on any failure — no existence leaks.
  async verifyAuthentication(
    response: AuthenticationResponseJSON,
  ): Promise<WebauthnCredential> {
    const expectedChallenge = await this.consumeChallenge(response, 'authentication');

    const credential = await this.credentials.findOne({
      where: { credentialId: response.id },
    });
    if (!credential) {
      throw new UnauthorizedException('Authentication failed');
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpID,
        requireUserVerification: false,
        credential: {
          id: credential.credentialId,
          publicKey: isoBase64URL.toBuffer(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports ?? undefined,
        },
      });
    } catch {
      throw new UnauthorizedException('Authentication failed');
    }

    if (!verification.verified) {
      throw new UnauthorizedException('Authentication failed');
    }

    // Persist the new counter verbatim (Apple passkeys legitimately stay at 0).
    credential.counter = verification.authenticationInfo.newCounter;
    credential.lastUsedAt = new Date();
    await this.credentials.save(credential);
    return credential;
  }

  // ── Credential management ────────────────────────────────────────────────────

  async listCredentials() {
    const rows = await this.credentials.find({ order: { createdAt: 'ASC' } });
    return rows.map((c) => ({
      id: c.id,
      label: c.label,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
      deviceType: c.deviceType,
      backedUp: c.backedUp,
    }));
  }

  // Refuses to delete the last remaining credential (would lock the user out).
  async deleteCredential(id: string): Promise<void> {
    const total = await this.credentials.count();
    if (total <= 1) {
      throw new ConflictException(
        'Cannot remove your only passkey — enroll another first',
      );
    }
    const result = await this.credentials.delete({ id });
    if (!result.affected) {
      throw new BadRequestException('Passkey not found');
    }
  }

  // ── Challenges ───────────────────────────────────────────────────────────────

  private async persistChallenge(
    challenge: string,
    type: 'registration' | 'authentication',
  ): Promise<void> {
    await this.challenges.insert({
      challenge,
      type,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
  }

  // Atomically consume the challenge the client actually signed. We read it from
  // the signed clientDataJSON, then DELETE ... RETURNING so a challenge can be
  // used exactly once even under concurrent serverless invocations. Zero rows
  // deleted (expired or replayed) → 400.
  private async consumeChallenge(
    response: RegistrationResponseJSON | AuthenticationResponseJSON,
    type: 'registration' | 'authentication',
  ): Promise<string> {
    const clientData = JSON.parse(
      Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'),
    ) as { challenge?: string };
    const challenge = clientData.challenge;
    if (!challenge) {
      throw new BadRequestException('Malformed authentication response');
    }
    const rows = await this.dataSource.query(
      `DELETE FROM webauthn_challenges
         WHERE challenge = $1 AND type = $2 AND expires_at > NOW()
         RETURNING id`,
      [challenge, type],
    );
    if (!rows || rows.length === 0) {
      throw new BadRequestException('Challenge expired or already used');
    }
    return challenge;
  }

  // Best-effort cleanup of stale challenges, called at login time only.
  async purgeExpiredChallenges(): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM webauthn_challenges WHERE expires_at <= NOW()`,
    );
  }
}
