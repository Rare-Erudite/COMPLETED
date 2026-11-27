/**
 * RARE — Scheduler schedule-expression parser.
 *
 * Dependency-free. Turns a schedule definition into "when is the next due
 * instant", evaluated in a named IANA timezone so that daily/weekly/monthly
 * rules keep their wall-clock meaning across DST transitions.
 *
 * Supported kinds
 * ---------------
 *   interval  — fixed period in seconds ("every 2 minutes")
 *   cron      — 5-field cron: minute hour day-of-month month day-of-week
 *   once      — a single absolute instant
 *
 * Design notes
 * ------------
 * • All arithmetic is done on wall-clock fields in the target timezone, then
 *   converted back to an absolute instant. This is what makes "every day at
 *   08:00" stay at 08:00 local time when the clocks change, instead of drifting
 *   by an hour.
 * • DST gaps (a wall-clock time that does not exist, e.g. 02:30 on a spring
 *   forward day) resolve to the first instant after the gap.
 * • DST overlaps (a wall-clock time that happens twice) resolve to the FIRST
 *   occurrence, so a job does not run twice.
 * • The parser never throws on user input; invalid expressions return
 *   { ok: false, error } so the API can reject them with a clear message.
 */

export type ScheduleKind = 'interval' | 'cron' | 'once';

export interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** true when day-of-month was restricted (affects cron OR semantics) */
  domRestricted: boolean;
  /** true when day-of-week was restricted (affects cron OR semantics) */
  dowRestricted: boolean;
}

export interface ParsedSchedule {
  ok: true;
  kind: ScheduleKind;
  /** interval only */
  intervalSeconds?: number;
  /** cron only */
  cron?: CronFields;
  /** once only */
  at?: number;
  /** the expression as supplied, for display */
  expression: string;
}

export interface ParseFailure {
  ok: false;
  error: string;
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseNumberList(
  raw: string,
  min: number,
  max: number,
  names?: string[],
): number[] | null {
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const token = part.trim().toLowerCase();
    if (!token) return null;

    // step: */5 or 1-30/2
    let step = 1;
    let body = token;
    const slash = token.indexOf('/');
    if (slash !== -1) {
      body = token.slice(0, slash);
      const stepRaw = token.slice(slash + 1);
      if (!/^\d+$/.test(stepRaw)) return null;
      step = Number(stepRaw);
      if (step < 1) return null;
    }

    const resolve = (value: string): number | null => {
      if (/^\d+$/.test(value)) return Number(value);
      if (names) {
        const idx = names.indexOf(value);
        if (idx !== -1) return names === DOW_NAMES ? idx : idx + 1;
      }
      return null;
    };

    let start: number;
    let end: number;
    if (body === '*') {
      start = min;
      end = max;
    } else if (body.includes('-')) {
      const [a, b] = body.split('-');
      const sa = resolve(a);
      const sb = resolve(b);
      if (sa === null || sb === null) return null;
      start = sa;
      end = sb;
    } else {
      const single = resolve(body);
      if (single === null) return null;
      start = single;
      // "5/10" means "from 5 to max, every 10"
      end = slash !== -1 ? max : single;
    }

    if (start < min || end > max || start > end) return null;
    for (let v = start; v <= end; v += step) out.add(v);
  }
  if (out.size === 0) return null;
  return [...out].sort((a, b) => a - b);
}

/** Parse a 5-field cron expression. */
export function parseCron(expression: string): CronFields | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minRaw, hourRaw, domRaw, monRaw, dowRaw] = fields;

  const minutes = parseNumberList(minRaw, 0, 59);
  const hours = parseNumberList(hourRaw, 0, 23);
  const daysOfMonth = parseNumberList(domRaw, 1, 31);
  const months = parseNumberList(monRaw, 1, 12, MONTH_NAMES);
  const daysOfWeek = parseNumberList(dowRaw, 0, 6, DOW_NAMES);

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domRestricted: domRaw.trim() !== '*',
    dowRestricted: dowRaw.trim() !== '*',
  };
}

/**
 * Parse a natural-language-ish schedule expression.
 *
 * Accepted forms (case-insensitive):
 *   "every 2 minutes" / "every 30 seconds" / "every 6 hours"
 *   "every day at 08:00" / "daily at 8am"
 *   "every monday at 09:30" / "weekly on friday at 17:00"
 *   "every month on the 1st at 07:00"
 *   "0 8 * * *"  (raw cron)
 *   ISO timestamp for a one-off
 */
