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
      // Reuse the DataSource across warm serverless invocations rather than
      // tearing it down (and reconnecting) on every Nest lifecycle close.
      keepConnectionAlive: true,
      // This API runs as Vercel serverless functions. DATABASE_URL must point at
      // the Supabase *transaction-mode* pooler (port 6543), NOT session mode
      // (port 5432). Session mode pins one Postgres backend per client for the
      // lifetime of the connection and caps total clients at pool_size: 15, so a
      // handful of cold-started serverless instances (each opening its own pool)
      // exhaust it within seconds — every request then fails with
      // "(EMAXCONNSESSION) max clients reached in session mode", surfacing as
      // TypeORM "Unable to connect to the database" and 500s across all APIs.
      // Transaction mode releases the backend at the end of each transaction and
      // multiplexes many clients over a small backend pool, which is what
      // serverless needs. We still keep each instance to a single connection and
      // release it quickly so idle/old instances free their slot (tune via
      // DB_POOL_MAX). Transaction mode only supports unnamed prepared statements,
      // which is what node-postgres/TypeORM use by default here.
      extra: {
        max: Number(process.env.DB_POOL_MAX) || 1,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 10000,
      },
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
