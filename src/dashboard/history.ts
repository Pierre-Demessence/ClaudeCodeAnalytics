import { useEffect, useMemo, useState } from 'react';

import type { Range, RangeChoice, RangeContext } from '@/core/range';
import type { RangedSummary } from '@/core/ranged';
import type { Summary } from '@/dashboard/api';

import { includesNow, rangeLabel, resolveRange } from '@/core/range';
import { anonymizeRanged } from '@/dashboard/anonymize';
import { loadRange } from '@/dashboard/api';
import { useRangeChoice } from '@/dashboard/tabs';

/** The sections the Usage, Breakdown, Sessions and Weeks tabs read: the summary's default windows or the views of a range. */
export type History = Omit<RangedSummary, 'range'>;

/** A history tab's data and the range controls. */
export interface HistoryView {
  /** What the user picked; absent for each view's default window. */
  choice?: RangeChoice;
  ctx: RangeContext;
  /** Why the range could not be loaded. */
  error?: string;
  history: History;
  /** The range's data has not arrived yet: `history` is the previous one. */
  loading: boolean;
  onChoose: (choice?: RangeChoice) => void;
  /** The span of `choice`, now. */
  range?: Range;
}

export function rangeContext(summary: Summary): RangeContext {
  return {
    firstMessage: summary.rangeBasis.firstMessage,
    now: Date.parse(summary.generatedAt),
    resets: summary.rangeBasis.resets,
    timeZone: summary.timeZone,
  };
}

/** The sections of the summary, each over its own default window. */
export function defaultHistory(summary: Summary): History {
  return {
    activity: summary.activity,
    breakdown: summary.breakdown,
    sessions: summary.sessions,
    usage: { day: summary.daily, week: summary.weekly },
    weekHistory: summary.weekHistory,
  };
}

/** The view of a tab without a range picked. */
export function defaultView(summary: Summary, onChoose: HistoryView['onChoose'] = () => {}): HistoryView {
  return { ctx: rangeContext(summary), history: defaultHistory(summary), loading: false, onChoose };
}

/** "15 Oct – 22 Oct 2026" for the range picked; the card's own wording without one. */
export const rangeText = (view: HistoryView, fallback: string) => (view.range ? rangeLabel(view.range, view.ctx.timeZone) : fallback);

/**
 * The history tabs' data. Without a range in the hash these are the summary's
 * sections; with one, `/api/range` answers, and the previous data stays until
 * then. A range that includes now is loaded again at each summary reload.
 * `summary` is the one shown, `anonymous` masks the ranged data the same way,
 * and `active` is whether the open tab reads the range: nothing is fetched otherwise.
 */
export function useHistoryView(summary: Summary | undefined, anonymous: boolean, active = true): HistoryView | undefined {
  const [choice, onChoose] = useRangeChoice();
  const [answer, setAnswer] = useState<{ data: RangedSummary; key: string }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();

  const ctx = useMemo(() => summary && rangeContext(summary), [summary]);
  const range = useMemo(() => (choice && ctx ? resolveRange(choice, ctx) : undefined), [choice, ctx]);
  const from = active ? range?.from : undefined;
  const to = active ? range?.to : undefined;
  const key = range && `${range.from}-${range.to}`;
  // Reloads with the summary only while new messages can still change the range.
  const generatedAt = active && range && ctx && includesNow(range, ctx.now) ? summary?.generatedAt : undefined;

  useEffect(() => {
    if (from === undefined || to === undefined)
      return;
    let cancelled = false;
    const controller = new AbortController();
    loadRange({ from, to }, controller.signal).then((data) => {
      if (!cancelled) {
        setAnswer({ data, key: `${from}-${to}` });
        setFailure(undefined);
      }
    }, (e: unknown) => {
      if (!cancelled)
        setFailure({ key: `${from}-${to}`, message: e instanceof Error ? e.message : String(e) });
    });
    return () => {
      cancelled = true;
      // A range left behind (stepping quickly) need not be computed by the server.
      controller.abort();
    };
  }, [from, to, generatedAt]);

  const ranged = useMemo(() => answer && (anonymous ? anonymizeRanged(answer.data) : answer.data), [anonymous, answer]);

  if (!summary || !ctx)
    return undefined;
  return {
    choice,
    ctx,
    error: failure?.key === key ? failure?.message : undefined,
    history: range && ranged ? ranged : defaultHistory(summary),
    loading: range !== undefined && answer?.key !== key && failure?.key !== key,
    onChoose,
    range,
  };
}
