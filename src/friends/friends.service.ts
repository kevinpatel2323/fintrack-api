import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, In, Repository } from 'typeorm';
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
import { UpdateLedgerPreferencesDto } from './dto/update-ledger-preferences.dto';
import { SettlementAllocationDto } from './dto/settlement-allocation.dto';
import { CreateOffsetDto } from './dto/create-offset.dto';
import { CreateWriteOffDto } from './dto/create-write-off.dto';
import { ApplyLegacyReviewDto } from './dto/apply-legacy-review.dto';
import { TagWriteOff } from '../database/entities/tag-write-off.entity';
import { FriendOffset, FriendOffsetLine } from '../database/entities/friend-offset.entity';
import { fromPaise, toPaise } from './settlement-allocation';
import {
  LedgerRows,
  SettlementFigures,
  computeLedger,
  newErrors,
  suggestLegacyConversion,
  withSettlementLinks,
  withTagChanged,
  withoutTag,
} from './friend-ledger';
import { loadLedger, syncSettlementSides } from './friend-ledger.store';

/** Placeholder id for a tag that does not exist yet, in a what-if ledger. */
const NEW_TAG = 'new';

const isDue = (direction: string) => direction === 'OWES_ME' || direction === 'I_OWE';

/** A tag's subject date — bank or card — for oldest-first ordering. */
function subjectDate(tag: TransactionFriendTag): string {
  // Typed as a string, but a driver can still hand back a Date.
  const raw: unknown = tag.transaction?.transactionDate ?? tag.cardTransaction?.txnDate ?? '';
  return raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
}

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
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Bill-wise figures for a batch of tags: pending / settled / netted /
   * written off for entries, applied / on account / side for settlements, each
   * tag's signed balance effect, and the write-offs and offsets behind them.
   * Computed from the whole ledger of every friend involved, so refunds and
   * netting that reach beyond the batch still count.
   */
  private async allocationInfo(tags: TransactionFriendTag[]): Promise<Map<string, object>> {
    const info = new Map<string, object>();
    if (tags.length === 0) return info;
    const loaded = await loadLedger(
      this.dataSource.manager,
      tags.map((t) => String(t.friendId)),
    );
    const ledger = computeLedger(loaded.rows);
    for (const tag of tags) {
      const id = String(tag.id);
      const fig = ledger.figures.get(id);
      if (!fig) continue;
      const { kind: _kind, ...figures } = fig;
      info.set(id, {
        ...figures,
        writeOffs: loaded.rows.writeOffs
          .filter((w) => w.tagId === id)
          .map((w) => ({ id: w.id, amount: w.amount, reason: w.reason })),
        offsets: loaded.rows.offsetLines
          .filter((l) => l.tagId === id)
          .map((l) => ({ offsetId: l.offsetId, amount: l.amount })),
      });
    }
    return info;
  }

  /**
   * Applies `change` to the friend's ledger in memory and throws if that breaks
   * a rule that held before — including flipping the direction of a settlement
   * other than the ones being edited (a refund whose target changed sides,
   * say). Rules already broken before the change (left by a cascade delete,
   * for instance) do not block it.
   *
   * `targets` are tag ids the change points at; each must be one of this
   * friend's tags.
   */
  private async assertLedgerChange(
    friendId: string,
    change: (rows: LedgerRows) => LedgerRows,
    options: { targets?: string[]; editing?: string[] } = {},
  ): Promise<void> {
    const loaded = await loadLedger(this.dataSource.manager, [friendId]);
    const targets = options.targets ?? [];
    if (new Set(targets).size !== targets.length) {
      throw new ConflictException('The same entry is listed more than once.');
    }
    for (const id of targets) {
      if (!loaded.tags.has(String(id))) {
        throw new ConflictException(`Entry #${id} does not exist or belongs to a different friend.`);
      }
    }

    const before = computeLedger(loaded.rows);
    const after = computeLedger(change(loaded.rows));
    const editing = new Set((options.editing ?? []).map(String));
    const messages = newErrors(before, after).map((e) => e.message);
    for (const [id, fig] of after.figures) {
      const was = before.figures.get(id);
      if (
        fig.kind === 'settlement' &&
        was?.kind === 'settlement' &&
        !editing.has(id) &&
        fig.settlementSide !== was.settlementSide
      ) {
        messages.push(
          `Settlement #${id} would change from money ${was.settlementSide} to money ${fig.settlementSide}. Change it first.`,
        );
      }
    }
    if (messages.length > 0) {
      throw new ConflictException(
        messages
          .map((m) => m.replace(/Settlement #new\b/g, 'This settlement').replace(/#new\b/g, 'this settlement'))
          .join(' '),
      );
    }
  }

  /** Re-derives and stores each settlement's side for these friends. */
  private async syncSides(em: EntityManager, friendIds: string[]) {
    const loaded = await loadLedger(em, friendIds);
    await syncSettlementSides(em, loaded, computeLedger(loaded.rows));
  }

  private async writeAllocations(
    em: EntityManager,
    settlementTagId: string,
    allocations: SettlementAllocationDto[],
  ) {
    await em.delete(SettlementLink, { settlementTagId });
    if (allocations.length === 0) return;
    await em.save(
      allocations.map((a) =>
        em.create(SettlementLink, {
          settlementTagId,
          settledTagId: String(a.tagId),
          amount: a.amount,
        }),
      ),
    );
  }

  /** True when amounts, offsets or write-offs hang off this tag. */
  private async hasLedgerAttachments(tag: TransactionFriendTag): Promise<boolean> {
    const loaded = await loadLedger(this.dataSource.manager, [String(tag.friendId)]);
    const id = String(tag.id);
    return (
      loaded.rows.links.some(
        (l) => (l.sourceId === id || l.targetId === id) && l.amount !== null,
      ) ||
      loaded.rows.offsetLines.some((l) => l.tagId === id) ||
      loaded.rows.writeOffs.some((w) => w.tagId === id)
    );
  }

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

  /**
   * The tag at the other end of a settlement link, with `linkAmount` — how much
   * of the settlement went to it, or null for a link made before amounts.
   */
  private shapeLinkedTag(link: SettlementLink, side: 'settledTag' | 'settlementTag') {
    const linked = link[side];
    if (!linked) return linked;
    return { ...this.shapeTag(linked), linkAmount: link.amount ?? null };
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

    const info = await this.allocationInfo(tags);

    // For each tag, load linked transactions if it's a settlement
    const tagsWithLinks = await Promise.all(
      tags.map(async (tag) => {
        const shaped = { ...this.shapeTag(tag), ...info.get(String(tag.id)) };
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
            settlesTransactions: links.map((link) => this.shapeLinkedTag(link, 'settledTag')),
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
        existing.push(this.shapeLinkedTag(link, 'settledTag'));
        settledTagsByLink.set(link.settlementTagId, existing);
      }
    }

    const info = await this.allocationInfo(tags);

    for (const tag of tags) {
      const base = { ...this.shapeTag(tag), ...info.get(String(tag.id)) };
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

    if (dto.allocations !== undefined && dto.linkedTransactionIds !== undefined) {
      throw new BadRequestException('Send either allocations or linkedTransactionIds, not both.');
    }
    if (dto.allocations?.length) {
      if (dto.direction !== TransactionFriendDirection.Settlement) {
        throw new ConflictException('Only a settlement can be applied to entries.');
      }
      const allocations = dto.allocations.map((a) => ({ tagId: String(a.tagId), amount: a.amount }));
      await this.assertLedgerChange(
        String(dto.friendId),
        (rows) =>
          withSettlementLinks(
            { ...rows, tags: [...rows.tags, { id: NEW_TAG, direction: dto.direction, amount: dto.amount }] },
            NEW_TAG,
            allocations,
          ),
        { targets: allocations.map((a) => a.tagId), editing: [NEW_TAG] },
      );
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

    // The tag and its links land together, so a failed link never leaves a
    // settlement saved without the allocation it was created with.
    return this.dataSource.transaction(async (em) => {
      const savedTag = await em.save(tag);

      if (dto.allocations?.length) {
        await this.writeAllocations(em, savedTag.id, dto.allocations);
      } else if (dto.linkedTransactionIds && dto.linkedTransactionIds.length > 0) {
        const links = dto.linkedTransactionIds.map((linkedId) =>
          em.create(SettlementLink, {
            settlementTagId: savedTag.id,
            settledTagId: String(linkedId),
          }),
        );
        await em.save(links);
      }

      await this.syncSides(em, [String(dto.friendId)]);
      return savedTag;
    });
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

    const nextFriendId = dto.friendId ? String(dto.friendId) : String(tag.friendId);
    const movingFriend = nextFriendId !== String(tag.friendId);
    if (dto.allocations !== undefined && dto.linkedTransactionIds !== undefined) {
      throw new BadRequestException('Send either allocations or linkedTransactionIds, not both.');
    }
    if (dto.allocations !== undefined && dto.allocations.length > 0) {
      if (nextDirection !== TransactionFriendDirection.Settlement) {
        throw new ConflictException('Only a settlement can be applied to entries.');
      }
      if (movingFriend) {
        throw new ConflictException('Move the settlement to the other friend first, then apply it.');
      }
    }
    if (movingFriend && (await this.hasLedgerAttachments(tag))) {
      throw new ConflictException(
        'This entry has settlement amounts, netting or write-offs attached. Remove them before moving it to another friend.',
      );
    }
    if (!movingFriend && dto.linkedTransactionIds === undefined) {
      const allocations = (dto.allocations ?? []).map((a) => ({ tagId: String(a.tagId), amount: a.amount }));
      await this.assertLedgerChange(
        String(tag.friendId),
        (rows) => {
          const changed = withTagChanged(rows, String(tag.id), { direction: nextDirection, amount: nextAmount });
          return dto.allocations !== undefined
            ? withSettlementLinks(changed, String(tag.id), allocations)
            : changed;
        },
        { targets: allocations.map((a) => a.tagId), editing: [String(tag.id)] },
      );
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

    return this.dataSource.transaction(async (em) => {
      if (dto.allocations !== undefined) {
        await this.writeAllocations(em, String(tag.id), dto.allocations);
      }
      const updated = em.merge(TransactionFriendTag, tag, {
        friendId: nextFriendId,
        amount: nextAmount,
        direction: nextDirection,
        note: dto.note ?? tag.note,
      });
      const saved = await em.save(updated);
      await this.syncSides(em, [String(tag.friendId), nextFriendId]);
      return saved;
    });
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

    // Removing an entry can strand what depends on it — a settlement that
    // netted it in, say — so the ledger has to hold without it.
    await this.assertLedgerChange(String(tag.friendId), (rows) => withoutTag(rows, String(tag.id)));

    await this.dataSource.transaction(async (em) => {
      // An offset is one balanced whole; losing a line voids all of it. Links
      // and write-offs go with the tag through ON DELETE CASCADE.
      const lines = await em.find(FriendOffsetLine, { where: { tagId: String(tag.id) } });
      const offsetIds = [...new Set(lines.map((l) => String(l.offsetId)))];
      if (offsetIds.length > 0) await em.delete(FriendOffset, { id: In(offsetIds) });
      await em.delete(TransactionFriendTag, { id: tagId });
      await this.syncSides(em, [String(tag.friendId)]);
    });
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

    const ids = tags.map((t) => String(t.id));
    const [outgoing, incoming] = ids.length
      ? await Promise.all([
          this.settlementLinkRepository.find({
            where: { settlementTagId: In(ids) },
            relations: settledRelations('settledTag'),
            order: { id: 'ASC' },
          }),
          this.settlementLinkRepository.find({
            where: { settledTagId: In(ids) },
            relations: settledRelations('settlementTag'),
            order: { id: 'ASC' },
          }),
        ])
      : [[], []];

    // Linked tags carry their own figures too, so a ledger can say what an
    // entry still has open even when that entry sits outside the export.
    const linkedTags = [
      ...outgoing.map((l) => l.settledTag),
      ...incoming.map((l) => l.settlementTag),
    ].filter((t): t is TransactionFriendTag => Boolean(t));
    const info = await this.allocationInfo([...tags, ...linkedTags]);
    const linked = (link: SettlementLink, side: 'settledTag' | 'settlementTag') => {
      const shaped = this.shapeLinkedTag(link, side);
      return shaped ? { ...shaped, ...info.get(String(shaped.id)) } : shaped;
    };

    return tags.map((tag) => {
      const settlesTransactions =
        tag.direction === TransactionFriendDirection.Settlement
          ? outgoing.filter((l) => l.settlementTagId === tag.id).map((l) => linked(l, 'settledTag'))
          : undefined;
      const settledByLinks = incoming.filter((l) => l.settledTagId === tag.id);
      const settledBy =
        settledByLinks.length > 0
          ? settledByLinks.map((l) => linked(l, 'settlementTag'))
          : undefined;

      return {
        ...this.shapeTag(tag),
        ...info.get(String(tag.id)),
        settlesTransactions,
        settledBy,
      };
    });
  }

  /**
   * Pins tags in or out of this friend's exported ledger, or forgets the pin.
   *
   * The picker saves whole batches (one "remember all" click can cover every
   * loaded row), so this collapses to at most three UPDATEs — one per distinct
   * value — no matter how many tags were sent. A tag that belongs to another
   * friend is a bug in the caller, not a partial success, so the whole batch
   * is rejected before anything is written.
   */
  async updateLedgerPreferences(
    friendId: string,
    dto: UpdateLedgerPreferencesDto,
  ) {
    const friend = await this.friendRepository.findOne({ where: { id: friendId } });
    if (!friend) {
      throw new NotFoundException('Friend not found.');
    }

    // Last entry wins if the caller sent the same tag twice.
    const wanted = new Map<string, boolean | null>();
    for (const pref of dto.preferences ?? []) {
      wanted.set(String(pref.tagId), pref.included ?? null);
    }
    if (wanted.size === 0) {
      return { updated: 0 };
    }

    const tagIds = [...wanted.keys()];
    const owned = await this.tagRepository.find({
      where: { id: In(tagIds), friendId },
      select: { id: true },
    });
    if (owned.length !== tagIds.length) {
      throw new NotFoundException(
        'One or more tags do not exist or belong to another friend.',
      );
    }

    const byValue = new Map<boolean | null, string[]>();
    for (const [tagId, included] of wanted) {
      const bucket = byValue.get(included) ?? [];
      bucket.push(tagId);
      byValue.set(included, bucket);
    }

    for (const [included, ids] of byValue) {
      await this.tagRepository.update({ id: In(ids) }, { ledgerIncluded: included });
    }

    return { updated: tagIds.length };
  }

  private async requireFriend(friendId: string): Promise<Friend> {
    const friend = await this.friendRepository.findOne({ where: { id: friendId } });
    if (!friend) {
      throw new NotFoundException('Friend not found.');
    }
    return friend;
  }

  /**
   * Totals plus the bill-wise view: what is still open entry by entry on each
   * side, settlement money on account, and `legacyDifference` — the part of
   * the balance only unreviewed legacy settlements explain. Together they
   * always reconcile: net = openOwesMe − openIOwe − onAccountReceived +
   * onAccountPaid + legacyDifference.
   */
  async getFriendSummary(friendId: string) {
    await this.requireFriend(friendId);
    const loaded = await loadLedger(this.dataSource.manager, [friendId]);
    const ledger = computeLedger(loaded.rows);

    let totalIOwe = 0;
    let totalOwesMe = 0;
    let totalSettlements = 0;
    let totalSettlementsPaid = 0;
    for (const tag of loaded.rows.tags) {
      const amount = toPaise(tag.amount);
      if (tag.direction === 'I_OWE') totalIOwe += amount;
      if (tag.direction === 'OWES_ME') totalOwesMe += amount;
      if (tag.direction === 'SETTLEMENT') {
        totalSettlements += amount;
        const fig = ledger.figures.get(tag.id) as SettlementFigures;
        if (fig.settlementSide === 'paid') totalSettlementsPaid += amount;
      }
    }
    const review = suggestLegacyConversion(loaded.rows);

    return {
      friendId,
      totalIOwe: fromPaise(totalIOwe),
      totalOwesMe: fromPaise(totalOwesMe),
      totalSettlements: fromPaise(totalSettlements),
      totalSettlementsReceived: fromPaise(totalSettlements - totalSettlementsPaid),
      totalSettlementsPaid: fromPaise(totalSettlementsPaid),
      totalWrittenOff: fromPaise(loaded.rows.writeOffs.reduce((s, w) => s + toPaise(w.amount), 0)),
      net: ledger.totals.net,
      openOwesMe: ledger.totals.openOwesMe,
      openIOwe: ledger.totals.openIOwe,
      onAccount: fromPaise(toPaise(ledger.totals.onAccountReceived) + toPaise(ledger.totals.onAccountPaid)),
      onAccountReceived: ledger.totals.onAccountReceived,
      onAccountPaid: ledger.totals.onAccountPaid,
      legacyDifference: ledger.totals.legacyDifference,
      legacySettlements: review.suggestions.length,
      legacyNeedingReview: review.suggestions.filter((s) => s.reasons.length > 0).length,
    };
  }

  async getLinkeableTransactionsForFriend(friendId: string) {
    const tags = await this.tagRepository
      .find({
        where: {
          friendId,
        },
        relations: SUBJECT_RELATIONS,
        order: { id: 'DESC' },
      })
      .then((all) => all.filter((tag) => tag.direction !== TransactionFriendDirection.Settlement));
    const info = await this.allocationInfo(tags);
    return tags.map((tag) => ({ ...this.shapeTag(tag), ...info.get(String(tag.id)) }));
  }

  /**
   * What a settlement can be applied to, oldest first:
   *
   * - `data` — every entry, on either side, with something still pending.
   *   Entries on the settlement's own side are paid off; entries on the other
   *   side are netted in.
   * - `refundable` — other settlements' money on account, which this one can
   *   refund.
   * - `balance` — the friend's reconciled totals, for context.
   *
   * When editing a settlement (`settlementTagId`), its own links are left out
   * of the maths — they are about to be replaced — and come back as
   * `currentAllocation`, so what it already covers stays listed. Entries an
   * amount-less (pre-allocation) link settled are left out: what was paid
   * against them was never recorded.
   */
  async listOpenDues(friendId: string, settlementTagId?: string) {
    await this.requireFriend(friendId);
    const loaded = await loadLedger(this.dataSource.manager, [friendId]);
    if (settlementTagId) {
      const settlement = loaded.tags.get(settlementTagId);
      if (!settlement || settlement.direction !== TransactionFriendDirection.Settlement) {
        throw new NotFoundException('Settlement not found for this friend.');
      }
    }

    const own = new Map<string, number | null>();
    for (const l of loaded.rows.links) {
      if (settlementTagId && l.sourceId === settlementTagId) own.set(l.targetId, l.amount);
    }
    const without = settlementTagId
      ? computeLedger(withSettlementLinks(loaded.rows, settlementTagId, []))
      : computeLedger(loaded.rows);
    const refundSources = new Set(
      loaded.rows.links
        .filter((l) => l.sourceId !== settlementTagId && loaded.tags.get(l.targetId)?.direction === 'SETTLEMENT')
        .map((l) => l.sourceId),
    );

    const dues = [];
    const refundable = [];
    for (const [id, tag] of loaded.tags) {
      const fig = without.figures.get(id);
      if (!fig) continue;
      const { kind, ...figures } = fig;
      const current = own.has(id) ? own.get(id) ?? null : null;
      if (kind === 'due') {
        const listed = own.has(id) || (!fig.settlementLegacy && fig.pendingAmount > 0);
        if (listed) dues.push({ ...this.shapeTag(tag), ...figures, currentAllocation: current });
      } else if (kind === 'settlement' && id !== settlementTagId) {
        const listed =
          !fig.settlementLegacy &&
          !refundSources.has(id) &&
          (own.has(id) || (fig.unallocatedAmount ?? 0) > 0);
        if (listed) refundable.push({ ...this.shapeTag(tag), ...figures, currentAllocation: current });
      }
    }

    const byDate = (a: { id: string }, b: { id: string }) =>
      subjectDate(loaded.tags.get(String(a.id))!).localeCompare(subjectDate(loaded.tags.get(String(b.id))!)) ||
      Number(a.id) - Number(b.id);
    return {
      count: dues.length,
      data: dues.sort(byDate),
      refundable: refundable.sort(byDate),
      balance: computeLedger(loaded.rows).totals,
    };
  }

  // ── Netting without money ──────────────────────────────────────────────

  async listOffsets(friendId: string) {
    await this.requireFriend(friendId);
    const offsets = await this.dataSource.getRepository(FriendOffset).find({
      where: { friendId },
      relations: ['lines', 'lines.tag', 'lines.tag.transaction', 'lines.tag.cardTransaction', 'lines.tag.cardTransaction.card'],
      order: { createdAt: 'DESC' },
    });
    return offsets.map((o) => ({
      id: o.id,
      note: o.note,
      createdAt: o.createdAt,
      amount: fromPaise(
        (o.lines ?? [])
          .filter((l) => l.tag?.direction === TransactionFriendDirection.OwesMe)
          .reduce((s, l) => s + toPaise(l.amount), 0),
      ),
      lines: (o.lines ?? []).map((l) => ({
        id: l.id,
        amount: l.amount,
        tag: l.tag ? this.shapeTag(l.tag) : null,
      })),
    }));
  }

  /**
   * Nets what the friend owes against what the user owes them, entry by entry,
   * with no money moving. Both sides must clear the same amount.
   */
  async createOffset(friendId: string, dto: CreateOffsetDto) {
    await this.requireFriend(friendId);
    const lines = dto.lines.map((l) => ({ tagId: String(l.tagId), amount: l.amount }));
    await this.assertLedgerChange(
      friendId,
      (rows) => ({
        ...rows,
        offsetLines: [...rows.offsetLines, ...lines.map((l) => ({ offsetId: NEW_TAG, ...l }))],
      }),
      { targets: lines.map((l) => l.tagId) },
    );

    return this.dataSource.transaction(async (em) => {
      const offset = await em.save(
        em.create(FriendOffset, {
          friendId,
          note: dto.note?.trim() || null,
          lines: lines.map((l) => em.create(FriendOffsetLine, { tagId: l.tagId, amount: l.amount })),
        }),
      );
      return { id: offset.id };
    });
  }

  /** Undoes a netting; the entries go back to pending. */
  async deleteOffset(friendId: string, offsetId: string) {
    const offset = await this.dataSource
      .getRepository(FriendOffset)
      .findOne({ where: { id: offsetId, friendId } });
    if (!offset) throw new NotFoundException('Netting not found.');
    await this.dataSource.getRepository(FriendOffset).delete({ id: offsetId });
    return { deleted: true };
  }

  // ── Write-offs ─────────────────────────────────────────────────────────

  /** Closes a leftover on an entry or a settlement; the balance moves by exactly `amount`. */
  async createWriteOff(friendId: string, dto: CreateWriteOffDto) {
    await this.requireFriend(friendId);
    const tagId = String(dto.tagId);
    await this.assertLedgerChange(
      friendId,
      (rows) => ({
        ...rows,
        writeOffs: [...rows.writeOffs, { id: NEW_TAG, tagId, amount: dto.amount }],
      }),
      { targets: [tagId] },
    );
    const saved = await this.dataSource.getRepository(TagWriteOff).save(
      this.dataSource.getRepository(TagWriteOff).create({
        tagId,
        amount: dto.amount,
        reason: dto.reason?.trim() || 'Round-off',
      }),
    );
    return { id: saved.id };
  }

  async deleteWriteOff(friendId: string, writeOffId: string) {
    const writeOff = await this.dataSource
      .getRepository(TagWriteOff)
      .findOne({ where: { id: writeOffId }, relations: ['tag'] });
    if (!writeOff || String(writeOff.tag?.friendId) !== friendId) {
      throw new NotFoundException('Write-off not found.');
    }
    await this.dataSource.getRepository(TagWriteOff).delete({ id: writeOffId });
    return { deleted: true };
  }

  // ── Reviewing settlements saved before amounts existed ─────────────────

  /**
   * The friend's amount-less settlements, each with the amounts its links most
   * plausibly meant, what would be left over, and how the balance would move.
   * Nothing is changed until the review is applied.
   */
  async getLegacyReview(friendId: string) {
    await this.requireFriend(friendId);
    const loaded = await loadLedger(this.dataSource.manager, [friendId]);
    const review = suggestLegacyConversion(loaded.rows);

    return {
      netBefore: review.netBefore,
      netAfter: review.netAfter,
      settlements: review.suggestions.map((s) => {
        const suggested = new Map(s.allocations.map((a) => [a.tagId, a.amount]));
        const linked = loaded.rows.links
          .filter((l) => l.sourceId === s.settlementId)
          .map((l) => loaded.tags.get(l.targetId))
          .filter((t): t is TransactionFriendTag => Boolean(t))
          .sort((a, b) => subjectDate(a).localeCompare(subjectDate(b)) || Number(a.id) - Number(b.id))
          .map((t) => ({
            ...this.shapeTag(t),
            suggestedAmount: suggested.get(String(t.id)) ?? 0,
            stale: s.staleTagIds.includes(String(t.id)),
            short: s.shortTagIds.includes(String(t.id)),
          }));
        return {
          ...s,
          settlement: this.shapeTag(loaded.tags.get(s.settlementId)!),
          linked,
        };
      }),
    };
  }

  /**
   * Gives all of a friend's amount-less settlements real amounts at once —
   * together, because several of them can share an entry and only the end
   * state is meaningful. Every rule must hold afterwards.
   */
  async applyLegacyReview(friendId: string, dto: ApplyLegacyReviewDto) {
    await this.requireFriend(friendId);
    const loaded = await loadLedger(this.dataSource.manager, [friendId]);
    const legacyIds = new Set(loaded.rows.links.filter((l) => l.amount === null).map((l) => l.sourceId));
    const submitted = dto.settlements.map((s) => String(s.settlementTagId));
    if (
      submitted.length !== legacyIds.size ||
      new Set(submitted).size !== submitted.length ||
      submitted.some((id) => !legacyIds.has(id))
    ) {
      throw new BadRequestException(
        `Review all ${legacyIds.size} older settlement(s) for this friend together.`,
      );
    }

    const plans = dto.settlements.map((s) => ({
      id: String(s.settlementTagId),
      allocations: s.allocations.map((a) => ({ tagId: String(a.tagId), amount: a.amount })),
    }));
    for (const plan of plans) {
      if (new Set(plan.allocations.map((a) => a.tagId)).size !== plan.allocations.length) {
        throw new ConflictException('The same entry is listed more than once.');
      }
    }
    await this.assertLedgerChange(
      friendId,
      (rows) => plans.reduce((r, plan) => withSettlementLinks(r, plan.id, plan.allocations), rows),
      {
        targets: [...new Set(plans.flatMap((p) => p.allocations.map((a) => a.tagId)))],
        editing: plans.map((p) => p.id),
      },
    );

    await this.dataSource.transaction(async (em) => {
      for (const plan of plans) {
        await this.writeAllocations(em, plan.id, plan.allocations.map((a) => ({ tagId: Number(a.tagId), amount: a.amount })));
      }
      await this.syncSides(em, [friendId]);
    });
    return this.getFriendSummary(friendId);
  }

  /** Friends with amount-less settlements, and how many of those need a decision. */
  async legacyReviewSummary() {
    const rows = await this.settlementLinkRepository
      .createQueryBuilder('l')
      .innerJoin('l.settlementTag', 's')
      .select('DISTINCT s.friend_id', 'friendId')
      .where('l.amount IS NULL')
      .getRawMany<{ friendId: string }>();
    const friendIds = rows.map((r) => String(r.friendId));
    if (friendIds.length === 0) return { needingReview: 0, friends: [] };

    const [loaded, friends] = await Promise.all([
      loadLedger(this.dataSource.manager, friendIds),
      this.friendRepository.find({ where: { id: In(friendIds) } }),
    ]);
    const result = friends
      .map((friend) => {
        const id = String(friend.id);
        const own = new Set(loaded.rows.tags.filter((t) => String(loaded.tags.get(t.id)?.friendId) === id).map((t) => t.id));
        const review = suggestLegacyConversion({
          tags: loaded.rows.tags.filter((t) => own.has(t.id)),
          links: loaded.rows.links.filter((l) => own.has(l.sourceId)),
          offsetLines: loaded.rows.offsetLines.filter((l) => own.has(l.tagId)),
          writeOffs: loaded.rows.writeOffs.filter((w) => own.has(w.tagId)),
        });
        return {
          friendId: id,
          friendName: friend.name,
          legacySettlements: review.suggestions.length,
          needingReview: review.suggestions.filter((s) => s.reasons.length > 0).length,
          netChange: fromPaise(toPaise(review.netAfter) - toPaise(review.netBefore)),
        };
      })
      .sort((a, b) => b.needingReview - a.needingReview || a.friendName.localeCompare(b.friendName));
    return {
      needingReview: result.reduce((s, f) => s + f.needingReview, 0),
      friends: result,
    };
  }
}
