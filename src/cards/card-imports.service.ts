import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Card } from '../database/entities/card.entity';
import { CardStatement } from '../database/entities/card-statement.entity';
import { CardStatementImport } from '../database/entities/card-statement-import.entity';
import { CardTransaction } from '../database/entities/card-transaction.entity';
import { CardPayment } from '../database/entities/card-payment.entity';
import {
  parseHdfcCcStatement,
  ParsedCcEntry,
  ParsedCcStatement,
} from './parsers/hdfc-cc.parser';
import { addDaysIso, cycleStartFor, toIsoDay } from './card-cycle';
import {
  DEFAULT_DATE_WINDOW_DAYS,
  EntryMatch,
  matchParsedEntries,
} from './card-txn-match';

/**
 * A match the user has kept ticked on the import review screen. Only pairs the
 * server itself proposed are ever applied, so this can narrow the automatic
 * set but never widen it.
 */
export interface ConfirmedMatch {
  parsedIndex: number;
  existingId: string;
}

const MAX_CONFIRMED_MATCHES = 5000;

/**
 * Reads the review screen's choices off a multipart form field. The upload is
 * multipart, so this arrives as a JSON string rather than a validated DTO and
 * has to be checked by hand. An absent or empty field means "no review
 * happened" — every proposed match is then applied.
 */
export function parseConfirmedMatches(
  raw?: string,
): ConfirmedMatch[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('confirmedMatches must be valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new BadRequestException('confirmedMatches must be a JSON array.');
  }
  if (parsed.length > MAX_CONFIRMED_MATCHES) {
    throw new BadRequestException(
      `confirmedMatches accepts at most ${MAX_CONFIRMED_MATCHES} entries.`,
    );
  }

  return parsed.map((item) => {
    const entry = item as Partial<ConfirmedMatch>;
    const parsedIndex = Number(entry?.parsedIndex);
    const existingId = String(entry?.existingId ?? '');
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
      throw new BadRequestException(
        'confirmedMatches[].parsedIndex must be a non-negative integer.',
      );
    }
    if (!/^\d+$/.test(existingId)) {
      throw new BadRequestException(
        'confirmedMatches[].existingId must be a numeric id string.',
      );
    }
    return { parsedIndex, existingId };
  });
}

// Card rows are reshaped into the bank statement's preview row so the unified
// import screen can render either kind of statement with one code path. A
// refund puts money back on the card, so it reads as a credit.
function toPreviewRow(entry: ParsedCcEntry) {
  return {
    transactionDate: entry.txnDate,
    narration: entry.merchant,
    withdrawal: entry.isRefund ? 0 : entry.amount,
    deposit: entry.isRefund ? entry.amount : 0,
    balance: 0,
    upiName: null,
    upiDescription: null,
    upiBank: null,
  };
}

