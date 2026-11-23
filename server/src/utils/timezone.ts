/**
 * Restaurant-local time helpers.
 *
 * The API runs in UTC (Vercel), but restaurants think in local time
 * (Restaurant.timezone, default Africa/Nairobi). A booking for "19:00" or a
 * report for "2026-11-23" must be interpreted in the restaurant's zone, not
 * the server's. Uses the built-in Intl API; no date library needed.
 */
import prisma from '../config/database';

export const DEFAULT_TIMEZONE = 'Africa/Nairobi';

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try { partsFormatter(tz); return true; } catch { return false; }
}

const safeZone = (tz?: string | null) => (isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE);

/** Wall-clock parts of `date` as seen in `timeZone`. */
export function zonedParts(date: Date, timeZone?: string | null) {
  const parts = partsFormatter(safeZone(timeZone)).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Offset (ms) of `timeZone` from UTC at instant `date` (positive east of UTC). */
function offsetMs(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * Converts a local wall-clock time in `timeZone` to the UTC instant.
 * `date` is "YYYY-MM-DD", `time` is "HH:mm" or "HH:mm:ss(.sss)". Returns null if invalid.
 */
export function zonedDateTimeToUtc(date: string, time: string, timeZone?: string | null): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(time.trim());
  if (!d || !t) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [h, mi, s, ms] = [Number(t[1]), Number(t[2]), Number(t[3] || 0), Number((t[4] || '0').padEnd(3, '0'))];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59 || s > 59) return null;
  const zone = safeZone(timeZone);
  const naive = Date.UTC(y, mo - 1, da, h, mi, s, ms);
  // Two passes handle DST transitions correctly for zones that have them.
  let guess = naive - offsetMs(new Date(naive), zone);
  guess = naive - offsetMs(new Date(guess), zone);
  const result = new Date(guess);
  // Reject impossible calendar dates such as 2026-02-31.
  const check = zonedParts(result, zone);
  if (check.year !== y || check.month !== mo || check.day !== da) return null;
  return result;
}

/** UTC instants for the start and end (inclusive) of a local calendar day. */
export function localDayRange(date: string, timeZone?: string | null): { start: Date; end: Date } | null {
  const start = zonedDateTimeToUtc(date, '00:00', timeZone);
  const end = zonedDateTimeToUtc(date, '23:59:59.999', timeZone);
  return start && end ? { start, end } : null;
}

/** Today's local date ("YYYY-MM-DD") in `timeZone`. */
export function localDateString(timeZone?: string | null, now: Date = new Date()): string {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Start of the current local day, as a UTC instant. */
export function startOfLocalDay(timeZone?: string | null, now: Date = new Date()): Date {
  return localDayRange(localDateString(timeZone, now), timeZone)!.start;
}

/** Minutes since local midnight in `timeZone`. */
export function localMinutesOfDay(timeZone?: string | null, now: Date = new Date()): number {
  const p = zonedParts(now, timeZone);
  return p.hour * 60 + p.minute;
}

const tzCache = new Map<string, { tz: string; at: number }>();
/** The restaurant's configured timezone (cached briefly), falling back to Africa/Nairobi. */
export async function getRestaurantTimeZone(restaurantId?: string | null): Promise<string> {
  if (!restaurantId) return DEFAULT_TIMEZONE;
  const hit = tzCache.get(restaurantId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.tz;
  const r = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { timezone: true } });
  const tz = safeZone(r?.timezone);
  tzCache.set(restaurantId, { tz, at: Date.now() });
  return tz;
}
