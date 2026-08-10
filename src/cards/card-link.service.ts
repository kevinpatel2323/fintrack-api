import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Card } from '../database/entities/card.entity';
import { CardPayment } from '../database/entities/card-payment.entity';
import { CardStatement } from '../database/entities/card-statement.entity';
import { CardTransaction } from '../database/entities/card-transaction.entity';
import { Transaction } from '../database/entities/transaction.entity';
import { FriendsService } from '../friends/friends.service';

const toPaise = (value: number): number => Math.round(value * 100);

function normalizeDateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// Signed paise for one card transaction: refunds subtract, purchases add.
const signedPaise = (txn: CardTransaction): number =>
  toPaise(txn.amount) * (txn.isRefund ? -1 : 1);

const sumSignedPaise = (txns: CardTransaction[]): number =>
  txns.reduce((sum, txn) => sum + signedPaise(txn), 0);

// A bill payment rarely equals the sum of the card transactions it covers: an
// HDFC statement carries the previous cycle's balance forward and includes
// "payment received" credit rows, neither of which map onto covered purchases.
// So instead of demanding an exact match we derive the difference and let the
// UI label it.  Positive => the payment covered carried-forward dues or charges
// with no transaction row.  Negative => a partial payment that did not cover
// everything selected.
export function matchTotals(
  paymentAmount: number,
  covered: CardTransaction[],
): { matchedTotal: number; remainder: number } {
  const matchedPaise = sumSignedPaise(covered);
  const remainderPaise = toPaise(paymentAmount) - matchedPaise;
  return {
    matchedTotal: matchedPaise / 100,
    remainder: remainderPaise / 100,
  };
}

@Injectable()
export class CardLinkService {
  constructor(
    @InjectRepository(CardPayment)
    private readonly paymentsRepo: Repository<CardPayment>,
    @InjectRepository(CardTransaction)
    private readonly txnsRepo: Repository<CardTransaction>,
    private readonly dataSource: DataSource,
    private readonly friendsService: FriendsService,
  ) {}

  /** Attaches each card transaction's friend tags in a fixed two queries. */
  private async withFriendTags(txns: CardTransaction[]) {
    const tagsByTxn = await this.friendsService.listTagsForCardTransactions(
      txns.map((t) => String(t.id)),
    );
    return txns.map((t) => ({
      ...t,
      friendTags: tagsByTxn.get(String(t.id)) ?? [],
    }));
  }

  async getLink(bankTransactionId: string) {
    const payment = await this.paymentsRepo.findOne({
      where: { bankTransactionId },
      relations: ['card'],
    });
    if (!payment) return { linked: false as const };

    const covered = await this.txnsRepo.find({
      where: { paidByPaymentId: payment.id },
      relations: ['category'],
      order: { txnDate: 'ASC', id: 'ASC' },
    });
    const coveredTransactions = await this.withFriendTags(covered);

    return {
      linked: true as const,
      payment: {
        id: payment.id,
        amount: payment.amount,
        paidOn: payment.paidOn,
        statementId: payment.statementId,
      },
      card: payment.card
        ? {
            id: payment.card.id,
            name: payment.card.name,
            bank: payment.card.bank,
            last4: payment.card.last4,
          }
        : null,
      coveredTransactions,
      ...matchTotals(payment.amount, covered),
    };
  }

  // Link an explicit hand-picked set of card transactions.
  async link(
    bankTransactionId: string,
    cardId: string,
    cardTransactionIds: string[],
  ) {
    const ids = [...new Set(cardTransactionIds)];
    if (ids.length === 0) {
      throw new BadRequestException('Select at least one card transaction.');
    }

    return this.dataSource.transaction(async (em) => {
      const { bankTxn, card } = await this.loadLinkTargets(
        em,
        bankTransactionId,
        cardId,
      );

      const txns = await em
        .getRepository(CardTransaction)
        .createQueryBuilder('ct')
        .setLock('pessimistic_write')
        .where('ct.id IN (:...ids)', { ids })
        .getMany();

      if (txns.length !== ids.length) {
        throw new BadRequestException('One or more card transactions were not found.');
      }
      for (const txn of txns) {
        if (txn.cardId !== card.id) {
          throw new BadRequestException(
            'All selected transactions must belong to the selected card.',
          );
        }
        if (txn.paidByPaymentId !== null) {
          throw new BadRequestException(
            'One or more selected transactions are already covered by another payment.',
          );
        }
      }

      return this.persistLink(em, bankTxn, card, txns, null);
    });
  }

