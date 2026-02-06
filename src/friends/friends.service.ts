import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Friend } from '../database/entities/friend.entity';
import {
  TransactionFriendDirection,
  TransactionFriendTag,
} from '../database/entities/transaction-friend-tag.entity';
import { Transaction } from '../database/entities/transaction.entity';
import { CreateFriendDto } from './dto/create-friend.dto';
import { ListFriendsQueryDto } from './dto/list-friends.dto';
import { UpdateFriendDto } from './dto/update-friend.dto';
import { CreateTransactionFriendTagDto } from './dto/create-transaction-friend-tag.dto';
import { UpdateTransactionFriendTagDto } from './dto/update-transaction-friend-tag.dto';

@Injectable()
export class FriendsService {
  constructor(
    @InjectRepository(Friend)
    private readonly friendRepository: Repository<Friend>,
    @InjectRepository(TransactionFriendTag)
    private readonly tagRepository: Repository<TransactionFriendTag>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
  ) {}

  async createFriend(dto: CreateFriendDto) {
    const friend = this.friendRepository.create({
      name: dto.name,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      note: dto.note ?? null,
    });
    return this.friendRepository.save(friend);
  }

  async listFriends(query: ListFriendsQueryDto) {
    const q = query.q?.trim();
    if (q) {
      return this.friendRepository.find({
        where: [{ name: ILike(`%${q}%`) }, { email: ILike(`%${q}%`) }],
        order: { name: 'ASC' },
      });
    }

    return this.friendRepository.find({ order: { name: 'ASC' } });
  }

  async getFriend(id: string) {
    return this.friendRepository.findOne({ where: { id } });
  }

  async updateFriend(id: string, dto: UpdateFriendDto) {
    const friend = await this.friendRepository.findOne({ where: { id } });
    if (!friend) {
      throw new NotFoundException('Friend not found.');
    }

    const updated = this.friendRepository.merge(friend, {
      name: dto.name ?? friend.name,
      email: dto.email ?? friend.email,
      phone: dto.phone ?? friend.phone,
      note: dto.note ?? friend.note,
    });

    return this.friendRepository.save(updated);
  }

  async deleteFriend(id: string) {
    const friend = await this.friendRepository.findOne({ where: { id } });
    if (!friend) {
      throw new NotFoundException('Friend not found.');
    }

    const tagCount = await this.tagRepository.count({ where: { friendId: id } });
    if (tagCount > 0) {
      throw new ConflictException('Friend has tagged transactions. Remove tags first.');
    }

    await this.friendRepository.delete({ id });
    return { deleted: true };
  }

  async listTransactionTags(transactionId: string) {
    return this.tagRepository.find({
      where: { transactionId },
      relations: ['friend'],
      order: { id: 'ASC' },
    });
  }

  async createTransactionTag(transactionId: string, dto: CreateTransactionFriendTagDto) {
    const [transaction, friend] = await Promise.all([
      this.transactionRepository.findOne({ where: { id: transactionId } }),
      this.friendRepository.findOne({ where: { id: String(dto.friendId) } }),
    ]);

    if (!transaction) {
      throw new NotFoundException('Transaction not found.');
    }
    if (!friend) {
      throw new NotFoundException('Friend not found.');
    }

    const existing = await this.tagRepository.findOne({
      where: { transactionId, friendId: String(dto.friendId) },
    });
    if (existing) {
      throw new ConflictException('Friend already tagged on this transaction.');
    }

    if (
      dto.direction === TransactionFriendDirection.NothingOutstanding &&
      dto.amount !== 0
    ) {
      throw new ConflictException('Nothing outstanding tags must have amount 0.');
    }

    if (
      dto.direction !== TransactionFriendDirection.NothingOutstanding &&
      dto.amount <= 0
    ) {
      throw new ConflictException('Amount must be greater than 0.');
    }

    const tag = this.tagRepository.create({
      transactionId,
      friendId: String(dto.friendId),
      amount: dto.amount,
      direction: dto.direction,
      note: dto.note ?? null,
    });

    return this.tagRepository.save(tag);
  }

  async updateTransactionTag(
    transactionId: string,
    tagId: string,
    dto: UpdateTransactionFriendTagDto,
  ) {
    const tag = await this.tagRepository.findOne({
      where: { id: tagId, transactionId },
    });

    if (!tag) {
      throw new NotFoundException('Tag not found.');
    }

    if (dto.friendId && String(dto.friendId) !== tag.friendId) {
      const friend = await this.friendRepository.findOne({
        where: { id: String(dto.friendId) },
      });
      if (!friend) {
        throw new NotFoundException('Friend not found.');
      }

      const duplicate = await this.tagRepository.findOne({
        where: { transactionId, friendId: String(dto.friendId) },
      });
      if (duplicate) {
        throw new ConflictException('Friend already tagged on this transaction.');
      }
    }

    const nextDirection = dto.direction ?? tag.direction;
    const nextAmount = dto.amount ?? tag.amount;

    if (
      nextDirection === TransactionFriendDirection.NothingOutstanding &&
      nextAmount !== 0
    ) {
      throw new ConflictException('Nothing outstanding tags must have amount 0.');
    }
    if (
      nextDirection !== TransactionFriendDirection.NothingOutstanding &&
      nextAmount <= 0
    ) {
      throw new ConflictException('Amount must be greater than 0.');
    }

    const updated = this.tagRepository.merge(tag, {
      friendId: dto.friendId ? String(dto.friendId) : tag.friendId,
      amount: nextAmount,
      direction: nextDirection,
      note: dto.note ?? tag.note,
    });

    return this.tagRepository.save(updated);
  }

  async deleteTransactionTag(transactionId: string, tagId: string) {
    const tag = await this.tagRepository.findOne({
      where: { id: tagId, transactionId },
    });
    if (!tag) {
      throw new NotFoundException('Tag not found.');
    }

    await this.tagRepository.delete({ id: tagId });
    return { deleted: true };
  }

  async listFriendTransactions(friendId: string) {
    const friend = await this.friendRepository.findOne({ where: { id: friendId } });
    if (!friend) {
      throw new NotFoundException('Friend not found.');
    }

    return this.tagRepository.find({
      where: { friendId },
      relations: ['transaction'],
      order: { id: 'DESC' },
    });
  }

  async getFriendSummary(friendId: string) {
    const friend = await this.friendRepository.findOne({ where: { id: friendId } });
    if (!friend) {
      throw new NotFoundException('Friend not found.');
    }

    const raw = await this.tagRepository
      .createQueryBuilder('tag')
      .select(
        `COALESCE(SUM(CASE WHEN tag.direction = :iOwe THEN tag.amount ELSE 0 END), 0)`,
        'total_i_owe',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN tag.direction = :owesMe THEN tag.amount ELSE 0 END), 0)`,
        'total_owes_me',
      )
      .where('tag.friend_id = :friendId', { friendId })
      .setParameters({
        iOwe: TransactionFriendDirection.IOwe,
        owesMe: TransactionFriendDirection.OwesMe,
      })
      .getRawOne();

    return {
      friendId,
      totalIOwe: Number(raw?.total_i_owe ?? 0),
      totalOwesMe: Number(raw?.total_owes_me ?? 0),
      net: Number(raw?.total_owes_me ?? 0) - Number(raw?.total_i_owe ?? 0),
    };
  }
}