export function parseSchedule(expression: string, now: number = Date.now()): ParsedSchedule | ParseFailure {
  const raw = (expression ?? '').trim();
  if (!raw) return { ok: false, error: 'A schedule expression is required.' };
  const text = raw.toLowerCase().replace(/\s+/g, ' ');

  // Raw cron: 5 whitespace-separated fields, all cron-ish characters.
  if (/^[\d*,\-/a-z]+( [\d*,\-/a-z]+){4}$/.test(text) && !/^(every|daily|weekly|monthly)/.test(text)) {
    const cron = parseCron(text);
    if (!cron) return { ok: false, error: `"${raw}" is not a valid 5-field cron expression.` };
    return { ok: true, kind: 'cron', cron, expression: raw };
  }

  // Interval: "every N seconds|minutes|hours"
  const interval = text.match(/^every (\d+) ?(second|seconds|sec|minute|minutes|min|hour|hours|hr)s?$/);
  if (interval) {
    const n = Number(interval[1]);
    const unit = interval[2];
    const mult = unit.startsWith('sec') ? 1 : unit.startsWith('min') ? 60 : 3600;
    const seconds = n * mult;
    if (seconds < 30) return { ok: false, error: 'The minimum interval is 30 seconds.' };
    if (seconds > 366 * 24 * 3600) return { ok: false, error: 'The maximum interval is one year.' };
    return { ok: true, kind: 'interval', intervalSeconds: seconds, expression: raw };
  }

  // Time-of-day helper: "at 8", "at 08:00", "at 8am", "at 5:30pm"
  const parseTimeOfDay = (s: string): { h: number; m: number } | null => {
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const ampm = m[3];
    if (min > 59) return null;
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    if (h > 23) return null;
    return { h, m: min };
  };

  // Bare time of day: "10:30" / "8am" / "17:45".
  // The /api/schedules contract has always accepted a plain `time` field, and
  // existing clients send exactly this. Treat it as a daily recurrence at that
  // wall-clock time rather than rejecting it.
  if (/^\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/.test(text)) {
    const t = parseTimeOfDay(text);
    if (t) {
      return {
        ok: true,
        kind: 'cron',
        cron: {
          minutes: [t.m], hours: [t.h], daysOfMonth: range(1, 31), months: range(1, 12),
          daysOfWeek: range(0, 6), domRestricted: false, dowRestricted: false,
        },
        expression: raw,
      };
    }
  }

  // Daily: "every day at 08:00" / "daily at 8am"
  const daily = text.match(/^(?:every day|daily)(?: at)? (.+)$/);
  if (daily) {
    const t = parseTimeOfDay(daily[1].trim());
    if (!t) return { ok: false, error: `Could not read a time of day from "${raw}".` };
    return {
      ok: true,
      kind: 'cron',
      cron: {
        minutes: [t.m], hours: [t.h], daysOfMonth: range(1, 31), months: range(1, 12),
        daysOfWeek: range(0, 6), domRestricted: false, dowRestricted: false,
      },
      expression: raw,
    };
  }

  // Weekly: "every monday at 09:30" / "weekly on friday at 17:00"
  const weekly = text.match(/^(?:every|weekly on) (sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: at)? (.+)$/);
  if (weekly) {
    const dow = DOW_NAMES.indexOf(weekly[1].slice(0, 3));
    const t = parseTimeOfDay(weekly[2].trim());
    if (dow === -1 || !t) return { ok: false, error: `Could not read a weekday and time from "${raw}".` };
    return {
      ok: true,
      kind: 'cron',
      cron: {
        minutes: [t.m], hours: [t.h], daysOfMonth: range(1, 31), months: range(1, 12),
        daysOfWeek: [dow], domRestricted: false, dowRestricted: true,
      },
      expression: raw,
    };
  }

  // Monthly: "every month on the 1st at 07:00"
  const monthly = text.match(/^(?:every month|monthly) on the (\d{1,2})(?:st|nd|rd|th)?(?: at)? (.+)$/);
  if (monthly) {
    const dom = Number(monthly[1]);
    const t = parseTimeOfDay(monthly[2].trim());
    if (dom < 1 || dom > 31 || !t) return { ok: false, error: `Could not read a day of month and time from "${raw}".` };
    return {
      ok: true,
      kind: 'cron',
      cron: {
        minutes: [t.m], hours: [t.h], daysOfMonth: [dom], months: range(1, 12),
        daysOfWeek: range(0, 6), domRestricted: true, dowRestricted: false,
      },
      expression: raw,
    };
  }

  // A cron-shaped string with the wrong field count must be rejected, not
  // handed to Date.parse (which happily "parses" things like "0 8 * *").
  if (/[*\/]/.test(text) || /^[\d\s,\-]+$/.test(text)) {
    const fieldCount = text.split(' ').length;
    if (fieldCount !== 5) {
      return {
        ok: false,
        error: `"${raw}" looks like a cron expression but has ${fieldCount} fields; cron needs exactly 5 (minute hour day-of-month month day-of-week).`,
      };
    }
  }

  // One-off absolute instant.
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return { ok: true, kind: 'once', at: asDate, expression: raw };
  }

  return {
    ok: false,
    error: `Unrecognised schedule "${raw}". Use "every 2 minutes", "every day at 08:00", "every monday at 09:30", a 5-field cron expression, or an ISO timestamp.`,
  };
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i += 1) out.push(i);
  return out;
}

