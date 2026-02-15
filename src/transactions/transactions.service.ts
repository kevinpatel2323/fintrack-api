import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from '../database/entities/transaction.entity';
import { Account } from '../database/entities/account.entity';
import { CreateManualTransactionDto } from './dto/create-manual-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
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

    const saved = await this.transactionsRepository.save(transaction);
    const withAccount = await this.transactionsRepository.findOne({
      where: { id: saved.id },
      relations: ['account'],
    });

    if (!withAccount) return saved;
    const { account: loadedAccount, accountId, ...rest } = withAccount;
    return { ...rest, accountNumber: loadedAccount?.accountNumber ?? null };
  }
}
