import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionMemo } from '../database/entities/transaction-memo.entity';
import { PairedDevice } from '../database/entities/paired-device.entity';
import { Card } from '../database/entities/card.entity';
import { DeviceMemoDto } from './dto/device-memo.dto';
import { ListMemosQueryDto } from './dto/web-memos.dto';
import { PairedDevicesService } from './paired-devices.service';
import { loadMemoKey, seal, unseal } from './secret-box';
import { isOtpMessage, ParsedSms, parseSms, SMS_PARSER_VERSION, SmsParseResult } from './sms-parser';
import { bankForSender, contentHash, maskCardNumbers, roundLocation } from './sms-privacy';
import { memoSummary } from './memo-summary';

export type DeviceReplyStatus = 'accepted' | 'refused' | 'invalid' | 'retry';
export interface DeviceReply {
  status: DeviceReplyStatus;
  id?: string;
  summary?: string;
  duplicate?: boolean;
  message?: string;
}

// A phone may set or change the memo on its own rows for this long; after
// that only the web app can.
export const MEMO_EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPARSE_BATCH = 200;

const EMPTY_FIELDS: ParsedSms = {
  direction: null, channel: null, amount: null, currency: null, bank: null, instrument: null,
  last4: null, merchant: null, vpa: null, reference: null, txnDate: null,
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanMemo(value: string | null | undefined): string | null {
  const memo = value?.trim();
  return memo ? memo.slice(0, 500) : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Transaction memos: storing what the phone sends, and the web app's list.
 *
 * Ingest never loses an SMS. A parser failure still stores the row (as
 * 'unreadable'); the same submission id or the same SMS twice returns the row
 * already there, adding the memo or location if this copy has one it lacked;
 * a database failure surfaces as 'retry' so the phone keeps its file. OTPs are
 * the only messages refused, and nothing of them is stored.
 */
@Injectable()
export class TransactionMemosService {
  private readonly logger = new Logger(TransactionMemosService.name);

  constructor(
    @InjectRepository(TransactionMemo)
    private readonly memos: Repository<TransactionMemo>,
    @InjectRepository(Card)
    private readonly cards: Repository<Card>,
    private readonly devices: PairedDevicesService,
  ) {}

  // ── Phone ────────────────────────────────────────────────────────────────

  async ingest(device: PairedDevice, dto: DeviceMemoDto): Promise<DeviceReply> {
    if (dto.outboxCount !== undefined) await this.devices.noteOutbox(device.id, dto.outboxCount);
    const memo = cleanMemo(dto.memo);
    const message = dto.message?.trim() ? dto.message : null;
    if (!message) return this.applyMemoOnly(device, dto.submissionId, memo, dto.capturedAt);
    if (isOtpMessage(message)) return { status: 'refused' };

    const key = this.requireKey();
    const masked = maskCardNumbers(message);
    const senderBank = bankForSender(dto.sender);
    const capturedAt = parseDate(dto.capturedAt) ?? new Date();
    const parsed = this.safeParse(masked, parseDate(dto.receivedAt) ?? capturedAt, senderBank);
    const location = roundLocation(
      dto.location?.latitude ?? dto.latitude,
      dto.location?.longitude ?? dto.longitude,
    );
    const sender = dto.sender?.trim() || null;

    const row: Partial<TransactionMemo> = {
      submissionId: dto.submissionId,
      contentHash: contentHash({ sender, message, receivedAt: dto.receivedAt, capturedAt: dto.capturedAt }),
      deviceId: device.id,
      receivedAt: parseDate(dto.receivedAt),
      capturedAt,
      sender,
      senderVerified: sender ? senderBank !== null : null,
      rawMessageSealed: seal(masked, key),
      memo,
      memoAt: memo ? new Date() : null,
      ...parsed.fields,
      cardId: await this.matchCard(parsed.fields),
      locationSealed: location ? seal(JSON.stringify(location), key) : null,
      locationStatus: dto.locationStatus?.trim() || (location ? 'captured' : null),
      parseStatus: parsed.status,
      parseError: parsed.error,
      parserVersion: SMS_PARSER_VERSION,
      shortcutVersion: dto.shortcutVersion?.trim() || null,
    };

    const inserted = await this.memos
      .createQueryBuilder()
      .insert()
      .into(TransactionMemo)
      .values(row)
      .orIgnore()
      .returning(['id'])
      .execute();
    const newId: string | undefined = inserted.raw?.[0]?.id;
    if (newId) return { status: 'accepted', id: String(newId), summary: memoSummary(row as TransactionMemo) };

    // Already here: a retry, the memo following its SMS, or one SMS sent twice.
    const existing = await this.memos.findOne({
      where: [{ submissionId: dto.submissionId }, { contentHash: row.contentHash as string }],
    });
    if (!existing) return { status: 'retry' };
    if (existing.deviceId === device.id) {
      const patch: Partial<TransactionMemo> = {};
      if (memo && !existing.memo) Object.assign(patch, { memo, memoAt: new Date() });
      if (row.locationSealed && !existing.locationSealed) {
        Object.assign(patch, { locationSealed: row.locationSealed, locationStatus: row.locationStatus });
      }
      if (Object.keys(patch).length) {
        await this.memos.update({ id: existing.id }, { ...patch, updatedAt: new Date() });
        Object.assign(existing, patch);
      }
    }
    return { status: 'accepted', id: existing.id, summary: memoSummary(existing), duplicate: true };
  }

  // A memo typed for an SMS sent earlier ("Add Fintrack memo", or a burst where
  // the SMS went out before its memo was typed).
  private async applyMemoOnly(
    device: PairedDevice,
    submissionId: string,
    memo: string | null,
    capturedAt: string | undefined,
  ): Promise<DeviceReply> {
    const row = await this.memos.findOne({ where: { submissionId } });
    if (!row) {
      // Its SMS may still be on the way; give up only once the edit window has passed.
      const captured = parseDate(capturedAt);
      if (captured && Date.now() - captured.getTime() > MEMO_EDIT_WINDOW_MS) {
        return { status: 'invalid', message: 'No memo to update.' };
      }
      return { status: 'retry' };
    }
    // Another phone's row, or one past the window, reads exactly like a missing one.
    if (row.deviceId !== device.id || Date.now() - row.createdAt.getTime() > MEMO_EDIT_WINDOW_MS) {
      return { status: 'invalid', message: 'No memo to update.' };
    }
    if (memo && memo !== row.memo) {
      await this.memos.update({ id: row.id }, { memo, memoAt: new Date(), updatedAt: new Date() });
      row.memo = memo;
    }
    return { status: 'accepted', id: row.id, summary: memoSummary(row) };
  }

  /** This phone's recent rows still without a memo, newest first, as one-line summaries. */
  async pending(device: PairedDevice) {
    const rows = await this.memos
      .createQueryBuilder('m')
      .where('m.device_id = :deviceId', { deviceId: device.id })
      .andWhere('m.memo IS NULL')
      .andWhere('m.created_at > :since', { since: new Date(Date.now() - PENDING_WINDOW_MS) })
      .orderBy('m.created_at', 'DESC')
      .limit(5)
      .getMany();
    return {
      status: 'ok',
      count: rows.length,
      data: rows.map((m) => ({ submissionId: m.submissionId, summary: memoSummary(m), receivedAt: m.receivedAt ?? m.createdAt })),
    };
  }

  // ── Web ──────────────────────────────────────────────────────────────────

  async list(query: ListMemosQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const qb = this.memos.createQueryBuilder('m');
    if (query.tab === 'no-memo') qb.andWhere('m.memo IS NULL');
    if (query.tab === 'debit' || query.tab === 'credit') qb.andWhere('m.direction = :direction', { direction: query.tab });
    const search = query.q?.trim();
    if (search) {
      const like = `%${escapeLike(search)}%`;
      const amount = Number(search.replace(/[₹,\s]/g, ''));
      qb.andWhere(
        `(m.merchant ILIKE :like OR m.vpa ILIKE :like OR m.memo ILIKE :like OR m.sender ILIKE :like
          OR m.bank ILIKE :like OR m.last4 ILIKE :like OR m.reference ILIKE :like
          ${Number.isFinite(amount) && amount > 0 ? 'OR m.amount = :amount' : ''})`,
        { like, amount },
      );
    }
    const [rows, count] = await qb
      .orderBy('COALESCE(m.received_at, m.captured_at, m.created_at)', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getManyAndCount();
    return { count, data: rows.map((m) => this.toListItem(m)) };
  }

  async summary() {
    const raw = await this.memos
      .createQueryBuilder('m')
      .select('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE m.memo IS NULL)', 'withoutMemo')
      .addSelect('MAX(COALESCE(m.received_at, m.created_at))', 'lastReceivedAt')
      .getRawOne<{ total: string; withoutMemo: string; lastReceivedAt: Date | null }>();
    return {
      withoutMemo: Number(raw?.withoutMemo ?? 0),
      total: Number(raw?.total ?? 0),
      lastReceivedAt: raw?.lastReceivedAt ?? null,
    };
  }

  async detail(id: string) {
    return this.toDetail(await this.findOne(id));
  }

  async updateMemo(id: string, memo: string | null) {
    const row = await this.findOne(id);
    const clean = cleanMemo(memo);
    await this.memos.update({ id }, { memo: clean, memoAt: clean ? new Date() : null, updatedAt: new Date() });
    return this.toListItem({ ...row, memo: clean, memoAt: clean ? new Date() : null });
  }

  async remove(id: string): Promise<{ deleted: true; id: string }> {
    await this.findOne(id);
    await this.memos.delete({ id });
    return { deleted: true, id };
  }

  async reparse(id: string) {
    const row = await this.findOne(id);
    await this.reparseRow(row, this.requireKey());
    return this.detail(id);
  }

  /** Re-reads every row parsed by an older parser, or not read at all, with the current rules. */
  async reparseAll(): Promise<{ updated: number }> {
    const key = this.requireKey();
    let updated = 0;
    let afterId = '0';
    for (;;) {
      const batch = await this.memos
        .createQueryBuilder('m')
        .where('m.id > :afterId', { afterId })
        .andWhere('m.raw_message_sealed IS NOT NULL')
        .andWhere(
          "(m.parser_version IS NULL OR m.parser_version < :version OR m.parse_status = 'unreadable')",
          { version: SMS_PARSER_VERSION },
        )
        .orderBy('m.id', 'ASC')
        .limit(REPARSE_BATCH)
        .getMany();
      if (batch.length === 0) break;
      for (const row of batch) {
        if (await this.reparseRow(row, key)) updated += 1;
      }
      afterId = batch[batch.length - 1].id;
    }
    return { updated };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async reparseRow(row: TransactionMemo, key: Buffer): Promise<boolean> {
    if (!row.rawMessageSealed) return false;
    let text: string;
    try {
      text = unseal(row.rawMessageSealed, key);
    } catch {
      return false;
    }
    const parsed = this.safeParse(text, row.receivedAt ?? row.capturedAt ?? row.createdAt, bankForSender(row.sender));
    await this.memos.update(
      { id: row.id },
      {
        ...parsed.fields,
        cardId: await this.matchCard(parsed.fields),
        parseStatus: parsed.status,
        parseError: parsed.error,
        parserVersion: SMS_PARSER_VERSION,
        updatedAt: new Date(),
      },
    );
    return true;
  }

  // A parser bug must never cost an SMS: store it unread and say so.
  private safeParse(text: string, receivedAt: Date, senderBank: string | null): SmsParseResult {
    try {
      return parseSms({ text, receivedAt, senderBank });
    } catch (error) {
      this.logger.error(`SMS parser failed: ${error instanceof Error ? error.name : 'unknown error'}`);
      return { status: 'unreadable', fields: { ...EMPTY_FIELDS, bank: senderBank }, error: 'The parser failed on this message.' };
    }
  }

  // Only an exact, unambiguous last-4 match on a card links the row to it.
  private async matchCard(fields: ParsedSms): Promise<string | null> {
    if (fields.instrument !== 'card' || !fields.last4) return null;
    const cards = await this.cards.find({ where: { last4: fields.last4 }, select: { id: true } });
    return cards.length === 1 ? cards[0].id : null;
  }

  private requireKey(): Buffer {
    const key = loadMemoKey();
    // Fail closed: without the key nothing is stored rather than stored in the clear.
    if (!key) throw new ServiceUnavailableException('MEMO_DATA_KEY is not configured.');
    return key;
  }

  private async findOne(id: string): Promise<TransactionMemo> {
    const row = await this.memos.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Memo not found.');
    return row;
  }

  private toListItem(m: TransactionMemo) {
    return {
      id: m.id,
      receivedAt: m.receivedAt,
      capturedAt: m.capturedAt,
      createdAt: m.createdAt,
      sender: m.sender,
      senderVerified: m.senderVerified,
      memo: m.memo,
      memoAt: m.memoAt,
      direction: m.direction,
      channel: m.channel,
      amount: m.amount,
      currency: m.currency,
      bank: m.bank,
      instrument: m.instrument,
      last4: m.last4,
      merchant: m.merchant,
      vpa: m.vpa,
      reference: m.reference,
      txnDate: m.txnDate,
      cardId: m.cardId,
      hasLocation: Boolean(m.locationSealed),
      parseStatus: m.parseStatus,
      deviceId: m.deviceId,
    };
  }

  private toDetail(m: TransactionMemo) {
    const key = loadMemoKey();
    const open = (sealed: string | null): string | null => {
      if (!sealed || !key) return null;
      try {
        return unseal(sealed, key);
      } catch {
        return null;
      }
    };
    const locationText = open(m.locationSealed);
    let location: { latitude: number; longitude: number } | null = null;
    if (locationText) {
      try {
        const parsed = JSON.parse(locationText) as { latitude?: unknown; longitude?: unknown };
        location = roundLocation(Number(parsed.latitude), Number(parsed.longitude));
      } catch {
        location = null;
      }
    }
    return {
      ...this.toListItem(m),
      rawMessage: open(m.rawMessageSealed),
      location,
      locationStatus: m.locationStatus,
      parseError: m.parseError,
      parserVersion: m.parserVersion,
      shortcutVersion: m.shortcutVersion,
    };
  }
}
