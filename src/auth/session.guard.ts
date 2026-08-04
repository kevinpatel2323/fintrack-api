import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SessionService } from './session.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { COOKIE_NAME, isAuthDisabled } from './auth.constants';
import type { AuthSession } from '../database/entities/auth-session.entity';

type AuthedRequest = Request & {
  authSession?: AuthSession;
  cookies?: Record<string, string>;
};

// Global guard. It always parses the cookie and attaches req.authSession when
// the session is valid (so even @Public routes can introspect auth state), then
// enforces: @Public routes pass; everything else requires a valid session.
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isAuthDisabled()) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[COOKIE_NAME];
    const session = await this.sessions.validate(token);
    if (session) req.authSession = session;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (!session) throw new UnauthorizedException('Authentication required');
    return true;
  }
}
