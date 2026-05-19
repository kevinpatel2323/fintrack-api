import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Card } from '../database/entities/card.entity';
import { CardStatement } from '../database/entities/card-statement.entity';
import { CardTransaction } from '../database/entities/card-transaction.entity';
import { CardPayment } from '../database/entities/card-payment.entity';
import { Category } from '../database/entities/category.entity';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';
import {
  ToggleFreezeDto,
  UpdateCardControlsDto,
} from './dto/card-controls.dto';
import {
  CreateCardTransactionDto,
  UpdateCardTransactionDto,
} from './dto/create-card-transaction.dto';
import { CreateCardPaymentDto } from './dto/create-card-payment.dto';
import {
  CreateCardStatementDto,
  UpdateCardStatementDto,
} from './dto/create-card-statement.dto';

export interface CardWithComputed extends Card {
  outstanding: number;
  available: number | null;
  utilizationPct: number | null;
  thisCycleSpend: number;
  thisMonthSpend: number;
  currentDue: number;
  currentDueDate: string | null;
  nextStatementId: string | null;
}

@Injectable()
export class CardsService {
  constructor(
    @InjectRepository(Card) private readonly cardsRepo: Repository<Card>,
    @InjectRepository(CardStatement)
    private readonly statementsRepo: Repository<CardStatement>,
    @InjectRepository(CardTransaction)
    private readonly txnsRepo: Repository<CardTransaction>,
    @InjectRepository(CardPayment)
    private readonly paymentsRepo: Repository<CardPayment>,
    @InjectRepository(Category)
    private readonly categoriesRepo: Repository<Category>,
    private readonly dataSource: DataSource,
  ) {}

  // ── Card CRUD ────────────────────────────────────────────────────────────
  async create(dto: CreateCardDto): Promise<Card> {
    this.validateKindFields(dto.kind, dto);

    return this.dataSource.transaction(async (em) => {
      if (dto.isPrimary === true) {
        await em.update(Card, { isPrimary: true }, { isPrimary: false });
      }

      const card = em.create(Card, {
        kind: dto.kind,
        bank: dto.bank,
        network: dto.network,
        name: dto.name,
        nickname: dto.nickname ?? null,
        last4: dto.last4,
        expiryMonth: dto.expiryMonth,
        expiryYear: dto.expiryYear,
        holder: dto.holder ?? null,
        palette: dto.palette ?? 'obsidian',
        creditLimit: dto.kind === 'credit' ? dto.creditLimit ?? null : null,
        statementDay: dto.kind === 'credit' ? dto.statementDay ?? null : null,
        dueDay: dto.kind === 'credit' ? dto.dueDay ?? null : null,
        linkedAccountNumber:
          dto.kind === 'debit' ? dto.linkedAccountNumber ?? null : null,
        dailyLimit: dto.kind === 'debit' ? dto.dailyLimit ?? null : null,
        atmLimit: dto.kind === 'debit' ? dto.atmLimit ?? null : null,
        pointsLabel: dto.pointsLabel ?? null,
        pointsBalance: dto.pointsBalance ?? 0,
        pointsValue: dto.pointsValue ?? 0,
        frozen: dto.frozen ?? false,
        onlineEnabled: dto.onlineEnabled ?? true,
        contactlessEnabled: dto.contactlessEnabled ?? true,
        internationalEnabled: dto.internationalEnabled ?? false,
        isPrimary: dto.isPrimary ?? false,
        notes: dto.notes ?? null,
      });

      return em.save(card);
    });
  }

  async findAll(): Promise<CardWithComputed[]> {
    const cards = await this.cardsRepo.find({
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });
    return Promise.all(cards.map((c) => this.attachComputed(c)));
  }

  async findOne(id: string): Promise<CardWithComputed> {
    const card = await this.cardsRepo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Card not found.');
    return this.attachComputed(card);
  }

