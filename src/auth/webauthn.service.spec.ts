import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { WebauthnService } from './webauthn.service';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

jest.mock('@simplewebauthn/server/helpers', () => ({
  isoBase64URL: {
    fromBuffer: (b: Uint8Array) => `b64:${Buffer.from(b).toString('hex')}`,
    toBuffer: (s: string) => Buffer.from(String(s).replace('b64:', ''), 'hex'),
  },
}));

const clientData = (challenge: string) =>
  Buffer.from(JSON.stringify({ challenge })).toString('base64url');

describe('WebauthnService', () => {
  let credentials: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    delete: jest.Mock;
  };
  let challenges: { insert: jest.Mock };
  let dataSource: { query: jest.Mock };
  let svc: WebauthnService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RP_ID = 'localhost';
    process.env.RP_ORIGIN = 'http://localhost:3001';
    process.env.RP_NAME = 'Fintrack';
    credentials = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((x) => x),
      save: jest.fn().mockImplementation(async (x) => x),
      count: jest.fn(),
      delete: jest.fn(),
    };
    challenges = { insert: jest.fn().mockResolvedValue(undefined) };
    dataSource = { query: jest.fn() };
    svc = new WebauthnService(
      credentials as never,
      challenges as never,
      dataSource as never,
    );
  });

  describe('getRegistrationOptions', () => {
    it('persists the generated challenge', async () => {
      (generateRegistrationOptions as jest.Mock).mockResolvedValue({
        challenge: 'REGCHAL',
      });
      const opts = await svc.getRegistrationOptions();
      expect(opts.challenge).toBe('REGCHAL');
      expect(challenges.insert).toHaveBeenCalledWith(
        expect.objectContaining({ challenge: 'REGCHAL', type: 'registration' }),
      );
    });
  });

  describe('verifyRegistration', () => {
    it('consumes the signed challenge atomically and stores the credential', async () => {
      dataSource.query.mockResolvedValue([{ id: '1' }]);
      (verifyRegistrationResponse as jest.Mock).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'NEWID',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ['internal'],
          },
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
        },
      });

      const response = {
        id: 'NEWID',
        response: { clientDataJSON: clientData('REGCHAL'), transports: ['internal'] },
      };
      await svc.verifyRegistration(response as never, 'My Mac');

      // expectedChallenge comes from the consumed challenge (the signed one).
      expect(
        (verifyRegistrationResponse as jest.Mock).mock.calls[0][0]
          .expectedChallenge,
      ).toBe('REGCHAL');
      // Single-use atomic consume.
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM webauthn_challenges'),
        ['REGCHAL', 'registration'],
      );
      const stored = credentials.create.mock.calls[0][0];
      expect(stored.credentialId).toBe('NEWID');
      expect(stored.publicKey).toBe('b64:010203');
      expect(stored.counter).toBe(0);
      expect(stored.backedUp).toBe(true);
      expect(stored.label).toBe('My Mac');
    });

    it('rejects a consumed/expired challenge with 400', async () => {
      dataSource.query.mockResolvedValue([]); // nothing deleted
      const response = {
        id: 'X',
        response: { clientDataJSON: clientData('GONE') },
      };
      await expect(
        svc.verifyRegistration(response as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(verifyRegistrationResponse).not.toHaveBeenCalled();
    });
  });

  describe('verifyAuthentication', () => {
    const response = {
      id: 'CREDID',
      response: { clientDataJSON: clientData('AUTHCHAL') },
    };

    beforeEach(() => {
      credentials.findOne.mockResolvedValue({
        id: '5',
        credentialId: 'CREDID',
        publicKey: 'b64:010203',
        counter: 3,
        transports: ['internal'],
      });
      (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 7 },
      });
    });

    it('verifies against the consumed challenge and persists newCounter', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: '1' }]);
      const cred = await svc.verifyAuthentication(response as never);
      expect(
        (verifyAuthenticationResponse as jest.Mock).mock.calls[0][0]
          .expectedChallenge,
      ).toBe('AUTHCHAL');
      expect(cred.counter).toBe(7);
      expect(credentials.save).toHaveBeenCalledWith(
        expect.objectContaining({ counter: 7 }),
      );
      expect(cred.lastUsedAt).toBeInstanceOf(Date);
    });

    it('fails on a replayed challenge (second consume deletes nothing)', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: '1' }]).mockResolvedValueOnce([]);
      await svc.verifyAuthentication(response as never); // first use ok
      await expect(
        svc.verifyAuthentication(response as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getAuthenticationOptions', () => {
    it('persists the generated challenge', async () => {
      (generateAuthenticationOptions as jest.Mock).mockResolvedValue({
        challenge: 'AUTHCHAL',
      });
      const opts = await svc.getAuthenticationOptions();
      expect(opts.challenge).toBe('AUTHCHAL');
      expect(challenges.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          challenge: 'AUTHCHAL',
          type: 'authentication',
        }),
      );
    });
  });

  describe('deleteCredential', () => {
    it('refuses to remove the last credential (409)', async () => {
      credentials.count.mockResolvedValue(1);
      await expect(svc.deleteCredential('5')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(credentials.delete).not.toHaveBeenCalled();
    });

    it('removes a credential when others remain', async () => {
      credentials.count.mockResolvedValue(2);
      credentials.delete.mockResolvedValue({ affected: 1 });
      await expect(svc.deleteCredential('5')).resolves.toBeUndefined();
      expect(credentials.delete).toHaveBeenCalledWith({ id: '5' });
    });
  });
});
