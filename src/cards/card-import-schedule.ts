/**
 * Works out which credit-card statement has to be imported next.
 *
 * A statement is tracked by the month it is generated in ("Sep 2026") rather
 * than by its exact date. HDFC names its exports by that month, and a statement
 * date can shift for a short month, so month keys line up where days would not.
 *
 * The statement day comes from the imports already made whenever there are any.
 * The card's own `statementDay` is typed in by hand and can simply be wrong, so
 * it is only the fallback for a card that has never had a statement imported.
 *
 * Pure date math on ISO strings, like `card-cycle.ts`, so it is testable
 * without a database.
 */
import { addDaysIso, clampedDayInMonth, daysInMonth } from './card-cycle';

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** How many recent imports vote on the statement day. */
const DAY_SAMPLE_SIZE = 6;
/** Months shown on the at-a-glance strip, ending with the next unbilled one. */
const TIMELINE_MONTHS = 6;
/** Guards the month walks against a card last imported decades ago. */
const MAX_MONTH_WALK = 120;

export interface ImportedStatementRef {
  statementDate: string;
  dueDate: string | null;
  filename: string;
}

export interface ScheduledStatement {
  /** `YYYY-MM` */
  month: string;
  /** e.g. "Sep 2026" */
  label: string;
  /** The day the bank is expected to generate it. */
  expectedDate: string;
}

export interface NextStatement extends ScheduledStatement {
  /** Days from today to `expectedDate`; zero or less means it is already out. */
  daysAway: number;
  /** `expectedDate` plus the usual statement-to-due gap seen in past imports. */
  estimatedDueDate: string | null;
  /** The bank's export name for it, e.g. "Sep2026_BilledStatements_2209". */
  filenameHint: string | null;
}

export type TimelineState = 'imported' | 'missing' | 'ready' | 'upcoming';

export interface ImportSchedule {
  /**
   * `ready` — at least one statement is out and not imported yet.
   * `waiting` — everything generated so far is imported.
   * `unknown` — no imports and no statement day on the card to go on.
   */
  status: 'ready' | 'waiting' | 'unknown';
  statementDay: number | null;
  statementDaySource: 'history' | 'card' | null;
  /** The imports put the statement on a different day than the card setting says. */
  statementDayMismatch: boolean;
  lastImported: { month: string; label: string; statementDate: string } | null;
  next: NextStatement | null;
  /** Generated but not imported, oldest first. The first one is `next`. */
  pending: ScheduledStatement[];
  /** Months skipped between the first and the latest import. */
  gaps: ScheduledStatement[];
  timeline: Array<{ month: string; label: string; state: TimelineState }>;
}

export interface ScheduleInput {
  cardStatementDay: number | null;
  last4: string;
  /** Every import made for the card, in any order. */
  imports: ImportedStatementRef[];
  todayIso: string;
}

