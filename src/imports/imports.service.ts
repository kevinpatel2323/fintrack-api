import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transaction } from '../database/entities/transaction.entity';
import { StatementImport } from '../database/entities/statement-import.entity';
import { Account } from '../database/entities/account.entity';
import { ParsedEntry } from './parsers/hdfc.parser';
import { TransactionFriendTag } from '../database/entities/transaction-friend-tag.entity';

function normalizeDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value);
  if (text.length >= 10) return text.slice(0, 10);
  return null;
}

type ImportPlan = {
  accountKey: string;
  lastDate: string | null;
  filtered: ParsedEntry[];
  periodStart: string | null;
  periodEnd: string | null;
};

@Injectable()
export class ImportsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
    @InjectRepository(StatementImport)
    private readonly importsRepository: Repository<StatementImport>,
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    private readonly dataSource: DataSource,
  ) {}

  async getLastImport(accountNumber?: string | null): Promise<StatementImport | null> {
    const account = accountNumber ? await this.findAccountByNumber(accountNumber) : null;
    return this.importsRepository.findOne({
      where: account ? { accountId: account.id } : {},
      order: { uploadedAt: 'DESC' },
      relations: ['account'],
    });
  }

  async listImports(page: number, limit: number, accountNumber?: string | null): Promise<StatementImport[]> {
    const account = accountNumber ? await this.findAccountByNumber(accountNumber) : null;
    return this.importsRepository.find({
      where: account ? { accountId: account.id } : {},
      order: { uploadedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      relations: ['account'],
    });
  }

  async getImportById(id: string): Promise<StatementImport | null> {
    return this.importsRepository.findOne({ where: { id }, relations: ['account'] });
  }

  async getTransactionsInRange(
    start: string,
    end: string,
    accountNumber?: string | null,
  ): Promise<Transaction[]> {
    const query = this.transactionsRepository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.account', 'account')
      .leftJoinAndSelect('t.category', 'category')
      .where('t.transactionDate BETWEEN :start AND :end', { start, end });

    if (accountNumber) {
      const account = await this.findAccountByNumber(accountNumber);
      if (!account) {
        return [];
      }
      query.andWhere('t.accountId = :accountId', { accountId: account.id });
    }

    return query.orderBy('t.transactionDate', 'ASC').addOrderBy('t.id', 'ASC').getMany();
  }

  async listAccounts(): Promise<string[]> {
    const rows = await this.accountsRepository
      .createQueryBuilder('a')
      .select('a.accountNumber', 'accountNumber')
      .orderBy('a.accountNumber', 'ASC')
      .getRawMany<{ accountNumber: string }>();

    return rows.map((row) => row.accountNumber);
  }

  async findAccountByNumber(accountNumber: string): Promise<Account | null> {
    return this.accountsRepository.findOne({ where: { accountNumber } });
  }

  async getOrCreateAccount(accountNumber: string): Promise<Account> {
    const existing = await this.findAccountByNumber(accountNumber);
    if (existing) return existing;

    const account = new Account();
    account.accountNumber = accountNumber;
    return this.accountsRepository.save(account);
  }

  private async buildImportPlan(
    entries: ParsedEntry[],
    accountNumber: string | null,
  ): Promise<ImportPlan> {
    const accountKey = accountNumber ?? 'unknown';
    const existingAccount = await this.findAccountByNumber(accountKey);

    let lastDate: string | null = null;
    if (existingAccount) {
      const lastDateResult = await this.transactionsRepository
        .createQueryBuilder('t')
        .select('MAX(t.transactionDate)::text', 'max')
        .where('t.accountId = :accountId', { accountId: existingAccount.id })
        .getRawOne<{ max: string | null }>();
      lastDate = normalizeDateOnly(lastDateResult?.max ?? null);
    }

    const filtered = (lastDate
      ? entries.filter((entry) => entry.transactionDateIso > lastDate)
      : [...entries]
    ).sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());

    const sortedEntries = [...entries].sort(
      (a, b) => a.transactionDate.getTime() - b.transactionDate.getTime(),
    );
    const periodStart = sortedEntries.length > 0 ? sortedEntries[0].transactionDateIso : null;
    const periodEnd =
      sortedEntries.length > 0 ? sortedEntries[sortedEntries.length - 1].transactionDateIso : null;

    return { accountKey, lastDate, filtered, periodStart, periodEnd };
  }

  async previewStatement(entries: ParsedEntry[], accountNumber: string | null) {
    const plan = await this.buildImportPlan(entries, accountNumber);
    const previewRows = plan.filtered.map((entry) => ({
      transactionDate: entry.transactionDateIso,
      narration: entry.narration,
      withdrawal: entry.withdrawal,
      deposit: entry.deposit,
      balance: entry.balance,
      upiName: entry.upiName,
      upiDescription: entry.upiDescription,
      upiBank: entry.upiBank,
    }));

    return {
      accountNumber: plan.accountKey,
      totalParsed: entries.length,
      willInsert: plan.filtered.length,
      skippedRows: entries.length - plan.filtered.length,
      lastDateBefore: plan.lastDate,
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      previewRows,
    };
  }

  async importStatement(entries: ParsedEntry[], filename: string | null, accountNumber: string | null) {
    const plan = await this.buildImportPlan(entries, accountNumber);
    const account = await this.getOrCreateAccount(plan.accountKey);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const importRow = new StatementImport();
      importRow.filename = filename;
      importRow.accountId = account.id;
      importRow.periodStart = plan.periodStart;
      importRow.periodEnd = plan.periodEnd;
      importRow.lastTxDateBefore = plan.lastDate;
      importRow.totalRows = entries.length;
      importRow.insertedRows = plan.filtered.length;

      const savedImportRow = await queryRunner.manager.save(importRow);

      if (plan.filtered.length > 0) {
        const newTransactions = plan.filtered.map((entry) => {
          const transaction = new Transaction();
          transaction.transactionDate = entry.transactionDateIso;
          transaction.accountId = account.id;
          transaction.statementImportId = savedImportRow.id;
          transaction.narration = entry.narration;
          transaction.withdrawal = entry.withdrawal;
          transaction.deposit = entry.deposit;
          transaction.balance = entry.balance;
          transaction.upiName = entry.upiName;
          transaction.upiDescription = entry.upiDescription;
          transaction.upiBank = entry.upiBank;
          return transaction;
        });
        await queryRunner.manager.save(newTransactions);
      }
      await queryRunner.commitTransaction();

      return {
        totalParsed: entries.length,
        insertedRows: plan.filtered.length,
        lastDateBefore: plan.lastDate,
        periodStart: plan.periodStart,
        periodEnd: plan.periodEnd,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async revertImport(importId: string) {
    const importRow = await this.importsRepository.findOne({ where: { id: importId } });
    if (!importRow) {
      throw new NotFoundException('Import not found.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const linkedTransactions = await queryRunner.manager.find(Transaction, {
        where: { statementImportId: importId },
        select: { id: true },
      });
      const transactionIds = linkedTransactions.map((row) => row.id);

      if (importRow.insertedRows > 0 && transactionIds.length === 0) {
        throw new BadRequestException(
          'This import cannot be reverted automatically because transactions are not linked to this import.',
        );
      }

      let removedTags = 0;
      if (transactionIds.length > 0) {
        const deletedTags = await queryRunner.manager
          .createQueryBuilder()
          .delete()
          .from(TransactionFriendTag)
          .where('transaction_id IN (:...transactionIds)', { transactionIds })
          .execute();
        removedTags = deletedTags.affected ?? 0;

        await queryRunner.manager
          .createQueryBuilder()
          .delete()
          .from(Transaction)
          .where('id IN (:...transactionIds)', { transactionIds })
          .execute();
      }

      await queryRunner.manager.delete(StatementImport, { id: importId });
      await queryRunner.commitTransaction();

      return {
        reverted: true,
        importId,
        removedTransactions: transactionIds.length,
        removedFriendTags: removedTags,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
