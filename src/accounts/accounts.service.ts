import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../database/entities/account.entity';
import { Transaction } from '../database/entities/transaction.entity';
import { cleanHolderName } from './account-holder-name';

export type AccountListItem = {
  id: string;
  accountNumber: string;
  holderName: string | null;
  transactionCount: number;
  lastTransactionDate: string | null;
};

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
  ) {}

  /**
   * Every account with its holder name, plus how many transactions it has and
   * the latest one's date, so the user can tell the accounts apart to name them.
   */
  async list(): Promise<AccountListItem[]> {
    const rows = await this.accountsRepository
      .createQueryBuilder('a')
      .leftJoin(Transaction, 't', 't.account_id = a.id')
      .select('a.id', 'id')
      .addSelect('a.account_number', 'accountNumber')
      .addSelect('a.holder_name', 'holderName')
      .addSelect('COUNT(t.id)', 'transactionCount')
      // As text: the pg driver would turn a raw DATE into a local-midnight Date.
      .addSelect('MAX(t.transaction_date)::text', 'lastTransactionDate')
      .groupBy('a.id')
      .orderBy('a.account_number', 'ASC')
      .getRawMany<{
        id: string;
        accountNumber: string;
        holderName: string | null;
        transactionCount: string;
        lastTransactionDate: string | null;
      }>();

    return rows.map((row) => ({
      id: String(row.id),
      accountNumber: row.accountNumber,
      holderName: row.holderName ?? null,
      transactionCount: Number(row.transactionCount) || 0,
      lastTransactionDate: row.lastTransactionDate ?? null,
    }));
  }

  /** Names the account after its holder; null or blank clears the name. */
  async setHolderName(
    id: string,
    holderName: string | null,
  ): Promise<Pick<AccountListItem, 'id' | 'accountNumber' | 'holderName'>> {
    const account = await this.accountsRepository.findOne({ where: { id } });
    if (!account) throw new NotFoundException('Account not found.');

    const name = cleanHolderName(holderName);
    await this.accountsRepository.update({ id }, { holderName: name });
    return { id: account.id, accountNumber: account.accountNumber, holderName: name };
  }
}
