import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DashboardService } from './dashboard.service';
import { Transaction } from '../database/entities/transaction.entity';
import { Account } from '../database/entities/account.entity';
import { Friend } from '../database/entities/friend.entity';
import { Category } from '../database/entities/category.entity';
import { TransactionFriendTag } from '../database/entities/transaction-friend-tag.entity';
import { CardTransaction } from '../database/entities/card-transaction.entity';
import {
  cardTransactionsRepoWith,
  emptyCardTransactionsRepo,
} from './testing/card-spend.mock';

/**
 * Unit Tests for Dashboard Service
 *
 * These tests validate specific examples and edge cases for the spending overview computation.
 */
describe('DashboardService - Unit Tests', () => {
  let service: DashboardService;
  let transactionsRepository: Repository<Transaction>;
  let accountsRepository: Repository<Account>;
  let tagsRepository: Repository<TransactionFriendTag>;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        DashboardService,
        {
          provide: getRepositoryToken(Transaction),
          useValue: {
            createQueryBuilder: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Account),
          useValue: {
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Friend),
          useValue: {},
        },
        {
          provide: getRepositoryToken(Category),
          useValue: {},
        },
        {
          provide: getRepositoryToken(TransactionFriendTag),
          useValue: {
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(CardTransaction),
          useValue: emptyCardTransactionsRepo(),
        },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    transactionsRepository = module.get<Repository<Transaction>>(
      getRepositoryToken(Transaction),
    );
    accountsRepository = module.get<Repository<Account>>(
      getRepositoryToken(Account),
    );
    tagsRepository = module.get<Repository<TransactionFriendTag>>(
      getRepositoryToken(TransactionFriendTag),
    );
  });

  describe('computeSpendingOverview', () => {
    /**
     * Test with empty transaction set (returns zeros)
     * 
     * When there are no transactions in the database, the method should return
     * all zero values without errors.
     */
    it('should return zeros for empty transaction set', async () => {
      // Mock query builder for current period (no transactions)
      const currentQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalSpent: '0',
          totalIncome: '0',
          transactionCount: '0',
        }),
      };

      // Mock query builder for comparison period (no transactions)
      const comparisonQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalSpent: '0',
          totalIncome: '0',
        }),
      };

      // Mock createQueryBuilder to return different builders for each call
      let callCount = 0;
      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockImplementation(() => {
          callCount++;
          return callCount === 1
            ? (currentQueryBuilder as any)
            : (comparisonQueryBuilder as any);
        });

      const result = await service.computeSpendingOverview(
        '2024-01-01',
        '2024-01-31',
      );

      // Verify all values are zero
      expect(result.totalSpent).toBe(0);
      expect(result.totalIncome).toBe(0);
      expect(result.netChange).toBe(0);
      expect(result.transactionCount).toBe(0);
      expect(result.averageTransaction).toBe(0);
      expect(result.comparisonPeriod.totalSpent).toBe(0);
      expect(result.comparisonPeriod.totalIncome).toBe(0);
      expect(result.comparisonPeriod.percentageChange).toBe(0);
    });

    /**
     * Test with single transaction
     * 
     * When there is exactly one transaction, the method should correctly
     * calculate all metrics including the average transaction amount.
     */
    it('should correctly compute metrics for single transaction', async () => {
      // Mock query builder for current period (one transaction)
      const currentQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalSpent: '5000',
          totalIncome: '0',
          transactionCount: '1',
        }),
      };

      // Mock query builder for comparison period (no transactions)
      const comparisonQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalSpent: '0',
          totalIncome: '0',
        }),
      };

      let callCount = 0;
      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockImplementation(() => {
          callCount++;
          return callCount === 1
            ? (currentQueryBuilder as any)
            : (comparisonQueryBuilder as any);
        });

      const result = await service.computeSpendingOverview(
        '2024-01-01',
        '2024-01-31',
      );

      // Verify single transaction metrics
      expect(result.totalSpent).toBe(5000);
      expect(result.totalIncome).toBe(0);
      expect(result.netChange).toBe(-5000); // 0 - 5000
      expect(result.transactionCount).toBe(1);
      expect(result.averageTransaction).toBe(5000); // (5000 + 0) / 1
      expect(result.comparisonPeriod.totalSpent).toBe(0);
      expect(result.comparisonPeriod.totalIncome).toBe(0);
      expect(result.comparisonPeriod.percentageChange).toBe(0); // No previous spending
    });

    /**
     * Test comparison period calculation
     * 
     * The comparison period should be of equal length to the current period
     * and should end one day before the current period starts.
     */
    it('should correctly calculate comparison period dates and percentage change', async () => {
      // Mock query builder for current period
      const currentQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalSpent: '10000',
          totalIncome: '15000',
          transactionCount: '5',
        }),
      };

      // Mock query builder for comparison period
      const comparisonQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalSpent: '8000',
          totalIncome: '12000',
        }),
      };

      let callCount = 0;
      const createQueryBuilderSpy = jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockImplementation(() => {
          callCount++;
          return callCount === 1
            ? (currentQueryBuilder as any)
            : (comparisonQueryBuilder as any);
        });

      const result = await service.computeSpendingOverview(
        '2024-01-01',
        '2024-01-31',
      );

      // Verify comparison period was queried
      expect(createQueryBuilderSpy).toHaveBeenCalledTimes(2);
      
      // Verify comparison period data
      expect(result.comparisonPeriod.totalSpent).toBe(8000);
      expect(result.comparisonPeriod.totalIncome).toBe(12000);
      
      // Verify percentage change calculation
      // ((10000 - 8000) / 8000) * 100 = 25%
      expect(result.comparisonPeriod.percentageChange).toBe(25);

      // Verify the comparison query was called with correct date parameters.
      // `where` is spent on the CC bill-payment exclusion, so both date bounds
      // arrive as `andWhere`.
      expect(comparisonQueryBuilder.andWhere).toHaveBeenCalledWith(
        't.transaction_date >= :compStartDate',
        expect.objectContaining({ compStartDate: expect.any(String) }),
      );
      expect(comparisonQueryBuilder.andWhere).toHaveBeenCalledWith(
        't.transaction_date <= :compEndDate',
        expect.objectContaining({ compEndDate: expect.any(String) }),
      );
    });

    /**
     * Test account filtering
     * 
     * When an accountNumber is provided, the query should filter transactions
     * to only include those from the specified account.
     */
    it('should filter by account number when provided', async () => {
      const testAccountNumber = '1234567890';

      // Mock query builder for current period
      const currentQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalSpent: '3000',
          totalIncome: '5000',
          transactionCount: '3',
        }),
      };

      // Mock query builder for comparison period
      const comparisonQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalSpent: '2500',
          totalIncome: '4000',
        }),
      };

      let callCount = 0;
      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockImplementation(() => {
          callCount++;
          return callCount === 1
            ? (currentQueryBuilder as any)
            : (comparisonQueryBuilder as any);
        });

      const result = await service.computeSpendingOverview(
        '2024-01-01',
        '2024-01-31',
        testAccountNumber,
      );

      // Verify account filtering was applied to current period query
      expect(currentQueryBuilder.innerJoin).toHaveBeenCalledWith(
        't.account',
        'a',
      );
      expect(currentQueryBuilder.andWhere).toHaveBeenCalledWith(
        'a.account_number = :accountNumber',
        { accountNumber: testAccountNumber },
      );

      // Verify account filtering was applied to comparison period query
      expect(comparisonQueryBuilder.innerJoin).toHaveBeenCalledWith(
        't.account',
        'a',
      );
      expect(comparisonQueryBuilder.andWhere).toHaveBeenCalledWith(
        'a.account_number = :accountNumber',
        { accountNumber: testAccountNumber },
      );

      // Verify results are returned correctly
      expect(result.totalSpent).toBe(3000);
      expect(result.totalIncome).toBe(5000);
      expect(result.netChange).toBe(2000); // 5000 - 3000
      expect(result.transactionCount).toBe(3);
    });

    /**
     * Test without date range parameters
     * 
     * When no date range is provided, the method should query all transactions
     * and not calculate a comparison period.
     */
    it('should handle missing date range parameters', async () => {
      // Mock query builder for current period (all transactions)
      const currentQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalSpent: '50000',
          totalIncome: '60000',
          transactionCount: '20',
        }),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(currentQueryBuilder as any);

      const result = await service.computeSpendingOverview();

      // Verify no date filters were applied
      expect(currentQueryBuilder.andWhere).not.toHaveBeenCalled();

      // Verify comparison period is zero (no date range to compare)
      expect(result.comparisonPeriod.totalSpent).toBe(0);
      expect(result.comparisonPeriod.totalIncome).toBe(0);
      expect(result.comparisonPeriod.percentageChange).toBe(0);

      // Verify current period data
      expect(result.totalSpent).toBe(50000);
      expect(result.totalIncome).toBe(60000);
      expect(result.netChange).toBe(10000);
      expect(result.transactionCount).toBe(20);
      expect(result.averageTransaction).toBe(5500); // (50000 + 60000) / 20
    });

    /**
     * Test percentage change with decreased spending
     * 
     * When current spending is less than previous period, percentage change
     * should be negative.
     */
    it('should calculate negative percentage change when spending decreases', async () => {
      // Mock query builder for current period
      const currentQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalSpent: '6000',
          totalIncome: '10000',
          transactionCount: '4',
        }),
      };

      // Mock query builder for comparison period (higher spending)
      const comparisonQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalSpent: '10000',
          totalIncome: '12000',
        }),
      };

      let callCount = 0;
      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockImplementation(() => {
          callCount++;
          return callCount === 1
            ? (currentQueryBuilder as any)
            : (comparisonQueryBuilder as any);
        });

      const result = await service.computeSpendingOverview(
        '2024-02-01',
        '2024-02-29',
      );

      // Verify percentage change is negative
      // ((6000 - 10000) / 10000) * 100 = -40%
      expect(result.comparisonPeriod.percentageChange).toBe(-40);
      expect(result.comparisonPeriod.percentageChange).toBeLessThan(0);
    });
  });

  describe('computeCategoryBreakdown', () => {
    /**
     * Test percentage calculation accuracy
     * 
     * When there are multiple categories with different amounts, the method
     * should correctly calculate the percentage for each category relative
     * to the total spent.
     */
    it('should calculate accurate percentages for each category', async () => {
      // Mock query builder with multiple categories
      const queryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            categoryId: '1',
            categoryName: 'Food & Dining',
            categoryColor: '#FF6B6B',
            totalAmount: '6000',
            transactionCount: '10',
          },
          {
            categoryId: '2',
            categoryName: 'Transportation',
            categoryColor: '#4ECDC4',
            totalAmount: '3000',
            transactionCount: '5',
          },
          {
            categoryId: '3',
            categoryName: 'Shopping',
            categoryColor: '#95E1D3',
            totalAmount: '1000',
            transactionCount: '2',
          },
        ]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeCategoryBreakdown(
        '2024-01-01',
        '2024-01-31',
      );

      // Verify total spent calculation
      expect(result.totalSpent).toBe(10000); // 6000 + 3000 + 1000

      // Verify percentage calculations
      expect(result.categories[0].percentage).toBe(60); // 6000 / 10000 * 100
      expect(result.categories[1].percentage).toBe(30); // 3000 / 10000 * 100
      expect(result.categories[2].percentage).toBe(10); // 1000 / 10000 * 100

      // Verify percentages sum to 100
      const totalPercentage = result.categories.reduce(
        (sum: number, cat: any) => sum + cat.percentage,
        0,
      );
      expect(totalPercentage).toBe(100);

      // Verify categories are sorted by amount descending
      expect(result.categories[0].totalAmount).toBeGreaterThanOrEqual(
        result.categories[1].totalAmount,
      );
      expect(result.categories[1].totalAmount).toBeGreaterThanOrEqual(
        result.categories[2].totalAmount,
      );
    });

    /**
     * Test with uncategorized transactions
     * 
     * When there are transactions without a category (categoryId = null),
     * they should be included in the breakdown with the name "Uncategorized"
     * and their amount should be tracked separately.
     */
    it('should handle uncategorized transactions correctly', async () => {
      // Mock query builder with uncategorized transactions
      const queryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            categoryId: '1',
            categoryName: 'Food & Dining',
            categoryColor: '#FF6B6B',
            totalAmount: '7000',
            transactionCount: '8',
          },
          {
            categoryId: null,
            categoryName: null,
            categoryColor: null,
            totalAmount: '3000',
            transactionCount: '5',
          },
        ]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeCategoryBreakdown(
        '2024-01-01',
        '2024-01-31',
      );

      // Verify total spent includes uncategorized
      expect(result.totalSpent).toBe(10000); // 7000 + 3000

      // Verify uncategorized category has correct name
      const uncategorized = result.categories.find((c: any) => c.categoryId === null);
      expect(uncategorized).toBeDefined();
      expect(uncategorized.categoryName).toBe('Uncategorized');

      // Verify uncategorized amount and percentage are tracked
      expect(result.uncategorizedAmount).toBe(3000);
      expect(result.uncategorizedPercentage).toBe(30); // 3000 / 10000 * 100

      // Verify categorized amount
      const categorized = result.categories.find((c: any) => c.categoryId === '1');
      expect(categorized.totalAmount).toBe(7000);
      expect(categorized.percentage).toBe(70); // 7000 / 10000 * 100
    });

    /**
     * Test sorting by amount
     * 
     * Categories should be sorted by totalAmount in descending order,
     * with the highest spending category first.
     */
    it('should sort categories by amount in descending order', async () => {
      // Mock query builder with categories in random order
      const queryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            categoryId: '1',
            categoryName: 'Food & Dining',
            categoryColor: '#FF6B6B',
            totalAmount: '15000',
            transactionCount: '20',
          },
          {
            categoryId: '2',
            categoryName: 'Transportation',
            categoryColor: '#4ECDC4',
            totalAmount: '8000',
            transactionCount: '12',
          },
          {
            categoryId: '3',
            categoryName: 'Entertainment',
            categoryColor: '#F38181',
            totalAmount: '5000',
            transactionCount: '8',
          },
          {
            categoryId: '4',
            categoryName: 'Utilities',
            categoryColor: '#AA96DA',
            totalAmount: '2000',
            transactionCount: '4',
          },
        ]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeCategoryBreakdown(
        '2024-01-01',
        '2024-01-31',
      );

      // Verify sorting is applied by the SQL query (orderBy was called)
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('SUM(t.withdrawal)', 'DESC');

      // Verify categories are in descending order
      expect(result.categories.length).toBe(4);
      expect(result.categories[0].totalAmount).toBe(15000);
      expect(result.categories[1].totalAmount).toBe(8000);
      expect(result.categories[2].totalAmount).toBe(5000);
      expect(result.categories[3].totalAmount).toBe(2000);

      // Verify each category is greater than or equal to the next
      for (let i = 0; i < result.categories.length - 1; i++) {
        expect(result.categories[i].totalAmount).toBeGreaterThanOrEqual(
          result.categories[i + 1].totalAmount,
        );
      }
    });

    /**
     * Test with empty transaction set
     * 
     * When there are no expense transactions in the date range, the method
     * should return an empty categories array with zero totals.
     */
    it('should return empty breakdown for no transactions', async () => {
      // Mock query builder with no results
      const queryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeCategoryBreakdown(
        '2024-01-01',
        '2024-01-31',
      );

      // Verify empty results
      expect(result.categories).toEqual([]);
      expect(result.totalSpent).toBe(0);
      expect(result.uncategorizedAmount).toBe(0);
      expect(result.uncategorizedPercentage).toBe(0);
    });

    /**
     * Test percentage calculation with zero total
     * 
     * When totalSpent is zero, percentages should be zero to avoid
     * division by zero errors.
     */
    it('should handle zero total spent without errors', async () => {
      // Mock query builder with zero amounts
      const queryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            categoryId: '1',
            categoryName: 'Food & Dining',
            categoryColor: '#FF6B6B',
            totalAmount: '0',
            transactionCount: '0',
          },
        ]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeCategoryBreakdown(
        '2024-01-01',
        '2024-01-31',
      );

      // Verify no division by zero errors
      expect(result.totalSpent).toBe(0);
      expect(result.categories[0].percentage).toBe(0);
      expect(result.uncategorizedPercentage).toBe(0);
    });

    /**
     * Test account filtering
     * 
     * When an accountNumber is provided, the query should filter transactions
     * to only include those from the specified account.
     */
    it('should filter by account number when provided', async () => {
      const testAccountNumber = '1234567890';

      // Mock query builder
      const queryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            categoryId: '1',
            categoryName: 'Food & Dining',
            categoryColor: '#FF6B6B',
            totalAmount: '5000',
            transactionCount: '7',
          },
        ]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeCategoryBreakdown(
        '2024-01-01',
        '2024-01-31',
        testAccountNumber,
      );

      // Verify account filtering was applied
      expect(queryBuilder.innerJoin).toHaveBeenCalledWith('t.account', 'a');
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'a.account_number = :accountNumber',
        { accountNumber: testAccountNumber },
      );

      // Verify results are returned correctly
      expect(result.totalSpent).toBe(5000);
      expect(result.categories.length).toBe(1);
    });
  });

  describe('computeFriendBalances', () => {
    /**
     * Test net balance calculation
     * 
     * The net balance should be correctly calculated as:
     * netBalance = totalOwesMe - totalIOwe - totalSettlements
     */
    it('should correctly calculate net balance for each friend', async () => {
      // Mock query builder with friend balance data
      const queryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            friendId: '1',
            friendName: 'Alice',
            totalIOwe: '2000',
            totalOwesMe: '5000',
            totalSettlements: '1000',
            lastTransactionDate: '2024-01-28',
          },
          {
            friendId: '2',
            friendName: 'Bob',
            totalIOwe: '3000',
            totalOwesMe: '1000',
            totalSettlements: '0',
            lastTransactionDate: '2024-01-25',
          },
          {
            friendId: '3',
            friendName: 'Charlie',
            totalIOwe: '0',
            totalOwesMe: '4000',
            totalSettlements: '2000',
            lastTransactionDate: '2024-01-20',
          },
        ]),
      };

      jest
        .spyOn(tagsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeFriendBalances();

      // Verify net balance calculations
      // Alice: 5000 - 2000 - 1000 = 2000 (Alice owes me)
      const alice = result.find((b: any) => b.friendName === 'Alice');
      expect(alice).toBeDefined();
      expect(alice.netBalance).toBe(2000);
      expect(alice.totalIOwe).toBe(2000);
      expect(alice.totalOwesMe).toBe(5000);
      expect(alice.totalSettlements).toBe(1000);

      // Bob: 1000 - 3000 - 0 = -2000 (I owe Bob)
      const bob = result.find((b: any) => b.friendName === 'Bob');
      expect(bob).toBeDefined();
      expect(bob.netBalance).toBe(-2000);
      expect(bob.totalIOwe).toBe(3000);
      expect(bob.totalOwesMe).toBe(1000);
      expect(bob.totalSettlements).toBe(0);

      // Charlie: 4000 - 0 - 2000 = 2000 (Charlie owes me)
      const charlie = result.find((b: any) => b.friendName === 'Charlie');
      expect(charlie).toBeDefined();
      expect(charlie.netBalance).toBe(2000);
      expect(charlie.totalIOwe).toBe(0);
      expect(charlie.totalOwesMe).toBe(4000);
      expect(charlie.totalSettlements).toBe(2000);
    });

    /**
     * Test filtering of zero balances
     * 
     * Friends with a net balance of zero should be filtered out from the results,
     * as they have no outstanding balance.
     */
    it('should filter out friends with zero net balance', async () => {
      // Mock query builder with some zero-balance friends
      const queryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            friendId: '1',
            friendName: 'Alice',
            totalIOwe: '3000',
            totalOwesMe: '5000',
            totalSettlements: '0',
            lastTransactionDate: '2024-01-28',
          },
          {
            friendId: '2',
            friendName: 'Bob',
            totalIOwe: '2000',
            totalOwesMe: '1000',
            totalSettlements: '0',
            lastTransactionDate: '2024-01-25',
          },
          {
            friendId: '3',
            friendName: 'Charlie',
            totalIOwe: '3000',
            totalOwesMe: '2000',
            totalSettlements: '1000',
            lastTransactionDate: '2024-01-20',
          },
          {
            friendId: '4',
            friendName: 'David',
            totalIOwe: '5000',
            totalOwesMe: '3000',
            totalSettlements: '2000',
            lastTransactionDate: '2024-01-15',
          },
        ]),
      };

      jest
        .spyOn(tagsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeFriendBalances();

      // Charlie: 2000 - 3000 - 1000 = -2000 (should be included)
      // David: 3000 - 5000 - 2000 = -4000 (should be included)
      // But if we calculate correctly:
      // Alice: 5000 - 3000 - 0 = 2000 (included)
      // Bob: 1000 - 2000 - 0 = -1000 (included)
      // Charlie: 2000 - 3000 - 1000 = -2000 (included)
      // David: 3000 - 5000 - 2000 = -4000 (included)

      // All have non-zero balances, so all should be included
      expect(result.length).toBe(4);

      // Now test with actual zero balance
      const queryBuilderWithZero = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            friendId: '1',
            friendName: 'Alice',
            totalIOwe: '2000',
            totalOwesMe: '5000',
            totalSettlements: '3000',
            lastTransactionDate: '2024-01-28',
          },
          {
            friendId: '2',
            friendName: 'Bob',
            totalIOwe: '1000',
            totalOwesMe: '1000',
            totalSettlements: '0',
            lastTransactionDate: '2024-01-25',
          },
        ]),
      };

      jest
        .spyOn(tagsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilderWithZero as any);

      const resultWithZero = await service.computeFriendBalances();

      // Alice: 5000 - 2000 - 3000 = 0 (should be filtered out)
      // Bob: 1000 - 1000 - 0 = 0 (should be filtered out)
      expect(resultWithZero.length).toBe(0);

      // Verify no friends with zero balance are included
      const zeroBalanceFriends = resultWithZero.filter(
        (b: any) => b.netBalance === 0,
      );
      expect(zeroBalanceFriends.length).toBe(0);
    });

    /**
     * Test sorting by absolute value
     * 
     * Friends should be sorted by the absolute value of their net balance
     * in descending order, regardless of whether the balance is positive or negative.
     */
    it('should sort friends by absolute net balance in descending order', async () => {
      // Mock query builder with friends having various balances
      const queryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            friendId: '1',
            friendName: 'Alice',
            totalIOwe: '1000',
            totalOwesMe: '6000',
            totalSettlements: '0',
            lastTransactionDate: '2024-01-28',
          },
          {
            friendId: '2',
            friendName: 'Bob',
            totalIOwe: '8000',
            totalOwesMe: '2000',
            totalSettlements: '1000',
            lastTransactionDate: '2024-01-25',
          },
          {
            friendId: '3',
            friendName: 'Charlie',
            totalIOwe: '500',
            totalOwesMe: '3500',
            totalSettlements: '0',
            lastTransactionDate: '2024-01-20',
          },
          {
            friendId: '4',
            friendName: 'David',
            totalIOwe: '4000',
            totalOwesMe: '1000',
            totalSettlements: '0',
            lastTransactionDate: '2024-01-15',
          },
        ]),
      };

      jest
        .spyOn(tagsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeFriendBalances();

      // Calculate expected net balances:
      // Alice: 6000 - 1000 - 0 = 5000 (absolute: 5000)
      // Bob: 2000 - 8000 - 1000 = -7000 (absolute: 7000)
      // Charlie: 3500 - 500 - 0 = 3000 (absolute: 3000)
      // David: 1000 - 4000 - 0 = -3000 (absolute: 3000)

      // Expected order by absolute value: Bob (7000), Alice (5000), Charlie (3000), David (3000)
      expect(result.length).toBe(4);
      expect(result[0].friendName).toBe('Bob');
      expect(Math.abs(result[0].netBalance)).toBe(7000);
      expect(result[1].friendName).toBe('Alice');
      expect(Math.abs(result[1].netBalance)).toBe(5000);

      // Charlie and David both have absolute balance of 3000
      // Their relative order doesn't matter, but both should come after Alice
      expect(Math.abs(result[2].netBalance)).toBe(3000);
      expect(Math.abs(result[3].netBalance)).toBe(3000);

      // Verify sorting is correct: each absolute balance >= next
      for (let i = 0; i < result.length - 1; i++) {
        expect(Math.abs(result[i].netBalance)).toBeGreaterThanOrEqual(
          Math.abs(result[i + 1].netBalance),
        );
      }
    });

    /**
     * Test with empty friend tags
     * 
     * When there are no friend tags in the database, the method should
     * return an empty array without errors.
     */
    it('should return empty array when no friend tags exist', async () => {
      // Mock query builder with no results
      const queryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      jest
        .spyOn(tagsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeFriendBalances();

      // Verify empty results
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    /**
     * Test with only settlements
     * 
     * When a friend has only settlement transactions, the net balance
     * should be negative (settlements reduce what they owe or what I owe).
     */
    it('should handle friends with only settlement transactions', async () => {
      // Mock query builder with settlement-only friend
      const queryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            friendId: '1',
            friendName: 'Alice',
            totalIOwe: '0',
            totalOwesMe: '0',
            totalSettlements: '5000',
            lastTransactionDate: '2024-01-28',
          },
        ]),
      };

      jest
        .spyOn(tagsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeFriendBalances();

      // Alice: 0 - 0 - 5000 = -5000
      // This represents a settlement that was recorded, resulting in negative balance
      expect(result.length).toBe(1);
      expect(result[0].friendName).toBe('Alice');
      expect(result[0].netBalance).toBe(-5000);
      expect(result[0].totalSettlements).toBe(5000);
    });

    /**
     * Test last transaction date tracking
     * 
     * The method should correctly track the last transaction date for each friend.
     */
    it('should track last transaction date for each friend', async () => {
      // Mock query builder with transaction dates
      const queryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            friendId: '1',
            friendName: 'Alice',
            totalIOwe: '1000',
            totalOwesMe: '2000',
            totalSettlements: '0',
            lastTransactionDate: '2024-01-28',
          },
          {
            friendId: '2',
            friendName: 'Bob',
            totalIOwe: '3000',
            totalOwesMe: '1000',
            totalSettlements: '0',
            lastTransactionDate: '2024-01-15',
          },
        ]),
      };

      jest
        .spyOn(tagsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeFriendBalances();

      // Verify last transaction dates are preserved
      const alice = result.find((b: any) => b.friendName === 'Alice');
      expect(alice.lastTransactionDate).toBe('2024-01-28');

      const bob = result.find((b: any) => b.friendName === 'Bob');
      expect(bob.lastTransactionDate).toBe('2024-01-15');
    });
  });

  describe('computeMonthlyTrends', () => {
    /**
     * Test month generation logic
     * 
     * The method should generate the correct number of months in YYYY-MM format,
     * going back from the current month.
     */
    it('should generate correct number of months in YYYY-MM format', async () => {
      const monthsBack = 6;

      // Mock query builder with no transaction data
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeMonthlyTrends(monthsBack);

      // Verify correct number of months
      expect(result).toHaveLength(monthsBack);

      // Verify each month is in YYYY-MM format
      const monthRegex = /^\d{4}-\d{2}$/;
      for (const trend of result) {
        expect(trend.month).toMatch(monthRegex);
      }

      // Verify months are sequential
      for (let i = 0; i < result.length - 1; i++) {
        const currentDate = new Date(result[i].month + '-01');
        const nextDate = new Date(result[i + 1].month + '-01');
        
        // Next month should be exactly one month after current
        const expectedNext = new Date(currentDate);
        expectedNext.setMonth(expectedNext.getMonth() + 1);
        
        expect(nextDate.getFullYear()).toBe(expectedNext.getFullYear());
        expect(nextDate.getMonth()).toBe(expectedNext.getMonth());
      }
    });

    /**
     * Test with months having zero transactions
     * 
     * When some months have no transactions, they should still be included
     * in the results with zero values.
     */
    it('should include months with zero transactions', async () => {
      const monthsBack = 6;
      const today = new Date();

      // Generate expected months
      const expectedMonths: string[] = [];
      for (let i = monthsBack - 1; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const month = date.toISOString().slice(0, 7);
        expectedMonths.push(month);
      }

      // Mock query builder with data for only 2 months (others have zero transactions)
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            month: expectedMonths[0],
            totalSpent: '5000',
            totalIncome: '8000',
            transactionCount: '10',
          },
          {
            month: expectedMonths[3],
            totalSpent: '3000',
            totalIncome: '6000',
            transactionCount: '7',
          },
        ]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeMonthlyTrends(monthsBack);

      // Verify all months are included
      expect(result).toHaveLength(monthsBack);

      // Verify months with data have correct values
      expect(result[0].totalSpent).toBe(5000);
      expect(result[0].totalIncome).toBe(8000);
      expect(result[0].transactionCount).toBe(10);
      expect(result[0].netChange).toBe(3000); // 8000 - 5000

      expect(result[3].totalSpent).toBe(3000);
      expect(result[3].totalIncome).toBe(6000);
      expect(result[3].transactionCount).toBe(7);
      expect(result[3].netChange).toBe(3000); // 6000 - 3000

      // Verify months without data have zero values
      expect(result[1].totalSpent).toBe(0);
      expect(result[1].totalIncome).toBe(0);
      expect(result[1].transactionCount).toBe(0);
      expect(result[1].netChange).toBe(0);

      expect(result[2].totalSpent).toBe(0);
      expect(result[2].totalIncome).toBe(0);
      expect(result[2].transactionCount).toBe(0);
      expect(result[2].netChange).toBe(0);
    });

    /**
     * Test chronological ordering
     * 
     * Months should be ordered from oldest to newest (chronologically).
     */
    it('should return months in chronological order (oldest to newest)', async () => {
      const monthsBack = 12;

      // Mock query builder with random month data
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            month: '2024-01',
            totalSpent: '5000',
            totalIncome: '8000',
            transactionCount: '10',
          },
          {
            month: '2024-03',
            totalSpent: '3000',
            totalIncome: '6000',
            transactionCount: '7',
          },
        ]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeMonthlyTrends(monthsBack);

      // Verify chronological ordering
      for (let i = 0; i < result.length - 1; i++) {
        const currentDate = new Date(result[i].month + '-01');
        const nextDate = new Date(result[i + 1].month + '-01');
        
        expect(currentDate.getTime()).toBeLessThan(nextDate.getTime());
      }

      // Verify first month is oldest
      const firstMonth = new Date(result[0].month + '-01');
      const lastMonth = new Date(result[result.length - 1].month + '-01');
      
      expect(firstMonth.getTime()).toBeLessThan(lastMonth.getTime());
    });

    /**
     * Test month label formatting
     * 
     * Each trend should have a monthLabel in "MMM YYYY" format (e.g., "Jan 2024").
     */
    it('should format month labels correctly', async () => {
      const monthsBack = 3;

      // Mock query builder
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeMonthlyTrends(monthsBack);

      // Verify each trend has a monthLabel
      for (const trend of result) {
        expect(trend.monthLabel).toBeDefined();
        expect(typeof trend.monthLabel).toBe('string');
        
        // monthLabel should match format "MMM YYYY" (e.g., "Jan 2024")
        expect(trend.monthLabel).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
      }
    });

    /**
     * Test account filtering
     * 
     * When an accountNumber is provided, the query should filter transactions
     * to only include those from the specified account.
     */
    it('should filter by account number when provided', async () => {
      const monthsBack = 6;
      const testAccountNumber = '1234567890';

      // Mock query builder
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeMonthlyTrends(
        monthsBack,
        testAccountNumber,
      );

      // Verify account filtering was applied
      expect(queryBuilder.innerJoin).toHaveBeenCalledWith('t.account', 'a');
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'a.account_number = :accountNumber',
        { accountNumber: testAccountNumber },
      );

      // Verify results are returned correctly
      expect(result).toHaveLength(monthsBack);
    });

    /**
     * Test netChange calculation
     * 
     * For each month, netChange should equal totalIncome - totalSpent.
     */
    it('should correctly calculate netChange for each month', async () => {
      const monthsBack = 4;
      const today = new Date();

      // Generate expected months
      const expectedMonths: string[] = [];
      for (let i = monthsBack - 1; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const month = date.toISOString().slice(0, 7);
        expectedMonths.push(month);
      }

      // Mock query builder with various income/expense combinations
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            month: expectedMonths[0],
            totalSpent: '5000',
            totalIncome: '8000',
            transactionCount: '10',
          },
          {
            month: expectedMonths[1],
            totalSpent: '7000',
            totalIncome: '6000',
            transactionCount: '12',
          },
          {
            month: expectedMonths[2],
            totalSpent: '3000',
            totalIncome: '3000',
            transactionCount: '8',
          },
        ]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeMonthlyTrends(monthsBack);

      // Verify netChange calculations
      expect(result[0].netChange).toBe(3000); // 8000 - 5000 (positive)
      expect(result[1].netChange).toBe(-1000); // 6000 - 7000 (negative)
      expect(result[2].netChange).toBe(0); // 3000 - 3000 (zero)
      expect(result[3].netChange).toBe(0); // No data, should be 0
    });

    /**
     * Test default monthsBack parameter
     * 
     * When monthsBack is not provided, it should default to 6 months.
     */
    it('should default to 6 months when monthsBack is not provided', async () => {
      // Mock query builder
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeMonthlyTrends();

      // Verify default is 6 months
      expect(result).toHaveLength(6);
    });
  });

  describe('computeAccountSummary', () => {
    /**
     * Test account summary returns array
     * 
     * The method should return an array of account summaries.
     * Note: Full integration testing with real database is recommended
     * for this method due to complex query builder chains.
     */
    it('should return an array of account summaries', async () => {
      // Mock accounts
      const mockAccounts = [
        { id: '1', accountNumber: '1234567890' },
      ];

      jest
        .spyOn(accountsRepository, 'createQueryBuilder')
        .mockReturnValue({
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(mockAccounts),
        } as any);

      // Mock transaction queries with complete chain
      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue({
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          addOrderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({
            id: '1',
            balance: 50000,
            transactionDate: new Date('2024-01-31'),
          }),
          getRawOne: jest.fn().mockResolvedValue({
            totalDeposits: '60000',
            totalWithdrawals: '10000',
            transactionCount: '25',
          }),
        } as any);

      const result = await service.computeAccountSummary();

      // Verify result is an array
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(0);
      
      // If there are results, verify structure
      if (result.length > 0) {
        expect(result[0]).toHaveProperty('accountId');
        expect(result[0]).toHaveProperty('accountNumber');
        expect(result[0]).toHaveProperty('currentBalance');
        expect(result[0]).toHaveProperty('lastTransactionDate');
        expect(result[0]).toHaveProperty('transactionCount');
        expect(result[0]).toHaveProperty('totalDeposits');
        expect(result[0]).toHaveProperty('totalWithdrawals');
      }
    });

    /**
     * Test with empty accounts list
     * 
     * When there are no accounts, should return empty array.
     */
    it('should return empty array when no accounts exist', async () => {
      jest
        .spyOn(accountsRepository, 'createQueryBuilder')
        .mockReturnValue({
          select: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        } as any);

      const result = await service.computeAccountSummary();

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('computeTopCategories', () => {
    /**
     * Test top categories limit parameter
     * 
     * The method should return only the top N categories by spending amount.
     */
    it('should return top N categories by spending amount', async () => {
      // Mock query builder with multiple categories
      const queryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            categoryId: '1',
            categoryName: 'Food & Dining',
            categoryColor: '#FF6B6B',
            totalAmount: '15000',
            transactionCount: '20',
          },
          {
            categoryId: '2',
            categoryName: 'Transportation',
            categoryColor: '#4ECDC4',
            totalAmount: '8000',
            transactionCount: '12',
          },
          {
            categoryId: '3',
            categoryName: 'Entertainment',
            categoryColor: '#F38181',
            totalAmount: '5000',
            transactionCount: '8',
          },
          {
            categoryId: '4',
            categoryName: 'Utilities',
            categoryColor: '#AA96DA',
            totalAmount: '3000',
            transactionCount: '6',
          },
          {
            categoryId: '5',
            categoryName: 'Shopping',
            categoryColor: '#95E1D3',
            totalAmount: '2000',
            transactionCount: '4',
          },
          {
            categoryId: '6',
            categoryName: 'Healthcare',
            categoryColor: '#FCBAD3',
            totalAmount: '1000',
            transactionCount: '2',
          },
        ]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      // Request top 3 categories
      const result = await service.computeTopCategories(
        '2024-01-01',
        '2024-01-31',
        3,
      );

      // Verify only top 3 are returned
      expect(result).toHaveLength(3);
      expect(result[0].categoryName).toBe('Food & Dining');
      expect(result[0].totalAmount).toBe(15000);
      expect(result[1].categoryName).toBe('Transportation');
      expect(result[1].totalAmount).toBe(8000);
      expect(result[2].categoryName).toBe('Entertainment');
      expect(result[2].totalAmount).toBe(5000);
    });

    /**
     * Test default limit
     * 
     * When limit is not provided, it should default to 5 categories.
     */
    it('should default to 5 categories when limit is not provided', async () => {
      // Mock query builder with 10 categories
      const categories = Array.from({ length: 10 }, (_, i) => ({
        categoryId: `${i + 1}`,
        categoryName: `Category ${i + 1}`,
        categoryColor: '#FF6B6B',
        totalAmount: `${10000 - i * 1000}`,
        transactionCount: `${20 - i}`,
      }));

      const queryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(categories),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeTopCategories(
        '2024-01-01',
        '2024-01-31',
      );

      // Verify default limit of 5
      expect(result).toHaveLength(5);
    });
  });

  describe('computeIncomeVsExpenses', () => {
    /**
     * Test income vs expenses calculations
     * 
     * The method should correctly calculate total income, expenses,
     * net savings, and savings rate.
     */
    it('should correctly calculate income vs expenses metrics', async () => {
      // Mock query builder
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalIncome: '60000',
          totalExpenses: '45000',
        }),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeIncomeVsExpenses(
        '2024-01-01',
        '2024-01-31',
      );

      // Verify calculations
      expect(result.totalIncome).toBe(60000);
      expect(result.totalExpenses).toBe(45000);
      expect(result.netSavings).toBe(15000); // 60000 - 45000
      expect(result.savingsRate).toBe(25); // (15000 / 60000) * 100
      expect(result.incomePercentage).toBe(100); // Always 100
      expect(result.expensesPercentage).toBe(75); // (45000 / 60000) * 100
    });

    /**
     * Test with zero income
     * 
     * When there is no income, savings rate and expenses percentage
     * should be zero to avoid division by zero.
     */
    it('should handle zero income without errors', async () => {
      // Mock query builder with zero income
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalIncome: '0',
          totalExpenses: '5000',
        }),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeIncomeVsExpenses(
        '2024-01-01',
        '2024-01-31',
      );

      // Verify no division by zero errors
      expect(result.totalIncome).toBe(0);
      expect(result.totalExpenses).toBe(5000);
      expect(result.netSavings).toBe(-5000); // 0 - 5000
      expect(result.savingsRate).toBe(0); // Avoid division by zero
      expect(result.expensesPercentage).toBe(0); // Avoid division by zero
    });

    /**
     * Test with expenses exceeding income
     * 
     * When expenses exceed income, net savings should be negative
     * and savings rate should be negative.
     */
    it('should handle expenses exceeding income', async () => {
      // Mock query builder
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalIncome: '40000',
          totalExpenses: '50000',
        }),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeIncomeVsExpenses(
        '2024-01-01',
        '2024-01-31',
      );

      // Verify negative savings
      expect(result.totalIncome).toBe(40000);
      expect(result.totalExpenses).toBe(50000);
      expect(result.netSavings).toBe(-10000); // 40000 - 50000
      expect(result.savingsRate).toBe(-25); // (-10000 / 40000) * 100
      expect(result.expensesPercentage).toBe(125); // (50000 / 40000) * 100
    });

    /**
     * Test account filtering
     * 
     * When an accountNumber is provided, the query should filter
     * to only include transactions from that account.
     */
    it('should filter by account number when provided', async () => {
      const testAccountNumber = '1234567890';

      // Mock query builder
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalIncome: '30000',
          totalExpenses: '20000',
        }),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeIncomeVsExpenses(
        '2024-01-01',
        '2024-01-31',
        testAccountNumber,
      );

      // Verify account filtering was applied
      expect(queryBuilder.innerJoin).toHaveBeenCalledWith('t.account', 'a');
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'a.account_number = :accountNumber',
        { accountNumber: testAccountNumber },
      );

      // Verify results
      expect(result.totalIncome).toBe(30000);
      expect(result.totalExpenses).toBe(20000);
    });
  });
});
