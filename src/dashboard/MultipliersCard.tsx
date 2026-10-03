import { Info } from 'lucide-react';

import type { MultiplierCheck } from '@/core/multipliers';

import { MIN_DRIFT_WEEKS } from '@/core/limits';
import { PLAN_LABELS, PLAN_MULTIPLIERS } from '@/core/plans';
import { useTip } from '@/dashboard/useTip';

/** Smallest scale of the ratio tracks, in ×. */
const MIN_SCALE = 6;

const percentOf = (value: number, scale: number) => `${Math.min(value, scale) / scale * 100}%`;
const times = (value: number) => `${value.toFixed(1)}×`;

function Row({ check, scale }: { check: MultiplierCheck; scale: number }) {
  const tip = useTip();
  const { advertised, from, measured, to } = check;
  const range = measured && `${times(measured.low)}–${times(measured.high)}`;
  return (
    <>
      <span>{`${PLAN_LABELS[from]} → ${PLAN_LABELS[to]}`}</span>
      <div
        className="mult-track"
        {...tip(measured
          ? `Scale 0× to ${scale}×. Dashed line: advertised ${advertised}×. Dot: measured ${times(measured.value)}, bracket: likely range ${range}.`
          : `Scale 0× to ${scale}×. Dashed line: advertised ${advertised}×.`)}
      >
        {measured && <span className="mult-range" style={{ left: percentOf(measured.low, scale), width: `calc(${percentOf(measured.high, scale)} - ${percentOf(measured.low, scale)})` }} />}
        <span className="mult-advertised" style={{ left: percentOf(advertised, scale) }} />
        {measured && <span className="mult-measured" style={{ left: percentOf(measured.value, scale) }} />}
      </div>
      {measured
        ? (
            <span className="mult-text">
              <strong>{`measured ${times(measured.value)}`}</strong>
              {` (${range})`}
              <small>{`advertised ${advertised}×; ${measured.fromWeeks} weeks on ${PLAN_LABELS[from]}, ${measured.toWeeks} on ${PLAN_LABELS[to]}`}</small>
            </span>
          )
        : (
            <span className="mult-text">
              <Info aria-hidden="true" className="icon-inline icon-info" size={16} />
              <strong>not measured</strong>
              <small>{`needs ${MIN_DRIFT_WEEKS} completed weeks on each plan; the advertised ${advertised}× is used`}</small>
            </span>
          )}
    </>
  );
}

/** How far the advertised plan multipliers, which every conversion on this tab uses, match your own weeks. */
export function MultipliersCard({ multipliers }: { multipliers: readonly MultiplierCheck[] }) {
  const scale = Math.max(MIN_SCALE, Math.ceil(Math.max(...multipliers.flatMap(m => [m.advertised, m.measured?.high ?? 0]))));
  return (
    <section className="card">
      <div className="card-head">
        <h2>How far to trust the conversions</h2>
        <span className="card-subtitle">{`Anthropic advertises ${PLAN_MULTIPLIERS.max5}× and ${PLAN_MULTIPLIERS.max20}× Pro's usage; your own readings show what you actually got.`}</span>
      </div>
      <div className="mult-grid">
        {multipliers.map(check => <Row check={check} key={check.from} scale={scale} />)}
      </div>
      <ul className="legend">
        <li>
          <span className="legend-typical" />
          advertised ratio
        </li>
        <li>
          <span className="mult-dot" />
          measured ratio
        </li>
        <li>
          <span className="mult-bracket" />
          likely range
        </li>
      </ul>
      <p className="note">
        Weeks use your total weekly %, claude.ai chat included. A converted week is the same absolute usage divided by the other plan's limit. Measured: the weekly % per $100 of Claude Code usage on the smaller plan divided by the bigger one's, from completed weeks. Approximate.
      </p>
    </section>
  );
}