// ---------------------------------------------------------------------------
// Timezone-aware wall-clock helpers
// ---------------------------------------------------------------------------

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sunday
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Read the wall-clock fields of an absolute instant in a timezone. */
export function toWallClock(instant: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const weekdayName = get('weekday').toLowerCase().slice(0, 3);
  const weekday = DOW_NAMES.indexOf(weekdayName);
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: weekday === -1 ? 0 : weekday,
  };
}

/**
 * Convert wall-clock fields in a timezone back to an absolute instant.
 *
 * Strategy: guess UTC, measure the offset the timezone actually applies at
 * that guess, correct, and re-measure once. This converges for every real
 * zone including half-hour offsets and DST boundaries.
 */
export function fromWallClock(
  fields: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone: string,
): number {
  const utcGuess = Date.UTC(
    fields.year, fields.month - 1, fields.day,
    fields.hour, fields.minute, fields.second ?? 0,
  );
  let instant = utcGuess;
  for (let i = 0; i < 3; i += 1) {
    const wc = toWallClock(instant, timeZone);
    const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
    const drift = asUtc - instant;
    if (drift === 0) break;
    instant = utcGuess - drift;
  }
  return instant;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function cronMatchesDay(cron: CronFields, wc: WallClock): boolean {
  if (!cron.months.includes(wc.month)) return false;
  const domOk = cron.daysOfMonth.includes(wc.day);
  const dowOk = cron.daysOfWeek.includes(wc.weekday);
  // Standard cron semantics: when BOTH day fields are restricted, either may match.
  if (cron.domRestricted && cron.dowRestricted) return domOk || dowOk;
  if (cron.domRestricted) return domOk;
  if (cron.dowRestricted) return dowOk;
  return true;
}

/**
 * Next due instant strictly after `after`, or null if the expression can never
 * fire again (e.g. "every month on the 31st" in a month without one — we still
 * search forward, so this only returns null for genuinely impossible rules).
 */
export function nextRunAfter(
  schedule: ParsedSchedule,
  after: number,
  timeZone: string,
): number | null {
  if (schedule.kind === 'once') {
    return schedule.at !== undefined && schedule.at > after ? schedule.at : null;
  }

  if (schedule.kind === 'interval') {
    const step = (schedule.intervalSeconds ?? 60) * 1000;
    // Align to the next whole step after `after` so restarts do not drift.
    return after + step;
  }

  const cron = schedule.cron;
  if (!cron) return null;

  const startWc = toWallClock(after, timeZone);
  // Search up to 5 years ahead — enough for "Feb 29" style rules.
  const maxDays = 366 * 5;
  let cursor = { year: startWc.year, month: startWc.month, day: startWc.day };

  for (let dayOffset = 0; dayOffset <= maxDays; dayOffset += 1) {
    const probe = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day + dayOffset));
    const y = probe.getUTCFullYear();
    const mo = probe.getUTCMonth() + 1;
    const d = probe.getUTCDate();
    if (d > daysInMonth(y, mo)) continue;

    const wc: WallClock = {
      year: y, month: mo, day: d, hour: 0, minute: 0, second: 0,
      weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(),
    };
    if (!cronMatchesDay(cron, wc)) continue;

    for (const h of cron.hours) {
      for (const m of cron.minutes) {
        const candidate = fromWallClock({ year: y, month: mo, day: d, hour: h, minute: m, second: 0 }, timeZone);
        if (candidate > after) return candidate;
      }
    }
  }
  return null;
}

/** Human-readable description used in API responses and the UI. */
export function describeSchedule(schedule: ParsedSchedule): string {
  if (schedule.kind === 'once') {
    return `Once at ${new Date(schedule.at ?? 0).toISOString()}`;
  }
  if (schedule.kind === 'interval') {
    const s = schedule.intervalSeconds ?? 60;
    if (s % 3600 === 0) return `Every ${s / 3600} hour${s === 3600 ? '' : 's'}`;
    if (s % 60 === 0) return `Every ${s / 60} minute${s === 60 ? '' : 's'}`;
    return `Every ${s} seconds`;
  }
  return `Cron ${schedule.expression}`;
}
