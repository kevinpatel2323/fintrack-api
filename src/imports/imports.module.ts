import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { Transaction } from '../database/entities/transaction.entity';
import { StatementImport } from '../database/entities/statement-import.entity';
import { Account } from '../database/entities/account.entity';
import { FriendsModule } from '../friends/friends.module';
import { CardsModule } from '../cards/cards.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, StatementImport, Account]),
    FriendsModule,
    CardsModule,
  ],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