  async update(id: string, dto: UpdateCardDto): Promise<Card> {
    const card = await this.cardsRepo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Card not found.');

    const nextKind = dto.kind ?? card.kind;
    this.validateKindFields(nextKind, { ...card, ...dto } as any);

    return this.dataSource.transaction(async (em) => {
      if (dto.isPrimary === true && !card.isPrimary) {
        await em.update(Card, { isPrimary: true }, { isPrimary: false });
      }

      Object.assign(card, this.coerceFieldsForKind(nextKind, dto));
      return em.save(card);
    });
  }

  async remove(id: string): Promise<{ deleted: boolean; id: string }> {
    const card = await this.cardsRepo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Card not found.');
    await this.cardsRepo.delete({ id });
    return { deleted: true, id };
  }

  async setFreeze(id: string, dto: ToggleFreezeDto): Promise<Card> {
    const card = await this.cardsRepo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Card not found.');
    card.frozen = dto.frozen;
    return this.cardsRepo.save(card);
  }

  async setControls(id: string, dto: UpdateCardControlsDto): Promise<Card> {
    const card = await this.cardsRepo.findOne({ where: { id } });
    if (!card) throw new NotFoundException('Card not found.');
    if (dto.onlineEnabled !== undefined) card.onlineEnabled = dto.onlineEnabled;
    if (dto.contactlessEnabled !== undefined)
      card.contactlessEnabled = dto.contactlessEnabled;
    if (dto.internationalEnabled !== undefined)
      card.internationalEnabled = dto.internationalEnabled;
    return this.cardsRepo.save(card);
  }

  async setPrimary(id: string): Promise<Card> {
    return this.dataSource.transaction(async (em) => {
      const card = await em.findOne(Card, { where: { id } });
      if (!card) throw new NotFoundException('Card not found.');
      await em.update(Card, { isPrimary: true }, { isPrimary: false });
      card.isPrimary = true;
      return em.save(card);
    });
  }

  // ── Wallet overview ──────────────────────────────────────────────────────
  async getWallet(): Promise<{
    cards: CardWithComputed[];
    totals: {
      totalLimit: number;
      totalOutstanding: number;
      totalAvailable: number;
      totalDue: number;
      utilizationPct: number;
      totalPoints: number;
      totalPointsValue: number;
      creditCount: number;
      debitCount: number;
    };
  }> {
    const cards = await this.findAll();
    const credit = cards.filter((c) => c.kind === 'credit');
    const totalLimit = credit.reduce((s, c) => s + (c.creditLimit ?? 0), 0);
    const totalOutstanding = credit.reduce((s, c) => s + c.outstanding, 0);
    const totalAvailable = totalLimit - totalOutstanding;
    const totalDue = cards.reduce((s, c) => s + c.currentDue, 0);
    const utilizationPct =
      totalLimit > 0 ? (totalOutstanding / totalLimit) * 100 : 0;
    const totalPoints = credit.reduce((s, c) => s + (c.pointsBalance ?? 0), 0);
    const totalPointsValue = credit.reduce(
      (s, c) => s + (c.pointsValue ?? 0),
      0,
    );

    return {
      cards,
      totals: {
        totalLimit,
        totalOutstanding,
        totalAvailable,
        totalDue,
        utilizationPct,
        totalPoints,
        totalPointsValue,
        creditCount: credit.length,
        debitCount: cards.filter((c) => c.kind === 'debit').length,
      },
    };
  }

