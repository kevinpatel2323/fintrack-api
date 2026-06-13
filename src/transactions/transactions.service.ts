import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from '../database/entities/transaction.entity';
import { Account } from '../database/entities/account.entity';
import { Category } from '../database/entities/category.entity';
import { CreateManualTransactionDto } from './dto/create-manual-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
  ) {}

  private async findAccountByNumber(accountNumber: string): Promise<Account | null> {
    return this.accountsRepository.findOne({ where: { accountNumber } });
  }

  private async getOrCreateAccount(accountNumber: string): Promise<Account> {
    const existing = await this.findAccountByNumber(accountNumber);
    if (existing) return existing;

    const account = new Account();
    account.accountNumber = accountNumber;
    return this.accountsRepository.save(account);
  }

  async createManualTransaction(dto: CreateManualTransactionDto) {
    const accountNumber = 'Wallet';
    const narration = dto.narration.trim();
    if (!accountNumber) {
      throw new BadRequestException('Account number is required.');
    }
    if (!narration) {
      throw new BadRequestException('Narration is required.');
    }
    if (dto.type === 'SETTLEMENT' && !dto.settlementDirection) {
      throw new BadRequestException('Settlement direction is required.');
    }
    const account = await this.getOrCreateAccount(accountNumber);

    const transaction = new Transaction();
    transaction.transactionDate = dto.transactionDate.slice(0, 10);
    transaction.accountId = account.id;
    transaction.statementImportId = null;
    transaction.narration = narration;
    const settlementDirection = dto.settlementDirection;
    const isWithdrawal =
      dto.type === 'PAID' ||
      (dto.type === 'SETTLEMENT' && settlementDirection === 'WITHDRAWAL');
    const isDeposit =
      dto.type === 'RECEIVED' ||
      dto.type === 'I_OWE' ||
      (dto.type === 'SETTLEMENT' && settlementDirection === 'DEPOSIT');
    transaction.withdrawal = isWithdrawal ? dto.amount : 0;
    transaction.deposit = isDeposit ? dto.amount : 0;
    transaction.balance = dto.balance ?? 0;
    transaction.upiName = dto.upiName?.trim() || null;
    transaction.upiDescription = dto.upiDescription?.trim() || null;
    transaction.upiBank = dto.upiBank?.trim() || null;
    transaction.isManual = true;
    transaction.categoryId = null;

    const saved = await this.transactionsRepository.save(transaction);
    const withAccount = await this.transactionsRepository.findOne({
      where: { id: saved.id },
      relations: ['account'],
    });

    if (!withAccount) return saved;
    const { account: loadedAccount, accountId, ...rest } = withAccount;
    return { ...rest, accountNumber: loadedAccount?.accountNumber ?? null };
  }

  async getCategoryTransactionsForExport(
    categoryId: string,
    start?: string,
    end?: string,
  ): Promise<{ category: Category; transactions: Transaction[] }> {
    const category = await this.categoriesRepository.findOne({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Category not found.');

    const query = this.transactionsRepository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.account', 'account')
      .where('t.category_id = :categoryId', { categoryId });

    if (start) query.andWhere('t.transaction_date >= :start', { start });
    if (end) query.andWhere('t.transaction_date <= :end', { end });

    const transactions = await query
      .orderBy('t.transaction_date', 'ASC')
      .addOrderBy('t.id', 'ASC')
      .getMany();

    return { category, transactions };
  }

  async getTransactionById(transactionId: string) {
    const row = await this.transactionsRepository.findOne({
      where: { id: transactionId },
      relations: ['account', 'category'],
    });
    if (!row) throw new NotFoundException('Transaction not found.');

    const { account, accountId, ...rest } = row;
    return { ...rest, accountNumber: account?.accountNumber ?? null };
  }

  async setTransactionCategory(
    transactionId: string,
    categoryId: string | null,
  ): Promise<{ id: string; categoryId: string | null; category: Category | null }> {
    const transaction = await this.transactionsRepository.findOne({
      where: { id: transactionId },
    });
    if (!transaction) throw new NotFoundException('Transaction not found.');

    if (categoryId !== null) {
      const category = await this.categoriesRepository.findOne({ where: { id: categoryId } });
      if (!category) throw new NotFoundException('Category not found.');
      transaction.categoryId = categoryId;
      await this.transactionsRepository.save(transaction);
      return { id: transaction.id, categoryId, category };
    } else {
      transaction.categoryId = null;
      await this.transactionsRepository.save(transaction);
      return { id: transaction.id, categoryId: null, category: null };
    }
  }
}
