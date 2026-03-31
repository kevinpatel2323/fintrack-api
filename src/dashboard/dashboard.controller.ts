import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  async getDashboardSummary(@Query() query: any) {
    const startDate = query.startDate;
    const endDate = query.endDate;
    const accountNumber = query.accountNumber;

    return this.dashboardService.computeDashboardSummary(
      startDate,
      endDate,
      accountNumber,
    );
  }

  @Get('spending-overview')
  async getSpendingOverview(@Query() query: any) {
    const startDate = query.startDate;
    const endDate = query.endDate;
    const accountNumber = query.accountNumber;

    return this.dashboardService.computeSpendingOverview(
      startDate,
      endDate,
      accountNumber,
    );
  }

  @Get('category-breakdown')
  async getCategoryBreakdown(@Query() query: any) {
    const startDate = query.startDate;
    const endDate = query.endDate;
    const accountNumber = query.accountNumber;

    return this.dashboardService.computeCategoryBreakdown(
      startDate,
      endDate,
      accountNumber,
    );
  }

  @Get('friend-balances')
  async getFriendBalances() {
    return this.dashboardService.computeFriendBalances();
  }

  @Get('monthly-trends')
  async getMonthlyTrends(@Query() query: any) {
    const monthsBack = query.monthsBack ? parseInt(query.monthsBack, 10) : 6;
    const accountNumber = query.accountNumber;

    return this.dashboardService.computeMonthlyTrends(
      monthsBack,
      accountNumber,
    );
  }

  @Get('account-summary')
  async getAccountSummary() {
    return this.dashboardService.computeAccountSummary();
  }

  @Get('top-categories')
  async getTopCategories(@Query() query: any) {
    const startDate = query.startDate;
    const endDate = query.endDate;
    const limit = query.limit ? parseInt(query.limit, 10) : 5;

    return this.dashboardService.computeTopCategories(
      startDate,
      endDate,
      limit,
    );
  }

  @Get('income-vs-expenses')
  async getIncomeVsExpenses(@Query() query: any) {
    const startDate = query.startDate;
    const endDate = query.endDate;
    const accountNumber = query.accountNumber;

    return this.dashboardService.computeIncomeVsExpenses(
      startDate,
      endDate,
      accountNumber,
    );
  }
}