// ── Month helpers ─────────────────────────────────────────────────────────

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_ABBR[m - 1]} ${y}`;
}

function statementDateIn(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number);
  return clampedDayInMonth(y, m, day);
}

function scheduled(month: string, day: number): ScheduledStatement {
  return { month, label: monthLabel(month), expectedDate: statementDateIn(month, day) };
}

function dayOf(iso: string): number {
  return Number(iso.slice(8, 10));
}

function isMonthEnd(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  return d === daysInMonth(y, m);
}

function daysBetween(fromIso: string, toIso: string): number {
  const ms =
    Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ── Inference ─────────────────────────────────────────────────────────────

/**
 * The statement day the bank actually uses, read off recent imports (newest
 * first). A date on the last day of its month may have been clamped from a
 * later day — a 30th lands on the 28th in February — so those only decide when
 * nothing else is available, and then the largest one wins. Otherwise the most
 * common day wins, and a tie goes to the more recent import, which follows a
 * bank that has moved the statement date.
 */
export function inferStatementDay(newestFirst: string[]): number | null {
  const recent = newestFirst.slice(0, DAY_SAMPLE_SIZE);
  if (recent.length === 0) return null;

  const unclamped = recent.filter((iso) => !isMonthEnd(iso));
  if (unclamped.length === 0) return Math.max(...recent.map(dayOf));

  const counts = new Map<number, number>();
  for (const iso of unclamped) {
    counts.set(dayOf(iso), (counts.get(dayOf(iso)) ?? 0) + 1);
  }
  let best = dayOf(unclamped[0]);
  for (const iso of unclamped) {
    if (counts.get(dayOf(iso))! > counts.get(best)!) best = dayOf(iso);
  }
  return best;
}

/**
 * The bank's export name for `month`, built from the newest import's name —
 * "Aug2026_BilledStatements_2209_26-08-26_12.58.xlsx" gives
 * "Sep2026_BilledStatements_2209". The tail after the card number is a download
 * timestamp, so it is dropped. No hint when the old name does not follow that
 * pattern; a guess would send you looking for a file that does not exist.
 */
export function filenameHint(
  lastFilename: string,
  lastMonth: string,
  month: string,
  last4: string,
): string | null {
  const token = (m: string) => monthLabel(m).replace(' ', '');
  const prefix = token(lastMonth);
  if (!lastFilename.startsWith(prefix)) return null;
  const rest = lastFilename.slice(prefix.length);
  const cardAt = rest.indexOf(`_${last4}`);
  if (cardAt < 0) return null;
  return `${token(month)}${rest.slice(0, cardAt + last4.length + 1)}`;
}

// ── Schedule ──────────────────────────────────────────────────────────────

export function buildImportSchedule(input: ScheduleInput): ImportSchedule {
  const { cardStatementDay, last4, todayIso } = input;
  const imports = [...input.imports].sort((a, b) =>
    b.statementDate.localeCompare(a.statementDate),
  );
  const inferredDay = inferStatementDay(imports.map((i) => i.statementDate));
  const statementDay = inferredDay ?? cardStatementDay ?? null;
  const statementDaySource = inferredDay
    ? 'history'
    : cardStatementDay
      ? 'card'
      : null;
  const statementDayMismatch = Boolean(
    inferredDay && cardStatementDay && inferredDay !== cardStatementDay,
  );

  if (!statementDay) {
    return {
      status: 'unknown',
      statementDay: null,
      statementDaySource: null,
      statementDayMismatch: false,
      lastImported: null,
      next: null,
      pending: [],
      gaps: [],
      timeline: [],
    };
  }

  const isOut = (month: string) => statementDateIn(month, statementDay) <= todayIso;
  const importedMonths = new Set(imports.map((i) => monthOf(i.statementDate)));
  const newest = imports[0] ?? null;
  const lastMonth = newest ? monthOf(newest.statementDate) : null;

  // Everything the bank has generated since the newest import. With nothing
  // imported yet there is no backlog to speak of — just the latest statement,
  // which is the natural one to start from.
  const pending: ScheduledStatement[] = [];
  let upcomingMonth: string;
  if (lastMonth) {
    let month = addMonths(lastMonth, 1);
    for (let i = 0; i < MAX_MONTH_WALK && isOut(month); i += 1) {
      pending.push(scheduled(month, statementDay));
      month = addMonths(month, 1);
    }
    upcomingMonth = month;
  } else {
    const thisMonth = monthOf(todayIso);
    const latestOut = isOut(thisMonth) ? thisMonth : addMonths(thisMonth, -1);
    pending.push(scheduled(latestOut, statementDay));
    upcomingMonth = addMonths(latestOut, 1);
  }

  const gaps: ScheduledStatement[] = [];
  if (lastMonth) {
    const firstMonth = monthOf(imports[imports.length - 1].statementDate);
    let month = addMonths(firstMonth, 1);
    for (let i = 0; i < MAX_MONTH_WALK && month < lastMonth; i += 1) {
      if (!importedMonths.has(month)) gaps.push(scheduled(month, statementDay));
      month = addMonths(month, 1);
    }
  }

  const nextScheduled = pending[0] ?? scheduled(upcomingMonth, statementDay);
  const dueGap = median(
    imports
      .filter((i) => i.dueDate)
      .map((i) => daysBetween(i.statementDate, i.dueDate as string)),
  );
  const next: NextStatement = {
    ...nextScheduled,
    daysAway: daysBetween(todayIso, nextScheduled.expectedDate),
    estimatedDueDate:
      dueGap === null ? null : addDaysIso(nextScheduled.expectedDate, dueGap),
    filenameHint: newest
      ? filenameHint(newest.filename, lastMonth!, nextScheduled.month, last4)
      : null,
  };

  // The strip ends on the first statement not generated yet and reaches back
  // at most TIMELINE_MONTHS, never past the first statement there is to show.
  const earliest = lastMonth
    ? monthOf(imports[imports.length - 1].statementDate)
    : pending[0].month;
  let start = addMonths(upcomingMonth, -(TIMELINE_MONTHS - 1));
  if (start < earliest) start = earliest;
  const timeline: ImportSchedule['timeline'] = [];
  for (let month = start; month <= upcomingMonth; month = addMonths(month, 1)) {
    let state: TimelineState;
    if (importedMonths.has(month)) state = 'imported';
    else if (lastMonth && month < lastMonth) state = 'missing';
    else if (month === upcomingMonth) state = 'upcoming';
    else state = 'ready';
    timeline.push({ month, label: monthLabel(month), state });
  }

  return {
    status: pending.length > 0 ? 'ready' : 'waiting',
    statementDay,
    statementDaySource,
    statementDayMismatch,
    lastImported: newest
      ? {
          month: lastMonth!,
          label: monthLabel(lastMonth!),
          statementDate: newest.statementDate,
        }
      : null,
    next,
    pending,
    gaps,
    timeline,
  };
}
