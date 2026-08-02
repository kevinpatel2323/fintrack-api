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

const toPaise = (value: number): number => Math.round(value * 100);

const formatInr = (paise: number): string =>
  (paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function normalizeDateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

@Injectable()
export class CardLinkService {
  constructor(
    @InjectRepository(CardPayment)
    private readonly paymentsRepo: Repository<CardPayment>,
    @InjectRepository(CardTransaction)
    private readonly txnsRepo: Repository<CardTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  async getLink(bankTransactionId: string) {
    const payment = await this.paymentsRepo.findOne({
      where: { bankTransactionId },
      relations: ['card'],
    });
    if (!payment) return { linked: false as const };

    const coveredTransactions = await this.txnsRepo.find({
      where: { paidByPaymentId: payment.id },
      relations: ['category'],
      order: { txnDate: 'ASC', id: 'ASC' },
    });

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
    };
  }

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

      const selectedPaise = txns.reduce(
        (sum, txn) => sum + toPaise(txn.amount) * (txn.isRefund ? -1 : 1),
        0,
      );
      const withdrawalPaise = toPaise(bankTxn.withdrawal);
      if (selectedPaise !== withdrawalPaise) {
        const delta = selectedPaise - withdrawalPaise;
        throw new BadRequestException(
          `Selected transactions total ₹${formatInr(selectedPaise)} but the payment is ₹${formatInr(withdrawalPaise)} (${delta > 0 ? '+' : '−'}₹${formatInr(Math.abs(delta))}). Selection must match exactly.`,
        );
      }

      const statementIds = new Set(
        txns.map((t) => t.statementId).filter((sid): sid is string => sid !== null),
      );
      const sharedStatementId =
        statementIds.size === 1 && txns.every((t) => t.statementId !== null)
          ? [...statementIds][0]
          : null;

      const payment = em.create(CardPayment, {
        cardId: card.id,
        statementId: sharedStatementId,
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
        .where('id IN (:...ids)', { ids })
        .execute();

      for (const sid of statementIds) {
        await this.recomputeStatementPaid(em, sid);
      }

      return this.buildLinkResponse(em, saved.id);
    });
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
    };
  }

  // Batch lookup for the transactions-range endpoint: maps each bank
  // transaction id to its bill-payment annotation (if any) in one query so the
  // list UI can render the "CC bill" badge without an N+1 fan-out.
  async getBillPaymentsForBankTransactions(
    bankTransactionIds: string[],
  ): Promise<Map<string, { paymentId: string; cardId: string; cardLast4: string }>> {
    const result = new Map<
      string,
      { paymentId: string; cardId: string; cardLast4: string }
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

    for (const row of rows) {
      result.set(String(row.bankTransactionId), {
        paymentId: String(row.paymentId),
        cardId: String(row.cardId),
        cardLast4: row.cardLast4,
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
