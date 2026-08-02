import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Card } from '../database/entities/card.entity';
import { CardStatement } from '../database/entities/card-statement.entity';
import { CardTransaction } from '../database/entities/card-transaction.entity';
import { CardPayment } from '../database/entities/card-payment.entity';
import { CardStatementImport } from '../database/entities/card-statement-import.entity';
import { Category } from '../database/entities/category.entity';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';
import { CardImportsService } from './card-imports.service';
import { CardLinkService } from './card-link.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Card,
      CardStatement,
      CardTransaction,
      CardPayment,
      CardStatementImport,
      Category,
    ]),
  ],
  controllers: [CardsController],
  providers: [CardsService, CardImportsService, CardLinkService],
  exports: [CardsService, CardImportsService, CardLinkService],
})
export class CardsModule {}
