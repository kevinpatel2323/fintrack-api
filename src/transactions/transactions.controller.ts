import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateManualTransactionDto } from './dto/create-manual-transaction.dto';
import { ArrayNotEmpty, IsArray, IsNumber, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { CardLinkService } from '../cards/card-link.service';

class SetCategoryDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  categoryId!: number;
}

class LinkCcBillPaymentDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  cardId!: number;

  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @IsPositive({ each: true })
  cardTransactionIds!: number[];
}

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly cardLinkService: CardLinkService,
  ) {}

  // ── CC bill payment linking ──────────────────────────────────────────────
  @Get(':id/cc-link')
  async getCcLink(@Param('id', ParseIntPipe) id: number) {
    return this.cardLinkService.getLink(String(id));
  }

  @Post(':id/cc-link')
  async linkCcBillPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LinkCcBillPaymentDto,
  ) {
    return this.cardLinkService.link(
      String(id),
      String(dto.cardId),
      dto.cardTransactionIds.map(String),
    );
  }

  @Delete(':id/cc-link')
  async unlinkCcBillPayment(@Param('id', ParseIntPipe) id: number) {
    return this.cardLinkService.unlink(String(id));
  }

  @Post('manual')
  async createManual(@Body() dto: CreateManualTransactionDto) {
    return this.transactionsService.createManualTransaction(dto);
  }

  @Get(':id')
  async getById(@Param('id', ParseIntPipe) id: number) {
    const data = await this.transactionsService.getTransactionById(String(id));
    return { data };
  }

  @Patch(':id/category')
  async setCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetCategoryDto,
  ) {
    return this.transactionsService.setTransactionCategory(String(id), String(dto.categoryId));
  }

  @Delete(':id/category')
  async removeCategory(@Param('id', ParseIntPipe) id: number) {
    return this.transactionsService.setTransactionCategory(String(id), null);
  }
}
