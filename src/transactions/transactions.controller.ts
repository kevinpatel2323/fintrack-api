import { Body, Controller, Post } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateManualTransactionDto } from './dto/create-manual-transaction.dto';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('manual')
  async createManual(@Body() dto: CreateManualTransactionDto) {
    return this.transactionsService.createManualTransaction(dto);
  }
}
