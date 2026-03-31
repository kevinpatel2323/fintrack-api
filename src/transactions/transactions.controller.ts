import { Body, Controller, Delete, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateManualTransactionDto } from './dto/create-manual-transaction.dto';
import { IsNumber, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

class SetCategoryDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  categoryId!: number;
}

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('manual')
  async createManual(@Body() dto: CreateManualTransactionDto) {
    return this.transactionsService.createManualTransaction(dto);
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
