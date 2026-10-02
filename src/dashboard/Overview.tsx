import type { ReactNode } from 'react';

import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';

import type { WindowForecast } from '@/core/forecast';
import type { Summary } from '@/dashboard/api';
import type { VerdictKind } from '@/dashboard/verdict';

import { FIVE_HOURS_MS } from '@/core/calibration';
import { endpointResultText } from '@/dashboard/endpoint';
import { formatDateTime, formatPercent, formatRelative, formatResets } from '@/dashboard/format';
import { Meter } from '@/dashboard/Meter';
import { PacingChart } from '@/dashboard/PacingChart';
import { PastWeeks, PlanEquivalents } from '@/dashboard/PastWeeks';
import { useNow } from '@/dashboard/useNow';
import { limitVerdict } from '@/dashboard/verdict';

/** Readings older than this get a warning icon by the number. */
const STALE_WARNING_MS = 6 * 3_600_000;

const VERDICT_ICONS: Record<VerdictKind, ReactNode> = {
  cap: <TriangleAlert aria-hidden="true" className="icon-critical" size={18} />,
  good: <CircleCheck aria-hidden="true" className="icon-good" size={18} />,
  info: <Info aria-hidden="true" className="icon-info" size={18} />,
  tight: <CircleAlert aria-hidden="true" className="icon-warning" size={18} />,
};

function VerdictBox({ detail, kind, title }: { detail?: ReactNode; kind: VerdictKind; title: string }) {
  return (
    <p className={`verdict verdict-${kind}`}>
      {VERDICT_ICONS[kind]}
      <span>
        <strong>{title}</strong>
        {detail && (
          <>
            {' '}
            {detail}
          </>
        )}
      </span>
    </p>
  );
}

/** Warning icon by an estimated number; its explanation shows on hover, focus or click (touch), and closes on leave, blur or Escape. */
function EstimateWarning({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="estimate-warning">
      <button
        aria-controls={id}
        aria-expanded={open}
        aria-label="Why this number is an estimate"
        className="icon-button round"
        onBlur={() => setOpen(false)}
        // Click only opens: hover or focus already opened it, and a toggle would close it on that same click or tap.
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onKeyDown={e => e.key === 'Escape' && setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        type="button"
      >
        <TriangleAlert aria-hidden="true" className="icon-warning" size={18} />
      </button>
      {open && <span className="popover" id={id} role="status">{children}</span>}
    </span>
  );
}

interface LimitCardProps {
  /** Number dimmed with a warning icon explaining why it is an estimate. */
  estimated: boolean;
  forecast?: WindowForecast;
  /** ISO time or ms. */
  resetsAt: number | string;
  roomPerDay?: number;
  title: string;
  used: number;
  warning?: ReactNode;
  /** Tooltip of the meter. */
  meterTitle: string;
  now: number;
  window: 'fiveHour' | 'week';
}

function LimitCard({ estimated, forecast, meterTitle, now, resetsAt, roomPerDay, title, used, warning, window }: LimitCardProps) {
  const verdict = limitVerdict({ forecast, now, resetsAt, roomPerDay, used, window });
  return (
    <section className={`card limit-card card-${verdict.kind}`}>
      <div className="limit-head">
        <h2>{title}</h2>
        <span className="limit-resets" title={`Resets ${formatDateTime(resetsAt)}`}>{`resets ${formatResets(resetsAt, now)}`}</span>
      </div>
      <div className="limit-number-row">
        <span
          className={warning ? 'limit-number dim' : 'limit-number'}
          title={estimated ? 'Last reading plus the usage seen in transcripts since.' : 'Usage at the last reading, as shown by /usage.'}
        >
          {`${estimated ? '≈ ' : ''}${formatPercent(used)}`}
        </span>
        {warning && <EstimateWarning>{warning}</EstimateWarning>}
      </div>
      <Meter estimated={estimated} forecast={forecast} title={meterTitle} used={used} />
      <VerdictBox detail={verdict.detail} kind={verdict.kind} title={verdict.title} />
    </section>
  );
}

function EmptyCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="card limit-card">
      <div className="limit-head"><h2>{title}</h2></div>
      {children}
    </section>
  );
}

