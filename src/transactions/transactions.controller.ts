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
  Put,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateManualTransactionDto } from './dto/create-manual-transaction.dto';
import {
  ArrayNotEmpty,
  IsArray,
  IsNumber,
  IsPositive,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CardLinkService } from '../cards/card-link.service';

class SetCategoryDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  categoryId!: number;
}

// Exactly one selector: a whole statement (the common case — you pay the bill)
// or a hand-picked set of card transactions. `@ValidateIf` makes each field
// required only when the other is absent, so supplying neither fails both.
class LinkCcBillPaymentDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  cardId!: number;

  @ValidateIf((dto: LinkCcBillPaymentDto) => dto.cardTransactionIds === undefined)
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  statementId?: number;

  @ValidateIf((dto: LinkCcBillPaymentDto) => dto.statementId === undefined)
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @IsPositive({ each: true })
  cardTransactionIds?: number[];
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
    // @ValidateIf skips both checks when both selectors are present, so the
    // "supplied both" case has to be rejected here.
    if (dto.statementId !== undefined && dto.cardTransactionIds !== undefined) {
      throw new BadRequestException(
        'Provide either statementId or cardTransactionIds, not both.',
      );
    }
    if (dto.statementId !== undefined) {
      return this.cardLinkService.linkStatement(
        String(id),
        String(dto.cardId),
        String(dto.statementId),
      );
    }
    return this.cardLinkService.link(
      String(id),
      String(dto.cardId),
      (dto.cardTransactionIds ?? []).map(String),
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
