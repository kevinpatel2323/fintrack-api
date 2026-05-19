import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Card } from '../database/entities/card.entity';
import { CardStatement } from '../database/entities/card-statement.entity';
import { CardTransaction } from '../database/entities/card-transaction.entity';
import { CardPayment } from '../database/entities/card-payment.entity';
import { Category } from '../database/entities/category.entity';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Card,
      CardStatement,
      CardTransaction,
      CardPayment,
      Category,
    ]),
  ],
  controllers: [CardsController],
  providers: [CardsService],
  exports: [CardsService],
})
export class CardsModule {}
