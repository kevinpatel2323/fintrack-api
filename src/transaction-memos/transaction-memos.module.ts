import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionMemo } from '../database/entities/transaction-memo.entity';
import { PairedDevice } from '../database/entities/paired-device.entity';
import { Card } from '../database/entities/card.entity';
import { TransactionMemosController } from './transaction-memos.controller';
import { DeviceMemosController } from './device-memos.controller';
import { TransactionMemosService } from './transaction-memos.service';
import { PairedDevicesService } from './paired-devices.service';
import { DeviceKeyGuard } from './device-key.guard';

@Module({
  imports: [TypeOrmModule.forFeature([TransactionMemo, PairedDevice, Card])],
  controllers: [TransactionMemosController, DeviceMemosController],
  providers: [TransactionMemosService, PairedDevicesService, DeviceKeyGuard],
})
export class TransactionMemosModule {}
