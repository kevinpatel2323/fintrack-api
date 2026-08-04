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
import { CardTransaction } from '../database/entities/card-transaction.entity';
import { CreateFriendDto } from './dto/create-friend.dto';
import { ListFriendsQueryDto } from './dto/list-friends.dto';
import { UpdateFriendDto } from './dto/update-friend.dto';
import { CreateTransactionFriendTagDto } from './dto/create-transaction-friend-tag.dto';
import { UpdateTransactionFriendTagDto } from './dto/update-transaction-friend-tag.dto';
import { FriendTransactionsQueryDto } from './dto/friend-transactions-query.dto';

/**
 * What a friend tag is attached to. A tag always has exactly one subject:
 * a bank transaction or a credit-card transaction.
 */
export type TagSubject =
  | { kind: 'bank'; id: string }
  | { kind: 'card'; id: string };

export const bankSubject = (id: string): TagSubject => ({ kind: 'bank', id });
export const cardSubject = (id: string): TagSubject => ({ kind: 'card', id });

/** The tag columns that identify a subject — usable directly as a TypeORM where. */
function subjectWhere(subject: TagSubject) {
  return subject.kind === 'bank'
    ? { transactionId: subject.id }
    : { cardTransactionId: subject.id };
}

/** Relations to hydrate so a tag can always render its subject. */
const SUBJECT_RELATIONS = ['transaction', 'cardTransaction', 'cardTransaction.card'];

/**
 * Card transactions rendered in the shape the friend ledger already expects
 * from a bank transaction, so every tag consumer works on either kind without
 * branching. `subject` carries the real identity for callers that need it.
 */
