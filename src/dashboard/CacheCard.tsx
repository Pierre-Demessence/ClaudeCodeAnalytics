import { DatabaseZap } from 'lucide-react';

import type { Activity, DayFlushes } from '@/core/activity';

import { formatDay, formatPercent, formatUsd, formatUsdShort } from '@/dashboard/format';
import { InfoTip } from '@/dashboard/Tip';
import { useTip } from '@/dashboard/useTip';

/** A day reading less of its input from cache than this is flagged. */
const POOR_SHARE = 0.8;
const REFERENCE_SHARE = 0.9;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "1 flush after a pause longer than the cache lifetime, 2 with the cache lost mid-conversation · $1.20 extra". */
function flushText({ extra, idleGap, noGap }: DayFlushes): string {
  const parts = [
    idleGap > 0 && `${plural(idleGap, 'flush', 'flushes')} after a pause longer than the cache lifetime`,
    noGap > 0 && `${plural(noGap, 'flush', 'flushes')} with the cache lost mid-conversation`,
  ].filter(Boolean);
  return `${parts.join(', ')} · ${formatUsd(extra)} extra`;
}

/** Cache use this week, and the daily cache-read share. */
export function CacheCard({ cache }: { cache: Activity['cache'] }) {
  const { daily, week } = cache;
  const tip = useTip();
  const hasDaily = daily.some(d => d.readShare !== undefined);
  const flushTotals = daily.reduce((sum, d) => ({ count: sum.count + (d.flushes ? d.flushes.idleGap + d.flushes.noGap : 0), extra: sum.extra + (d.flushes?.extra ?? 0) }), { count: 0, extra: 0 });

  return (
    <section className="card">
      <h2>Cache efficiency</h2>
      {week
        ? (
            <div className="stats">
              <div>
                <strong>{formatPercent(week.readShare * 100)}</strong>
                <span>input from cache</span>
              </div>
              <div>
                <strong>{formatUsdShort(week.saved)}</strong>
                <span>
                  saved this week
                  <InfoTip label="About saved">Cost of the cached input at the full input price, minus what cache reads cost, this week.</InfoTip>
                </span>
              </div>
              <div>
                <strong>{formatPercent(week.writeCostShare * 100)}</strong>
                <span>
                  of cost on cache writes
                  <InfoTip label="About cache writes">Share of cost spent writing the cache. High values mean the cache often expired between turns.</InfoTip>
                </span>
              </div>
            </div>
          )
        : <p className="empty">No usage this week yet.</p>}
      {hasDaily && (
        <>
          <div className="mini-bars cache-bars" role="img" aria-label="Daily share of input read from the cache, last 14 days">
            <span className="cache-reference" style={{ bottom: `${REFERENCE_SHARE * 100}%` }}>
              <span>90%</span>
            </span>
            {daily.map(d => (
              <span
                className={d.readShare !== undefined && d.readShare < POOR_SHARE ? 'mini-bar poor' : 'mini-bar'}
                key={d.day}
                style={{ height: `${(d.readShare ?? 0) * 100}%` }}
                {...tip(d.readShare === undefined ? `${formatDay(d.day)}: no usage` : `${formatDay(d.day)}: ${formatPercent(d.readShare * 100)} of input from cache`)}
              />
            ))}
          </div>
          {daily.some(d => d.flushes) && (
            <div aria-label="Cache flushes per day, last 14 days" className="flush-marks" role="group">
              {daily.map(d => (d.flushes
                ? (
                    <span className="flush-mark" key={d.day} {...tip(`${formatDay(d.day)}: ${flushText(d.flushes)}`)}>
                      <DatabaseZap aria-hidden="true" size={14} />
                      {d.flushes.idleGap + d.flushes.noGap}
                    </span>
                  )
                : <span key={d.day} />))}
            </div>
          )}
          <ul className="legend mini-legend">
            <li>
              <span className="legend-swatch cache-good" />
              80% or more from cache
            </li>
            <li>
              <span className="legend-swatch cache-poor" />
              under 80%: poor caching that day
            </li>
            <li>
              <span className="legend-line legend-reference" />
              90% reference
            </li>
            {flushTotals.count > 0 && (
              <li>
                <DatabaseZap aria-hidden="true" className="icon-inline" size={14} />
                {`cache flush: a turn that rewrote the cache instead of reading it, counted per day. ${flushTotals.count} in these 14 days, ${formatUsd(flushTotals.extra)} extra.`}
              </li>
            )}
          </ul>
          <p className="note">Daily cache-read share, last 14 days. Drops usually mean long pauses (the 5-minute cache expired) or resumed conversations.</p>
        </>
      )}
    </section>
  );
}