  // Link every still-unpaid transaction on one statement. This is the common
  // case — you pay the bill, not a hand-picked basket — and it stays usable
  // even when the payment total does not equal the covered rows.
  async linkStatement(
    bankTransactionId: string,
    cardId: string,
    statementId: string,
  ) {
    return this.dataSource.transaction(async (em) => {
      const { bankTxn, card } = await this.loadLinkTargets(
        em,
        bankTransactionId,
        cardId,
      );

      const statement = await em.findOne(CardStatement, {
        where: { id: statementId },
      });
      if (!statement) throw new NotFoundException('Statement not found.');
      if (statement.cardId !== card.id) {
        throw new BadRequestException(
          'That statement belongs to a different card.',
        );
      }

      const txns = await em
        .getRepository(CardTransaction)
        .createQueryBuilder('ct')
        .setLock('pessimistic_write')
        .where('ct.statement_id = :statementId', { statementId })
        .andWhere('ct.paid_by_payment_id IS NULL')
        .getMany();

      if (txns.length === 0) {
        throw new BadRequestException(
          'Every transaction on this statement is already covered by another payment.',
        );
      }

      return this.persistLink(em, bankTxn, card, txns, statementId);
    });
  }

  // Shared guards for both link entry points: the bank row must be an
  // un-linked debit and the card must be a credit card.
  private async loadLinkTargets(
    em: EntityManager,
    bankTransactionId: string,
    cardId: string,
  ): Promise<{ bankTxn: Transaction; card: Card }> {
    const bankTxn = await em
      .getRepository(Transaction)
      .createQueryBuilder('t')
      .setLock('pessimistic_write')
      .where('t.id = :id', { id: bankTransactionId })
      .getOne();
    if (!bankTxn) throw new NotFoundException('Bank transaction not found.');
    if (!(bankTxn.withdrawal > 0) || bankTxn.deposit > 0) {
      throw new BadRequestException(
        'Only debit (withdrawal) transactions can be marked as a CC bill payment.',
      );
    }

    const existing = await em.findOne(CardPayment, {
      where: { bankTransactionId },
    });
    if (existing) {
      throw new BadRequestException(
        'This transaction is already marked as a CC bill payment. Unlink it first.',
      );
    }

    const card = await em.findOne(Card, { where: { id: cardId } });
    if (!card) throw new NotFoundException('Card not found.');
    if (card.kind !== 'credit') {
      throw new BadRequestException('Bill payments can only be linked to credit cards.');
    }

    return { bankTxn, card };
  }

  // Create the CardPayment, stamp the covered rows, and refresh every touched
  // statement's paid total.
  private async persistLink(
    em: EntityManager,
    bankTxn: Transaction,
    card: Card,
    txns: CardTransaction[],
    explicitStatementId: string | null,
  ) {
    const statementIds = new Set(
      txns.map((t) => t.statementId).filter((sid): sid is string => sid !== null),
    );
    if (explicitStatementId) statementIds.add(explicitStatementId);

    // With no explicit statement, only claim one when every covered row agrees
    // — a mixed basket belongs to no single statement.
    const paymentStatementId =
      explicitStatementId ??
      (statementIds.size === 1 && txns.every((t) => t.statementId !== null)
        ? [...statementIds][0]
        : null);

    const payment = em.create(CardPayment, {
      cardId: card.id,
      statementId: paymentStatementId,
      amount: bankTxn.withdrawal,
      paidOn: normalizeDateOnly(bankTxn.transactionDate),
      viaLabel: 'Bank transfer',
      bankTransactionId: bankTxn.id,
      notes: null,
    });
    const saved = await em.save(payment);

    await em
      .getRepository(CardTransaction)
      .createQueryBuilder()
      .update()
      .set({ paidByPaymentId: saved.id })
      .where('id IN (:...ids)', { ids: txns.map((t) => t.id) })
      .execute();

    for (const sid of statementIds) {
      await this.recomputeStatementPaid(em, sid);
    }

    return this.buildLinkResponse(em, saved.id);
  }

  async unlink(bankTransactionId: string) {
    return this.dataSource.transaction(async (em) => {
      const payment = await em.findOne(CardPayment, {
        where: { bankTransactionId },
      });
      if (!payment) {
        throw new NotFoundException('This transaction is not marked as a CC bill payment.');
      }

      const covered = await em.find(CardTransaction, {
        where: { paidByPaymentId: payment.id },
        select: { id: true, statementId: true },
      });
      const statementIds = new Set(
        covered.map((t) => t.statementId).filter((sid): sid is string => sid !== null),
      );
      if (payment.statementId) statementIds.add(payment.statementId);

      if (covered.length > 0) {
        await em
          .getRepository(CardTransaction)
          .createQueryBuilder()
          .update()
          .set({ paidByPaymentId: null })
          .where('id IN (:...ids)', { ids: covered.map((t) => t.id) })
          .execute();
      }
      await em.delete(CardPayment, { id: payment.id });

      for (const sid of statementIds) {
        await this.recomputeStatementPaid(em, sid);
      }

      return {
        unlinked: true,
        bankTransactionId,
        uncoveredTransactions: covered.length,
      };
    });
  }

