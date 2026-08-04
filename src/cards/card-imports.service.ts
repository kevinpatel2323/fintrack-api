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

// Statement cycle runs from the day after the previous statement date up to
// the statement date itself; day-of-month is clamped for short months.
function cycleStartFor(statementDateIso: string): string {
  const [y, m, d] = statementDateIso.split('-').map(Number);
  let prevYear = y;
  let prevMonth = m - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const daysInPrevMonth = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const date = new Date(Date.UTC(prevYear, prevMonth - 1, Math.min(d, daysInPrevMonth)));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
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
    private readonly dataSource: DataSource,
  ) {}

  async preview(cardId: string, buffer: Buffer) {
    const card = await this.loadCreditCard(cardId);
    const parsed = parseHdfcCcStatement(buffer);
    const duplicate = await this.findExistingImport(cardId, parsed.statementDate);

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
      previewRows: parsed.entries,
    };
  }

  async importStatement(cardId: string, buffer: Buffer, filename: string) {
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
        insertedRows: parsed.entries.length,
      });
      const savedImport = await em.save(importRow);

      const txns = parsed.entries.map((entry) =>
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

      return {
        importId: savedImport.id,
        statementId: statement.id,
        statementDate: parsed.statementDate,
        dueDate: parsed.dueDate,
        totalDue: parsed.totalDue,
        minDue: parsed.minDue,
        insertedRows: txns.length,
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
      willInsert: alreadyImported ? 0 : parsed.entries.length,
      skippedRows: alreadyImported ? parsed.entries.length : 0,
      periodStart: cycleStartFor(parsed.statementDate),
      periodEnd: parsed.statementDate,
      previewRows: parsed.entries.map(toPreviewRow),
    };
  }

  async importDetected(buffer: Buffer, filename: string) {
    const parsed = parseHdfcCcStatement(buffer);
    const card = await this.resolveCardByLast4(parsed.last4);
    const result = await this.importStatement(card.id, buffer, filename);

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
      if (statementId) {
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
