import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CardsService } from './cards.service';
import { CardImportsService } from './card-imports.service';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';
import {
  ToggleFreezeDto,
  UpdateCardControlsDto,
} from './dto/card-controls.dto';
import {
  CreateCardTransactionDto,
  UpdateCardTransactionDto,
} from './dto/create-card-transaction.dto';
import { CreateCardPaymentDto } from './dto/create-card-payment.dto';
import {
  CreateCardStatementDto,
  UpdateCardStatementDto,
} from './dto/create-card-statement.dto';

@Controller('cards')
export class CardsController {
  constructor(
    private readonly cardsService: CardsService,
    private readonly cardImportsService: CardImportsService,
  ) {}

  // ── CC statement imports ─────────────────────────────────────────────────
  @Post(':id/imports/hdfc-cc/preview')
  @UseInterceptors(FileInterceptor('statement'))
  async previewCcImport(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Missing file: statement');
    return this.cardImportsService.preview(String(id), file.buffer);
  }

  @Post(':id/imports/hdfc-cc')
  @UseInterceptors(FileInterceptor('statement'))
  async importCc(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Missing file: statement');
    const result = await this.cardImportsService.importStatement(
      String(id),
      file.buffer,
      file.originalname,
    );
    return { message: 'Import complete', ...result };
  }

  @Get(':id/imports')
  async listCcImports(@Param('id', ParseIntPipe) id: number) {
    const data = await this.cardImportsService.listImports(String(id));
    return { count: data.length, data };
  }

  @Post('imports/:importId/revert')
  async revertCcImport(@Param('importId', ParseIntPipe) importId: number) {
    return this.cardImportsService.revertImport(String(importId));
  }

  // ── Wallet / dues ──────────────────────────────────────────────────────
  @Get('wallet')
  async wallet() {
    return this.cardsService.getWallet();
  }

  @Get('dues')
  async dues() {
    return this.cardsService.getDues();
  }

  // ── Card CRUD ──────────────────────────────────────────────────────────
  @Post()
  async create(@Body() dto: CreateCardDto) {
    return this.cardsService.create(dto);
  }

  @Get()
  async list() {
    const data = await this.cardsService.findAll();
    return { count: data.length, data };
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.cardsService.findOne(String(id));
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCardDto,
  ) {
    return this.cardsService.update(String(id), dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.cardsService.remove(String(id));
  }

  @Patch(':id/freeze')
  async freeze(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ToggleFreezeDto,
  ) {
    return this.cardsService.setFreeze(String(id), dto);
  }

  @Patch(':id/controls')
  async controls(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCardControlsDto,
  ) {
    return this.cardsService.setControls(String(id), dto);
  }

  @Patch(':id/primary')
  async primary(@Param('id', ParseIntPipe) id: number) {
    return this.cardsService.setPrimary(String(id));
  }

  // ── Card transactions ──────────────────────────────────────────────────
  @Get(':id/transactions')
  async listTxns(
    @Param('id', ParseIntPipe) id: number,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('statementId') statementId?: string,
    @Query('unpaid') unpaid?: string,
  ) {
    const data = await this.cardsService.listTransactions(String(id), {
      start,
      end,
      statementId,
      unpaid: unpaid === 'true',
    });
    return { count: data.length, data };
  }

  @Post(':id/transactions')
  async createTxn(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCardTransactionDto,
  ) {
    return this.cardsService.createTransaction(String(id), dto);
  }

  @Patch('transactions/:txnId')
  async updateTxn(
    @Param('txnId', ParseIntPipe) txnId: number,
    @Body() dto: UpdateCardTransactionDto,
  ) {
    return this.cardsService.updateTransaction(String(txnId), dto);
  }

  @Delete('transactions/:txnId')
  async removeTxn(@Param('txnId', ParseIntPipe) txnId: number) {
    return this.cardsService.removeTransaction(String(txnId));
  }

  // ── Card payments ──────────────────────────────────────────────────────
  @Get(':id/payments')
  async listPayments(@Param('id', ParseIntPipe) id: number) {
    const data = await this.cardsService.listPayments(String(id));
    return { count: data.length, data };
  }

  @Post(':id/payments')
  async createPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCardPaymentDto,
  ) {
    return this.cardsService.createPayment(String(id), dto);
  }

  @Delete('payments/:paymentId')
  async removePayment(@Param('paymentId', ParseIntPipe) paymentId: number) {
    return this.cardsService.removePayment(String(paymentId));
  }

  // ── Card statements ────────────────────────────────────────────────────
  @Get(':id/statements')
  async listStatements(@Param('id', ParseIntPipe) id: number) {
    const data = await this.cardsService.listStatements(String(id));
    return { count: data.length, data };
  }

  @Post(':id/statements')
  async createStatement(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCardStatementDto,
  ) {
    return this.cardsService.createStatement(String(id), dto);
  }

  @Get('statements/:statementId/breakdown')
  async statementBreakdown(
    @Param('statementId', ParseIntPipe) statementId: number,
  ) {
    return this.cardsService.getStatementBreakdown(String(statementId));
  }

  @Patch('statements/:statementId')
  async updateStatement(
    @Param('statementId', ParseIntPipe) statementId: number,
    @Body() dto: UpdateCardStatementDto,
  ) {
    return this.cardsService.updateStatement(String(statementId), dto);
  }

  @Delete('statements/:statementId')
  async removeStatement(
    @Param('statementId', ParseIntPipe) statementId: number,
  ) {
    return this.cardsService.removeStatement(String(statementId));
  }
}
