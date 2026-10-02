// The UI is in English, so dates and numbers follow one English locale rather
// than mixing with the browser's language.
const LOCALE = 'en-GB';

const percent = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat(LOCALE, { currency: 'USD', maximumFractionDigits: 2, style: 'currency' });
const usdShort = new Intl.NumberFormat(LOCALE, { currency: 'USD', maximumFractionDigits: 0, style: 'currency' });
const compact = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1, notation: 'compact' });
const dateTime = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', hour: '2-digit', minute: '2-digit', month: 'short', weekday: 'short' });
const date = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

export const formatPercent = (value: number) => `${percent.format(value)}%`;
export const formatUsd = (value: number) => usd.format(value);
/** Whole dollars, for axis ticks. */
export const formatUsdShort = (value: number) => usdShort.format(value);
export const formatTokens = (value: number) => compact.format(value);
export const formatDateTime = (value: string | number) => dateTime.format(new Date(value));

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
