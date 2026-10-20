import { EntityManager, In } from 'typeorm';
import { TransactionFriendTag } from '../database/entities/transaction-friend-tag.entity';
import { SettlementLink } from '../database/entities/settlement-link.entity';
import { TagWriteOff } from '../database/entities/tag-write-off.entity';
import { FriendOffsetLine } from '../database/entities/friend-offset.entity';
import { Ledger, LedgerRows, SettlementFigures } from './friend-ledger';

/**
 * The database side of the friend ledger: loads everything that decides one
 * or more friends' bill-wise figures as plain rows for `computeLedger`, and
 * writes back the one derived value that is stored — each settlement's side.
 */

export interface LoadedLedger {
  rows: LedgerRows;
  /** The tags behind the rows, with their subjects, keyed by id. */
  tags: Map<string, TransactionFriendTag>;
}

function subjectDay(tag: TransactionFriendTag): string {
  const raw: unknown = tag.transaction?.transactionDate ?? tag.cardTransaction?.txnDate ?? '';
  return raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
}

export async function loadLedger(em: EntityManager, friendIds: string[]): Promise<LoadedLedger> {
  const ids = [...new Set(friendIds.map(String))];
  if (ids.length === 0) {
    return { rows: { tags: [], links: [], offsetLines: [], writeOffs: [] }, tags: new Map() };
  }

  const [tags, links, offsetLines, writeOffs] = await Promise.all([
    em.getRepository(TransactionFriendTag).find({
      where: { friendId: In(ids) },
      relations: ['transaction', 'cardTransaction', 'cardTransaction.card'],
    }),
    em
      .getRepository(SettlementLink)
      .createQueryBuilder('l')
      .innerJoin('l.settlementTag', 's')
      .where('s.friend_id IN (:...ids)', { ids })
      .getMany(),
    em
      .getRepository(FriendOffsetLine)
      .createQueryBuilder('line')
      .innerJoin('line.offset', 'o')
      .where('o.friend_id IN (:...ids)', { ids })
      .getMany(),
    em
      .getRepository(TagWriteOff)
      .createQueryBuilder('w')
      .innerJoin('w.tag', 't')
      .where('t.friend_id IN (:...ids)', { ids })
      .orderBy('w.id', 'ASC')
      .getMany(),
  ]);

  return {
    tags: new Map(tags.map((t) => [String(t.id), t])),
    rows: {
      tags: tags.map((t) => ({
        id: String(t.id),
        direction: t.direction,
        amount: t.amount,
        date: subjectDay(t),
      })),
      links: links.map((l) => ({
        sourceId: String(l.settlementTagId),
        targetId: String(l.settledTagId),
        amount: l.amount,
      })),
      offsetLines: offsetLines.map((l) => ({
        offsetId: String(l.offsetId),
        tagId: String(l.tagId),
        amount: l.amount,
      })),
      writeOffs: writeOffs.map((w) => ({
        id: String(w.id),
        tagId: String(w.tagId),
        amount: w.amount,
        reason: w.reason,
      })),
    },
  };
}

/**
 * Stores each settlement's side as the ledger now derives it — NULL for a
 * legacy settlement — so SQL balance queries can read one column. Only rows
 * that changed are written.
 */
export async function syncSettlementSides(
  em: EntityManager,
  loaded: LoadedLedger,
  ledger: Ledger,
): Promise<void> {
  const bySide = new Map<'received' | 'paid' | null, string[]>();
  for (const [id, tag] of loaded.tags) {
    if (tag.direction !== 'SETTLEMENT') {
      if (tag.settlementSide !== null) {
        bySide.set(null, [...(bySide.get(null) ?? []), id]);
      }
      continue;
    }
    const fig = ledger.figures.get(id) as SettlementFigures | undefined;
    if (!fig) continue;
    const wanted = fig.settlementLegacy ? null : fig.settlementSide;
    if (tag.settlementSide !== wanted) {
      bySide.set(wanted, [...(bySide.get(wanted) ?? []), id]);
    }
  }
  for (const [side, ids] of bySide) {
    await em.update(TransactionFriendTag, { id: In(ids) }, { settlementSide: side });
  }
}
