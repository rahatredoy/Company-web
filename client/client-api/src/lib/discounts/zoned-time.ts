/**
 * Clock arithmetic in a named timezone, without a date library.
 *
 * A discount's schedule is written in the shopkeeper's clock — "Friday from 6pm",
 * "ends 30 September at midnight" — and the server runs in UTC. Evaluating
 * either in the server's own zone would move a Dhaka evening sale six hours, so
 * every reading of the wall clock goes through `Intl`, which carries the IANA
 * database the runtime already ships.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Whether the runtime recognises a zone name. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 is Sunday. */
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** What a clock on the wall in `timeZone` reads at `at`. */
export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(at);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';

  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')) % 24,
    minute: Number(read('minute')),
    second: Number(read('second')),
    weekday: WEEKDAYS.indexOf(read('weekday')),
  };
}

/** How far `timeZone` is ahead of UTC at `at`, in milliseconds. */
function offsetAt(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant a wall-clock reading in `timeZone` names.
 *
 * `2026-09-30T23:59` in `Asia/Dhaka` is 17:59 UTC. Solved in two passes because
 * the offset depends on the instant being solved for: the second pass settles
 * the hour either side of a daylight-saving change, where a single guess can
 * land on the wrong side of it.
 */
export function wallTimeToInstant(wall: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
  if (!match) throw new Error(`Not a wall-clock time: ${wall}`);

  const [, y, m, d, hh, mm] = match.map(Number) as [number, number, number, number, number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);

  let guess = naive - offsetAt(new Date(naive), timeZone);
  guess = naive - offsetAt(new Date(guess), timeZone);
  return new Date(guess);
}

/** The reverse, for handing a stored instant back to the editor's inputs. */
export function instantToWallTime(at: Date | null, timeZone: string): string | null {
  if (!at) return null;
  const p = zonedParts(at, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Minutes since midnight on the wall clock. */
export function minutesOfDay(parts: ZonedParts): number {
  return parts.hour * 60 + parts.minute;
}

export function parseClock(value: string): number {
  const [hh, mm] = value.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

/**
 * "12 October", or "12 October 2027" when the year is not this one — the date
 * a shopper is told they can use an offer again.
 */
export function formatZonedDate(at: Date, timeZone: string, now = new Date()): string {
  const sameYear = zonedParts(at, timeZone).year === zonedParts(now, timeZone).year;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(at);
}

/** "6:00 PM". */
export function formatClock(value: string): string {
  const minutes = parseClock(value);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** Calendar months added in UTC, clamped so 31 January plus a month is the end of February. */
export function addInterval(at: Date, amount: number, unit: 'day' | 'week' | 'month'): Date {
  if (unit === 'day') return new Date(at.getTime() + amount * 86_400_000);
  if (unit === 'week') return new Date(at.getTime() + amount * 7 * 86_400_000);

  const next = new Date(at.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + amount);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/**
 * Days between today and the nearest occurrence of a birthday, in `timeZone`.
 *
 * A 29 February birthday is kept on 28 February in a year that has none, which
 * is when those customers celebrate it anyway.
 */
export function daysFromBirthday(birthDate: string, at: Date, timeZone: string): number {
  return nearestBirthday(birthDate, at, timeZone).days;
}

/**
 * The birthday closest to today and how far away it is — the year is what keeps
 * a birthday voucher to one per birthday, including one that falls on 2 January
 * and is first noticed on 30 December.
 */
export function nearestBirthday(birthDate: string, at: Date, timeZone: string): { days: number; year: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return { days: Number.POSITIVE_INFINITY, year: 0 };

  const month = Number(match[2]);
  const day = Number(match[3]);
  const today = zonedParts(at, timeZone);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);

  const occurrence = (year: number) => {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Date.UTC(year, month - 1, Math.min(day, lastDay));
  };

  return [today.year - 1, today.year, today.year + 1]
    .map((year) => ({ year, days: Math.abs(Math.round((occurrence(year) - todayUtc) / 86_400_000)) }))
    .reduce((best, entry) => (entry.days < best.days ? entry : best));
}