  // Payments created by linking must not overwrite totalAmount: the imported
  // statement total is the bank's official figure and can include carried-over
  // dues that have no transaction rows.
  private async recomputeStatementPaid(
    em: EntityManager,
    statementId: string,
  ): Promise<void> {
    const payRow = await em
      .getRepository(CardPayment)
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amount), 0)', 'sum')
      .where('p.statement_id = :sid', { sid: statementId })
      .getRawOne();
    const stmt = await em.findOne(CardStatement, { where: { id: statementId } });
    if (!stmt) return;
    stmt.paidAmount = Number(payRow?.sum ?? 0);
    const fullyPaid = stmt.paidAmount >= stmt.totalAmount && stmt.totalAmount > 0;
    if (fullyPaid) stmt.status = 'paid';
    else if (stmt.status === 'paid') stmt.status = 'closed';
    await em.save(stmt);
  }

  private async buildLinkResponse(em: EntityManager, paymentId: string) {
    const payment = await em.findOne(CardPayment, {
      where: { id: paymentId },
      relations: ['card'],
    });
    const coveredTransactions = await em.find(CardTransaction, {
      where: { paidByPaymentId: paymentId },
      order: { txnDate: 'ASC', id: 'ASC' },
    });
    return {
      linked: true as const,
      payment: payment
        ? {
            id: payment.id,
            amount: payment.amount,
            paidOn: payment.paidOn,
            statementId: payment.statementId,
          }
        : null,
      card: payment?.card
        ? {
            id: payment.card.id,
            name: payment.card.name,
            bank: payment.card.bank,
            last4: payment.card.last4,
          }
        : null,
      coveredTransactions,
      ...matchTotals(payment?.amount ?? 0, coveredTransactions),
    };
  }

  // Batch lookup for the transactions-range endpoint: maps each bank
  // transaction id to its bill-payment annotation (if any) in one query so the
  // list UI can render the "CC bill" badge without an N+1 fan-out.
  // `allCoveredCategorized` is true when every nested card txn under the
  // payment has a category (vacuously true when nothing is covered yet).
  async getBillPaymentsForBankTransactions(
    bankTransactionIds: string[],
  ): Promise<
    Map<
      string,
      {
        paymentId: string;
        cardId: string;
        cardLast4: string;
        allCoveredCategorized: boolean;
      }
    >
  > {
    const result = new Map<
      string,
      {
        paymentId: string;
        cardId: string;
        cardLast4: string;
        allCoveredCategorized: boolean;
      }
    >();
    if (bankTransactionIds.length === 0) return result;

    const rows = await this.paymentsRepo
      .createQueryBuilder('p')
      .innerJoin('p.card', 'c')
      .select('p.id', 'paymentId')
      .addSelect('p.bank_transaction_id', 'bankTransactionId')
      .addSelect('p.card_id', 'cardId')
      .addSelect('c.last4', 'cardLast4')
      .where('p.bank_transaction_id IN (:...ids)', { ids: bankTransactionIds })
      .getRawMany();

    const paymentIds = rows.map((row) => String(row.paymentId));
    const uncategorizedByPayment = new Map<string, number>();
    if (paymentIds.length > 0) {
      const coverage = await this.txnsRepo
        .createQueryBuilder('ct')
        .select('ct.paid_by_payment_id', 'paymentId')
        .addSelect(
          'SUM(CASE WHEN ct.category_id IS NULL THEN 1 ELSE 0 END)',
          'uncategorizedCount',
        )
        .where('ct.paid_by_payment_id IN (:...ids)', { ids: paymentIds })
        .groupBy('ct.paid_by_payment_id')
        .getRawMany();
      for (const row of coverage) {
        uncategorizedByPayment.set(
          String(row.paymentId),
          Number(row.uncategorizedCount) || 0,
        );
      }
    }

    for (const row of rows) {
      const paymentId = String(row.paymentId);
      // No covered rows → vacuously categorized (payment exists, nest is empty).
      const uncategorized = uncategorizedByPayment.get(paymentId) ?? 0;
      result.set(String(row.bankTransactionId), {
        paymentId,
        cardId: String(row.cardId),
        cardLast4: row.cardLast4,
        allCoveredCategorized: uncategorized === 0,
      });
    }
    return result;
  }

  // Used by the bank-import revert flow: unlink every payment whose bank
  // transaction is about to be deleted, restoring covered card transactions
  // to unpaid. Runs inside the caller's transaction.
  async unlinkByBankTransactionIds(
    em: EntityManager,
    bankTransactionIds: string[],
  ): Promise<number> {
    if (bankTransactionIds.length === 0) return 0;
    const payments = await em.find(CardPayment, {
      where: { bankTransactionId: In(bankTransactionIds) },
    });
    if (payments.length === 0) return 0;

    const paymentIds = payments.map((p) => p.id);
    const covered = await em.find(CardTransaction, {
      where: { paidByPaymentId: In(paymentIds) },
      select: { id: true, statementId: true },
    });
    const statementIds = new Set<string>();
    for (const t of covered) if (t.statementId) statementIds.add(t.statementId);
    for (const p of payments) if (p.statementId) statementIds.add(p.statementId);

    if (covered.length > 0) {
      await em
        .getRepository(CardTransaction)
        .createQueryBuilder()
        .update()
        .set({ paidByPaymentId: null })
        .where('id IN (:...ids)', { ids: covered.map((t) => t.id) })
        .execute();
    }
    await em.delete(CardPayment, { id: In(paymentIds) });

    for (const sid of statementIds) {
      await this.recomputeStatementPaid(em, sid);
    }
    return payments.length;
  }
}
