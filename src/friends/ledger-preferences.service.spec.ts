import { NotFoundException, ValidationPipe } from '@nestjs/common';
import { In } from 'typeorm';
import { FriendsService } from './friends.service';
import { UpdateLedgerPreferencesDto } from './dto/update-ledger-preferences.dto';

/**
 * `included: null` is the wire form of "forget this pin", so it has to survive
 * the global pipe's whitelist rather than being stripped into an omission that
 * means something else.
 */
describe('UpdateLedgerPreferencesDto through the global validation pipe', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });
  const meta = { type: 'body' as const, metatype: UpdateLedgerPreferencesDto };

  it('keeps null, both booleans and an omitted value, and coerces string ids', async () => {
    const out = (await pipe.transform(
      {
        preferences: [
          { tagId: '12', included: null },
          { tagId: 3, included: true },
          { tagId: 4, included: false },
          { tagId: 5 },
        ],
      },
      meta,
    )) as UpdateLedgerPreferencesDto;

    expect(out.preferences).toEqual([
      { tagId: 12, included: null },
      { tagId: 3, included: true },
      { tagId: 4, included: false },
      { tagId: 5 },
    ]);
  });

  it('rejects a non-boolean included', async () => {
    await expect(
      pipe.transform({ preferences: [{ tagId: 1, included: 'yes' }] }, meta),
    ).rejects.toThrow();
  });

  it('rejects a stray property', async () => {
    await expect(
      pipe.transform({ preferences: [{ tagId: 1, nope: 1 }] }, meta),
    ).rejects.toThrow();
  });
});

/**
 * Covers only `updateLedgerPreferences`, which is pure repository choreography:
 * ownership check, dedupe, then one UPDATE per distinct value.
 */
describe('FriendsService.updateLedgerPreferences', () => {
  let friendRepository: { findOne: jest.Mock };
  let tagRepository: { find: jest.Mock; update: jest.Mock };
  let service: FriendsService;

  const asService = (...args: unknown[]) =>
    new (FriendsService as unknown as new (...a: unknown[]) => FriendsService)(
      ...args,
    );

  beforeEach(() => {
    friendRepository = { findOne: jest.fn().mockResolvedValue({ id: '7' }) };
    tagRepository = {
      find: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service = asService(friendRepository, tagRepository, {}, {}, {});
  });

  const ownsTags = (...ids: string[]) =>
    tagRepository.find.mockResolvedValue(ids.map((id) => ({ id })));

  it('rejects an unknown friend before touching any tag', async () => {
    friendRepository.findOne.mockResolvedValue(null);

    await expect(
      service.updateLedgerPreferences('7', {
        preferences: [{ tagId: 1, included: false }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tagRepository.update).not.toHaveBeenCalled();
  });

  it('is a no-op for an empty batch', async () => {
    const result = await service.updateLedgerPreferences('7', {
      preferences: [],
    });

    expect(result).toEqual({ updated: 0 });
    expect(tagRepository.find).not.toHaveBeenCalled();
    expect(tagRepository.update).not.toHaveBeenCalled();
  });

  // A tag belonging to another friend means the caller is confused; writing the
  // rest of the batch anyway would leave a half-applied selection behind.
  it('rejects the whole batch when a tag belongs to another friend', async () => {
    ownsTags('1'); // asked for 1 and 2, only 1 came back

    await expect(
      service.updateLedgerPreferences('7', {
        preferences: [
          { tagId: 1, included: true },
          { tagId: 2, included: true },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tagRepository.update).not.toHaveBeenCalled();
  });

  it('scopes the ownership lookup to the friend', async () => {
    ownsTags('1');

    await service.updateLedgerPreferences('7', {
      preferences: [{ tagId: 1, included: false }],
    });

    expect(tagRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: In(['1']), friendId: '7' } }),
    );
  });

  it('groups the batch into one update per distinct value', async () => {
    ownsTags('1', '2', '3', '4');

    const result = await service.updateLedgerPreferences('7', {
      preferences: [
        { tagId: 1, included: true },
        { tagId: 2, included: false },
        { tagId: 3, included: true },
        { tagId: 4, included: null },
      ],
    });

    expect(result).toEqual({ updated: 4 });
    expect(tagRepository.update).toHaveBeenCalledTimes(3);
    expect(tagRepository.update).toHaveBeenCalledWith(
      { id: In(['1', '3']) },
      { ledgerIncluded: true },
    );
    expect(tagRepository.update).toHaveBeenCalledWith(
      { id: In(['2']) },
      { ledgerIncluded: false },
    );
    expect(tagRepository.update).toHaveBeenCalledWith(
      { id: In(['4']) },
      { ledgerIncluded: null },
    );
  });

  // An omitted `included` is how the picker says "forget this pin".
  it('treats an omitted value as clearing the pin', async () => {
    ownsTags('5');

    await service.updateLedgerPreferences('7', {
      preferences: [{ tagId: 5 }],
    });

    expect(tagRepository.update).toHaveBeenCalledWith(
      { id: In(['5']) },
      { ledgerIncluded: null },
    );
  });

  it('keeps the last entry when a tag is sent twice', async () => {
    ownsTags('9');

    const result = await service.updateLedgerPreferences('7', {
      preferences: [
        { tagId: 9, included: true },
        { tagId: 9, included: false },
      ],
    });

    expect(result).toEqual({ updated: 1 });
    expect(tagRepository.update).toHaveBeenCalledTimes(1);
    expect(tagRepository.update).toHaveBeenCalledWith(
      { id: In(['9']) },
      { ledgerIncluded: false },
    );
  });
});
