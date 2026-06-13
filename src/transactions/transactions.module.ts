import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { Transaction } from '../database/entities/transaction.entity';
import { Account } from '../database/entities/account.entity';
import { Category } from '../database/entities/category.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction, Account, Category])],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