  async getDues(): Promise<{
    upcoming: Array<{
      cardId: string;
      cardName: string;
      bank: string;
      last4: string;
      palette: string;
      statementId: string | null;
      amount: number;
      total: number;
      minDue: number;
      paid: number;
      dueDate: string;
      daysAway: number;
      status: 'overdue' | 'due-today' | 'due-tomorrow' | 'upcoming' | 'no-due';
    }>;
  }> {
    const cards = await this.cardsRepo.find({
      where: { kind: 'credit' },
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });
    if (cards.length === 0) return { upcoming: [] };

    const statements = await this.statementsRepo
      .createQueryBuilder('s')
      .where('s.card_id IN (:...ids)', { ids: cards.map((c) => c.id) })
      .andWhere('s.status IN (:...statuses)', {
        statuses: ['open', 'closed', 'overdue'],
      })
      .orderBy('s.due_date', 'ASC')
      .getMany();

    const byCard = new Map<string, CardStatement>();
    for (const s of statements) {
      if (!byCard.has(s.cardId)) byCard.set(s.cardId, s);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = cards.map((card) => {
      const stmt = byCard.get(card.id);
      if (!stmt) {
        return {
          cardId: card.id,
          cardName: card.nickname ?? card.name,
          bank: card.bank,
          last4: card.last4,
          palette: card.palette,
          statementId: null,
          amount: 0,
          total: 0,
          minDue: 0,
          paid: 0,
          dueDate: '',
          daysAway: 0,
          status: 'no-due' as const,
        };
      }
      const due = new Date(`${stmt.dueDate}T00:00:00`);
      const ms = due.getTime() - today.getTime();
      const daysAway = Math.round(ms / (1000 * 60 * 60 * 24));
      const owed = Math.max(stmt.totalAmount - stmt.paidAmount, 0);
      let status: 'overdue' | 'due-today' | 'due-tomorrow' | 'upcoming' | 'no-due';
      if (owed <= 0) status = 'no-due';
      else if (daysAway < 0) status = 'overdue';
      else if (daysAway === 0) status = 'due-today';
      else if (daysAway === 1) status = 'due-tomorrow';
      else status = 'upcoming';
      return {
        cardId: card.id,
        cardName: card.nickname ?? card.name,
        bank: card.bank,
        last4: card.last4,
        palette: card.palette,
        statementId: stmt.id,
        amount: owed,
        total: stmt.totalAmount,
        minDue: stmt.minDue,
        paid: stmt.paidAmount,
        dueDate: stmt.dueDate,
        daysAway,
        status,
      };
    });

    upcoming.sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    return { upcoming };
  }

  // ── Card transactions ────────────────────────────────────────────────────
  async listTransactions(
    cardId: string,
    opts: { start?: string; end?: string; statementId?: string },
  ): Promise<CardTransaction[]> {
    await this.assertCardExists(cardId);
    const qb = this.txnsRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.category', 'category')
      .where('t.card_id = :cardId', { cardId })
      .orderBy('t.txn_date', 'DESC')
      .addOrderBy('t.id', 'DESC');
    if (opts.start)
      qb.andWhere('t.txn_date >= :start', { start: opts.start });
    if (opts.end) qb.andWhere('t.txn_date <= :end', { end: opts.end });
    if (opts.statementId)
      qb.andWhere('t.statement_id = :statementId', {
        statementId: opts.statementId,
      });
    return qb.getMany();
  }

  async createTransaction(
    cardId: string,
    dto: CreateCardTransactionDto,
  ): Promise<CardTransaction> {
    await this.assertCardExists(cardId);
    if (dto.categoryId) await this.assertCategoryExists(dto.categoryId);
    if (dto.statementId)
      await this.assertStatementBelongsToCard(dto.statementId, cardId);

    return this.dataSource.transaction(async (em) => {
      const txn = em.create(CardTransaction, {
        cardId,
        amount: dto.amount,
        merchant: dto.merchant,
        txnDate: dto.txnDate,
        categoryId: dto.categoryId ?? null,
        statementId: dto.statementId ?? null,
        isRefund: dto.isRefund ?? false,
        notes: dto.notes ?? null,
      });
      const saved = await em.save(txn);
      if (saved.statementId)
        await this.recomputeStatementTotal(em, saved.statementId);
      return saved;
    });
  }

  async updateTransaction(
    txnId: string,
    dto: UpdateCardTransactionDto,
  ): Promise<CardTransaction> {
    const txn = await this.txnsRepo.findOne({ where: { id: txnId } });
    if (!txn) throw new NotFoundException('Card transaction not found.');
    if (dto.categoryId) await this.assertCategoryExists(dto.categoryId);
    if (dto.statementId)
      await this.assertStatementBelongsToCard(dto.statementId, txn.cardId);

    const prevStatementId = txn.statementId;

    return this.dataSource.transaction(async (em) => {
      if (dto.amount !== undefined) txn.amount = dto.amount;
      if (dto.merchant !== undefined) txn.merchant = dto.merchant;
      if (dto.txnDate !== undefined) txn.txnDate = dto.txnDate;
      if (dto.categoryId !== undefined) txn.categoryId = dto.categoryId ?? null;
      if (dto.statementId !== undefined)
        txn.statementId = dto.statementId ?? null;
      if (dto.isRefund !== undefined) txn.isRefund = dto.isRefund;
      if (dto.notes !== undefined) txn.notes = dto.notes ?? null;
      const saved = await em.save(txn);

      const touched = new Set<string>();
      if (prevStatementId) touched.add(prevStatementId);
      if (saved.statementId) touched.add(saved.statementId);
      for (const sid of touched) await this.recomputeStatementTotal(em, sid);

      return saved;
    });
  }

  async removeTransaction(
    txnId: string,
  ): Promise<{ deleted: boolean; id: string }> {
    const txn = await this.txnsRepo.findOne({ where: { id: txnId } });
    if (!txn) throw new NotFoundException('Card transaction not found.');
    const statementId = txn.statementId;
    await this.dataSource.transaction(async (em) => {
      await em.delete(CardTransaction, { id: txnId });
      if (statementId) await this.recomputeStatementTotal(em, statementId);
    });
    return { deleted: true, id: txnId };
  }

  // ── Card payments ────────────────────────────────────────────────────────
  async listPayments(cardId: string): Promise<CardPayment[]> {
    await this.assertCardExists(cardId);
    return this.paymentsRepo.find({
      where: { cardId },
      order: { paidOn: 'DESC', id: 'DESC' },
    });
  }

  async createPayment(
    cardId: string,
    dto: CreateCardPaymentDto,
  ): Promise<CardPayment> {
    await this.assertCardExists(cardId);
    if (dto.statementId)
      await this.assertStatementBelongsToCard(dto.statementId, cardId);

    return this.dataSource.transaction(async (em) => {
      const payment = em.create(CardPayment, {
        cardId,
        amount: dto.amount,
        paidOn: dto.paidOn,
        statementId: dto.statementId ?? null,
        viaLabel: dto.viaLabel ?? null,
        notes: dto.notes ?? null,
      });
      const saved = await em.save(payment);
      if (saved.statementId)
        await this.recomputeStatementTotal(em, saved.statementId);
      return saved;
    });
  }

  async removePayment(
    paymentId: string,
  ): Promise<{ deleted: boolean; id: string }> {
    const payment = await this.paymentsRepo.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Card payment not found.');
    const statementId = payment.statementId;
    await this.dataSource.transaction(async (em) => {
      await em.delete(CardPayment, { id: paymentId });
      if (statementId) await this.recomputeStatementTotal(em, statementId);
    });
    return { deleted: true, id: paymentId };
  }

  // ── Card statements ──────────────────────────────────────────────────────
  async listStatements(cardId: string): Promise<CardStatement[]> {
    await this.assertCardExists(cardId);
    return this.statementsRepo.find({
      where: { cardId },
      order: { cycleStart: 'DESC' },
    });
  }

  async createStatement(
    cardId: string,
    dto: CreateCardStatementDto,
  ): Promise<CardStatement> {
    await this.assertCardExists(cardId);
    if (dto.cycleEnd < dto.cycleStart)
      throw new BadRequestException(
        'cycleEnd must be on or after cycleStart.',
      );
    if (dto.dueDate < dto.cycleEnd)
      throw new BadRequestException('dueDate must be on or after cycleEnd.');

    return this.dataSource.transaction(async (em) => {
      const stmt = em.create(CardStatement, {
        cardId,
        cycleStart: dto.cycleStart,
        cycleEnd: dto.cycleEnd,
        dueDate: dto.dueDate,
        totalAmount: dto.totalAmount ?? 0,
        minDue: dto.minDue ?? 0,
        status: dto.status ?? 'open',
        notes: dto.notes ?? null,
      });
      const saved = await em.save(stmt);
      await this.linkOrphanTransactionsToStatement(em, saved);
      await this.recomputeStatementTotal(em, saved.id);
      return saved;
    });
  }

  async updateStatement(
    statementId: string,
    dto: UpdateCardStatementDto,
  ): Promise<CardStatement> {
    const stmt = await this.statementsRepo.findOne({ where: { id: statementId } });
    if (!stmt) throw new NotFoundException('Card statement not found.');

    if (dto.cycleStart !== undefined) stmt.cycleStart = dto.cycleStart;
    if (dto.cycleEnd !== undefined) stmt.cycleEnd = dto.cycleEnd;
    if (dto.dueDate !== undefined) stmt.dueDate = dto.dueDate;
    if (stmt.cycleEnd < stmt.cycleStart)
      throw new BadRequestException(
        'cycleEnd must be on or after cycleStart.',
      );
    if (stmt.dueDate < stmt.cycleEnd)
      throw new BadRequestException('dueDate must be on or after cycleEnd.');

    if (dto.totalAmount !== undefined) stmt.totalAmount = dto.totalAmount;
    if (dto.minDue !== undefined) stmt.minDue = dto.minDue;
    if (dto.status !== undefined) stmt.status = dto.status;
    if (dto.notes !== undefined) stmt.notes = dto.notes ?? null;

    return this.statementsRepo.save(stmt);
  }

  async removeStatement(
    statementId: string,
  ): Promise<{ deleted: boolean; id: string }> {
    const stmt = await this.statementsRepo.findOne({ where: { id: statementId } });
    if (!stmt) throw new NotFoundException('Card statement not found.');
    await this.statementsRepo.delete({ id: statementId });
    return { deleted: true, id: statementId };
  }

  async getStatementBreakdown(statementId: string): Promise<{
    statement: CardStatement;
    categories: Array<{
      categoryId: string | null;
      categoryName: string | null;
      categoryColor: string | null;
      amount: number;
    }>;
    transactions: CardTransaction[];
  }> {
    const stmt = await this.statementsRepo.findOne({ where: { id: statementId } });
    if (!stmt) throw new NotFoundException('Card statement not found.');
    const txns = await this.txnsRepo.find({
      where: { statementId },
      relations: ['category'],
      order: { txnDate: 'DESC', id: 'DESC' },
    });

    const buckets = new Map<string, { name: string | null; color: string | null; amount: number }>();
    for (const t of txns) {
      const key = t.categoryId ?? '__uncat__';
      if (!buckets.has(key))
        buckets.set(key, {
          name: t.category?.name ?? null,
          color: t.category?.color ?? null,
          amount: 0,
        });
      const b = buckets.get(key)!;
      b.amount += t.isRefund ? -t.amount : t.amount;
    }

    const categories = Array.from(buckets.entries())
      .map(([key, b]) => ({
        categoryId: key === '__uncat__' ? null : key,
        categoryName: b.name,
        categoryColor: b.color,
        amount: b.amount,
      }))
      .sort((a, b) => b.amount - a.amount);

    return { statement: stmt, categories, transactions: txns };
  }

  // ── Internals ────────────────────────────────────────────────────────────
  private async attachComputed(card: Card): Promise<CardWithComputed> {
    const now = new Date();
    const currentCycle = this.currentCycleRange(card, now);
    const monthRange = this.monthRange(now);

    const cycleSpendRow = card.statementDay
      ? await this.sumSpend(card.id, currentCycle.start, currentCycle.end)
      : { sum: 0 };
    const monthSpendRow = await this.sumSpend(
      card.id,
      monthRange.start,
      monthRange.end,
    );

    let currentDue = 0;
    let currentDueDate: string | null = null;
    let nextStatementId: string | null = null;
    if (card.kind === 'credit') {
      const stmt = await this.statementsRepo
        .createQueryBuilder('s')
        .where('s.card_id = :cardId', { cardId: card.id })
        .andWhere('s.status IN (:...statuses)', {
          statuses: ['open', 'closed', 'overdue'],
        })
        .orderBy('s.due_date', 'ASC')
        .getOne();
      if (stmt) {
        currentDue = Math.max(stmt.totalAmount - stmt.paidAmount, 0);
        currentDueDate = stmt.dueDate;
        nextStatementId = stmt.id;
      }
    }

    const outstanding =
      card.kind === 'credit'
        ? await this.computeOutstanding(card.id)
        : 0;
    const available =
      card.kind === 'credit' && card.creditLimit !== null
        ? card.creditLimit - outstanding
        : null;
    const utilizationPct =
      card.kind === 'credit' && card.creditLimit && card.creditLimit > 0
        ? (outstanding / card.creditLimit) * 100
        : null;

    return {
      ...card,
      outstanding,
      available,
      utilizationPct,
      thisCycleSpend: cycleSpendRow.sum,
      thisMonthSpend: monthSpendRow.sum,
      currentDue,
      currentDueDate,
      nextStatementId,
    };
  }

  private async sumSpend(
    cardId: string,
    start: string,
    end: string,
  ): Promise<{ sum: number }> {
    const row = await this.txnsRepo
      .createQueryBuilder('t')
      .select(
        'COALESCE(SUM(CASE WHEN t.is_refund THEN -t.amount ELSE t.amount END), 0)',
        'sum',
      )
      .where('t.card_id = :cardId', { cardId })
      .andWhere('t.txn_date BETWEEN :start AND :end', { start, end })
      .getRawOne<{ sum: string }>();
    return { sum: Number(row?.sum ?? 0) };
  }

  private async computeOutstanding(cardId: string): Promise<number> {
    const txnRow = await this.txnsRepo
      .createQueryBuilder('t')
      .select(
        'COALESCE(SUM(CASE WHEN t.is_refund THEN -t.amount ELSE t.amount END), 0)',
        'sum',
      )
      .where('t.card_id = :cardId', { cardId })
      .getRawOne<{ sum: string }>();
    const payRow = await this.paymentsRepo
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amount), 0)', 'sum')
      .where('p.card_id = :cardId', { cardId })
      .getRawOne<{ sum: string }>();
    const spend = Number(txnRow?.sum ?? 0);
    const paid = Number(payRow?.sum ?? 0);
    return Math.max(spend - paid, 0);
  }

  private currentCycleRange(
    card: Card,
    now: Date,
  ): { start: string; end: string } {
    if (!card.statementDay) return this.monthRange(now);
    const day = Math.min(card.statementDay, 28);
    const today = now.getUTCDate();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    let startDate: Date;
    let endDate: Date;
    if (today >= day) {
      startDate = new Date(Date.UTC(year, month, day));
      endDate = new Date(Date.UTC(year, month + 1, day - 1));
    } else {
      startDate = new Date(Date.UTC(year, month - 1, day));
      endDate = new Date(Date.UTC(year, month, day - 1));
    }
    return {
      start: startDate.toISOString().slice(0, 10),
      end: endDate.toISOString().slice(0, 10),
    };
  }

  private monthRange(now: Date): { start: string; end: string } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 0));
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }

  private async recomputeStatementTotal(em: any, statementId: string): Promise<void> {
    const sumRow = await em
      .getRepository(CardTransaction)
      .createQueryBuilder('t')
      .select(
        'COALESCE(SUM(CASE WHEN t.is_refund THEN -t.amount ELSE t.amount END), 0)',
        'sum',
      )
      .where('t.statement_id = :sid', { sid: statementId })
      .getRawOne();
    const payRow = await em
      .getRepository(CardPayment)
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amount), 0)', 'sum')
      .where('p.statement_id = :sid', { sid: statementId })
      .getRawOne();
    const total = Number(sumRow?.sum ?? 0);
    const paid = Number(payRow?.sum ?? 0);
    const stmt = await em.findOne(CardStatement, { where: { id: statementId } });
    if (!stmt) return;
    stmt.totalAmount = total;
    stmt.paidAmount = paid;
    if (paid >= total && total > 0) stmt.status = 'paid';
    await em.save(stmt);
  }

  private async linkOrphanTransactionsToStatement(
    em: any,
    stmt: CardStatement,
  ): Promise<void> {
    await em
      .getRepository(CardTransaction)
      .createQueryBuilder()
      .update()
      .set({ statementId: stmt.id })
      .where('card_id = :cid', { cid: stmt.cardId })
      .andWhere('statement_id IS NULL')
      .andWhere('txn_date BETWEEN :start AND :end', {
        start: stmt.cycleStart,
        end: stmt.cycleEnd,
      })
      .execute();
  }

  private async assertCardExists(cardId: string): Promise<void> {
    const card = await this.cardsRepo.findOne({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Card not found.');
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const cat = await this.categoriesRepo.findOne({ where: { id: categoryId } });
    if (!cat) throw new BadRequestException('Category not found.');
  }

  private async assertStatementBelongsToCard(
    statementId: string,
    cardId: string,
  ): Promise<void> {
    const stmt = await this.statementsRepo.findOne({ where: { id: statementId } });
    if (!stmt) throw new BadRequestException('Statement not found.');
    if (stmt.cardId !== cardId)
      throw new BadRequestException(
        'Statement does not belong to this card.',
      );
  }

  private validateKindFields(
    kind: 'credit' | 'debit',
    fields: Partial<CreateCardDto>,
  ): void {
    if (kind === 'debit') {
      if (
        fields.creditLimit != null ||
        fields.statementDay != null ||
        fields.dueDay != null
      ) {
        throw new BadRequestException(
          'creditLimit, statementDay, dueDay are not allowed on debit cards.',
        );
      }
    }
    if (kind === 'credit') {
      if (
        fields.linkedAccountNumber != null ||
        fields.dailyLimit != null ||
        fields.atmLimit != null
      ) {
        throw new BadRequestException(
          'linkedAccountNumber, dailyLimit, atmLimit are not allowed on credit cards.',
        );
      }
    }
  }

  private coerceFieldsForKind(
    kind: 'credit' | 'debit',
    dto: UpdateCardDto,
  ): Partial<Card> {
    const out: Partial<Card> = {};
    if (dto.kind !== undefined) out.kind = dto.kind;
    if (dto.bank !== undefined) out.bank = dto.bank;
    if (dto.network !== undefined) out.network = dto.network;
    if (dto.name !== undefined) out.name = dto.name;
    if (dto.nickname !== undefined) out.nickname = dto.nickname ?? null;
    if (dto.last4 !== undefined) out.last4 = dto.last4;
    if (dto.expiryMonth !== undefined) out.expiryMonth = dto.expiryMonth;
    if (dto.expiryYear !== undefined) out.expiryYear = dto.expiryYear;
    if (dto.holder !== undefined) out.holder = dto.holder ?? null;
    if (dto.palette !== undefined) out.palette = dto.palette;
    if (dto.pointsLabel !== undefined) out.pointsLabel = dto.pointsLabel ?? null;
    if (dto.pointsBalance !== undefined) out.pointsBalance = dto.pointsBalance;
    if (dto.pointsValue !== undefined) out.pointsValue = dto.pointsValue;
    if (dto.frozen !== undefined) out.frozen = dto.frozen;
    if (dto.onlineEnabled !== undefined) out.onlineEnabled = dto.onlineEnabled;
    if (dto.contactlessEnabled !== undefined)
      out.contactlessEnabled = dto.contactlessEnabled;
    if (dto.internationalEnabled !== undefined)
      out.internationalEnabled = dto.internationalEnabled;
    if (dto.isPrimary !== undefined) out.isPrimary = dto.isPrimary;
    if (dto.notes !== undefined) out.notes = dto.notes ?? null;

    if (kind === 'credit') {
      if (dto.creditLimit !== undefined)
        out.creditLimit = dto.creditLimit ?? null;
      if (dto.statementDay !== undefined)
        out.statementDay = dto.statementDay ?? null;
      if (dto.dueDay !== undefined) out.dueDay = dto.dueDay ?? null;
      out.linkedAccountNumber = null;
      out.dailyLimit = null;
      out.atmLimit = null;
    } else {
      if (dto.linkedAccountNumber !== undefined)
        out.linkedAccountNumber = dto.linkedAccountNumber ?? null;
      if (dto.dailyLimit !== undefined) out.dailyLimit = dto.dailyLimit ?? null;
      if (dto.atmLimit !== undefined) out.atmLimit = dto.atmLimit ?? null;
      out.creditLimit = null;
      out.statementDay = null;
      out.dueDay = null;
    }
    return out;
  }
}
