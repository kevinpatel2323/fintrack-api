import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { FriendsService } from './friends.service';
import { CreateTransactionFriendTagDto } from './dto/create-transaction-friend-tag.dto';
import { UpdateTransactionFriendTagDto } from './dto/update-transaction-friend-tag.dto';

@Controller('transactions')
export class TransactionFriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get(':transactionId/friends')
  async list(@Param('transactionId', ParseIntPipe) transactionId: number) {
    const data = await this.friendsService.listTransactionTags(String(transactionId));
    return { count: data.length, data };
  }

  @Post(':transactionId/friends')
  async create(
    @Param('transactionId', ParseIntPipe) transactionId: number,
    @Body() dto: CreateTransactionFriendTagDto,
  ) {
    return this.friendsService.createTransactionTag(String(transactionId), dto);
  }

  @Patch(':transactionId/friends/:tagId')
  async update(
    @Param('transactionId', ParseIntPipe) transactionId: number,
    @Param('tagId', ParseIntPipe) tagId: number,
    @Body() dto: UpdateTransactionFriendTagDto,
  ) {
    return this.friendsService.updateTransactionTag(String(transactionId), String(tagId), dto);
  }

  @Delete(':transactionId/friends/:tagId')
  async remove(
    @Param('transactionId', ParseIntPipe) transactionId: number,
    @Param('tagId', ParseIntPipe) tagId: number,
  ) {
    return this.friendsService.deleteTransactionTag(String(transactionId), String(tagId));
  }
}
