import type { Activity } from '@/core/activity';

import { formatDateTime, formatUsd } from '@/dashboard/format';
import { causeText } from '@/dashboard/usageData';
import { useTip } from '@/dashboard/useTip';

const BIN_LABELS = ['<1¢', '1–3¢', '3–10¢', '10–30¢', '30¢–$1', '$1–3', '$3–10', '>$10'];

/** Bar height on a log scale, so single outliers stay visible next to thousands of cheap messages. */
const logHeight = (count: number, max: number) => (count > 0 ? Math.max(2, Math.log10(count + 1) / Math.log10(max + 1) * 100) : 0);

/** The range's (by default this week's) message costs and the most expensive messages. */
export function MessageCostCard({ messageCost, range }: { messageCost: Activity['messageCost']; range?: string }) {
  const { bins, outlierCount, outliers } = messageCost;
  const max = Math.max(...bins);
  const tip = useTip();
  const scope = range ? 'in this range' : 'this week';

  return (
    <section className="card">
      <div className="card-head">
        <h2>Cost per message</h2>
        <span className="card-subtitle">{`${range ?? 'this week'}, bar heights on a log scale`}</span>
      </div>
      {max === 0
        ? <p className="empty">{range ? 'No usage in this range.' : 'No usage this week yet.'}</p>
        : (
            <>
              <div className="cost-bins" role="img" aria-label={`Messages per cost range ${scope}: ${bins.map((n, i) => `${BIN_LABELS[i]} ${n}`).join(', ')}`}>
                {bins.map((count, i) => (
                  <div className="cost-bin" key={BIN_LABELS[i]} {...tip(`${count} messages costing ${BIN_LABELS[i]}`)}>
                    <span>{count}</span>
                    <span className="mini-bar" style={{ height: `${logHeight(count, max) * 0.85}%` }} />
                  </div>
                ))}
              </div>
              <div className="cost-bin-labels" aria-hidden="true">
                {BIN_LABELS.map(label => <span key={label}>{label}</span>)}
              </div>
              <h3>{`Outliers ${scope}`}</h3>
              {outliers.length === 0
                ? <p className="note">{`No message reached $1 ${scope}.`}</p>
                : (
                    <>
                      {outlierCount > outliers.length && <p className="note">{`The ${outliers.length} costliest of ${outlierCount} messages over $1.`}</p>}
                      <table className="outlier-table">
                        <tbody>
                          {outliers.map(o => (
                            <tr key={`${o.ts}|${o.path}|${o.cost}`}>
                              <td>{formatDateTime(o.ts)}</td>
                              <td {...tip(o.path)}>{o.name}</td>
                              <td className="secondary">{causeText(o)}</td>
                              <td><strong>{formatUsd(o.cost)}</strong></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
            </>
          )}
    </section>
  );
}
