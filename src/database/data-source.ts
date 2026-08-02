import 'dotenv/config';
import path from 'path';
import { DataSource } from 'typeorm';
import { Transaction } from './entities/transaction.entity';
import { StatementImport } from './entities/statement-import.entity';
import { Account } from './entities/account.entity';
import { Friend } from './entities/friend.entity';
import { TransactionFriendTag } from './entities/transaction-friend-tag.entity';
import { SettlementLink } from './entities/settlement-link.entity';
import { Category } from './entities/category.entity';
import { Subscription } from './entities/subscription.entity';
import { Card } from './entities/card.entity';
import { CardStatement } from './entities/card-statement.entity';
import { CardTransaction } from './entities/card-transaction.entity';
import { CardPayment } from './entities/card-payment.entity';
import { CardStatementImport } from './entities/card-statement-import.entity';
import { WebauthnCredential } from './entities/webauthn-credential.entity';
import { AuthSession } from './entities/auth-session.entity';
import { WebauthnChallenge } from './entities/webauthn-challenge.entity';

const AppDataSource = new DataSource({
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
    CardStatementImport,
    WebauthnCredential,
    AuthSession,
    WebauthnChallenge,
  ],
  migrations: [path.join(__dirname, 'migrations/*.{ts,js}')],
  synchronize: false,
});

export default AppDataSource;
