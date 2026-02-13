import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Friend } from '../database/entities/friend.entity';
import { Transaction } from '../database/entities/transaction.entity';
import { TransactionFriendTag } from '../database/entities/transaction-friend-tag.entity';
import { SettlementLink } from '../database/entities/settlement-link.entity';
import { FriendsController } from './friends.controller';
import { TransactionFriendsController } from './transaction-friends.controller';
import { FriendsService } from './friends.service';

@Module({
  imports: [TypeOrmModule.forFeature([Friend, TransactionFriendTag, SettlementLink, Transaction])],
  controllers: [FriendsController, TransactionFriendsController],
  providers: [FriendsService],
})
export class FriendsModule {}
