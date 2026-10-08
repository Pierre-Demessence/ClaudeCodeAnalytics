import type { Family } from '@/core/family';
import type { ModelRatio } from '@/core/modelRatio';

import { SERIES } from '@/dashboard/models';
import { Swatch } from '@/dashboard/Patterns';
import { InfoTip } from '@/dashboard/Tip';

const seriesOf = (family: Family) => SERIES.find(s => s.family === family)!;

const hours = (value: number) => value.toFixed(1);
/** A factor such as 2.0 or 0.85: two decimals below 1, where one would hide most of the change. */
const factor = (value: number) => `× ${value.toFixed(value < 1 ? 2 : 1)}`;

function FamilyName({ family }: { family: Family }) {
  const series = seriesOf(family);
  return (
    <span className="ratio-family">
      <Swatch series={series} />
      <span>{series.label}</span>
    </span>
  );
}

/** How many hours of each lighter model equal an hour of the heaviest one, as a single line. */
export function ModelRatioLine({ ratios }: { ratios: readonly ModelRatio[] }) {
  const heaviest = ratios[0]?.from;
  const chain = ratios.filter(r => r.from === heaviest).sort((a, b) => a.hours - b.hours);
  if (heaviest === undefined || chain.length === 0)
    return null;
  const rough = chain.some(r => r.lowConfidence);
  return (
    <p className="model-ratio">
      <span className="model-ratio-lead">In your usage</span>
      <span className="ratio-term">
        <span>{`1 h of ${seriesOf(heaviest).label}`}</span>
        <Swatch series={seriesOf(heaviest)} />
      </span>
      {chain.map(r => (
        <span className="ratio-term" key={r.to}>
          <span>{`≈ ${hours(r.hours)} h of ${seriesOf(r.to).label}`}</span>
          <Swatch series={seriesOf(r.to)} />
        </span>
      ))}
      {rough && <span className="secondary">(rough)</span>}
      <InfoTip label="About these ratios">
        {rough
          ? 'This ratio is rough: the models were used on few of the same days, so the work each one did differs more. The Breakdown tab has the details.'
          : 'How long the limit lasts on each model compared with the heaviest one, in your usage of the last 4 weeks. The Breakdown tab has the ranges and the split by price and tokens.'}
      </InfoTip>
      <a href="#/breakdown">Details</a>
    </p>
  );
}

/** Every measured pair: the hours, their range, and why: price per token times tokens per active hour. */
export function ModelRatiosCard({ ratios }: { ratios: readonly ModelRatio[] }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Model ratios</h2>
        <span className="card-subtitle">last 4 weeks, active use</span>
      </div>
      <p className="note">
        In your usage, an hour on a heavier model uses as much of the limit as a longer time on a lighter one. You may give the heavier model harder work, so this is how each drains your limit the way you use it, not what the same job costs on each.
      </p>
      {ratios.length === 0
        ? <p className="note">Needs two models with at least 2 hours of active use each, on at least 2 days.</p>
        : (
            <>
              <div className="table-scroll">
                <table className="table ratio-table">
                  <thead>
                    <tr>
                      <th scope="col">1 h of</th>
                      <th scope="col">Equals the same limit on</th>
                      <th scope="col">Hours</th>
                      <th scope="col">Price per token</th>
                      <th scope="col">Tokens per hour</th>
                      <th scope="col">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ratios.map(r => (
                      <tr key={`${r.from}-${r.to}`}>
                        <td><FamilyName family={r.from} /></td>
                        <td><FamilyName family={r.to} /></td>
                        <td>
                          <strong>{`${r.lowConfidence ? '≈ ' : ''}${hours(r.hours)} h`}</strong>
                          <span className="visually-hidden"> range </span>
                          <span className="secondary">{` ${hours(r.low)}–${hours(r.high)}`}</span>
                          {r.lowConfidence && (
                            <InfoTip label="About this rough ratio">
                              The two models were used on few of the same days, so every day is compared and the work each one did differs more.
                            </InfoTip>
                          )}
                        </td>
                        <td>{factor(r.price)}</td>
                        <td>{factor(r.volume)}</td>
                        <td className="secondary">{r.days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">Hours = price per token × tokens per hour. The range is the 10th to 90th percentile over resampled days.</p>
            </>
          )}
    </section>
  );
}
