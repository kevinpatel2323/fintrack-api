import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { WebauthnService } from './webauthn.service';
import { SessionService } from './session.service';
import { Public } from './public.decorator';
import { isValidSetupToken } from './setup-token.util';
import { COOKIE_NAME, sessionTtlMinutes } from './auth.constants';
import { VerifyAuthenticationDto, VerifyRegistrationDto } from './dto/auth.dto';
import type { AuthSession } from '../database/entities/auth-session.entity';

type AuthedRequest = Request & {
  authSession?: AuthSession;
  cookies?: Record<string, string>;
};

// Auth endpoints are tighter-throttled than the rest of the app.
@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(
    private readonly webauthn: WebauthnService,
    private readonly sessions: SessionService,
  ) {}

  // ── Registration (enroll a passkey) ──────────────────────────────────────

  @Public()
  @Post('register/options')
  async registerOptions(@Req() req: AuthedRequest) {
    this.assertCanRegister(req);
    return this.webauthn.getRegistrationOptions();
  }

  @Public()
  @Post('register/verify')
  async registerVerify(
    @Req() req: AuthedRequest,
    @Body() dto: VerifyRegistrationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertCanRegister(req);
    const credential = await this.webauthn.verifyRegistration(
      dto.credential as unknown as RegistrationResponseJSON,
      dto.label,
    );
    // Auto-login: enrolling a passkey immediately mints a session.
    const { token, expiresAt } = await this.sessions.create(credential.id);
    this.setSessionCookie(res, token);
    return { verified: true, expiresAt };
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  @Public()
  @Post('login/options')
  async loginOptions() {
    return this.webauthn.getAuthenticationOptions();
  }

  @Public()
  @Post('login/verify')
  async loginVerify(
    @Body() dto: VerifyAuthenticationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const credential = await this.webauthn.verifyAuthentication(
      dto.credential as unknown as AuthenticationResponseJSON,
    );
    const { token, expiresAt } = await this.sessions.create(credential.id);
    this.setSessionCookie(res, token);
    // Lazy cleanup at login time only — gentle on the small connection pool.
    await Promise.all([
      this.sessions.purgeExpired(),
      this.webauthn.purgeExpiredChallenges(),
    ]).catch(() => undefined);
    return { verified: true, expiresAt };
  }

  // ── Session introspection / logout ────────────────────────────────────────

  // Always 200 — the SPA boot check reads this without generating 401 noise.
  @Public()
  @Get('session')
  session(@Req() req: AuthedRequest) {
    if (req.authSession) {
      return { authenticated: true, expiresAt: req.authSession.expiresAt };
    }
    return { authenticated: false };
  }

  @Post('logout')
  async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessions.destroy(req.cookies?.[COOKIE_NAME]);
    this.clearSessionCookie(res);
    return { ok: true };
  }

  // ── Credential management (protected) ─────────────────────────────────────

  @Get('credentials')
  listCredentials() {
    return this.webauthn.listCredentials();
  }

  @Delete('credentials/:id')
  async deleteCredential(@Param('id') id: string) {
    await this.webauthn.deleteCredential(id);
    return { ok: true };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Enrolling a passkey requires either an existing session or the break-glass
  // SETUP_TOKEN header. Generic 401 on failure — no hint about which is missing.
  private assertCanRegister(req: AuthedRequest): void {
    if (req.authSession) return;
    if (isValidSetupToken(req.headers['x-setup-token'] as string | undefined)) {
      return;
    }
    throw new UnauthorizedException('Setup token or active session required');
  }

  // Secure only over https — Safari rejects a Secure cookie on http://localhost,
  // which would break local dev. No Domain attribute → host-only cookie scoped
  // to the web origin that proxies /api.
  private cookieSecure(): boolean {
    const first = (process.env.RP_ORIGIN || '').split(',')[0].trim();
    return first.startsWith('https');
  }

  private setSessionCookie(res: Response, token: string): void {
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.cookieSecure(),
      path: '/',
      maxAge: sessionTtlMinutes() * 60 * 1000,
    });
  }

  private clearSessionCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.cookieSecure(),
      path: '/',
    });
  }
}
