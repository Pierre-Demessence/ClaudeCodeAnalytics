// The UI is in English, so dates and numbers follow one English locale rather
// than mixing with the browser's language.
const LOCALE = 'en-GB';

const percent = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
// narrowSymbol: en-GB writes "US$" otherwise.
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat(LOCALE, { currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2, style: 'currency' });
const usdShort = new Intl.NumberFormat(LOCALE, { currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0, style: 'currency' });
const compact = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1, notation: 'compact' });
const dateTime = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', hour: '2-digit', minute: '2-digit', month: 'short', weekday: 'short' });
const date = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const weekdayDate = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', weekday: 'short' });
const time = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const localDay = new Intl.DateTimeFormat('en-CA');
const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

export const formatPercent = (value: number) => `${percent.format(value)}%`;
export const formatInteger = (value: number) => integer.format(value);
export const formatUsd = (value: number) => usd.format(value);
/** Whole dollars in running text: "$46". */
export const formatDollars = (value: number) => `$${Math.round(value)}`;
/** Whole dollars, for axis ticks. */
export const formatUsdShort = (value: number) => usdShort.format(value);
export const formatTokens = (value: number) => compact.format(value);
export const formatDateTime = (value: string | number) => dateTime.format(new Date(value));
/** "Fri". */
export const formatWeekday = (value: string | number) => weekday.format(new Date(value));

/** `2026-10-02` (a local day) or an ISO instant, as a short date. */
export function formatDay(value: string): string {
  return date.format(/^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value));
}

/** "in 3 days", "5 minutes ago". */
export function formatRelative(value: string | number, now = Date.now()): string {
  const seconds = (new Date(value).getTime() - now) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86_400], ['hour', 3_600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size)
      return relative.format(Math.round(seconds / size), unit);
  }
  return relative.format(Math.round(seconds), 'second');
}

/** "in 4 h 12 min" for less than a day ahead, otherwise like `formatRelative`. */
export function formatCountdown(value: string | number, now = Date.now()): string {
  const ms = new Date(value).getTime() - now;
  if (ms <= 0 || ms >= 86_400_000)
    return formatRelative(value, now);
  return `in ${formatDuration(ms)}`;
}

/** "today, 17:50" for an instant later today, otherwise "Fri 2 Oct, 09:00" (local time). */
export function formatResets(value: string | number, now = Date.now()): string {
  const at = new Date(value);
  const day = localDay.format(at) === localDay.format(new Date(now)) ? 'today' : weekdayDate.format(at);
  return `${day}, ${time.format(at)}`;
}

/** "2 h 10 min" or "45 min", rounded up so a countdown never reads "0 min" before its end. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}
