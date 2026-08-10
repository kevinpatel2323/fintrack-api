import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CardLinkService, matchTotals } from './card-link.service';
import { CardTransaction } from '../database/entities/card-transaction.entity';

const txn = (amount: number, isRefund = false): CardTransaction =>
  ({ amount, isRefund }) as CardTransaction;

describe('matchTotals', () => {
  it('reports a zero remainder when the payment equals the covered rows', () => {
    expect(matchTotals(1000, [txn(600), txn(400)])).toEqual({
      matchedTotal: 1000,
      remainder: 0,
    });
  });

  it('reports a positive remainder for carried-forward dues', () => {
    // Paid ₹42,318 against ₹40,438 of purchases: the balance brought forward
    // from the previous cycle has no transaction row of its own.
    expect(matchTotals(42318, [txn(40000), txn(438)])).toEqual({
      matchedTotal: 40438,
      remainder: 1880,
    });
  });

  it('reports a negative remainder for a partial payment', () => {
    expect(matchTotals(5000, [txn(40438)])).toEqual({
      matchedTotal: 40438,
      remainder: -35438,
    });
  });

  it('subtracts refunds from the matched total', () => {
    expect(matchTotals(800, [txn(1000), txn(200, true)])).toEqual({
      matchedTotal: 800,
      remainder: 0,
    });
  });

  it('handles an empty cover set', () => {
    expect(matchTotals(1500, [])).toEqual({ matchedTotal: 0, remainder: 1500 });
  });

  // The whole point of the integer-paise detour: 0.1 + 0.2 must not leave a
  // phantom remainder.
  it('does not drift on values that are inexact in binary floating point', () => {
    expect(matchTotals(0.3, [txn(0.1), txn(0.2)])).toEqual({
      matchedTotal: 0.3,
      remainder: 0,
    });
  });

  // Amounts are NUMERIC(14,2) so sub-paise values never reach here in
  // practice; this pins down that each row rounds independently rather than
  // the sum being rounded once at the end.
  it('rounds each row to paise independently', () => {
    expect(matchTotals(100.01, [txn(33.336), txn(33.337), txn(33.337)])).toEqual({
      matchedTotal: 100.02,
      remainder: -0.01,
    });
  });
});

