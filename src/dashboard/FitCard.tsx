import { CircleAlert } from 'lucide-react';

import type { Summary } from '@/dashboard/api';

import { WEEK_MS } from '@/core/calibration';
import { InfoTip } from '@/dashboard/Tip';

const per100 = (k: number) => `${(k * 100).toFixed(1)}%`;

/** The fit that turns API-equivalent cost into a % of the limit. */
export function FitCard({ summary }: { summary: Summary }) {
  const { calibration, fiveHourCalibration, generatedAt, unknownModels } = summary;
  const weeks = calibration ? Math.ceil((Date.parse(generatedAt) - Date.parse(calibration.from)) / WEEK_MS) : 0;
  return (
    <section className="card cal-card cal-narrow">
      <h2>Calibration</h2>
      {calibration
        ? (
            <>
              <div className="fit-figure">
                <strong>{per100(calibration.k)}</strong>
                <span>of the weekly limit per $100 of API-equivalent usage</span>
              </div>
              <dl className="facts">
                <dt>
                  Typical error
                  <InfoTip label="About typical error">The usual gap between the fit and your readings, in points of the weekly limit. Large values mean the projections are rough.</InfoTip>
                </dt>
                <dd>{`±${calibration.rmse.toFixed(1)} pts`}</dd>
                <dt>Readings used</dt>
                <dd>{`${calibration.n}, last ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`}</dd>
                {fiveHourCalibration && (
                  <>
                    <dt>
                      5-hour fit
                      <InfoTip label="About the 5-hour fit">The same fit on the 5-hour limit, from readings of 5% or more. The endpoint gives no Claude Code share there, so claude.ai use counts as Claude Code.</InfoTip>
                    </dt>
                    <dd>{`${per100(fiveHourCalibration.k)} per $100, ±${fiveHourCalibration.rmse.toFixed(1)} pts`}</dd>
                  </>
                )}
              </dl>
              <p className="note">Fitted on your readings of 5% or more on the current plan, recent ones weighted more. A large typical error means the projections are rough.</p>
            </>
          )
        : <p className="note">Needs at least 3 readings of 5% or more on the current plan.</p>}
      {unknownModels.length > 0 && (
        <p className="status-bad">
          <CircleAlert aria-hidden="true" className="icon-inline" size={16} />
          {`No price for ${unknownModels.join(', ')}: counted as $0.`}
        </p>
      )}
    </section>
  );
}
