import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Defence-in-depth against CSRF. SameSite=Strict on the session cookie is the
// primary control; this guard adds an Origin allowlist check for state-changing
// methods. A present-but-disallowed Origin is rejected; an absent Origin (curl,
// server-to-server, tests) is allowed through.
@Injectable()
export class OriginCsrfGuard implements CanActivate {
  private get allowed(): string[] {
    return (process.env.RP_ORIGIN || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!MUTATING_METHODS.has(req.method)) return true;

    const origin = req.headers.origin;
    if (!origin) return true;
    if (this.allowed.includes(origin)) return true;

    throw new ForbiddenException('Cross-origin request rejected');
  }
}
