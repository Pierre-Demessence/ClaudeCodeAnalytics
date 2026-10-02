import type { WindowForecast } from '@/core/forecast';

import { formatDollars, formatDuration, formatPercent, formatResets } from '@/dashboard/format';

/** Drives the verdict icon, the card's color band and the verdict box's tint. */
export type VerdictKind = 'cap' | 'good' | 'info' | 'tight';

export interface Verdict {
  detail?: string;
  kind: VerdictKind;
  title: string;
}

/** Median projection from which the window is called tight. */
const TIGHT_FROM = 85;

interface VerdictInput {
  forecast?: WindowForecast;
  now: number;
  /** ISO time or ms. */
  resetsAt: number | string;
  /** Dollars per day left to reach 100 % at reset (weekly window, calibrated). */
  roomPerDay?: number;
  used: number;
  window: 'fiveHour' | 'week';
}

/** One-line verdict of a limit card: will the window last until its reset? */
export function limitVerdict({ forecast, now, resetsAt, roomPerDay, used, window }: VerdictInput): Verdict {
  const week = window === 'week';
  if (!forecast)
    return { detail: 'The first projection comes after a few readings.', kind: 'info', title: 'Not enough history to project yet.' };

  if (used >= 100)
    return { detail: `Resets ${formatResets(resetsAt, now)}.`, kind: 'cap', title: 'Limit reached.' };
  if (forecast.capAt !== undefined || forecast.median >= 100) {
    const title = forecast.capAt === undefined
      ? 'Likely to hit the limit before the reset.'
      : `Likely to hit the limit around ${formatResets(forecast.capAt, now)}.`;
    const detail = week && roomPerDay !== undefined ? `Spend under ${formatDollars(Math.floor(roomPerDay))}/day to last until the reset.` : undefined;
    return { detail, kind: 'cap', title };
  }

  const busy = forecast.high >= 100 ? `A busy pace could reach ${formatPercent(forecast.high)}.` : `Even a busy pace ends around ${formatPercent(forecast.high)}.`;
  if (forecast.median >= TIGHT_FROM) {
    return {
      detail: `A busy pace could reach ${formatPercent(forecast.high)}.`,
      kind: 'tight',
      title: week ? 'Tight, but you should last the week.' : 'Tight, but this session should last.',
    };
  }
  return week
    ? { detail: busy, kind: 'good', title: 'You should last the week.' }
    : { detail: `${formatDuration(new Date(resetsAt).getTime() - now)} left in the window.`, kind: 'good', title: 'No cap expected this session.' };
}
