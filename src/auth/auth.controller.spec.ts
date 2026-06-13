import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { COOKIE_NAME } from './auth.constants';

function mockRes() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
}

describe('AuthController', () => {
  let webauthn: {
    getRegistrationOptions: jest.Mock;
    verifyRegistration: jest.Mock;
    getAuthenticationOptions: jest.Mock;
    verifyAuthentication: jest.Mock;
    listCredentials: jest.Mock;
    deleteCredential: jest.Mock;
    purgeExpiredChallenges: jest.Mock;
  };
  let sessions: {
    create: jest.Mock;
    destroy: jest.Mock;
    purgeExpired: jest.Mock;
  };
  let controller: AuthController;

  beforeEach(() => {
    process.env.SETUP_TOKEN = 'secret-token';
    process.env.RP_ORIGIN = 'http://localhost:3001';
    webauthn = {
      getRegistrationOptions: jest.fn().mockResolvedValue({ challenge: 'c' }),
      verifyRegistration: jest.fn(),
      getAuthenticationOptions: jest.fn().mockResolvedValue({ challenge: 'c' }),
      verifyAuthentication: jest.fn(),
      listCredentials: jest.fn().mockResolvedValue([]),
      deleteCredential: jest.fn().mockResolvedValue(undefined),
      purgeExpiredChallenges: jest.fn().mockResolvedValue(undefined),
    };
    sessions = {
      create: jest.fn().mockResolvedValue({
        token: 'raw-token',
        expiresAt: new Date(Date.now() + 3600_000),
      }),
      destroy: jest.fn().mockResolvedValue(undefined),
      purgeExpired: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AuthController(webauthn as never, sessions as never);
  });

  describe('register precondition', () => {
    it('rejects when there is no session and no setup token', async () => {
      await expect(
        controller.registerOptions({ headers: {} } as never),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(webauthn.getRegistrationOptions).not.toHaveBeenCalled();
    });

    it('allows with a valid setup-token header', async () => {
      const req = { headers: { 'x-setup-token': 'secret-token' } };
      await controller.registerOptions(req as never);
      expect(webauthn.getRegistrationOptions).toHaveBeenCalled();
    });

    it('allows with an active session', async () => {
      const req = { headers: {}, authSession: { id: '1' } };
      await controller.registerOptions(req as never);
      expect(webauthn.getRegistrationOptions).toHaveBeenCalled();
    });

    it('rejects with a wrong setup-token header', async () => {
      const req = { headers: { 'x-setup-token': 'wrong' } };
      await expect(
        controller.registerOptions(req as never),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('register verify (auto-login)', () => {
    it('mints a session and sets the cookie', async () => {
      webauthn.verifyRegistration.mockResolvedValue({ id: '5' });
      const res = mockRes();
      const req = { headers: { 'x-setup-token': 'secret-token' } };
      const out = await controller.registerVerify(
        req as never,
        { credential: {}, label: 'Mac' } as never,
        res as never,
      );
      expect(webauthn.verifyRegistration).toHaveBeenCalledWith({}, 'Mac');
      expect(sessions.create).toHaveBeenCalledWith('5');
      expect(res.cookie).toHaveBeenCalledWith(
        COOKIE_NAME,
        'raw-token',
        expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
      );
      expect(out).toEqual({ verified: true, expiresAt: expect.any(Date) });
    });
  });

  describe('login verify', () => {
    it('verifies, sets the cookie and purges expired rows', async () => {
      webauthn.verifyAuthentication.mockResolvedValue({ id: '9' });
      const res = mockRes();
      await controller.loginVerify({ credential: {} } as never, res as never);
      expect(sessions.create).toHaveBeenCalledWith('9');
      expect(res.cookie).toHaveBeenCalledWith(
        COOKIE_NAME,
        'raw-token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(sessions.purgeExpired).toHaveBeenCalled();
      expect(webauthn.purgeExpiredChallenges).toHaveBeenCalled();
    });
  });

  describe('session introspection', () => {
    it('reports authenticated when a session is attached', () => {
      const expiresAt = new Date();
      expect(controller.session({ authSession: { expiresAt } } as never)).toEqual(
        { authenticated: true, expiresAt },
      );
    });

    it('reports unauthenticated otherwise', () => {
      expect(controller.session({} as never)).toEqual({ authenticated: false });
    });
  });

  describe('logout', () => {
    it('destroys the session and clears the cookie', async () => {
      const res = mockRes();
      const req = { cookies: { [COOKIE_NAME]: 'raw-token' } };
      await controller.logout(req as never, res as never);
      expect(sessions.destroy).toHaveBeenCalledWith('raw-token');
      expect(res.clearCookie).toHaveBeenCalledWith(
        COOKIE_NAME,
        expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
      );
    });
  });

  describe('credential management', () => {
    it('delegates deletion (service enforces the last-credential 409)', async () => {
      await controller.deleteCredential('3');
      expect(webauthn.deleteCredential).toHaveBeenCalledWith('3');
    });
  });
});
