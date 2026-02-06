import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportsService } from './imports.service';
import { parseHdfcStatement } from './parsers/hdfc.parser';
import { ImportsListQueryDto } from './dto/imports-list.dto';
import { TransactionsRangeQueryDto } from './dto/transactions-range.dto';

@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  private mapImport(importRow: any) {
    if (!importRow) return importRow;
    const accountNumber = importRow.account?.accountNumber ?? null;
    const { account, accountId, ...rest } = importRow;
    return { ...rest, accountNumber };
  }

  @Post('hdfc')
  @UseInterceptors(FileInterceptor('statement'))
  async importHdfc(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Missing file: statement');
    }

    const parsed = parseHdfcStatement(file.buffer);
    if (parsed.entries.length === 0) {
      throw new BadRequestException('No entries parsed from statement.');
    }

    const result = await this.importsService.importStatement(
      parsed.entries,
      file.originalname,
      parsed.accountNumber,
    );
    return { message: 'Import complete', accountNumber: parsed.accountNumber, ...result };
  }

  @Post('hdfc/preview')
  @UseInterceptors(FileInterceptor('statement'))
  async previewHdfc(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Missing file: statement');
    }

    const parsed = parseHdfcStatement(file.buffer);
    if (parsed.entries.length === 0) {
      throw new BadRequestException('No entries parsed from statement.');
    }

    const result = await this.importsService.previewStatement(parsed.entries, parsed.accountNumber);
    return { message: 'Preview ready', ...result };
  }

  @Post(':id/revert')
  async revertImport(@Param('id', ParseIntPipe) id: number) {
    return this.importsService.revertImport(String(id));
  }

  @Get('last')
  async getLastImport(@Query('accountNumber') accountNumber?: string) {
    const last = await this.importsService.getLastImport(accountNumber);
    if (!last) {
      throw new NotFoundException('No imports found.');
    }
    return this.mapImport(last);
  }

  @Get('accounts')
  async getAccounts() {
    const data = await this.importsService.listAccounts();
    return { count: data.length, data };
  }

  @Get('transactions/range')
  async getTransactionsRange(@Query() query: TransactionsRangeQueryDto) {
    const data = await this.importsService.getTransactionsInRange(
      query.start,
      query.end,
      query.accountNumber,
    );
    const mapped = data.map((row: any) => {
      const { account, accountId, ...rest } = row;
      return { ...rest, accountNumber: account?.accountNumber ?? null };
    });
    return { count: mapped.length, data: mapped };
  }

  @Get()
  async listImports(@Query() query: ImportsListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const data = await this.importsService.listImports(page, limit, query.accountNumber);
    return { page, limit, count: data.length, data: data.map((row: any) => this.mapImport(row)) };
  }

  @Get(':id')
  async getImportById(@Param('id', ParseIntPipe) id: number) {
    const data = await this.importsService.getImportById(String(id));
    if (!data) {
      throw new NotFoundException('Import not found.');
    }
    return this.mapImport(data);
  }
}
