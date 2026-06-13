import { createHash } from 'crypto';
import { SessionService } from './session.service';

function mockRepo() {
  return {
    insert: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

describe('SessionService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let svc: SessionService;

  beforeEach(() => {
    process.env.SESSION_TTL_MINUTES = '60';
    repo = mockRepo();
    svc = new SessionService(repo as never);
  });

  describe('create', () => {
    it('stores only the token hash, never the raw token', async () => {
      const { token } = await svc.create('42');
      const row = repo.insert.mock.calls[0][0];
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.tokenHash).not.toBe(token);
      expect(sha(token)).toBe(row.tokenHash);
      expect(row.credentialId).toBe('42');
    });

    it('sets an absolute expiry of now + TTL', async () => {
      const { expiresAt } = await svc.create('42');
      const expected = Date.now() + 60 * 60 * 1000;
      expect(Math.abs(expiresAt.getTime() - expected)).toBeLessThan(2000);
      expect(repo.insert.mock.calls[0][0].expiresAt.getTime()).toBe(
        expiresAt.getTime(),
      );
    });
  });

  describe('validate', () => {
    it('returns null for an absent token', async () => {
      expect(await svc.validate(undefined)).toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('looks up by hash and returns a live session without extending it', async () => {
      const future = new Date(Date.now() + 10_000);
      repo.findOne.mockResolvedValue({ id: '1', expiresAt: future });
      const session = await svc.validate('tok');
      expect(session).not.toBeNull();
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { tokenHash: sha('tok') },
      });
      // Absolute expiry: validation must not write anything back.
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('lazily deletes and rejects an expired session', async () => {
      repo.findOne.mockResolvedValue({
        id: '9',
        expiresAt: new Date(Date.now() - 1000),
      });
      expect(await svc.validate('tok')).toBeNull();
      expect(repo.delete).toHaveBeenCalledWith({ id: '9' });
    });

    it('returns null when no session matches', async () => {
      repo.findOne.mockResolvedValue(null);
      expect(await svc.validate('tok')).toBeNull();
    });
  });

  describe('destroy', () => {
    it('revokes by token hash', async () => {
      await svc.destroy('tok');
      expect(repo.delete).toHaveBeenCalledWith({ tokenHash: sha('tok') });
    });

    it('is a no-op for an absent token', async () => {
      await svc.destroy(undefined);
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  describe('purgeExpired', () => {
    it('deletes rows whose expiry has passed', async () => {
      await svc.purgeExpired();
      expect(repo.delete).toHaveBeenCalledTimes(1);
      expect(repo.delete.mock.calls[0][0]).toHaveProperty('expiresAt');
    });
  });
});