const CALIBRATION_LINK = <a href="#/calibration">Calibration</a>;

/** Why the weekly number is an estimate, when that matters: no reading this week, or a stale one. */
function weeklyWarning(summary: Summary, now: number): ReactNode {
  const current = summary.current!;
  const result = summary.status.endpointResult;
  const endpoint = summary.endpointEnabled && result && result !== 'ok' ? ` The usage endpoint fails (${endpointResultText(result)}).` : '';
  if (current.withoutReading) {
    if (current.estimatedNow === undefined)
      return undefined;
    return (
      <>
        <strong>No reading this week yet.</strong>
        {`${endpoint} This % is estimated from the usage seen in transcripts since the week started. See `}
        {CALIBRATION_LINK}
        .
      </>
    );
  }
  if (now - Date.parse(current.readAt) <= STALE_WARNING_MS)
    return undefined;
  return (
    <>
      <strong>{`Last reading ${formatRelative(current.readAt, now)}.`}</strong>
      {`${endpoint} ${current.estimatedNow === undefined
        ? 'Usage since then is not counted yet.'
        : 'This % is the last reading plus the usage seen in transcripts since, so it is an estimate.'} See `}
      {CALIBRATION_LINK}
      .
    </>
  );
}

export function Overview({ summary }: { summary: Summary }) {
  const now = useNow();
  const current = summary.current;
  const fiveHour = current?.fiveHour !== undefined ? current : undefined;
  // A manual reading has no reset time: it counts for 5 hours from when it was taken.
  const fiveHourResetsAt = fiveHour && (fiveHour.fiveHourResetsAt ?? Date.parse(fiveHour.readAt) + FIVE_HOURS_MS);

  return (
    <>
      <div className="overview-limits">
        {current
          ? (
              <LimitCard
                estimated={current.estimatedNow !== undefined}
                forecast={current.forecast}
                meterTitle="Weekly limit used so far, the projection at reset with its likely range, and the 100 % limit."
                now={now}
                resetsAt={current.resetsAt}
                roomPerDay={current.pacing.roomPerDay}
                title="Weekly limit"
                used={current.estimatedNow ?? current.weekly}
                warning={weeklyWarning(summary, now)}
                window="week"
              />
            )
          : (
              <EmptyCard title="Weekly limit">
                <VerdictBox
                  detail={(
                    <>
                      The first projection comes after a few readings: the collector takes one every 15 minutes once the hook is installed, or you can add one in
                      {' '}
                      {CALIBRATION_LINK}
                      .
                    </>
                  )}
                  kind="info"
                  title="Not enough history yet."
                />
              </EmptyCard>
            )}
        {fiveHour
          ? (
              <LimitCard
                estimated={fiveHour.fiveHourEstimatedNow !== undefined}
                forecast={fiveHour.fiveHourForecast}
                meterTitle="5-hour session limit used so far, the projection at reset with its likely range, and the 100 % limit."
                now={now}
                resetsAt={fiveHourResetsAt!}
                title="5-hour session"
                used={fiveHour.fiveHourEstimatedNow ?? fiveHour.fiveHour!}
                window="fiveHour"
              />
            )
          : (
              <EmptyCard title="5-hour session">
                <VerdictBox detail="A new 5-hour window starts with your next message." kind="info" title="No session in progress." />
              </EmptyCard>
            )}
      </div>
      {current && <PacingChart forecast={current.forecast} now={now} pacing={current.pacing} usedNow={current.estimatedNow ?? current.weekly} />}
      <div className="overview-bottom">
        <PastWeeks summary={summary} />
        <PlanEquivalents summary={summary} />
      </div>
    </>
  );
}