// Exercises the guards without a database: `dataSource.transaction` is stubbed
// to run its callback against a fake EntityManager.
describe('CardLinkService guards', () => {
  const debit = { id: '1', withdrawal: 42318, deposit: 0, transactionDate: '2026-08-03' };
  const creditCard = { id: '7', kind: 'credit', name: 'HDFC', last4: '4821' };

  function makeService(overrides: {
    bankTxn?: unknown;
    existingPayment?: unknown;
    card?: unknown;
    statement?: unknown;
    cardTxns?: unknown[];
  } = {}) {
    const {
      bankTxn = debit,
      existingPayment = null,
      card = creditCard,
      statement = { id: '99', cardId: '7' },
      cardTxns = [],
    } = overrides;

    const qb: Record<string, jest.Mock> = {};
    for (const m of ['setLock', 'where', 'andWhere', 'update', 'set', 'select', 'addSelect']) {
      qb[m] = jest.fn(() => qb);
    }
    qb.getOne = jest.fn(async () => bankTxn);
    qb.getMany = jest.fn(async () => cardTxns);
    qb.execute = jest.fn(async () => ({}));
    // recomputeStatementPaid sums the statement's payments.
    qb.getRawOne = jest.fn(async () => ({ sum: '0' }));

    const em = {
      getRepository: jest.fn(() => ({ createQueryBuilder: jest.fn(() => qb) })),
      findOne: jest.fn(async (entity: unknown) => {
        const name = (entity as { name?: string })?.name;
        if (name === 'CardPayment') return existingPayment;
        if (name === 'Card') return card;
        if (name === 'CardStatement') return statement;
        return null;
      }),
      find: jest.fn(async () => []),
      create: jest.fn((_e: unknown, data: unknown) => data),
      save: jest.fn(async (data: unknown) => ({ id: '500', ...(data as object) })),
      delete: jest.fn(async () => ({})),
    };

    const dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(em)),
    };

    const friendsService = {
      listTagsForCardTransactions: jest.fn(async () => new Map()),
    };

    const service = new CardLinkService(
      {} as never,
      {} as never,
      dataSource as never,
      friendsService as never,
    );
    // buildLinkResponse re-reads through the same fake manager; short-circuit it.
    jest
      .spyOn(service as never, 'buildLinkResponse' as never)
      .mockResolvedValue({ linked: true } as never);
    return { service, em, qb };
  }

  it('rejects an empty selection', async () => {
    const { service } = makeService();
    await expect(service.link('1', '7', [])).rejects.toThrow(BadRequestException);
  });

  it('rejects a deposit row', async () => {
    const { service } = makeService({
      bankTxn: { ...debit, withdrawal: 0, deposit: 5000 },
    });
    await expect(service.link('1', '7', ['10'])).rejects.toThrow(
      /Only debit \(withdrawal\) transactions/,
    );
  });

  it('rejects a missing bank transaction', async () => {
    const { service } = makeService({ bankTxn: null });
    await expect(service.link('1', '7', ['10'])).rejects.toThrow(NotFoundException);
  });

  it('rejects a transaction that is already a bill payment', async () => {
    const { service } = makeService({ existingPayment: { id: '3' } });
    await expect(service.link('1', '7', ['10'])).rejects.toThrow(/already marked/);
  });

  it('rejects a non-credit card', async () => {
    const { service } = makeService({ card: { id: '7', kind: 'debit' } });
    await expect(service.link('1', '7', ['10'])).rejects.toThrow(
      /only be linked to credit cards/,
    );
  });

  it('rejects rows already covered by another payment', async () => {
    const { service } = makeService({
      cardTxns: [{ id: '10', cardId: '7', amount: 100, isRefund: false, paidByPaymentId: '3' }],
    });
    await expect(service.link('1', '7', ['10'])).rejects.toThrow(
      /already covered by another payment/,
    );
  });

  it('rejects rows belonging to a different card', async () => {
    const { service } = makeService({
      cardTxns: [{ id: '10', cardId: '8', amount: 100, isRefund: false, paidByPaymentId: null }],
    });
    await expect(service.link('1', '7', ['10'])).rejects.toThrow(
      /must belong to the selected card/,
    );
  });

  // The behaviour change: a mismatch used to throw, and now links.
  it('links a selection that does not equal the payment amount', async () => {
    const { service, em } = makeService({
      cardTxns: [
        { id: '10', cardId: '7', amount: 40000, isRefund: false, paidByPaymentId: null },
      ],
    });
    await expect(service.link('1', '7', ['10'])).resolves.toEqual({ linked: true });
    expect(em.save).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 42318, bankTransactionId: '1' }),
    );
  });

  it('links a whole statement and stamps the payment with it', async () => {
    const { service, em } = makeService({
      cardTxns: [
        { id: '10', cardId: '7', statementId: '99', amount: 40000, isRefund: false, paidByPaymentId: null },
      ],
    });
    await expect(service.linkStatement('1', '7', '99')).resolves.toEqual({ linked: true });
    expect(em.save).toHaveBeenCalledWith(
      expect.objectContaining({ statementId: '99', cardId: '7' }),
    );
  });

  it('refuses a statement whose every row is already covered', async () => {
    const { service } = makeService({ cardTxns: [] });
    await expect(service.linkStatement('1', '7', '99')).rejects.toThrow(
      /already covered by another payment/,
    );
  });

  it('refuses a statement belonging to a different card', async () => {
    const { service } = makeService({ statement: { id: '99', cardId: '8' } });
    await expect(service.linkStatement('1', '7', '99')).rejects.toThrow(
      /belongs to a different card/,
    );
  });
});
