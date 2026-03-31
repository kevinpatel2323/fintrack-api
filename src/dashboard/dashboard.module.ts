import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../database/entities/transaction.entity';
import { Account } from '../database/entities/account.entity';
import { Friend } from '../database/entities/friend.entity';
import { Category } from '../database/entities/category.entity';
import { TransactionFriendTag } from '../database/entities/transaction-friend-tag.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Transaction,
      Account,
      Friend,
      Category,
      TransactionFriendTag,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
