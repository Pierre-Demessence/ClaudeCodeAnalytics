import type { Activity } from '@/core/activity';

import { formatDay, formatPercent, formatUsdShort } from '@/dashboard/format';

/** A day reading less of its input from cache than this is flagged. */
const POOR_SHARE = 0.8;
const REFERENCE_SHARE = 0.9;

/** Cache use this week, and the daily cache-read share. */
export function CacheCard({ cache }: { cache: Activity['cache'] }) {
  const { daily, week } = cache;
  const hasDaily = daily.some(d => d.readShare !== undefined);

  return (
    <section className="card">
      <h2>Cache efficiency</h2>
      {week
        ? (
            <div className="stats">
              <div title="Share of input tokens served from the prompt cache this week">
                <strong>{formatPercent(week.readShare * 100)}</strong>
                <span>input from cache</span>
              </div>
              <div title="Cost of the cached input at the full input price, minus what cache reads cost, this week">
                <strong>{formatUsdShort(week.saved)}</strong>
                <span>saved this week</span>
              </div>
              <div title="Share of cost spent writing the cache. High values mean the cache often expired between turns.">
                <strong>{formatPercent(week.writeCostShare * 100)}</strong>
                <span>of cost on cache writes</span>
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
                title={d.readShare === undefined ? `${formatDay(d.day)}: no usage` : `${formatDay(d.day)}: ${formatPercent(d.readShare * 100)} of input from cache`}
              />
            ))}
          </div>
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
          </ul>
          <p className="note">Daily cache-read share, last 14 days. Drops usually mean long pauses (the 5-minute cache expired) or resumed conversations.</p>
        </>
      )}
    </section>
  );
}
