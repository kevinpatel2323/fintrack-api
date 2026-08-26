/**
 * Billing-cycle date math, shared by the import path and the live card view.
 *
 * These two used to disagree: the import derived a cycle as
 * `[previousStatementDate + 1, statementDate]` while the card page derived the
 * current cycle as `[statementDay, nextStatementDay - 1]` with a hard clamp to
 * the 28th. The off-by-one mis-filed transactions that fell on a cycle
 * boundary, so both now go through the helpers here.
 *
 * Every value is an ISO `YYYY-MM-DD` day string. ISO days compare correctly
 * with `<`/`>`, so ranges are compared as strings rather than Dates.
 */

/** Last day of a 1-based month, e.g. (2026, 2) -> 28. */
function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** `day` in the given 1-based month, clamped to that month's length. */
function clampedDayInMonth(year: number, month1: number, day: number): string {
  const d = Math.min(day, daysInMonth(year, month1));
  return `${year}-${String(month1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * A `date` column reads back as a string here, but a driver or a Date-valued
 * caller can still hand over a Date — normalise both to a plain ISO day.
 */
export function toIsoDay(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Statement cycle runs from the day after the previous statement date up to
 * the statement date itself; day-of-month is clamped for short months.
 */
export function cycleStartFor(statementDateIso: string): string {
  const [y, m, d] = statementDateIso.split('-').map(Number);
  let prevYear = y;
  let prevMonth = m - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const prev = clampedDayInMonth(prevYear, prevMonth, d);
  return addDaysIso(prev, 1);
}

/** The first occurrence of `day` that is on or after `fromIso`. */
export function statementDateOnOrAfter(day: number, fromIso: string): string {
  const [y, m] = fromIso.split('-').map(Number);
  const thisMonth = clampedDayInMonth(y, m, day);
  if (thisMonth >= fromIso) return thisMonth;
  return m === 12
    ? clampedDayInMonth(y + 1, 1, day)
    : clampedDayInMonth(y, m + 1, day);
}

/** Calendar month containing `iso` — the fallback when no statement day is set. */
export function monthRangeIso(iso: string): { start: string; end: string } {
  const [y, m] = iso.split('-').map(Number);
  return {
    start: `${y}-${String(m).padStart(2, '0')}-01`,
    end: clampedDayInMonth(y, m, 31),
  };
}

/**
 * The cycle that has not been billed yet — where a transaction made today
 * belongs until its statement arrives.
 *
 * `lastCycleEnd` is the newest statement's `cycleEnd`, and wins over the
 * date-derived start so the open cycle can never overlap a statement that
 * already exists. When that statement runs past the next statement day (an
 * out-of-order or future import) the open cycle rolls forward to the one after
 * it instead of producing an inverted range.
 */
export function openCycleRange(
  statementDay: number | null,
  lastCycleEnd: string | null,
  todayIso: string,
): { start: string; end: string } {
  if (!statementDay) return monthRangeIso(todayIso);

  const end = statementDateOnOrAfter(statementDay, todayIso);
  const derivedStart = cycleStartFor(end);
  const afterLastStatement = lastCycleEnd ? addDaysIso(lastCycleEnd, 1) : null;

  if (afterLastStatement && afterLastStatement > derivedStart) {
    return {
      start: afterLastStatement,
      end: statementDateOnOrAfter(statementDay, afterLastStatement),
    };
  }
  return { start: derivedStart, end };
}
