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
      // DATABASE_URL must point at the Supabase *transaction-mode* pooler
      // (port 6543), NOT session mode (port 5432). Both share ONE project-wide
      // ceiling on client connections — session mode caps at 15
      // ("(EMAXCONNSESSION) max clients reached in session mode"), transaction
      // mode at 200 ("(EMAXCONN) max client connections reached, limit: 200").
      // That ceiling is shared across EVERY connection to the project: local
      // dev, production, migrations and every process restart all draw from it.
      //
      // The app kept dying after a few minutes because connections were LEAKED,
      // not because traffic was high. Do NOT re-add `keepConnectionAlive: true`
      // here: it tells TypeORM to skip closing the pool on shutdown, so every
      // `nest --watch` recompile and every production redeploy killed the
      // process WITHOUT releasing its connections. They lingered at the pooler
      // until it slowly timed them out, stacking across restarts until the 200
      // ceiling was hit and new connections were refused — surfacing downstream
      // as "timeout exceeded when trying to connect". main.ts now calls
      // enableShutdownHooks() so SIGTERM drains the pool on every restart.
      extra: {
        // Keep each process's footprint small against the shared 200-client
        // ceiling. Transaction mode multiplexes these onto a small backend pool,
        // so a handful covers per-request concurrency. Tune via DB_POOL_MAX.
        max: Number(process.env.DB_POOL_MAX) || 3,
        // Drop idle connections quickly so an idle process hands its client
        // slots back to the pooler instead of squatting on them.
        idleTimeoutMillis: 10000,
        // Don't let an idle pool keep the process (and its slots) alive.
        allowExitOnIdle: true,
        // Give slow TLS handshakes to the ap-southeast-1 pooler room to complete.
        connectionTimeoutMillis: 30000,
        // Cap any single runaway query.
        statement_timeout: 30000,
        // Keep the TCP socket alive so the pooler/NAT can't silently drop an idle
        // connection and leave a dead one ("Connection terminated unexpectedly").
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
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
