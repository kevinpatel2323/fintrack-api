import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { TransactionMemosService } from './transaction-memos.service';
import { PairedDevicesService } from './paired-devices.service';
import { CreatePairCodeDto, ListMemosQueryDto, UpdateMemoDto } from './dto/web-memos.dto';

// The web app's view of transaction memos and paired devices (passkey session).
@Controller('transaction-memos')
export class TransactionMemosController {
  constructor(
    private readonly memos: TransactionMemosService,
    private readonly devices: PairedDevicesService,
  ) {}

  @Get()
  list(@Query() query: ListMemosQueryDto) {
    return this.memos.list(query);
  }

  @Get('summary')
  summary() {
    return this.memos.summary();
  }

  @Post('reparse-all')
  reparseAll() {
    return this.memos.reparseAll();
  }

  @Get('devices')
  async listDevices() {
    const data = await this.devices.list();
    return { count: data.length, data };
  }

  @Post('devices/pair-code')
  createPairCode(@Body() dto: CreatePairCodeDto) {
    return this.devices.createPairCode(dto.name);
  }

  @Delete('devices/:id')
  revokeDevice(@Param('id', ParseIntPipe) id: number) {
    return this.devices.revoke(String(id));
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.memos.detail(String(id));
  }

  @Patch(':id')
  updateMemo(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMemoDto) {
    return this.memos.updateMemo(String(id), dto.memo);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.memos.remove(String(id));
  }

  @Post(':id/reparse')
  reparse(@Param('id', ParseIntPipe) id: number) {
    return this.memos.reparse(String(id));
  }
}
