import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SessionGuard } from './session.guard';
import { COOKIE_NAME } from './auth.constants';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('SessionGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let sessions: { validate: jest.Mock };
  let guard: SessionGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    sessions = { validate: jest.fn() };
    guard = new SessionGuard(reflector as never, sessions as never);
  });

  it('allows @Public routes even without a session', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    sessions.validate.mockResolvedValue(null);
    const req: Record<string, unknown> = { cookies: {} };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
  });

  it('attaches req.authSession on a public route when the cookie is valid', async () => {
    const session = { id: '1' };
    reflector.getAllAndOverride.mockReturnValue(true);
    sessions.validate.mockResolvedValue(session);
    const req: Record<string, unknown> = {
      cookies: { [COOKIE_NAME]: 'tok' },
    };
    await guard.canActivate(makeContext(req));
    expect(req.authSession).toBe(session);
    expect(sessions.validate).toHaveBeenCalledWith('tok');
  });

  it('rejects a protected route with a missing cookie', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    sessions.validate.mockResolvedValue(null);
    await expect(
      guard.canActivate(makeContext({ cookies: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a protected route with a garbage/expired cookie', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    sessions.validate.mockResolvedValue(null); // service treats expired/garbage as null
    await expect(
      guard.canActivate(makeContext({ cookies: { [COOKIE_NAME]: 'nope' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows a protected route with a valid session', async () => {
    const session = { id: '7' };
    reflector.getAllAndOverride.mockReturnValue(false);
    sessions.validate.mockResolvedValue(session);
    const req: Record<string, unknown> = {
      cookies: { [COOKIE_NAME]: 'tok' },
    };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req.authSession).toBe(session);
  });
});
