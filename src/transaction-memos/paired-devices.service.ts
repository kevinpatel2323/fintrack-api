import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { PairedDevice } from '../database/entities/paired-device.entity';
import { safeEqual } from '../auth/setup-token.util';
import {
  PAIR_MAX_ATTEMPTS,
  PAIR_WINDOW_MS,
  formatPairCode,
  newDeviceKey,
  newPairCode,
  normalisePairCode,
  sha256Hex,
} from './device-credentials';

export type DeviceStatus = 'pairing' | 'active' | 'revoked' | 'expired';

// last_used_at is only rewritten when it is this stale, so a burst of SMS does
// not turn every request into a write.
const TOUCH_AFTER_MS = 60_000;

/**
 * Pairing, authenticating and revoking the iPhones that send bank SMS.
 *
 * Pairing: the web app (behind a passkey session) opens a ten-minute window
 * with a one-time code; the phone trades the code for a device key exactly once.
 * Five wrong codes close every open window. Neither the code nor the key is
 * stored, only their SHA-256.
 */
@Injectable()
export class PairedDevicesService {
  constructor(
    @InjectRepository(PairedDevice)
    private readonly devices: Repository<PairedDevice>,
  ) {}

  async createPairCode(name?: string): Promise<{ deviceId: string; code: string; setupText: string; expiresAt: Date }> {
    // One window at a time: a new code closes any earlier one that was never used.
    await this.devices.update(
      { tokenSha256: IsNull(), revokedAt: IsNull(), pairExpiresAt: MoreThan(new Date()) },
      { pairExpiresAt: new Date() },
    );
    const code = newPairCode();
    const expiresAt = new Date(Date.now() + PAIR_WINDOW_MS);
    const device = await this.devices.save(
      this.devices.create({
        name: name?.trim() || 'iPhone',
        pairCodeSha256: sha256Hex(code),
        pairExpiresAt: expiresAt,
        pairAttempts: 0,
      }),
    );
    return { deviceId: device.id, code: formatPairCode(code), setupText: `fintrack:pair:${code}`, expiresAt };
  }

  /** The device key for a valid code, or null (wrong, expired, used, or no window open). */
  async pair(rawCode: string, name?: string): Promise<{ key: string; device: PairedDevice } | null> {
    const open = await this.devices.find({
      where: { tokenSha256: IsNull(), revokedAt: IsNull(), pairExpiresAt: MoreThan(new Date()) },
    });
    const live = open.filter((d) => d.pairAttempts < PAIR_MAX_ATTEMPTS && d.pairCodeSha256);
    if (live.length === 0) return null;

    const codeHash = sha256Hex(normalisePairCode(rawCode));
    const match = live.find((d) => safeEqual(d.pairCodeSha256 as string, codeHash));
    if (!match) {
      for (const d of live) {
        const attempts = d.pairAttempts + 1;
        await this.devices.update(
          { id: d.id },
          attempts >= PAIR_MAX_ATTEMPTS ? { pairAttempts: attempts, pairExpiresAt: new Date() } : { pairAttempts: attempts },
        );
      }
      return null;
    }

    const key = newDeviceKey();
    // Conditional on the key still being unset, so two phones racing the same
    // code cannot both get one.
    const claimed = await this.devices
      .createQueryBuilder()
      .update(PairedDevice)
      .set({
        tokenSha256: sha256Hex(key),
        pairCodeSha256: null,
        pairExpiresAt: null,
        lastUsedAt: new Date(),
        ...(name?.trim() ? { name: name.trim().slice(0, 60) } : {}),
      })
      .where('id = :id AND token_sha256 IS NULL', { id: match.id })
      .execute();
    if (!claimed.affected) return null;
    const device = await this.devices.findOneByOrFail({ id: match.id });
    return { key, device };
  }

  /** The paired, unrevoked device holding this key, or null. */
  async authenticate(key: string): Promise<PairedDevice | null> {
    const hash = sha256Hex(key);
    const device = await this.devices.findOne({ where: { tokenSha256: hash, revokedAt: IsNull() } });
    if (!device?.tokenSha256 || !safeEqual(device.tokenSha256, hash)) return null;
    if (!device.lastUsedAt || Date.now() - device.lastUsedAt.getTime() > TOUCH_AFTER_MS) {
      device.lastUsedAt = new Date();
      await this.devices.update({ id: device.id }, { lastUsedAt: device.lastUsedAt });
    }
    return device;
  }

  async noteOutbox(deviceId: string, outboxCount: number): Promise<void> {
    await this.devices.update({ id: deviceId }, { outboxCount });
  }

  async list(): Promise<Array<ReturnType<PairedDevicesService['describe']>>> {
    const rows = await this.devices.find({ order: { createdAt: 'DESC' } });
    // Pairing windows that closed without a phone are noise; paired and revoked devices stay.
    return rows.map((d) => this.describe(d)).filter((d) => d.status !== 'expired');
  }

  async revoke(id: string): Promise<{ revoked: true; id: string }> {
    const device = await this.devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found.');
    await this.devices.update({ id }, { revokedAt: device.revokedAt ?? new Date(), pairCodeSha256: null, pairExpiresAt: null });
    return { revoked: true, id };
  }

  describe(d: PairedDevice) {
    const status: DeviceStatus = d.revokedAt
      ? 'revoked'
      : d.tokenSha256
        ? 'active'
        : d.pairExpiresAt && d.pairExpiresAt.getTime() > Date.now() && d.pairAttempts < PAIR_MAX_ATTEMPTS
          ? 'pairing'
          : 'expired';
    return {
      id: d.id,
      name: d.name,
      status,
      lastUsedAt: d.lastUsedAt,
      outboxCount: d.outboxCount,
      createdAt: d.createdAt,
      revokedAt: d.revokedAt,
    };
  }
}
