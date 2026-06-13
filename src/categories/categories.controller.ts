import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CategoriesService } from './categories.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ExportCategoryTransactionsQueryDto } from './dto/export-transactions-query.dto';
import { buildTransactionsCsv } from '../transactions/transactions-csv.util';

// UTF-8 byte-order mark. Prepending it makes Excel read the CSV as UTF-8 so
// non-ASCII narrations (and the ₹ symbol) render correctly.
const UTF8_BOM = String.fromCharCode(0xfeff);

function sanitizeFilePart(name: string): string {
  return (
    String(name || 'category')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 48) || 'category'
  );
}

@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly transactionsService: TransactionsService,
  ) {}

  @Post()
  async create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Get()
  async list() {
    const data = await this.categoriesService.findAll();
    return { count: data.length, data };
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.categoriesService.findOne(String(id));
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(String(id), dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.categoriesService.remove(String(id));
  }

  @Get(':id/export')
  async exportTransactions(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ExportCategoryTransactionsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { category, transactions } =
      await this.transactionsService.getCategoryTransactionsForExport(
        String(id),
        query.start,
        query.end,
      );

    const csv = buildTransactionsCsv(transactions);
    const part = sanitizeFilePart(category.name);
    const rangePart =
      query.start || query.end ? `-${query.start ?? 'start'}-to-${query.end ?? 'today'}` : '-all';
    const filename = `Transactions-${part}${rangePart}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(UTF8_BOM + csv);
  }
}
