import { RRule } from 'rrule';

/** Max recurrence instances per subscription for one calendar request */
export const MAX_OCCURRENCES_PER_SUBSCRIPTION = 10_000;

/** Max total instances returned from one calendar request */
export const MAX_OCCURRENCES_TOTAL = 50_000;

export function normalizeRruleBody(rrule: string): string {
  const t = rrule.trim();
  if (t.toUpperCase().startsWith('RRULE:')) return t.slice(6).trim();
  return t;
}

export function parseIsoDateToUtcNoon(isoDate: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error('Invalid ISO date');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
}

export function toIsoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Returns ISO date strings (YYYY-MM-DD) for occurrences in [windowStart, windowEnd], excluding exdates.
 */
/** Throws if RRULE text or dtstart cannot build a valid {@link RRule}. */
export function validateRrule(rruleBody: string, dtstart: string): void {
  const parsed = RRule.parseString(normalizeRruleBody(rruleBody));
  new RRule({ ...parsed, dtstart: parseIsoDateToUtcNoon(dtstart) });
}

export function expandOccurrenceDates(
  rruleBody: string,
  dtstart: string,
  exdates: string[],
  windowStart: string,
  windowEnd: string,
): string[] {
  const parsed = RRule.parseString(normalizeRruleBody(rruleBody));
  const dt = parseIsoDateToUtcNoon(dtstart);
  const rule = new RRule({ ...parsed, dtstart: dt });
  const start = parseIsoDateToUtcNoon(windowStart);
  const end = parseIsoDateToUtcNoon(windowEnd);
  if (end < start) return [];
  const dates = rule.between(start, end, true);
  if (dates.length > MAX_OCCURRENCES_PER_SUBSCRIPTION) {
    throw new Error(`Too many occurrences in range (>${MAX_OCCURRENCES_PER_SUBSCRIPTION})`);
  }
  const ex = new Set((exdates ?? []).map((x) => x.slice(0, 10)));
  const out: string[] = [];
  for (const day of dates) {
    const iso = toIsoDateUtc(day);
    if (!ex.has(iso)) out.push(iso);
  }
  return out;
}
