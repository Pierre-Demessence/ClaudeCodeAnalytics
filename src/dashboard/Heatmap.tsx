import type { Activity } from '@/core/activity';

import { formatUsd } from '@/dashboard/format';
import { heatStep } from '@/dashboard/usageData';
import { useTip } from '@/dashboard/useTip';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 86_400_000;

const hour = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

/** Average cost per weekday and hour, in one hue so it reads without color vision. */
export function Heatmap({ heatmap }: { heatmap: Activity['heatmap'] }) {
  const { cells, from, to } = heatmap;
  const tip = useTip();
  let max = 0;
  let busiest: [number, number] | undefined;
  cells.forEach((row, day) => row.forEach((value, h) => {
    if (value > max) {
      max = value;
      busiest = [day, h];
    }
  }));
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  const busiestText = busiest && `${WEEKDAYS[busiest[0]]} ${hour(busiest[1])}–${hour(busiest[1] + 1)}`;

  return (
    <section className="card">
      <div className="card-head">
        <h2>When you work</h2>
        <span className="card-subtitle">{`average cost per weekday and hour, ${days >= 28 ? 'last 4 weeks' : `last ${days} days`}`}</span>
        <span className="card-head-spacer" />
        {busiestText && (
          <span className="heatmap-busiest">
            {'Busiest: '}
            <strong>{busiestText}</strong>
          </span>
        )}
      </div>
      {!busiest
        ? <p className="empty">No usage in the last 4 weeks.</p>
        : (
            <>
              <div className="heatmap" role="img" aria-label={`Average cost per weekday and hour; busiest ${busiestText}`}>
                {cells.map((row, day) => (
                  <div className="heatmap-row" key={WEEKDAYS[day]}>
                    <span className="heatmap-day">{WEEKDAYS[day]}</span>
                    <div className="heatmap-cells">
                      {row.map((value, h) => (
                        // eslint-disable-next-line react/no-array-index-key -- the hour is the cell's identity
                        <span className={`heat-cell heat-${heatStep(value, max)}`} key={h} {...tip(`${WEEKDAYS[day]} ${hour(h)} · ${formatUsd(value)} per day on average`, { focusable: false })} />
                      ))}
                    </div>
                  </div>
                ))}
                <div className="heatmap-row" aria-hidden="true">
                  <span />
                  <div className="heatmap-hours">
                    {[0, 3, 6, 9, 12, 15, 18, 21].map(h => <span key={h}>{String(h).padStart(2, '0')}</span>)}
                  </div>
                </div>
              </div>
              <div className="heatmap-scale">
                <span>less</span>
                {[1, 2, 3, 4, 5].map(step => <span aria-hidden="true" className={`heat-cell heat-${step}`} key={step} />)}
                <span>more</span>
              </div>
            </>
          )}
    </section>
  );
}
