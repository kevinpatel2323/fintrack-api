import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportsModule } from './imports/imports.module';
import { Transaction } from './database/entities/transaction.entity';
import { StatementImport } from './database/entities/statement-import.entity';
import { Account } from './database/entities/account.entity';
import { Friend } from './database/entities/friend.entity';
import { TransactionFriendTag } from './database/entities/transaction-friend-tag.entity';
import { SettlementLink } from './database/entities/settlement-link.entity';
import { Category } from './database/entities/category.entity';
import { Subscription } from './database/entities/subscription.entity';
import { FriendsModule } from './friends/friends.module';
import { TransactionsModule } from './transactions/transactions.module';
import { CategoriesModule } from './categories/categories.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [
        Transaction,
        StatementImport,
        Account,
        Friend,
        TransactionFriendTag,
        SettlementLink,
        Category,
        Subscription,
      ],
      synchronize: false,
    }),
    ImportsModule,
    FriendsModule,
    TransactionsModule,
    CategoriesModule,
    DashboardModule,
    SubscriptionsModule,
  ],
})
export class AppModule {}
