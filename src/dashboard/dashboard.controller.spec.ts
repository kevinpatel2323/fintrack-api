import { Test, TestingModule } from '@nestjs/testing';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Integration Tests for Dashboard Controller
 * 
 * These tests validate the REST API endpoints for dashboard data.
 */
describe('DashboardController - Integration Tests', () => {
  let controller: DashboardController;
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        {
          provide: DashboardService,
          useValue: {
            computeDashboardSummary: jest.fn(),
            computeSpendingOverview: jest.fn(),
            computeCategoryBreakdown: jest.fn(),
            computeFriendBalances: jest.fn(),
            computeMonthlyTrends: jest.fn(),
            computeAccountSummary: jest.fn(),
            computeTopCategories: jest.fn(),
            computeIncomeVsExpenses: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<DashboardController>(DashboardController);
    service = module.get<DashboardService>(DashboardService);
  });

  describe('GET /dashboard/summary', () => {
    /**
     * Test complete dashboard summary endpoint
     * 
     * The endpoint should call computeDashboardSummary with the provided
     * query parameters and return the complete dashboard data.
     */
    it('should return complete dashboard summary', async () => {
      const mockSummary = {
        spendingOverview: {
          totalSpent: 45000,
          totalIncome: 60000,
          netChange: 15000,
          transactionCount: 127,
          averageTransaction: 826.77,
          comparisonPeriod: {
            totalSpent: 38000,
            totalIncome: 55000,
            percentageChange: 18.42,
          },
        },
        categoryBreakdown: {
          categories: [],
          totalSpent: 45000,
          uncategorizedAmount: 0,
          uncategorizedPercentage: 0,
        },
        friendBalances: [],
        monthlyTrends: [],
        accountSummary: [],
        topCategories: [],
        incomeVsExpenses: {
          totalIncome: 60000,
          totalExpenses: 45000,
          netSavings: 15000,
          savingsRate: 25,
          incomePercentage: 100,
          expensesPercentage: 75,
        },
        recentTransactions: [],
      };

      jest
        .spyOn(service, 'computeDashboardSummary')
        .mockResolvedValue(mockSummary);

      const result = await controller.getDashboardSummary({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(service.computeDashboardSummary).toHaveBeenCalledWith(
        '2024-01-01',
        '2024-01-31',
        undefined,
      );
      expect(result).toEqual(mockSummary);
    });

    /**
     * Test with account filtering
     * 
     * When accountNumber is provided, it should be passed to the service.
     */
    it('should filter by account number when provided', async () => {
      const mockSummary = {
        spendingOverview: {},
        categoryBreakdown: {},
        friendBalances: [],
        monthlyTrends: [],
        accountSummary: [],
        topCategories: [],
        incomeVsExpenses: {},
        recentTransactions: [],
      };

      jest
        .spyOn(service, 'computeDashboardSummary')
        .mockResolvedValue(mockSummary);

      await controller.getDashboardSummary({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        accountNumber: '1234567890',
      });

      expect(service.computeDashboardSummary).toHaveBeenCalledWith(
        '2024-01-01',
        '2024-01-31',
        '1234567890',
      );
    });
  });

  describe('GET /dashboard/spending-overview', () => {
    /**
     * Test spending overview endpoint
     * 
     * The endpoint should return spending overview data for the specified period.
     */
    it('should return spending overview', async () => {
      const mockOverview = {
        totalSpent: 45000,
        totalIncome: 60000,
        netChange: 15000,
        transactionCount: 127,
        averageTransaction: 826.77,
        comparisonPeriod: {
          totalSpent: 38000,
          totalIncome: 55000,
          percentageChange: 18.42,
        },
      };

      jest
        .spyOn(service, 'computeSpendingOverview')
        .mockResolvedValue(mockOverview);

      const result = await controller.getSpendingOverview({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(service.computeSpendingOverview).toHaveBeenCalledWith(
        '2024-01-01',
        '2024-01-31',
        undefined,
      );
      expect(result).toEqual(mockOverview);
    });
  });

  describe('GET /dashboard/category-breakdown', () => {
    /**
     * Test category breakdown endpoint
     * 
     * The endpoint should return category breakdown data.
     */
    it('should return category breakdown', async () => {
      const mockBreakdown = {
        categories: [
          {
            categoryId: '1',
            categoryName: 'Food & Dining',
            categoryColor: '#FF6B6B',
            totalAmount: 15000,
            transactionCount: 45,
            percentage: 33.33,
          },
        ],
        totalSpent: 45000,
        uncategorizedAmount: 5000,
        uncategorizedPercentage: 11.11,
      };

      jest
        .spyOn(service, 'computeCategoryBreakdown')
        .mockResolvedValue(mockBreakdown);

      const result = await controller.getCategoryBreakdown({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(service.computeCategoryBreakdown).toHaveBeenCalledWith(
        '2024-01-01',
        '2024-01-31',
        undefined,
      );
      expect(result).toEqual(mockBreakdown);
    });
  });

  describe('GET /dashboard/friend-balances', () => {
    /**
     * Test friend balances endpoint
     * 
     * The endpoint should return friend balance data.
     */
    it('should return friend balances', async () => {
      const mockBalances = [
        {
          friendId: '1',
          friendName: 'Alice',
          totalIOwe: 2000,
          totalOwesMe: 5000,
          totalSettlements: 1000,
          netBalance: 2000,
          lastTransactionDate: '2024-01-28',
        },
      ];

      jest
        .spyOn(service, 'computeFriendBalances')
        .mockResolvedValue(mockBalances);

      const result = await controller.getFriendBalances();

      expect(service.computeFriendBalances).toHaveBeenCalled();
      expect(result).toEqual(mockBalances);
    });
  });

  describe('GET /dashboard/monthly-trends', () => {
    /**
     * Test monthly trends endpoint
     * 
     * The endpoint should return monthly trend data.
     */
    it('should return monthly trends with default monthsBack', async () => {
      const mockTrends = [
        {
          month: '2024-01',
          monthLabel: 'Jan 2024',
          totalSpent: 45000,
          totalIncome: 60000,
          netChange: 15000,
          transactionCount: 127,
        },
      ];

      jest.spyOn(service, 'computeMonthlyTrends').mockResolvedValue(mockTrends);

      const result = await controller.getMonthlyTrends({});

      expect(service.computeMonthlyTrends).toHaveBeenCalledWith(6, undefined);
      expect(result).toEqual(mockTrends);
    });

    /**
     * Test with custom monthsBack parameter
     * 
     * When monthsBack is provided, it should be parsed and passed to the service.
     */
    it('should use custom monthsBack when provided', async () => {
      const mockTrends: any[] = [];

      jest.spyOn(service, 'computeMonthlyTrends').mockResolvedValue(mockTrends);

      await controller.getMonthlyTrends({ monthsBack: '12' });

      expect(service.computeMonthlyTrends).toHaveBeenCalledWith(12, undefined);
    });
  });

  describe('GET /dashboard/account-summary', () => {
    /**
     * Test account summary endpoint
     * 
     * The endpoint should return account summary data.
     */
    it('should return account summary', async () => {
      const mockSummary = [
        {
          accountId: '1',
          accountNumber: '1234567890',
          currentBalance: 50000,
          lastTransactionDate: '2024-01-31',
          transactionCount: 127,
          totalDeposits: 60000,
          totalWithdrawals: 10000,
        },
      ];

      jest
        .spyOn(service, 'computeAccountSummary')
        .mockResolvedValue(mockSummary);

      const result = await controller.getAccountSummary();

      expect(service.computeAccountSummary).toHaveBeenCalled();
      expect(result).toEqual(mockSummary);
    });
  });

  describe('GET /dashboard/top-categories', () => {
    /**
     * Test top categories endpoint
     * 
     * The endpoint should return top categories data.
     */
    it('should return top categories with default limit', async () => {
      const mockCategories = [
        {
          categoryId: '1',
          categoryName: 'Food & Dining',
          categoryColor: '#FF6B6B',
          totalAmount: 15000,
          transactionCount: 45,
          percentage: 33.33,
        },
      ];

      jest
        .spyOn(service, 'computeTopCategories')
        .mockResolvedValue(mockCategories);

      const result = await controller.getTopCategories({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(service.computeTopCategories).toHaveBeenCalledWith(
        '2024-01-01',
        '2024-01-31',
        5,
      );
      expect(result).toEqual(mockCategories);
    });

    /**
     * Test with custom limit parameter
     * 
     * When limit is provided, it should be parsed and passed to the service.
     */
    it('should use custom limit when provided', async () => {
      const mockCategories: any[] = [];

      jest
        .spyOn(service, 'computeTopCategories')
        .mockResolvedValue(mockCategories);

      await controller.getTopCategories({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        limit: '10',
      });

      expect(service.computeTopCategories).toHaveBeenCalledWith(
        '2024-01-01',
        '2024-01-31',
        10,
      );
    });
  });

  describe('GET /dashboard/income-vs-expenses', () => {
    /**
     * Test income vs expenses endpoint
     * 
     * The endpoint should return income vs expenses data.
     */
    it('should return income vs expenses', async () => {
      const mockData = {
        totalIncome: 60000,
        totalExpenses: 45000,
        netSavings: 15000,
        savingsRate: 25,
        incomePercentage: 100,
        expensesPercentage: 75,
      };

      jest
        .spyOn(service, 'computeIncomeVsExpenses')
        .mockResolvedValue(mockData);

      const result = await controller.getIncomeVsExpenses({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(service.computeIncomeVsExpenses).toHaveBeenCalledWith(
        '2024-01-01',
        '2024-01-31',
        undefined,
      );
      expect(result).toEqual(mockData);
    });
  });
});
