import {
  BadRequestException,
  Body,
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
import { FriendsService } from '../friends/friends.service';
import { CardLinkService } from '../cards/card-link.service';
import { looksLikeCreditCardStatement } from '../cards/parsers/hdfc-cc.parser';
import {
  CardImportsService,
  parseConfirmedMatches,
} from '../cards/card-imports.service';

@Controller('imports')
export class ImportsController {
  constructor(
    private readonly importsService: ImportsService,
    private readonly friendsService: FriendsService,
    private readonly cardLinkService: CardLinkService,
    private readonly cardImportsService: CardImportsService,
  ) {}

  private mapImport(importRow: any) {
    if (!importRow) return importRow;
    const accountNumber = importRow.account?.accountNumber ?? null;
    const { account, accountId, ...rest } = importRow;
    return { ...rest, accountNumber };
  }

  @Post('hdfc')
  @UseInterceptors(FileInterceptor('statement'))
  async importHdfc(
    @UploadedFile() file?: Express.Multer.File,
    @Body('confirmedMatches') confirmedMatches?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Missing file: statement');
    }

    // One upload box handles both statement kinds; a credit card statement is
    // routed to the card it names rather than rejected.
    if (looksLikeCreditCardStatement(file.buffer)) {
      const card = await this.cardImportsService.importDetected(
        file.buffer,
        file.originalname,
        parseConfirmedMatches(confirmedMatches),
      );
      return { message: 'Import complete', ...card };
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
    return {
      message: 'Import complete',
      kind: 'bank',
      accountNumber: parsed.accountNumber,
      ...result,
    };
  }

  @Post('hdfc/preview')
  @UseInterceptors(FileInterceptor('statement'))
  async previewHdfc(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Missing file: statement');
    }

    if (looksLikeCreditCardStatement(file.buffer)) {
      const card = await this.cardImportsService.previewDetected(file.buffer);
      return { message: 'Preview ready', ...card };
    }

    const parsed = parseHdfcStatement(file.buffer);
    if (parsed.entries.length === 0) {
      throw new BadRequestException('No entries parsed from statement.');
    }

    const result = await this.importsService.previewStatement(parsed.entries, parsed.accountNumber);
    return { message: 'Preview ready', kind: 'bank', ...result };
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
    // Load every transaction's friend tags inline (fixed two queries) so the
    // web client can render the Tags column from this single response instead
    // of firing one /transactions/:id/friends request per row.
    const transactionIds = data.map((row) => row.id);
    const tagsByTransaction =
      await this.friendsService.listTransactionTagsForTransactions(
        transactionIds,
      );
    // Annotate bill-payment rows (fixed extra query, same pattern as tags) so
    // the list UI can render the "CC bill" badge and hide the mark action.
    const ccByTransaction =
      await this.cardLinkService.getBillPaymentsForBankTransactions(
        transactionIds,
      );
    const mapped = data.map((row: any) => {
      const { account, accountId, ...rest } = row;
      return {
        ...rest,
        accountNumber: account?.accountNumber ?? null,
        friendTags: tagsByTransaction.get(row.id) ?? [],
        ccBillPayment: ccByTransaction.get(row.id) ?? null,
      };
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
