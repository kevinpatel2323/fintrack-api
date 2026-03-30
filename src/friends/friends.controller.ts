import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { FriendsService } from './friends.service';
import { CreateFriendDto } from './dto/create-friend.dto';
import { UpdateFriendDto } from './dto/update-friend.dto';
import { ListFriendsQueryDto } from './dto/list-friends.dto';
import { FriendTransactionsQueryDto } from './dto/friend-transactions-query.dto';

@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Post()
  async create(@Body() dto: CreateFriendDto) {
    return this.friendsService.createFriend(dto);
  }

  @Get()
  async list(@Query() query: ListFriendsQueryDto) {
    const data = await this.friendsService.listFriends(query);
    return { count: data.length, data };
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const friend = await this.friendsService.getFriend(String(id));
    if (!friend) {
      throw new NotFoundException('Friend not found.');
    }
    return friend;
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFriendDto) {
    return this.friendsService.updateFriend(String(id), dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.friendsService.deleteFriend(String(id));
  }

  @Get(':id/transactions')
  async listFriendTransactions(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: FriendTransactionsQueryDto,
  ) {
    const data = await this.friendsService.listFriendTransactions(String(id), query);
    return { count: data.length, data };
  }

  @Get(':id/summary')
  async getFriendSummary(@Param('id', ParseIntPipe) id: number) {
    return this.friendsService.getFriendSummary(String(id));
  }

  @Get(':id/linkable-transactions')
  async getLinkableTransactions(@Param('id', ParseIntPipe) id: number) {
    const data = await this.friendsService.getLinkeableTransactionsForFriend(String(id));
    return { count: data.length, data };
  }
}
