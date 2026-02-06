import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transaction } from '../database/entities/transaction.entity';
import { StatementImport } from '../database/entities/statement-import.entity';
import { Account } from '../database/entities/account.entity';
import { ParsedEntry } from './parsers/hdfc.parser';

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

  async importStatement(entries: ParsedEntry[], filename: string | null, accountNumber: string | null) {
    const accountKey = accountNumber ?? 'unknown';
    const account = await this.getOrCreateAccount(accountKey);
    const lastDateResult = await this.transactionsRepository
      .createQueryBuilder('t')
      .select("MAX(t.transactionDate)::text", "max")
      .where('t.accountId = :accountId', { accountId: account.id })
      .getRawOne<{ max: string | null }>();
    console.log('lastDateResult', lastDateResult);

    const lastDate = normalizeDateOnly(lastDateResult?.max ?? null);
    console.log('lastDate', lastDate);

    const filtered = lastDate
      ? entries.filter((entry) => entry.transactionDateIso > lastDate)
      : entries;

    filtered.sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());

    console.log('filtered', filtered);

    const periodStart = entries.length > 0 ? entries[0].transactionDateIso : null;
    const periodEnd = entries.length > 0 ? entries[entries.length - 1].transactionDateIso : null;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (filtered.length > 0) {
        const newTransactions = filtered.map((entry) => {
          const transaction = new Transaction();
          transaction.transactionDate = entry.transactionDateIso;
          transaction.accountId = account.id;
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

      const importRow = new StatementImport();
      importRow.filename = filename;
      importRow.accountId = account.id;
      importRow.periodStart = periodStart;
      importRow.periodEnd = periodEnd;
      importRow.lastTxDateBefore = lastDate;
      importRow.totalRows = entries.length;
      importRow.insertedRows = filtered.length;

      await queryRunner.manager.save(importRow);
      await queryRunner.commitTransaction();

      return {
        totalParsed: entries.length,
        insertedRows: filtered.length,
        lastDateBefore: lastDate,
        periodStart,
        periodEnd,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
