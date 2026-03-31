import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fc from 'fast-check';
import { DashboardService } from './dashboard.service';
import { Transaction } from '../database/entities/transaction.entity';
import { Account } from '../database/entities/account.entity';
import { Friend } from '../database/entities/friend.entity';
import { Category } from '../database/entities/category.entity';
import { TransactionFriendTag } from '../database/entities/transaction-friend-tag.entity';

/**
 * Property-Based Tests for Dashboard Service
 * 
 * These tests validate universal correctness properties that must hold
 * for all possible inputs, not just specific examples.
 */
describe('DashboardService - Property-Based Tests', () => {
  let service: DashboardService;
  let transactionsRepository: Repository<Transaction>;
  let tagsRepository: Repository<TransactionFriendTag>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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
          useValue: {},
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
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    transactionsRepository = module.get<Repository<Transaction>>(
      getRepositoryToken(Transaction),
    );
    tagsRepository = module.get<Repository<TransactionFriendTag>>(
      getRepositoryToken(TransactionFriendTag),
    );
  });

  describe('computeSpendingOverview', () => {
    /**
     * **Validates: Requirements 1.2**
     * 
     * Property 2: Non-Negative Aggregates
     * 
     * For any set of transactions, the spending overview must satisfy:
     * - totalSpent >= 0 (sum of all withdrawals)
     * - totalIncome >= 0 (sum of all deposits)
     * - transactionCount >= 0 (count of transactions)
     * - averageTransaction >= 0 (average amount per transaction)
     * - comparisonPeriod.totalSpent >= 0
     * - comparisonPeriod.totalIncome >= 0
     * 
     * Note: netChange and percentageChange can be negative (they represent differences)
     */
    it('Property 2: All aggregates must be non-negative (except netChange and percentageChange)', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate arbitrary transaction data
          fc.record({
            currentPeriod: fc.record({
              totalSpent: fc.nat({ max: 1000000 }),
              totalIncome: fc.nat({ max: 1000000 }),
              transactionCount: fc.nat({ max: 10000 }),
            }),
            comparisonPeriod: fc.record({
              totalSpent: fc.nat({ max: 1000000 }),
              totalIncome: fc.nat({ max: 1000000 }),
            }),
          }),
          async (testData) => {
            // Mock the query builder to return our generated data
            const currentQueryBuilder = {
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoin: jest.fn().mockReturnThis(),
              getRawOne: jest.fn().mockResolvedValue({
                totalSpent: testData.currentPeriod.totalSpent.toString(),
                totalIncome: testData.currentPeriod.totalIncome.toString(),
                transactionCount: testData.currentPeriod.transactionCount.toString(),
              }),
            };

            const comparisonQueryBuilder = {
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoin: jest.fn().mockReturnThis(),
              getRawOne: jest.fn().mockResolvedValue({
                totalSpent: testData.comparisonPeriod.totalSpent.toString(),
                totalIncome: testData.comparisonPeriod.totalIncome.toString(),
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

            // Execute the method with date range to trigger comparison period
            const result = await service.computeSpendingOverview(
              '2024-01-01',
              '2024-01-31',
            );

            // Verify Property 2: Non-Negative Aggregates
            // All these values must be >= 0
            expect(result.totalSpent).toBeGreaterThanOrEqual(0);
            expect(result.totalIncome).toBeGreaterThanOrEqual(0);
            expect(result.transactionCount).toBeGreaterThanOrEqual(0);
            expect(result.averageTransaction).toBeGreaterThanOrEqual(0);
            expect(result.comparisonPeriod.totalSpent).toBeGreaterThanOrEqual(0);
            expect(result.comparisonPeriod.totalIncome).toBeGreaterThanOrEqual(0);

            // Additional invariants that should always hold
            // netChange can be negative (income - spent can be negative)
            expect(result.netChange).toBe(
              result.totalIncome - result.totalSpent,
            );

            // percentageChange can be negative (spending decreased)
            // but we verify it's a valid number
            expect(typeof result.comparisonPeriod.percentageChange).toBe(
              'number',
            );
            expect(
              Number.isFinite(result.comparisonPeriod.percentageChange),
            ).toBe(true);

            // averageTransaction should be correctly calculated
            if (result.transactionCount > 0) {
              const expectedAverage =
                (result.totalSpent + result.totalIncome) /
                result.transactionCount;
              expect(result.averageTransaction).toBeCloseTo(expectedAverage, 2);
            } else {
              expect(result.averageTransaction).toBe(0);
            }
          },
        ),
        {
          numRuns: 100, // Run 100 random test cases
          verbose: true,
        },
      );
    });

    /**
     * Additional property test: Edge case with zero transactions
     * 
     * When there are no transactions, all aggregates should be zero
     * and averageTransaction should be 0 (not NaN or Infinity)
     */
    it('Property: Zero transactions should result in zero aggregates', async () => {
      const currentQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          totalSpent: '0',
          totalIncome: '0',
          transactionCount: '0',
        }),
      };

      const comparisonQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
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

      // All aggregates should be zero
      expect(result.totalSpent).toBe(0);
      expect(result.totalIncome).toBe(0);
      expect(result.transactionCount).toBe(0);
      expect(result.netChange).toBe(0);
      
      // averageTransaction should be 0, not NaN or Infinity
      expect(result.averageTransaction).toBe(0);
      expect(Number.isFinite(result.averageTransaction)).toBe(true);
    });

    /**
     * Property test: Large numbers should not cause overflow
     * 
     * JavaScript numbers can safely represent integers up to 2^53 - 1
     * This test ensures the implementation handles large transaction amounts
     */
    it('Property: Large transaction amounts should not cause overflow', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            totalSpent: fc.integer({ min: 0, max: 1000000000 }), // 1 billion
            totalIncome: fc.integer({ min: 0, max: 1000000000 }), // 1 billion
            transactionCount: fc.integer({ min: 1, max: 1000000 }),
          }),
          async (testData) => {
            const currentQueryBuilder = {
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoin: jest.fn().mockReturnThis(),
              getRawOne: jest.fn().mockResolvedValue({
                totalSpent: testData.totalSpent.toString(),
                totalIncome: testData.totalIncome.toString(),
                transactionCount: testData.transactionCount.toString(),
              }),
            };

            const comparisonQueryBuilder = {
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoin: jest.fn().mockReturnThis(),
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

            // Verify all results are safe integers or finite numbers
            expect(Number.isSafeInteger(result.totalSpent)).toBe(true);
            expect(Number.isSafeInteger(result.totalIncome)).toBe(true);
            expect(Number.isSafeInteger(result.transactionCount)).toBe(true);
            expect(Number.isFinite(result.averageTransaction)).toBe(true);
            expect(Number.isFinite(result.netChange)).toBe(true);
          },
        ),
        {
          numRuns: 50,
        },
      );
    });
  });

  describe('computeCategoryBreakdown', () => {
    /**
     * **Validates: Requirements 1.2**
     * 
     * Property 3: Percentage Sum Invariant
     * 
     * For any set of expense transactions grouped by category, the category breakdown must satisfy:
     * - Sum of all category percentages must equal 100% (within floating point tolerance of 0.01%)
     * - Each individual percentage must be >= 0 and <= 100
     * - If totalSpent > 0, then sum of percentages should be very close to 100
     * - If totalSpent = 0, then all percentages should be 0
     * 
     * This property ensures that the percentage calculations are mathematically correct
     * and that the breakdown represents the complete picture of spending.
     */
    it('Property 3: Sum of all category percentages must equal 100% within floating point tolerance', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate arbitrary category data
          // We generate 1-10 categories with random amounts
          fc.array(
            fc.record({
              categoryId: fc.option(fc.uuid(), { nil: null }),
              categoryName: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
              categoryColor: fc.option(fc.string({ minLength: 6, maxLength: 6 }), { nil: null }),
              totalAmount: fc.nat({ max: 100000 }), // Random amount up to 100k
              transactionCount: fc.integer({ min: 1, max: 100 }),
            }),
            { minLength: 1, maxLength: 10 },
          ),
          async (categoryData) => {
            // Calculate total spent across all categories
            const totalSpent = categoryData.reduce(
              (sum, cat) => sum + cat.totalAmount,
              0,
            );

            // Mock the query builder to return our generated category data
            const queryBuilder = {
              leftJoin: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoin: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue(
                categoryData.map((cat) => ({
                  categoryId: cat.categoryId,
                  categoryName: cat.categoryName,
                  categoryColor: cat.categoryColor,
                  totalAmount: cat.totalAmount.toString(),
                  transactionCount: cat.transactionCount.toString(),
                })),
              ),
            };

            jest
              .spyOn(transactionsRepository, 'createQueryBuilder')
              .mockReturnValue(queryBuilder as any);

            // Execute the method
            const result = await service.computeCategoryBreakdown(
              '2024-01-01',
              '2024-01-31',
            );

            // Verify Property 3: Percentage Sum Invariant
            
            // 1. Each percentage must be between 0 and 100
            for (const category of result.categories) {
              expect(category.percentage).toBeGreaterThanOrEqual(0);
              expect(category.percentage).toBeLessThanOrEqual(100);
            }

            // 2. Sum of all percentages should equal 100 (within tolerance)
            const sumOfPercentages = result.categories.reduce(
              (sum: number, cat: any) => sum + cat.percentage,
              0,
            );

            if (totalSpent > 0) {
              // When there's spending, sum should be very close to 100
              expect(sumOfPercentages).toBeCloseTo(100, 2); // Within 0.01%
            } else {
              // When there's no spending, all percentages should be 0
              expect(sumOfPercentages).toBe(0);
              for (const category of result.categories) {
                expect(category.percentage).toBe(0);
              }
            }

            // 3. Verify totalSpent matches the sum of category amounts
            const sumOfAmounts = result.categories.reduce(
              (sum: number, cat: any) => sum + cat.totalAmount,
              0,
            );
            expect(result.totalSpent).toBeCloseTo(sumOfAmounts, 2);

            // 4. Verify each percentage is correctly calculated
            for (const category of result.categories) {
              if (totalSpent > 0) {
                const expectedPercentage = (category.totalAmount / totalSpent) * 100;
                expect(category.percentage).toBeCloseTo(expectedPercentage, 2);
              } else {
                expect(category.percentage).toBe(0);
              }
            }

            // 5. Verify uncategorized data is correctly extracted
            const uncategorized = result.categories.find(
              (c: any) => c.categoryId === null,
            );
            if (uncategorized) {
              expect(result.uncategorizedAmount).toBe(uncategorized.totalAmount);
              expect(result.uncategorizedPercentage).toBe(uncategorized.percentage);
            } else {
              expect(result.uncategorizedAmount).toBe(0);
              expect(result.uncategorizedPercentage).toBe(0);
            }
          },
        ),
        {
          numRuns: 100, // Run 100 random test cases
          verbose: true,
        },
      );
    });

    /**
     * Edge case: Empty category breakdown (no expense transactions)
     * 
     * When there are no expense transactions, the breakdown should have:
     * - Empty categories array
     * - totalSpent = 0
     * - uncategorizedAmount = 0
     * - uncategorizedPercentage = 0
     */
    it('Property: Empty expense transactions should result in zero totals', async () => {
      const queryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]), // No categories
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeCategoryBreakdown(
        '2024-01-01',
        '2024-01-31',
      );

      // All values should be zero
      expect(result.categories).toEqual([]);
      expect(result.totalSpent).toBe(0);
      expect(result.uncategorizedAmount).toBe(0);
      expect(result.uncategorizedPercentage).toBe(0);
    });

    /**
     * Property test: Single category should have 100% of spending
     * 
     * When all spending is in one category, that category should have 100%
     */
    it('Property: Single category should have 100% of spending', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            categoryId: fc.uuid(),
            categoryName: fc.string({ minLength: 1, maxLength: 50 }),
            categoryColor: fc.string({ minLength: 6, maxLength: 6 }),
            totalAmount: fc.integer({ min: 1, max: 100000 }),
            transactionCount: fc.integer({ min: 1, max: 100 }),
          }),
          async (categoryData) => {
            const queryBuilder = {
              leftJoin: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              innerJoin: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([
                {
                  categoryId: categoryData.categoryId,
                  categoryName: categoryData.categoryName,
                  categoryColor: categoryData.categoryColor,
                  totalAmount: categoryData.totalAmount.toString(),
                  transactionCount: categoryData.transactionCount.toString(),
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

            // Single category should have 100% of spending
            expect(result.categories).toHaveLength(1);
            expect(result.categories[0].percentage).toBeCloseTo(100, 2);
            expect(result.totalSpent).toBe(categoryData.totalAmount);
          },
        ),
        {
          numRuns: 50,
        },
      );
    });
  });

  describe('computeFriendBalances', () => {
    /**
     * **Validates: Requirements 1.2**
     * 
     * Property 4: Net Balance Calculation
     * 
     * For any set of friend transaction tags, the friend balance must satisfy:
     * - netBalance = totalOwesMe - totalIOwe - totalSettlements
     * 
     * This property ensures that the net balance calculation is mathematically correct
     * for all possible combinations of friend transactions.
     * 
     * The net balance represents:
     * - Positive value: Friend owes the user
     * - Negative value: User owes the friend
     * - Zero: No outstanding balance
     */
    it('Property 4: Friend net balance must equal totalOwesMe - totalIOwe - totalSettlements', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate arbitrary friend balance data
          // We generate 1-10 friends with random transaction amounts
          fc.array(
            fc.record({
              friendId: fc.uuid(),
              friendName: fc.string({ minLength: 1, maxLength: 50 }),
              totalIOwe: fc.nat({ max: 100000 }), // Amount user owes friend
              totalOwesMe: fc.nat({ max: 100000 }), // Amount friend owes user
              totalSettlements: fc.nat({ max: 50000 }), // Settlement amounts
              lastTransactionDate: fc.date({ min: new Date('2020-01-01'), max: new Date('2024-12-31') }).map(d => d.toISOString().split('T')[0]),
            }),
            { minLength: 1, maxLength: 10 },
          ),
          async (friendData) => {
            // Mock the query builder to return our generated friend data
            const queryBuilder = {
              innerJoin: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue(
                friendData.map((friend) => ({
                  friendId: friend.friendId,
                  friendName: friend.friendName,
                  totalIOwe: friend.totalIOwe.toString(),
                  totalOwesMe: friend.totalOwesMe.toString(),
                  totalSettlements: friend.totalSettlements.toString(),
                  lastTransactionDate: friend.lastTransactionDate,
                })),
              ),
            };

            jest
              .spyOn(tagsRepository, 'createQueryBuilder')
              .mockReturnValue(queryBuilder as any);

            // Execute the method
            const result = await service.computeFriendBalances();

            // Verify Property 4: Net Balance Calculation
            
            // For each friend in the result, verify the net balance formula
            for (const balance of result) {
              // The core property: netBalance = totalOwesMe - totalIOwe - totalSettlements
              const expectedNetBalance = 
                balance.totalOwesMe - balance.totalIOwe - balance.totalSettlements;
              
              expect(balance.netBalance).toBe(expectedNetBalance);
              
              // Additional invariants
              // 1. All component values must be non-negative
              expect(balance.totalIOwe).toBeGreaterThanOrEqual(0);
              expect(balance.totalOwesMe).toBeGreaterThanOrEqual(0);
              expect(balance.totalSettlements).toBeGreaterThanOrEqual(0);
              
              // 2. netBalance can be positive, negative, or zero
              expect(typeof balance.netBalance).toBe('number');
              expect(Number.isFinite(balance.netBalance)).toBe(true);
              
              // 3. Result should only include non-zero balances (per implementation)
              expect(balance.netBalance).not.toBe(0);
            }

            // Verify that the calculation matches our input data
            // Create a map of expected net balances
            const expectedBalances = new Map(
              friendData.map((friend) => {
                const netBalance = friend.totalOwesMe - friend.totalIOwe - friend.totalSettlements;
                return [friend.friendId, netBalance];
              })
            );

            // Each result should match the expected calculation
            for (const balance of result) {
              const expected = expectedBalances.get(balance.friendId);
              expect(balance.netBalance).toBe(expected);
            }

            // Verify sorting: results should be sorted by absolute netBalance descending
            for (let i = 0; i < result.length - 1; i++) {
              const currentAbs = Math.abs(result[i].netBalance);
              const nextAbs = Math.abs(result[i + 1].netBalance);
              expect(currentAbs).toBeGreaterThanOrEqual(nextAbs);
            }

            // Verify filtering: only non-zero balances should be included
            const nonZeroFriends = friendData.filter(
              (friend) => friend.totalOwesMe - friend.totalIOwe - friend.totalSettlements !== 0
            );
            expect(result.length).toBe(nonZeroFriends.length);
          },
        ),
        {
          numRuns: 100, // Run 100 random test cases
          verbose: true,
        },
      );
    });

    /**
     * Edge case: Friend with zero net balance should be filtered out
     * 
     * When totalOwesMe - totalIOwe - totalSettlements = 0, the friend should not appear in results
     */
    it('Property: Friends with zero net balance should be filtered out', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            friendId: fc.uuid(),
            friendName: fc.string({ minLength: 1, maxLength: 50 }),
            baseAmount: fc.integer({ min: 100, max: 10000 }),
          }),
          async (testData) => {
            // Create a friend where totalOwesMe - totalIOwe - totalSettlements = 0
            // For example: totalOwesMe = 1000, totalIOwe = 600, totalSettlements = 400
            const totalOwesMe = testData.baseAmount;
            const totalIOwe = Math.floor(testData.baseAmount * 0.6);
            const totalSettlements = testData.baseAmount - totalIOwe; // This makes netBalance = 0

            const queryBuilder = {
              innerJoin: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([
                {
                  friendId: testData.friendId,
                  friendName: testData.friendName,
                  totalIOwe: totalIOwe.toString(),
                  totalOwesMe: totalOwesMe.toString(),
                  totalSettlements: totalSettlements.toString(),
                  lastTransactionDate: '2024-01-15',
                },
              ]),
            };

            jest
              .spyOn(tagsRepository, 'createQueryBuilder')
              .mockReturnValue(queryBuilder as any);

            const result = await service.computeFriendBalances();

            // Friend with zero balance should be filtered out
            expect(result).toHaveLength(0);
          },
        ),
        {
          numRuns: 50,
        },
      );
    });

    /**
     * Property test: Positive net balance means friend owes user
     * 
     * When totalOwesMe > totalIOwe + totalSettlements, netBalance should be positive
     */
    it('Property: Positive net balance means friend owes user', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            friendId: fc.uuid(),
            friendName: fc.string({ minLength: 1, maxLength: 50 }),
            totalOwesMe: fc.integer({ min: 1000, max: 100000 }),
            totalIOwe: fc.integer({ min: 0, max: 500 }),
            totalSettlements: fc.integer({ min: 0, max: 400 }),
          }),
          async (testData) => {
            // Ensure totalOwesMe > totalIOwe + totalSettlements for positive balance
            const queryBuilder = {
              innerJoin: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([
                {
                  friendId: testData.friendId,
                  friendName: testData.friendName,
                  totalIOwe: testData.totalIOwe.toString(),
                  totalOwesMe: testData.totalOwesMe.toString(),
                  totalSettlements: testData.totalSettlements.toString(),
                  lastTransactionDate: '2024-01-15',
                },
              ]),
            };

            jest
              .spyOn(tagsRepository, 'createQueryBuilder')
              .mockReturnValue(queryBuilder as any);

            const result = await service.computeFriendBalances();

            const expectedNetBalance = 
              testData.totalOwesMe - testData.totalIOwe - testData.totalSettlements;

            if (expectedNetBalance > 0) {
              expect(result).toHaveLength(1);
              expect(result[0].netBalance).toBeGreaterThan(0);
              expect(result[0].netBalance).toBe(expectedNetBalance);
            } else if (expectedNetBalance === 0) {
              // Should be filtered out
              expect(result).toHaveLength(0);
            }
          },
        ),
        {
          numRuns: 50,
        },
      );
    });

    /**
     * Property test: Negative net balance means user owes friend
     * 
     * When totalIOwe + totalSettlements > totalOwesMe, netBalance should be negative
     */
    it('Property: Negative net balance means user owes friend', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            friendId: fc.uuid(),
            friendName: fc.string({ minLength: 1, maxLength: 50 }),
            totalIOwe: fc.integer({ min: 1000, max: 100000 }),
            totalOwesMe: fc.integer({ min: 0, max: 500 }),
            totalSettlements: fc.integer({ min: 0, max: 400 }),
          }),
          async (testData) => {
            // Ensure totalIOwe > totalOwesMe for negative balance
            const queryBuilder = {
              innerJoin: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([
                {
                  friendId: testData.friendId,
                  friendName: testData.friendName,
                  totalIOwe: testData.totalIOwe.toString(),
                  totalOwesMe: testData.totalOwesMe.toString(),
                  totalSettlements: testData.totalSettlements.toString(),
                  lastTransactionDate: '2024-01-15',
                },
              ]),
            };

            jest
              .spyOn(tagsRepository, 'createQueryBuilder')
              .mockReturnValue(queryBuilder as any);

            const result = await service.computeFriendBalances();

            const expectedNetBalance = 
              testData.totalOwesMe - testData.totalIOwe - testData.totalSettlements;

            if (expectedNetBalance < 0) {
              expect(result).toHaveLength(1);
              expect(result[0].netBalance).toBeLessThan(0);
              expect(result[0].netBalance).toBe(expectedNetBalance);
            } else if (expectedNetBalance === 0) {
              // Should be filtered out
              expect(result).toHaveLength(0);
            }
          },
        ),
        {
          numRuns: 50,
        },
      );
    });

    /**
     * Property test: Empty friend tags should return empty array
     * 
     * When there are no friend transaction tags, the result should be an empty array
     */
    it('Property: Empty friend tags should return empty array', async () => {
      const queryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]), // No friend data
      };

      jest
        .spyOn(tagsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeFriendBalances();

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('computeMonthlyTrends', () => {
    /**
     * **Validates: Requirements 1.2**
     * 
     * Property 5: Monthly Trends Completeness
     * 
     * For any requested number of months back (monthsBack), the monthly trends must satisfy:
     * - trends.length = monthsBack (all requested months are included)
     * - All months are in chronological order (oldest to newest)
     * - Each month is in valid YYYY-MM format
     * - All months are unique (no duplicates)
     * - Months with zero transactions are included with zero values
     * 
     * This property ensures that the monthly trends provide a complete picture
     * of the requested time period, even for months with no activity.
     */
    it('Property 5: Monthly trends must include all requested months in chronological order', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate arbitrary monthsBack value (1-24 as per design constraints)
          fc.integer({ min: 1, max: 24 }),
          // Generate arbitrary transaction data for some months
          fc.array(
            fc.record({
              month: fc.string(), // Will be overridden with valid YYYY-MM
              totalSpent: fc.nat({ max: 100000 }),
              totalIncome: fc.nat({ max: 100000 }),
              transactionCount: fc.integer({ min: 1, max: 100 }),
            }),
            { minLength: 0, maxLength: 10 },
          ),
          async (monthsBack, transactionData) => {
            // Generate the expected months array (same logic as service)
            const expectedMonths: string[] = [];
            const today = new Date();
            
            for (let i = monthsBack - 1; i >= 0; i--) {
              const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
              const month = date.toISOString().slice(0, 7); // YYYY-MM
              expectedMonths.push(month);
            }

            // Create transaction data for some (but not necessarily all) months
            // This simulates real-world scenario where some months have no transactions
            const monthDataMap = new Map<string, any>();
            
            // Randomly assign transaction data to some of the expected months
            for (let i = 0; i < Math.min(transactionData.length, expectedMonths.length); i++) {
              const month = expectedMonths[i];
              monthDataMap.set(month, {
                month,
                totalSpent: transactionData[i].totalSpent.toString(),
                totalIncome: transactionData[i].totalIncome.toString(),
                transactionCount: transactionData[i].transactionCount.toString(),
              });
            }

            // Mock the query builder to return only months with transactions
            const queryBuilder = {
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              innerJoin: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue(
                Array.from(monthDataMap.values())
              ),
            };

            jest
              .spyOn(transactionsRepository, 'createQueryBuilder')
              .mockReturnValue(queryBuilder as any);

            // Execute the method
            const result = await service.computeMonthlyTrends(monthsBack);

            // Verify Property 5: Monthly Trends Completeness
            
            // 1. Result length must equal monthsBack
            expect(result.length).toBe(monthsBack);
            
            // 2. All expected months must be present
            const resultMonths = result.map((trend: any) => trend.month);
            expect(resultMonths).toEqual(expectedMonths);
            
            // 3. Months must be in chronological order (oldest to newest)
            for (let i = 0; i < result.length - 1; i++) {
              const currentMonth = new Date(result[i].month + '-01');
              const nextMonth = new Date(result[i + 1].month + '-01');
              expect(currentMonth.getTime()).toBeLessThan(nextMonth.getTime());
            }
            
            // 4. Each month must be in valid YYYY-MM format
            const monthRegex = /^\d{4}-\d{2}$/;
            for (const trend of result) {
              expect(trend.month).toMatch(monthRegex);
              
              // Verify month is a valid date
              const date = new Date(trend.month + '-01');
              expect(date.toString()).not.toBe('Invalid Date');
            }
            
            // 5. All months must be unique
            const uniqueMonths = new Set(resultMonths);
            expect(uniqueMonths.size).toBe(result.length);
            
            // 6. Months with no transactions should have zero values
            for (const trend of result) {
              if (!monthDataMap.has(trend.month)) {
                // This month had no transactions
                expect(trend.totalSpent).toBe(0);
                expect(trend.totalIncome).toBe(0);
                expect(trend.transactionCount).toBe(0);
                expect(trend.netChange).toBe(0);
              } else {
                // This month had transactions
                const data = monthDataMap.get(trend.month);
                expect(trend.totalSpent).toBe(Number(data.totalSpent));
                expect(trend.totalIncome).toBe(Number(data.totalIncome));
                expect(trend.transactionCount).toBe(Number(data.transactionCount));
                expect(trend.netChange).toBe(
                  Number(data.totalIncome) - Number(data.totalSpent)
                );
              }
            }
            
            // 7. Each trend must have a valid monthLabel
            for (const trend of result) {
              expect(trend.monthLabel).toBeDefined();
              expect(typeof trend.monthLabel).toBe('string');
              expect(trend.monthLabel.length).toBeGreaterThan(0);
              
              // monthLabel should be in format like "Jan 2024"
              expect(trend.monthLabel).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
            }
            
            // 8. All numeric values must be non-negative (except netChange)
            for (const trend of result) {
              expect(trend.totalSpent).toBeGreaterThanOrEqual(0);
              expect(trend.totalIncome).toBeGreaterThanOrEqual(0);
              expect(trend.transactionCount).toBeGreaterThanOrEqual(0);
              expect(typeof trend.netChange).toBe('number');
              expect(Number.isFinite(trend.netChange)).toBe(true);
            }
          },
        ),
        {
          numRuns: 100, // Run 100 random test cases
          verbose: true,
        },
      );
    });

    /**
     * Edge case: Single month request
     * 
     * When monthsBack = 1, should return exactly one month (current month)
     */
    it('Property: Single month request should return exactly one month', async () => {
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeMonthlyTrends(1);

      expect(result).toHaveLength(1);
      
      // Should be current month (the implementation goes back monthsBack-1 from current month)
      const today = new Date();
      const expectedMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 7);
      expect(result[0].month).toBe(expectedMonth);
    });

    /**
     * Property test: Maximum months (24) should work correctly
     * 
     * When monthsBack = 24 (maximum allowed), should return 24 months
     */
    it('Property: Maximum months (24) should return 24 months', async () => {
      const queryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      jest
        .spyOn(transactionsRepository, 'createQueryBuilder')
        .mockReturnValue(queryBuilder as any);

      const result = await service.computeMonthlyTrends(24);

      expect(result).toHaveLength(24);
      
      // Verify all months are unique
      const months = result.map((trend: any) => trend.month);
      const uniqueMonths = new Set(months);
      expect(uniqueMonths.size).toBe(24);
      
      // Verify chronological order
      for (let i = 0; i < result.length - 1; i++) {
        const current = new Date(result[i].month + '-01');
        const next = new Date(result[i + 1].month + '-01');
        expect(current.getTime()).toBeLessThan(next.getTime());
      }
    });

    /**
     * Property test: netChange calculation
     * 
     * For all trends, netChange must equal totalIncome - totalSpent
     */
    it('Property: netChange must equal totalIncome - totalSpent for all months', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 12 }),
          fc.array(
            fc.record({
              totalSpent: fc.nat({ max: 100000 }),
              totalIncome: fc.nat({ max: 100000 }),
              transactionCount: fc.integer({ min: 1, max: 100 }),
            }),
            { minLength: 1, maxLength: 12 },
          ),
          async (monthsBack, transactionData) => {
            // Generate expected months
            const expectedMonths: string[] = [];
            const today = new Date();
            
            for (let i = monthsBack - 1; i >= 0; i--) {
              const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
              const month = date.toISOString().slice(0, 7);
              expectedMonths.push(month);
            }

            // Create transaction data for all months
            const monthDataMap = new Map<string, any>();
            for (let i = 0; i < Math.min(transactionData.length, expectedMonths.length); i++) {
              monthDataMap.set(expectedMonths[i], {
                month: expectedMonths[i],
                totalSpent: transactionData[i].totalSpent.toString(),
                totalIncome: transactionData[i].totalIncome.toString(),
                transactionCount: transactionData[i].transactionCount.toString(),
              });
            }

            const queryBuilder = {
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              innerJoin: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue(
                Array.from(monthDataMap.values())
              ),
            };

            jest
              .spyOn(transactionsRepository, 'createQueryBuilder')
              .mockReturnValue(queryBuilder as any);

            const result = await service.computeMonthlyTrends(monthsBack);

            // Verify netChange calculation for all months
            for (const trend of result) {
              const expectedNetChange = trend.totalIncome - trend.totalSpent;
              expect(trend.netChange).toBe(expectedNetChange);
            }
          },
        ),
        {
          numRuns: 50,
        },
      );
    });
  });
});
