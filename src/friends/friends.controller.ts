import {
  BadRequestException,
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
import { UpdateLedgerPreferencesDto } from './dto/update-ledger-preferences.dto';
import { CreateOffsetDto } from './dto/create-offset.dto';
import { CreateWriteOffDto } from './dto/create-write-off.dto';
import { ApplyLegacyReviewDto } from './dto/apply-legacy-review.dto';

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

  /** Friends with settlements saved before amounts existed. Declared ahead of `:id`. */
  @Get('review-summary')
  async legacyReviewSummary() {
    return this.friendsService.legacyReviewSummary();
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

  @Patch(':id/ledger-preferences')
  async updateLedgerPreferences(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLedgerPreferencesDto,
  ) {
    return this.friendsService.updateLedgerPreferences(String(id), dto);
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

  /**
   * What a settlement can be applied to: entries with something pending on
   * either side, other settlements' money on account it can refund, and the
   * reconciled balance.
   */
  @Get(':id/open-dues')
  async listOpenDues(
    @Param('id', ParseIntPipe) id: number,
    @Query('settlementTagId') settlementTagId?: string,
  ) {
    // Optional, so ParseIntPipe (which rejects a missing value) cannot guard it.
    if (settlementTagId !== undefined && !/^\d+$/.test(settlementTagId)) {
      throw new BadRequestException('settlementTagId must be a numeric id.');
    }
    return this.friendsService.listOpenDues(String(id), settlementTagId);
  }

  // ── Netting without money ──────────────────────────────────────────────
  @Get(':id/offsets')
  async listOffsets(@Param('id', ParseIntPipe) id: number) {
    const data = await this.friendsService.listOffsets(String(id));
    return { count: data.length, data };
  }

  @Post(':id/offsets')
  async createOffset(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateOffsetDto) {
    return this.friendsService.createOffset(String(id), dto);
  }

  @Delete(':id/offsets/:offsetId')
  async deleteOffset(
    @Param('id', ParseIntPipe) id: number,
    @Param('offsetId', ParseIntPipe) offsetId: number,
  ) {
    return this.friendsService.deleteOffset(String(id), String(offsetId));
  }

  // ── Write-offs ─────────────────────────────────────────────────────────
  @Post(':id/write-offs')
  async createWriteOff(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateWriteOffDto) {
    return this.friendsService.createWriteOff(String(id), dto);
  }

  @Delete(':id/write-offs/:writeOffId')
  async deleteWriteOff(
    @Param('id', ParseIntPipe) id: number,
    @Param('writeOffId', ParseIntPipe) writeOffId: number,
  ) {
    return this.friendsService.deleteWriteOff(String(id), String(writeOffId));
  }

  // ── Reviewing settlements saved before amounts existed ─────────────────
  @Get(':id/legacy-review')
  async getLegacyReview(@Param('id', ParseIntPipe) id: number) {
    return this.friendsService.getLegacyReview(String(id));
  }

  @Post(':id/legacy-review')
  async applyLegacyReview(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplyLegacyReviewDto,
  ) {
    return this.friendsService.applyLegacyReview(String(id), dto);
  }
}
