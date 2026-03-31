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

const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Transaction, StatementImport, Account, Friend, TransactionFriendTag, SettlementLink, Category],
  migrations: [path.join(__dirname, 'migrations/*.{ts,js}')],
  synchronize: false,
});

export default AppDataSource;
