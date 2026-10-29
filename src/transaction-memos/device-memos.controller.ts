import { Body, Controller, Get, HttpCode, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { DeviceMemoDto, PairDeviceDto } from './dto/device-memo.dto';
import { DeviceKeyGuard, DeviceRequest, routeNotFound } from './device-key.guard';
import { DeviceReplyFilter } from './device-reply.filter';
import { PairedDevicesService } from './paired-devices.service';
import { TransactionMemosService } from './transaction-memos.service';

/**
 * The routes the Fintrack Memos shortcut calls. @Public only skips the web
 * session check: every route but /pair requires a paired device's key
 * (DeviceKeyGuard), and anything short of that gets the stock 404.
 */
@Public()
@Controller('api/v1')
@UseFilters(DeviceReplyFilter)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class DeviceMemosController {
  constructor(
    private readonly devices: PairedDevicesService,
    private readonly memos: TransactionMemosService,
  ) {}

  // Trades a one-time code from the web app for this phone's device key. Shut
  // (404) unless "Connect iPhone" was pressed in the last ten minutes.
  @Post('devices/pair')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  async pair(@Req() req: DeviceRequest, @Body() dto: PairDeviceDto) {
    const paired = await this.devices.pair(dto.code, dto.name);
    if (!paired) throw routeNotFound(req);
    return { status: 'paired', key: paired.key, name: paired.device.name };
  }

  @Get('devices/me')
  @UseGuards(DeviceKeyGuard)
  me(@Req() req: DeviceRequest) {
    return { status: 'ok', name: req.device?.name ?? null };
  }

  @Post('memos')
  @HttpCode(200)
  @UseGuards(DeviceKeyGuard)
  ingest(@Req() req: DeviceRequest, @Body() dto: DeviceMemoDto) {
    return this.memos.ingest(req.device!, dto);
  }

  @Get('memos/pending')
  @UseGuards(DeviceKeyGuard)
  pending(@Req() req: DeviceRequest) {
    return this.memos.pending(req.device!);
  }
}
