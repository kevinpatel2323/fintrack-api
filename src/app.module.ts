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
import { Card } from './database/entities/card.entity';
import { CardStatement } from './database/entities/card-statement.entity';
import { CardTransaction } from './database/entities/card-transaction.entity';
import { CardPayment } from './database/entities/card-payment.entity';
import { FriendsModule } from './friends/friends.module';
import { TransactionsModule } from './transactions/transactions.module';
import { CategoriesModule } from './categories/categories.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { CardsModule } from './cards/cards.module';

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
        Card,
        CardStatement,
        CardTransaction,
        CardPayment,
      ],
      synchronize: false,
    }),
    ImportsModule,
    FriendsModule,
    TransactionsModule,
    CategoriesModule,
    DashboardModule,
    SubscriptionsModule,
    CardsModule,
  ],
})
export class AppModule {}
