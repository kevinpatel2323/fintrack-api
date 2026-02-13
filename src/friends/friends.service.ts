import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';
import { Friend } from '../database/entities/friend.entity';
import {
  TransactionFriendDirection,
  TransactionFriendTag,
} from '../database/entities/transaction-friend-tag.entity';
import { SettlementLink } from '../database/entities/settlement-link.entity';
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
    @InjectRepository(SettlementLink)
    private readonly settlementLinkRepository: Repository<SettlementLink>,
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
    const tags = await this.tagRepository.find({
      where: { transactionId },
      relations: ['friend', 'transaction'],
      order: { id: 'ASC' },
    });

    // For each tag, load linked transactions if it's a settlement
    const tagsWithLinks = await Promise.all(
      tags.map(async (tag) => {
        if (tag.direction === TransactionFriendDirection.Settlement) {
          const links = await this.settlementLinkRepository.find({
            where: { settlementTagId: tag.id },
            relations: ['settledTag', 'settledTag.transaction'],
          });
          return {
            ...tag,
            settlesTransactions: links.map(link => link.settledTag),
          };
        }
        return tag;
      })
    );

    return tagsWithLinks;
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

    // Validate linked transactions if provided
    if (dto.linkedTransactionIds && dto.linkedTransactionIds.length > 0) {
      if (dto.direction !== TransactionFriendDirection.Settlement) {
        throw new ConflictException('Only settlement tags can have linked transactions.');
      }

      const linkedTags = await this.tagRepository.find({
        where: { id: In(dto.linkedTransactionIds.map(String)) },
      });

      if (linkedTags.length !== dto.linkedTransactionIds.length) {
        throw new NotFoundException('One or more linked transaction tags not found.');
      }

      for (const linkedTag of linkedTags) {
        if (linkedTag.friendId !== String(dto.friendId)) {
          throw new ConflictException('All linked transactions must be with the same friend.');
        }

        if (linkedTag.direction === TransactionFriendDirection.Settlement) {
          throw new ConflictException('Cannot link to another settlement transaction.');
        }
      }
    }

    const tag = this.tagRepository.create({
      transactionId,
      friendId: String(dto.friendId),
      amount: dto.amount,
      direction: dto.direction,
      note: dto.note ?? null,
    });

    const savedTag = await this.tagRepository.save(tag);

    // Create settlement links
    if (dto.linkedTransactionIds && dto.linkedTransactionIds.length > 0) {
      const links = dto.linkedTransactionIds.map(linkedId =>
        this.settlementLinkRepository.create({
          settlementTagId: savedTag.id,
          settledTagId: String(linkedId),
        })
      );
      await this.settlementLinkRepository.save(links);
    }

    return savedTag;
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

    // Validate linked transactions if provided
    if (dto.linkedTransactionIds !== undefined) {
      if (dto.linkedTransactionIds.length > 0 && nextDirection !== TransactionFriendDirection.Settlement) {
        throw new ConflictException('Only settlement tags can have linked transactions.');
      }

      if (dto.linkedTransactionIds.length > 0) {
        const linkedTags = await this.tagRepository.find({
          where: { id: In(dto.linkedTransactionIds.map(String)) },
        });

        if (linkedTags.length !== dto.linkedTransactionIds.length) {
          throw new NotFoundException('One or more linked transaction tags not found.');
        }

        const nextFriendId = dto.friendId ? String(dto.friendId) : tag.friendId;
        for (const linkedTag of linkedTags) {
          if (linkedTag.friendId !== nextFriendId) {
            throw new ConflictException('All linked transactions must be with the same friend.');
          }

          if (linkedTag.direction === TransactionFriendDirection.Settlement) {
            throw new ConflictException('Cannot link to another settlement transaction.');
          }
        }
      }

      // Update settlement links
      await this.settlementLinkRepository.delete({ settlementTagId: tagId });
      
      if (dto.linkedTransactionIds.length > 0) {
        const links = dto.linkedTransactionIds.map(linkedId =>
          this.settlementLinkRepository.create({
            settlementTagId: tagId,
            settledTagId: String(linkedId),
          })
        );
        await this.settlementLinkRepository.save(links);
      }
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

    // Settlement links will be automatically deleted due to CASCADE
    await this.tagRepository.delete({ id: tagId });
    return { deleted: true };
  }

  async listFriendTransactions(friendId: string) {
    const friend = await this.friendRepository.findOne({ where: { id: friendId } });
    if (!friend) {
      throw new NotFoundException('Friend not found.');
    }

    const tags = await this.tagRepository.find({
      where: { friendId },
      relations: ['transaction'],
      order: { id: 'DESC' },
    });

    // For each tag, load settlement info
    const tagsWithSettlementInfo = await Promise.all(
      tags.map(async (tag) => {
        // If it's a settlement, load what it settled
        let settlesTransactions;
        if (tag.direction === TransactionFriendDirection.Settlement) {
          const links = await this.settlementLinkRepository.find({
            where: { settlementTagId: tag.id },
            relations: ['settledTag', 'settledTag.transaction'],
          });
          settlesTransactions = links.map(link => link.settledTag);
        }

        // Find settlements that settled this tag
        const settlementLinks = await this.settlementLinkRepository.find({
          where: { settledTagId: tag.id },
          relations: ['settlementTag', 'settlementTag.transaction'],
        });
        const settledBy = settlementLinks.length > 0 
          ? settlementLinks.map(link => link.settlementTag)
          : undefined;

        return {
          ...tag,
          settlesTransactions,
          settledBy,
        };
      })
    );

    return tagsWithSettlementInfo;
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
      .addSelect(
        `COALESCE(SUM(CASE WHEN tag.direction = :settlement THEN tag.amount ELSE 0 END), 0)`,
        'total_settlements',
      )
      .where('tag.friend_id = :friendId', { friendId })
      .setParameters({
        iOwe: TransactionFriendDirection.IOwe,
        owesMe: TransactionFriendDirection.OwesMe,
        settlement: TransactionFriendDirection.Settlement,
      })
      .getRawOne();

    const totalIOwe = Number(raw?.total_i_owe ?? 0);
    const totalOwesMe = Number(raw?.total_owes_me ?? 0);
    const totalSettlements = Number(raw?.total_settlements ?? 0);
    
    // Net = (what they owe me) - (what I owe them) - settlements
    // Settlements reduce the outstanding balance
    const net = totalOwesMe - totalIOwe - totalSettlements;

    return {
      friendId,
      totalIOwe,
      totalOwesMe,
      totalSettlements,
      net,
    };
  }

  async getLinkeableTransactionsForFriend(friendId: string) {
    return this.tagRepository.find({
      where: {
        friendId,
      },
      relations: ['transaction'],
      order: { id: 'DESC' },
    }).then(tags =>
      tags.filter(tag => tag.direction !== TransactionFriendDirection.Settlement)
    );
  }
}