@Injectable()
export class CardImportsService {
  constructor(
    @InjectRepository(Card) private readonly cardsRepo: Repository<Card>,
    @InjectRepository(CardStatementImport)
    private readonly importsRepo: Repository<CardStatementImport>,
    @InjectRepository(CardTransaction)
    private readonly txnsRepo: Repository<CardTransaction>,
    @InjectRepository(CardStatement)
    private readonly statementsRepo: Repository<CardStatement>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Pairs the statement's rows against unbilled transactions already on the
   * card — the ones entered by hand between the last statement date and this
   * one. Matching bills them in place instead of inserting a second copy, which
   * would double-count the spend in every friend ledger those rows are tagged
   * into.
   */
  private async proposeMatches(cardId: string, parsed: ParsedCcStatement) {
    const cycleStart = cycleStartFor(parsed.statementDate);

    // A cycle can already have a statement when it was opened by hand, and
    // `createStatement` bills the unbilled rows inside it on the way. Those rows
    // are still the user's own, so they stay matchable — otherwise re-importing
    // the real statement over a hand-made one duplicates every one of them.
    const existingStatement = await this.statementsRepo.findOne({
      where: { cardId, cycleStart },
    });

    const query = this.txnsRepo
      .createQueryBuilder('t')
      .where('t.card_id = :cardId', { cardId })
      // Rows a previous import created belong to that statement; only rows the
      // user entered are candidates for merging.
      .andWhere('t.card_import_id IS NULL')
      .andWhere('t.txn_date BETWEEN :from AND :to', {
        from: addDaysIso(cycleStart, -DEFAULT_DATE_WINDOW_DAYS),
        to: addDaysIso(parsed.statementDate, DEFAULT_DATE_WINDOW_DAYS),
      });
    if (existingStatement) {
      query.andWhere(
        '(t.statement_id IS NULL OR t.statement_id = :existingStatementId)',
        { existingStatementId: existingStatement.id },
      );
    } else {
      query.andWhere('t.statement_id IS NULL');
    }
    const candidates = await query.getMany();

    const byId = new Map(candidates.map((c) => [c.id, c]));
    const { matches } = matchParsedEntries(
      parsed.entries,
      candidates.map((c) => ({
        id: c.id,
        txnDate: toIsoDay(c.txnDate),
        amount: c.amount,
        isRefund: c.isRefund,
        merchant: c.merchant,
      })),
    );
    return { matches, byId };
  }

  /** Match detail for the review screen: what the statement says vs. what you entered. */
  private describeMatches(
    parsed: ParsedCcStatement,
    matches: EntryMatch[],
    byId: Map<string, CardTransaction>,
  ) {
    return matches.map((match) => {
      const entry = parsed.entries[match.parsedIndex];
      const existing = byId.get(match.existingId)!;
      return {
        parsedIndex: match.parsedIndex,
        existingId: match.existingId,
        dateDeltaDays: match.dateDeltaDays,
        statementRow: {
          txnDate: entry.txnDate,
          merchant: entry.merchant,
          amount: entry.amount,
          isRefund: entry.isRefund,
        },
        existingRow: {
          txnDate: toIsoDay(existing.txnDate),
          merchant: existing.merchant,
          amount: existing.amount,
          isRefund: existing.isRefund,
        },
      };
    });
  }

  /**
   * Narrows the proposed matches to the ones the user kept ticked. A pair the
   * server no longer proposes is dropped rather than rejected: the card may
   * have changed between preview and import, and in that case not merging is
   * the safe outcome.
   */
  private applyConfirmations(
    proposed: EntryMatch[],
    confirmed: ConfirmedMatch[] | undefined,
  ): EntryMatch[] {
    if (!confirmed) return proposed;
    const kept = new Set(
      confirmed.map((c) => `${c.parsedIndex}:${c.existingId}`),
    );
    return proposed.filter((m) => kept.has(`${m.parsedIndex}:${m.existingId}`));
  }

  async preview(cardId: string, buffer: Buffer) {
    const card = await this.loadCreditCard(cardId);
    const parsed = parseHdfcCcStatement(buffer);
    const duplicate = await this.findExistingImport(cardId, parsed.statementDate);
    const { matches, byId } = await this.proposeMatches(cardId, parsed);

    return {
      last4: parsed.last4,
      last4Matches: parsed.last4 === card.last4,
      statementDate: parsed.statementDate,
      dueDate: parsed.dueDate,
      totalDue: parsed.totalDue,
      minDue: parsed.minDue,
      creditLimit: parsed.creditLimit,
      totalRows: parsed.entries.length,
      refundRows: parsed.entries.filter((e) => e.isRefund).length,
      alreadyImported: Boolean(duplicate),
      matchedRows: matches.length,
      newRows: parsed.entries.length - matches.length,
      matches: this.describeMatches(parsed, matches, byId),
      previewRows: parsed.entries,
    };
  }

  async importStatement(
    cardId: string,
    buffer: Buffer,
    filename: string,
    confirmedMatches?: ConfirmedMatch[],
  ) {
    const card = await this.loadCreditCard(cardId);
    const parsed = parseHdfcCcStatement(buffer);

    if (parsed.last4 !== card.last4) {
      throw new BadRequestException(
        `This statement is for card ending ${parsed.last4}, but the selected card ends ${card.last4}.`,
      );
    }
    if (parsed.entries.length === 0) {
      throw new BadRequestException('No transactions parsed from statement.');
    }
    const duplicate = await this.findExistingImport(cardId, parsed.statementDate);
    if (duplicate) {
      throw new ConflictException(
        `Statement dated ${parsed.statementDate} is already imported for this card. Revert it first to re-upload.`,
      );
    }

    const { matches } = await this.proposeMatches(card.id, parsed);
    const applied = this.applyConfirmations(matches, confirmedMatches);
    const matchedIndexes = new Set(applied.map((m) => m.parsedIndex));

    return this.dataSource.transaction(async (em) => {
      const statement = await this.upsertStatement(em, card.id, parsed);

      const importRow = em.create(CardStatementImport, {
        cardId: card.id,
        statementId: statement.id,
        filename,
        statementDate: parsed.statementDate,
        dueDate: parsed.dueDate,
        totalDue: parsed.totalDue,
        minDue: parsed.minDue,
        totalRows: parsed.entries.length,
        insertedRows: parsed.entries.length - applied.length,
      });
      const savedImport = await em.save(importRow);

      const txns = parsed.entries
        .filter((_, index) => !matchedIndexes.has(index))
        .map((entry) =>
          em.create(CardTransaction, {
            cardId: card.id,
            statementId: statement.id,
            cardImportId: savedImport.id,
            amount: entry.amount,
            merchant: entry.merchant,
            txnDate: entry.txnDate,
            isRefund: entry.isRefund,
            categoryId: null,
            notes: null,
          }),
        );
      await em.save(txns);

      // A matched row keeps its id, so its friend tags, category and notes ride
      // along untouched. Its date moves onto the statement's, which is the
      // billing fact and keeps the row inside the cycle it is now filed under.
      // The merchant text stays as the user wrote it — it is the label they
      // will recognise in a friend's ledger, and the statement's raw string is
      // noise. `card_import_id` stays NULL: the row is not this import's to
      // delete, which is what makes a later revert non-destructive.
      for (const match of applied) {
        const entry = parsed.entries[match.parsedIndex];
        await em.update(
          CardTransaction,
          { id: match.existingId },
          { statementId: statement.id, txnDate: entry.txnDate },
        );
      }

      return {
        importId: savedImport.id,
        statementId: statement.id,
        statementDate: parsed.statementDate,
        dueDate: parsed.dueDate,
        totalDue: parsed.totalDue,
        minDue: parsed.minDue,
        insertedRows: txns.length,
        matchedRows: applied.length,
      };
    });
  }

  // ── Unified import entry points ──────────────────────────────────────────
  // The import screen accepts any statement, so the card is identified from the
  // statement itself rather than chosen up front.

  private async resolveCardByLast4(last4: string): Promise<Card> {
    const matches = await this.cardsRepo.find({ where: { last4, kind: 'credit' } });
    if (matches.length === 0) {
      throw new NotFoundException(
        `This statement is for a credit card ending ${last4}, but no such card exists yet. Add the card first, then import.`,
      );
    }
    if (matches.length > 1) {
      throw new ConflictException(
        `${matches.length} credit cards end in ${last4}. Import this statement from the card's own page instead.`,
      );
    }
    return matches[0];
  }

  private cardSummary(card: Card) {
    return {
      id: card.id,
      name: card.name,
      nickname: card.nickname,
      last4: card.last4,
      network: card.network,
    };
  }

  async previewDetected(buffer: Buffer) {
    const parsed = parseHdfcCcStatement(buffer);
    const card = await this.resolveCardByLast4(parsed.last4);
    const alreadyImported = Boolean(
      await this.findExistingImport(card.id, parsed.statementDate),
    );
    const { matches, byId } = await this.proposeMatches(card.id, parsed);
    const matchedRows = alreadyImported ? 0 : matches.length;

    return {
      kind: 'card' as const,
      card: this.cardSummary(card),
      accountNumber: null,
      statementDate: parsed.statementDate,
      dueDate: parsed.dueDate,
      totalDue: parsed.totalDue,
      minDue: parsed.minDue,
      creditLimit: parsed.creditLimit,
      alreadyImported,
      totalParsed: parsed.entries.length,
      willInsert: alreadyImported ? 0 : parsed.entries.length - matchedRows,
      skippedRows: alreadyImported ? parsed.entries.length : 0,
      matchedRows,
      newRows: alreadyImported ? 0 : parsed.entries.length - matchedRows,
      matches: alreadyImported ? [] : this.describeMatches(parsed, matches, byId),
      periodStart: cycleStartFor(parsed.statementDate),
      periodEnd: parsed.statementDate,
      previewRows: parsed.entries.map(toPreviewRow),
    };
  }

  async importDetected(
    buffer: Buffer,
    filename: string,
    confirmedMatches?: ConfirmedMatch[],
  ) {
    const parsed = parseHdfcCcStatement(buffer);
    const card = await this.resolveCardByLast4(parsed.last4);
    const result = await this.importStatement(
      card.id,
      buffer,
      filename,
      confirmedMatches,
    );

    return { kind: 'card' as const, card: this.cardSummary(card), ...result };
  }

  async listImports(cardId: string): Promise<CardStatementImport[]> {
    await this.loadCreditCard(cardId);
    return this.importsRepo.find({
      where: { cardId },
      order: { statementDate: 'DESC' },
    });
  }

  async revertImport(importId: string) {
    const importRow = await this.importsRepo.findOne({ where: { id: importId } });
    if (!importRow) throw new NotFoundException('Card statement import not found.');

    const paidCount = await this.txnsRepo
      .createQueryBuilder('t')
      .where('t.card_import_id = :importId', { importId })
      .andWhere('t.paid_by_payment_id IS NOT NULL')
      .getCount();
    if (paidCount > 0) {
      throw new BadRequestException(
        `${paidCount} transaction(s) from this import are linked to bill payments. Unlink those payments first.`,
      );
    }

    return this.dataSource.transaction(async (em) => {
      const deleted = await em
        .createQueryBuilder()
        .delete()
        .from(CardTransaction)
        .where('card_import_id = :importId', { importId })
        .execute();

      const statementId = importRow.statementId;
      let removedStatement = false;
      let unbilledTransactions = 0;
      if (statementId) {
        // Rows this import matched rather than inserted were entered by hand and
        // must survive the revert with their friend tags — but the billing the
        // import applied to them has to come off, or they stay attached to a
        // statement that no longer has an import behind it. Any row on this
        // statement with no `card_import_id` is such a row.
        const unbilled = await em
          .createQueryBuilder()
          .update(CardTransaction)
          .set({ statementId: null })
          .where('statement_id = :statementId', { statementId })
          .andWhere('card_import_id IS NULL')
          .execute();
        unbilledTransactions = unbilled.affected ?? 0;

        const remainingTxns = await em.count(CardTransaction, {
          where: { statementId },
        });
        const remainingPayments = await em.count(CardPayment, {
          where: { statementId },
        });
        if (remainingTxns === 0 && remainingPayments === 0) {
          await em.delete(CardStatement, { id: statementId });
          removedStatement = true;
        }
      }

      await em.delete(CardStatementImport, { id: importId });

      return {
        reverted: true,
        importId,
        removedTransactions: deleted.affected ?? 0,
        unbilledTransactions,
        removedStatement,
      };
    });
  }

  private async loadCreditCard(cardId: string): Promise<Card> {
    const card = await this.cardsRepo.findOne({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Card not found.');
    if (card.kind !== 'credit') {
      throw new BadRequestException(
        'Statements can only be imported into credit cards.',
      );
    }
    return card;
  }

  private async findExistingImport(
    cardId: string,
    statementDate: string,
  ): Promise<CardStatementImport | null> {
    return this.importsRepo.findOne({ where: { cardId, statementDate } });
  }

  // Reuse a manually created statement for the same cycle if one exists; the
  // parsed totals win either way because the official Total Amount Due can
  // include carried-over balance/interest that has no transaction rows.
  private async upsertStatement(
    em: any,
    cardId: string,
    parsed: ParsedCcStatement,
  ): Promise<CardStatement> {
    const cycleStart = cycleStartFor(parsed.statementDate);
    let statement = await em.findOne(CardStatement, {
      where: { cardId, cycleStart },
    });
    if (!statement) {
      statement = em.create(CardStatement, {
        cardId,
        cycleStart,
        cycleEnd: parsed.statementDate,
        dueDate: parsed.dueDate ?? parsed.statementDate,
        status: 'closed',
      });
    }
    statement.cycleEnd = parsed.statementDate;
    if (parsed.dueDate) statement.dueDate = parsed.dueDate;
    statement.totalAmount = parsed.totalDue;
    statement.minDue = parsed.minDue;
    if (statement.paidAmount >= parsed.totalDue && parsed.totalDue > 0) {
      statement.status = 'paid';
    }
    return em.save(statement);
  }
}
