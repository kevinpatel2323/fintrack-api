import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CalendarQueryDto } from './dto/calendar-query.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  async create(@Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(dto);
  }

  @Get()
  async list() {
    const data = await this.subscriptionsService.findAll();
    return { count: data.length, data };
  }

  @Get('calendar')
  async calendar(@Query() query: CalendarQueryDto) {
    return this.subscriptionsService.getCalendar(query.start, query.end);
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.subscriptionsService.findOne(String(id));
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSubscriptionDto) {
    return this.subscriptionsService.update(String(id), dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.subscriptionsService.remove(String(id));
  }
}