function cardTransactionAsSubject(card: CardTransaction) {
  const last4 = card.card?.last4;
  return {
    id: card.id,
    transactionDate: card.txnDate,
    narration: card.merchant,
    upiName: card.merchant,
    upiDescription: card.notes ?? null,
    // Drives the ledger's meta line, which otherwise reads "Manual".
    upiBank: last4 ? `Card ····${last4}` : 'Card',
    // A refund puts money back, so it lands on the deposit side.
    withdrawal: card.isRefund ? 0 : card.amount,
    deposit: card.isRefund ? card.amount : 0,
    isManual: false,
    accountNumber: null,
    categoryId: card.categoryId,
    category: card.category ?? null,
  };
}

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
    @InjectRepository(CardTransaction)
    private readonly cardTransactionRepository: Repository<CardTransaction>,
  ) {}

  /**
   * Collapses a tag's two possible subjects into the single `transaction`
   * field the API has always returned, plus an explicit `subject` descriptor.
   */
  private shapeTag<T extends TransactionFriendTag>(tag: T) {
    const { cardTransaction, ...rest } = tag as TransactionFriendTag & {
      cardTransaction?: CardTransaction | null;
    };
    if (!cardTransaction) {
      return {
        ...rest,
        subject: { kind: 'bank' as const, id: tag.transactionId },
      };
    }
    return {
      ...rest,
      transaction: cardTransactionAsSubject(cardTransaction),
      subject: {
        kind: 'card' as const,
        id: cardTransaction.id,
        cardId: cardTransaction.cardId,
        cardLast4: cardTransaction.card?.last4 ?? null,
      },
    };
  }

  private async assertSubjectExists(subject: TagSubject) {
    const found =
      subject.kind === 'bank'
        ? await this.transactionRepository.findOne({ where: { id: subject.id } })
        : await this.cardTransactionRepository.findOne({
            where: { id: subject.id },
          });
    if (!found) {
      throw new NotFoundException(
        subject.kind === 'bank'
          ? 'Transaction not found.'
          : 'Card transaction not found.',
      );
    }
  }

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
    return this.listSubjectTags(bankSubject(transactionId));
  }

  async listSubjectTags(subject: TagSubject) {
    const tags = await this.tagRepository.find({
      where: subjectWhere(subject),
      relations: ['friend', ...SUBJECT_RELATIONS],
      order: { id: 'ASC' },
    });

    // For each tag, load linked transactions if it's a settlement
    const tagsWithLinks = await Promise.all(
      tags.map(async (tag) => {
        const shaped = this.shapeTag(tag);
        if (tag.direction === TransactionFriendDirection.Settlement) {
          const links = await this.settlementLinkRepository.find({
            where: { settlementTagId: tag.id },
            relations: [
              'settledTag',
              'settledTag.transaction',
              'settledTag.cardTransaction',
              'settledTag.cardTransaction.card',
            ],
            order: { settledTagId: 'ASC' },
          });
          return {
            ...shaped,
            settlesTransactions: links.map((link) =>
              link.settledTag ? this.shapeTag(link.settledTag) : link.settledTag,
            ),
          };
        }
        return shaped;
      })
    );

    return tagsWithLinks;
  }

  /**
   * Batch variant of {@link listTransactionTags} for many transactions at once.
   * Returns a Map of transactionId -> tags[], where each tag matches the exact
   * shape of listTransactionTags (friend relation, plus settlesTransactions for
   * SETTLEMENT tags). Runs in a fixed TWO queries regardless of how many
   * transactions are passed — one for the tags, one for all settlement links —
   * so the transactions list can render friend tags inline instead of firing
   * one /transactions/:id/friends request per row (the N+1 flood that exhausted
   * the Supabase connection pool).
   */
  async listTransactionTagsForTransactions(
    transactionIds: string[],
  ): Promise<Map<string, any[]>> {
    return this.listTagsForSubjects('bank', transactionIds);
  }

  /** Batch variant for card transactions — see {@link listTransactionTagsForTransactions}. */
  async listTagsForCardTransactions(
    cardTransactionIds: string[],
  ): Promise<Map<string, any[]>> {
    return this.listTagsForSubjects('card', cardTransactionIds);
  }

  private async listTagsForSubjects(
    kind: TagSubject['kind'],
    subjectIds: string[],
  ): Promise<Map<string, any[]>> {
    const byTransaction = new Map<string, any[]>();
    if (subjectIds.length === 0) {
      return byTransaction;
    }

    const tags = await this.tagRepository.find({
      where:
        kind === 'bank'
          ? { transactionId: In(subjectIds) }
          : { cardTransactionId: In(subjectIds) },
      relations: ['friend', ...SUBJECT_RELATIONS],
      order: { id: 'ASC' },
    });

    const settlementTagIds = tags
      .filter((tag) => tag.direction === TransactionFriendDirection.Settlement)
      .map((tag) => tag.id);

    const settledTagsByLink = new Map<string, any[]>();
    if (settlementTagIds.length > 0) {
      const links = await this.settlementLinkRepository.find({
        where: { settlementTagId: In(settlementTagIds) },
        relations: [
          'settledTag',
          'settledTag.transaction',
          'settledTag.cardTransaction',
          'settledTag.cardTransaction.card',
        ],
        order: { settledTagId: 'ASC' },
      });
      for (const link of links) {
        const existing = settledTagsByLink.get(link.settlementTagId) ?? [];
        existing.push(
          link.settledTag ? this.shapeTag(link.settledTag) : link.settledTag,
        );
        settledTagsByLink.set(link.settlementTagId, existing);
      }
    }

    for (const tag of tags) {
      const base = this.shapeTag(tag);
      const shaped =
        tag.direction === TransactionFriendDirection.Settlement
          ? { ...base, settlesTransactions: settledTagsByLink.get(tag.id) ?? [] }
          : base;
      const subjectId =
        kind === 'bank' ? tag.transactionId : tag.cardTransactionId;
      if (!subjectId) continue;
      const existing = byTransaction.get(subjectId) ?? [];
      existing.push(shaped);
      byTransaction.set(subjectId, existing);
    }

    return byTransaction;
  }

  async createTransactionTag(transactionId: string, dto: CreateTransactionFriendTagDto) {
    return this.createSubjectTag(bankSubject(transactionId), dto);
  }

  async createSubjectTag(subject: TagSubject, dto: CreateTransactionFriendTagDto) {
    const [, friend] = await Promise.all([
      this.assertSubjectExists(subject),
      this.friendRepository.findOne({ where: { id: String(dto.friendId) } }),
    ]);

    if (!friend) {
      throw new NotFoundException('Friend not found.');
    }

    const existing = await this.tagRepository.findOne({
      where: { ...subjectWhere(subject), friendId: String(dto.friendId) },
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
      ...subjectWhere(subject),
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
    return this.updateSubjectTag(bankSubject(transactionId), tagId, dto);
  }

  async updateSubjectTag(
    subject: TagSubject,
    tagId: string,
    dto: UpdateTransactionFriendTagDto,
  ) {
    const tag = await this.tagRepository.findOne({
      where: { id: tagId, ...subjectWhere(subject) },
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
        where: { ...subjectWhere(subject), friendId: String(dto.friendId) },
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
    return this.deleteSubjectTag(bankSubject(transactionId), tagId);
  }

  async deleteSubjectTag(subject: TagSubject, tagId: string) {
    const tag = await this.tagRepository.findOne({
      where: { id: tagId, ...subjectWhere(subject) },
    });
    if (!tag) {
      throw new NotFoundException('Tag not found.');
    }

    // Settlement links will be automatically deleted due to CASCADE
    await this.tagRepository.delete({ id: tagId });
    return { deleted: true };
  }

  async listFriendTransactions(friendId: string, query?: FriendTransactionsQueryDto) {
    const friend = await this.friendRepository.findOne({ where: { id: friendId } });
    if (!friend) {
      throw new NotFoundException('Friend not found.');
    }

    const hasDateRange = Boolean(query?.start || query?.end);
    let tags: TransactionFriendTag[];

    if (hasDateRange) {
      // A tag dates from whichever subject it hangs off, so both the filter
      // and the ordering run on the coalesced date.
      const subjectDate =
        'COALESCE(transaction.transaction_date, cardTransaction.txn_date)';
      const qb = this.tagRepository
        .createQueryBuilder('tag')
        .leftJoinAndSelect('tag.transaction', 'transaction')
        .leftJoinAndSelect('tag.cardTransaction', 'cardTransaction')
        .leftJoinAndSelect('cardTransaction.card', 'card')
        .where('tag.friend_id = :friendId', { friendId });

      if (query?.start) {
        qb.andWhere(`${subjectDate} >= :start`, { start: query.start });
      }
      if (query?.end) {
        qb.andWhere(`${subjectDate} <= :end`, { end: query.end });
      }

      qb.orderBy(subjectDate, 'ASC').addOrderBy('tag.id', 'ASC');
      tags = await qb.getMany();
    } else {
      tags = await this.tagRepository.find({
        where: { friendId },
        relations: SUBJECT_RELATIONS,
        order: { id: 'DESC' },
      });
    }

    return this.attachSettlementInfoToTags(tags);
  }

  private async attachSettlementInfoToTags(tags: TransactionFriendTag[]) {
    const settledRelations = (prefix: 'settledTag' | 'settlementTag') => [
      prefix,
      `${prefix}.transaction`,
      `${prefix}.cardTransaction`,
      `${prefix}.cardTransaction.card`,
    ];

    return Promise.all(
      tags.map(async (tag) => {
        let settlesTransactions;
        if (tag.direction === TransactionFriendDirection.Settlement) {
          const links = await this.settlementLinkRepository.find({
            where: { settlementTagId: tag.id },
            relations: settledRelations('settledTag'),
          });
          settlesTransactions = links.map((link) =>
            link.settledTag ? this.shapeTag(link.settledTag) : link.settledTag,
          );
        }

        const settlementLinks = await this.settlementLinkRepository.find({
          where: { settledTagId: tag.id },
          relations: settledRelations('settlementTag'),
        });
        const settledBy =
          settlementLinks.length > 0
            ? settlementLinks.map((link) =>
                link.settlementTag
                  ? this.shapeTag(link.settlementTag)
                  : link.settlementTag,
              )
            : undefined;

        return {
          ...this.shapeTag(tag),
          settlesTransactions,
          settledBy,
        };
      }),
    );
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
      relations: SUBJECT_RELATIONS,
      order: { id: 'DESC' },
    }).then(tags =>
      tags
        .filter(tag => tag.direction !== TransactionFriendDirection.Settlement)
        .map((tag) => this.shapeTag(tag))
    );
  }
}
