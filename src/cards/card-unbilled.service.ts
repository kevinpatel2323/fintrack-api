import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Card } from '../database/entities/card.entity';
import { CardStatement } from '../database/entities/card-statement.entity';
import { CardTransaction } from '../database/entities/card-transaction.entity';
import { addDaysIso, toIsoDay } from './card-cycle';
import { matchParsedEntries } from './card-txn-match';
import {
  parseHdfcUnbilledPaste,
  ParsedUnbilledEntry,
} from './parsers/hdfc-unbilled-paste.parser';

/**
 * Rows pasted off HDFC's Unbilled Transactions page land as ordinary unbilled
 * card transactions — exactly what a hand-entered row is — so the statement
 * import later bills them in place (`card-txn-match.ts`) and keeps their tags.
 *
 * The page lists everything since the last statement, so the same rows come
 * back on every paste. Each paste therefore matches against what the card
 * already holds and only adds the rest. The window is ±1 day rather than the
 * statement import's ±3: these are the bank's own dates, and a wider window
 * would fold two ₹90 UPI payments on nearby days into one.
 */
const PASTE_DATE_WINDOW_DAYS = 1;

type RowStatus = 'new' | 'existing' | 'billed_cycle';

@Injectable()
export class CardUnbilledService {
  constructor(
    @InjectRepository(Card) private readonly cardsRepo: Repository<Card>,
    @InjectRepository(CardTransaction)
    private readonly txnsRepo: Repository<CardTransaction>,
    @InjectRepository(CardStatement)
    private readonly statementsRepo: Repository<CardStatement>,
    private readonly dataSource: DataSource,
  ) {}

  private async plan(cardId: string, text: string) {
    const card = await this.cardsRepo.findOne({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Card not found.');
    if (card.kind !== 'credit') {
      throw new BadRequestException('Unbilled spend only applies to credit cards.');
    }

    const parsed = parseHdfcUnbilledPaste(text);
    const dates = parsed.entries.map((e) => e.txnDate).sort();

    // Rows dated inside a cycle a statement has already closed are not added:
    // that statement is the record for them, and adding them would double it.
    const latest = await this.statementsRepo
      .createQueryBuilder('s')
      .select('MAX(s.cycle_end)::text', 'max')
      .where('s.card_id = :cardId', { cardId })
      .getRawOne<{ max: string | null }>();
    const lastBilledDay = latest?.max ? toIsoDay(latest.max) : null;

    const candidates = await this.txnsRepo
      .createQueryBuilder('t')
      .where('t.card_id = :cardId', { cardId })
      .andWhere('t.txn_date BETWEEN :from AND :to', {
        from: addDaysIso(dates[0], -PASTE_DATE_WINDOW_DAYS),
        to: addDaysIso(dates[dates.length - 1], PASTE_DATE_WINDOW_DAYS),
      })
      .getMany();

    const { matches } = matchParsedEntries(
      parsed.entries,
      candidates.map((c) => ({
        id: c.id,
        txnDate: toIsoDay(c.txnDate),
        amount: c.amount,
        isRefund: c.isRefund,
        merchant: c.merchant,
      })),
      { dateWindowDays: PASTE_DATE_WINDOW_DAYS },
    );
    const matchedId = new Map(matches.map((m) => [m.parsedIndex, m.existingId]));

    const rows = parsed.entries.map((entry, index) => {
      let status: RowStatus = 'new';
      if (matchedId.has(index)) status = 'existing';
      else if (lastBilledDay && entry.txnDate <= lastBilledDay) status = 'billed_cycle';
      return { ...entry, status, existingId: matchedId.get(index) ?? null };
    });

    return { card, parsed, rows };
  }

  async preview(cardId: string, text: string) {
    const { card, parsed, rows } = await this.plan(cardId, text);
    return {
      card: { id: card.id, name: card.name, last4: card.last4 },
      totalSpent: parsed.totalSpent,
      totalCredited: parsed.totalCredited,
      totalRows: rows.length,
      newRows: rows.filter((r) => r.status === 'new').length,
      existingRows: rows.filter((r) => r.status === 'existing').length,
      billedCycleRows: rows.filter((r) => r.status === 'billed_cycle').length,
      rows,
    };
  }

  async save(cardId: string, text: string) {
    const { rows } = await this.plan(cardId, text);
    const fresh = rows.filter((r) => r.status === 'new');

    await this.dataSource.transaction(async (em) => {
      await em.save(
        fresh.map((entry: ParsedUnbilledEntry) =>
          em.create(CardTransaction, {
            cardId,
            statementId: null,
            cardImportId: null,
            amount: entry.amount,
            merchant: entry.merchant,
            txnDate: entry.txnDate,
            isRefund: entry.isRefund,
            categoryId: null,
            notes: null,
          }),
        ),
      );
    });

    return {
      insertedRows: fresh.length,
      existingRows: rows.filter((r) => r.status === 'existing').length,
      billedCycleRows: rows.filter((r) => r.status === 'billed_cycle').length,
    };
  }
}
