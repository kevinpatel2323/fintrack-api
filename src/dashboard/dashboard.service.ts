import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from '../database/entities/transaction.entity';
import { Account } from '../database/entities/account.entity';
import { Friend } from '../database/entities/friend.entity';
import { Category } from '../database/entities/category.entity';
import { TransactionFriendTag } from '../database/entities/transaction-friend-tag.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    @InjectRepository(Friend)
    private readonly friendsRepository: Repository<Friend>,
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
    @InjectRepository(TransactionFriendTag)
    private readonly tagsRepository: Repository<TransactionFriendTag>,
  ) {}

  async computeSpendingOverview(
    startDate?: string,
    endDate?: string,
    accountNumber?: string,
  ): Promise<any> {
    // Step 1: Query current period aggregates
    const currentQuery = this.transactionsRepository
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.withdrawal), 0)', 'totalSpent')
      .addSelect('COALESCE(SUM(t.deposit), 0)', 'totalIncome')
      .addSelect('COUNT(*)', 'transactionCount');

    if (startDate) {
      currentQuery.andWhere('t.transaction_date >= :startDate', { startDate });
    }
    if (endDate) {
      currentQuery.andWhere('t.transaction_date <= :endDate', { endDate });
    }
    if (accountNumber) {
      currentQuery
        .innerJoin('t.account', 'a')
        .andWhere('a.account_number = :accountNumber', { accountNumber });
    }

    const current = await currentQuery.getRawOne();

    // Step 2: Calculate comparison period dates (equal length before startDate)
    let compStartDate: string | null = null;
    let compEndDate: string | null = null;

    if (startDate && endDate) {
      const daysDiff = Math.ceil(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      compStartDate = new Date(
        new Date(startDate).getTime() - (daysDiff + 1) * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .split('T')[0];
      compEndDate = new Date(
        new Date(startDate).getTime() - 1 * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .split('T')[0];
    }

    // Step 3: Query comparison period aggregates
    let compTotalSpent = 0;
    let compTotalIncome = 0;

    if (compStartDate && compEndDate) {
      const comparisonQuery = this.transactionsRepository
        .createQueryBuilder('t')
        .select('COALESCE(SUM(t.withdrawal), 0)', 'totalSpent')
        .addSelect('COALESCE(SUM(t.deposit), 0)', 'totalIncome')
        .where('t.transaction_date >= :compStartDate', { compStartDate })
        .andWhere('t.transaction_date <= :compEndDate', { compEndDate });

      if (accountNumber) {
        comparisonQuery
          .innerJoin('t.account', 'a')
          .andWhere('a.account_number = :accountNumber', { accountNumber });
      }

      const comparison = await comparisonQuery.getRawOne();
      compTotalSpent = Number(comparison.totalSpent);
      compTotalIncome = Number(comparison.totalIncome);
    }

    // Step 4: Calculate derived metrics
    const totalSpent = Number(current.totalSpent);
    const totalIncome = Number(current.totalIncome);
    const transactionCount = Number(current.transactionCount);

    const percentageChange =
      compTotalSpent > 0
        ? ((totalSpent - compTotalSpent) / compTotalSpent) * 100
        : 0;

    const averageTransaction =
      transactionCount > 0 ? (totalSpent + totalIncome) / transactionCount : 0;

    // Step 5: Return SpendingOverview object
    return {
      totalSpent,
      totalIncome,
      netChange: totalIncome - totalSpent,
      transactionCount,
      averageTransaction,
      comparisonPeriod: {
        totalSpent: compTotalSpent,
        totalIncome: compTotalIncome,
        percentageChange,
      },
    };
  }

  async computeCategoryBreakdown(
    startDate?: string,
    endDate?: string,
    accountNumber?: string,
  ): Promise<any> {
    // Step 1: Query category aggregates
    const query = this.transactionsRepository
      .createQueryBuilder('t')
      .leftJoin('t.category', 'c')
      .select('t.category_id', 'categoryId')
      .addSelect('c.name', 'categoryName')
      .addSelect('c.color', 'categoryColor')
      .addSelect('COALESCE(SUM(t.withdrawal), 0)', 'totalAmount')
      .addSelect('COUNT(*)', 'transactionCount')
      .andWhere('t.withdrawal > 0') // Only expenses
      .groupBy('t.category_id, c.name, c.color')
      .orderBy('SUM(t.withdrawal)', 'DESC');

    if (startDate) {
      query.andWhere('t.transaction_date >= :startDate', { startDate });
    }
    if (endDate) {
      query.andWhere('t.transaction_date <= :endDate', { endDate });
    }
    if (accountNumber) {
      query
        .innerJoin('t.account', 'a')
        .andWhere('a.account_number = :accountNumber', { accountNumber });
    }

    const results = await query.getRawMany();

    // Step 2: Calculate total spent
    const totalSpent = results.reduce(
      (sum, row) => sum + Number(row.totalAmount),
      0,
    );

    // Step 3: Calculate percentages and format categories
    const categories = results.map((row) => {
      const totalAmount = Number(row.totalAmount);
      const percentage = totalSpent > 0 ? (totalAmount / totalSpent) * 100 : 0;

      return {
        categoryId: row.categoryId,
        categoryName: row.categoryName || 'Uncategorized',
        categoryColor: row.categoryColor,
        totalAmount,
        transactionCount: Number(row.transactionCount),
        percentage,
      };
    });

    // Step 4: Extract uncategorized data
    const uncategorized = categories.find((c) => c.categoryId === null);
    const uncategorizedAmount = uncategorized?.totalAmount || 0;
    const uncategorizedPercentage = uncategorized?.percentage || 0;

    // Return valid breakdown
    return {
      categories,
      totalSpent,
      uncategorizedAmount,
      uncategorizedPercentage,
    };
  }

  async computeFriendBalances(): Promise<any[]> {
    // Step 1: Query aggregated friend tag data
    const balances = await this.tagsRepository
      .createQueryBuilder('tag')
      .innerJoin('tag.friend', 'f')
      .select('tag.friend_id', 'friendId')
      .addSelect('f.name', 'friendName')
      .addSelect(
        `COALESCE(SUM(CASE WHEN tag.direction = 'I_OWE' THEN tag.amount ELSE 0 END), 0)`,
        'totalIOwe',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN tag.direction = 'OWES_ME' THEN tag.amount ELSE 0 END), 0)`,
        'totalOwesMe',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN tag.direction = 'SETTLEMENT' THEN tag.amount ELSE 0 END), 0)`,
        'totalSettlements',
      )
      .addSelect('MAX(t.transaction_date)', 'lastTransactionDate')
      .innerJoin('tag.transaction', 't')
      .groupBy('tag.friend_id, f.name')
      .getRawMany();

    // Step 2: Calculate net balances and filter
    const results = balances
      .map((row) => {
        const totalIOwe = Number(row.totalIOwe);
        const totalOwesMe = Number(row.totalOwesMe);
        const totalSettlements = Number(row.totalSettlements);
        const netBalance = totalOwesMe - totalIOwe - totalSettlements;

        return {
          friendId: row.friendId,
          friendName: row.friendName,
          totalIOwe,
          totalOwesMe,
          totalSettlements,
          netBalance,
          lastTransactionDate: row.lastTransactionDate,
        };
      })
      .filter((balance) => balance.netBalance !== 0) // Only show non-zero balances
      .sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance)); // Sort by absolute value

    return results;
  }

  async computeMonthlyTrends(
    monthsBack: number = 6,
    accountNumber?: string,
  ): Promise<any[]> {
    // Step 1: Generate array of month strings (YYYY-MM format)
    const months: string[] = [];
    const today = new Date();

    for (let i = monthsBack - 1; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const month = date.toISOString().slice(0, 7); // YYYY-MM
      months.push(month);
    }

    // Step 2: Write SQL query to aggregate transactions by month
    const query = this.transactionsRepository
      .createQueryBuilder('t')
      .select(`TO_CHAR(t.transaction_date, 'YYYY-MM')`, 'month')
      .addSelect('COALESCE(SUM(t.withdrawal), 0)', 'totalSpent')
      .addSelect('COALESCE(SUM(t.deposit), 0)', 'totalIncome')
      .addSelect('COUNT(*)', 'transactionCount')
      .where(`TO_CHAR(t.transaction_date, 'YYYY-MM') IN (:...months)`, {
        months,
      })
      .groupBy('month')
      .orderBy('month', 'ASC');

    if (accountNumber) {
      query
        .innerJoin('t.account', 'a')
        .andWhere('a.account_number = :accountNumber', { accountNumber });
    }

    const results = await query.getRawMany();

    // Step 3: Create lookup map for efficient data access
    const dataMap = new Map<string, any>();
    for (const row of results) {
      dataMap.set(row.month, row);
    }

    // Step 4: Build complete trends array including zero-transaction months
    const trends = months.map((month) => {
      const data = dataMap.get(month);
      const totalSpent = data ? Number(data.totalSpent) : 0;
      const totalIncome = data ? Number(data.totalIncome) : 0;
      const transactionCount = data ? Number(data.transactionCount) : 0;

      // Step 5: Format month labels (e.g., "Jan 2024")
      const date = new Date(month + '-01');
      const monthLabel = date.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      });

      return {
        month,
        monthLabel,
        totalSpent,
        totalIncome,
        netChange: totalIncome - totalSpent,
        transactionCount,
      };
    });

    // Step 6: Return MonthlyTrend array
    return trends;
  }

  async computeAccountSummary(): Promise<any[]> {
    // Step 1: Get all accounts with their latest transaction
    const accounts = await this.accountsRepository
      .createQueryBuilder('a')
      .select('a.id', 'accountId')
      .addSelect('a.account_number', 'accountNumber')
      .getMany();

    // Step 2: For each account, get aggregated transaction data
    const accountSummaries = await Promise.all(
      accounts.map(async (account) => {
        // Get latest transaction for current balance
        const latestTransaction = await this.transactionsRepository
          .createQueryBuilder('t')
          .where('t.account_id = :accountId', { accountId: account.id })
          .orderBy('t.transaction_date', 'DESC')
          .addOrderBy('t.id', 'DESC')
          .limit(1)
          .getOne();

        // Get aggregated totals
        const aggregates = await this.transactionsRepository
          .createQueryBuilder('t')
          .select('COALESCE(SUM(t.deposit), 0)', 'totalDeposits')
          .addSelect('COALESCE(SUM(t.withdrawal), 0)', 'totalWithdrawals')
          .addSelect('COUNT(*)', 'transactionCount')
          .where('t.account_id = :accountId', { accountId: account.id })
          .getRawOne();

        return {
          accountId: account.id,
          accountNumber: account.accountNumber,
          currentBalance: latestTransaction?.balance || 0,
          lastTransactionDate: latestTransaction?.transactionDate || null,
          transactionCount: Number(aggregates.transactionCount),
          totalDeposits: Number(aggregates.totalDeposits),
          totalWithdrawals: Number(aggregates.totalWithdrawals),
        };
      }),
    );

    return accountSummaries;
  }

  async computeTopCategories(
    startDate?: string,
    endDate?: string,
    limit: number = 5,
  ): Promise<any[]> {
    // Reuse category breakdown logic with limit parameter
    const breakdown = await this.computeCategoryBreakdown(
      startDate,
      endDate,
    );

    // Return top N categories by spending amount
    return breakdown.categories.slice(0, limit);
  }

  async computeIncomeVsExpenses(
    startDate?: string,
    endDate?: string,
    accountNumber?: string,
  ): Promise<any> {
    // Step 1: Query total income and expenses for the period
    const query = this.transactionsRepository
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.deposit), 0)', 'totalIncome')
      .addSelect('COALESCE(SUM(t.withdrawal), 0)', 'totalExpenses');

    if (startDate) {
      query.andWhere('t.transaction_date >= :startDate', { startDate });
    }
    if (endDate) {
      query.andWhere('t.transaction_date <= :endDate', { endDate });
    }
    if (accountNumber) {
      query
        .innerJoin('t.account', 'a')
        .andWhere('a.account_number = :accountNumber', { accountNumber });
    }

    const result = await query.getRawOne();

    // Step 2: Calculate derived metrics
    const totalIncome = Number(result.totalIncome);
    const totalExpenses = Number(result.totalExpenses);
    const netSavings = totalIncome - totalExpenses;
    const savingsRate =
      totalIncome > 0 ? (netSavings / totalIncome) * 100 : 0;
    const incomePercentage = 100; // Always 100 for reference
    const expensesPercentage =
      totalIncome > 0 ? (totalExpenses / totalIncome) * 100 : 0;

    return {
      totalIncome,
      totalExpenses,
      netSavings,
      savingsRate,
      incomePercentage,
      expensesPercentage,
    };
  }

  async computeDashboardSummary(
    startDate?: string,
    endDate?: string,
    accountNumber?: string,
  ): Promise<any> {
    // TODO: Implement dashboard summary by calling all individual methods
    const spendingOverview = await this.computeSpendingOverview(
      startDate,
      endDate,
      accountNumber,
    );
    const categoryBreakdown = await this.computeCategoryBreakdown(
      startDate,
      endDate,
      accountNumber,
    );
    const friendBalances = await this.computeFriendBalances();
    const monthlyTrends = await this.computeMonthlyTrends(6, accountNumber);
    const accountSummary = await this.computeAccountSummary();
    const topCategories = await this.computeTopCategories(
      startDate,
      endDate,
      5,
    );
    const incomeVsExpenses = await this.computeIncomeVsExpenses(
      startDate,
      endDate,
      accountNumber,
    );

    // Fetch recent transactions (limit 10)
    const recentTransactions = await this.transactionsRepository.find({
      order: { transactionDate: 'DESC' },
      take: 10,
      relations: ['account', 'category'],
    });

    return {
      spendingOverview,
      categoryBreakdown,
      friendBalances,
      monthlyTrends,
      accountSummary,
      topCategories,
      incomeVsExpenses,
      recentTransactions,
    };
  }
}
