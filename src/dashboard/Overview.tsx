import type { ReactNode } from 'react';

import { TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';

import type { FamilyActiveLeft } from '@/core/activePace';
import type { Family } from '@/core/family';
import type { WindowForecast } from '@/core/forecast';
import type { Summary } from '@/dashboard/api';

import { FIVE_HOURS_MS } from '@/core/calibration';
import { endpointResultText } from '@/dashboard/endpoint';
import { FamilyHours } from '@/dashboard/FamilyHours';
import { formatCountdown, formatDateTime, formatDuration, formatPercent, formatRelative } from '@/dashboard/format';
import { Meter } from '@/dashboard/Meter';
import { PacingChart } from '@/dashboard/PacingChart';
import { InfoTip } from '@/dashboard/Tip';
import { useNow } from '@/dashboard/useNow';
import { useTip } from '@/dashboard/useTip';
import { limitVerdict } from '@/dashboard/verdict';
import { VerdictBox } from '@/dashboard/VerdictBox';

/** Readings older than this get a warning icon by the number. */
const STALE_WARNING_MS = 6 * 3_600_000;

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
  /** Active use left if only one model family were used. */
  activeLeftByFamily?: readonly FamilyActiveLeft[];
  /** Active use (ms) left before the limit, shown next to the number. */
  activeLeftMs?: number;
  /** Family of the latest message. */
  currentFamily?: Family;
  /** Number dimmed with a warning icon explaining why it is an estimate. */
  estimated: boolean;
  forecast?: WindowForecast;
  /** ISO time or ms. */
  now: number;
  resetsAt: number | string;
  roomPerDay?: number;
  title: string;
  used: number;
  warning?: ReactNode;
  window: 'fiveHour' | 'week';
}

function LimitCard({ activeLeftByFamily, activeLeftMs, currentFamily, estimated, forecast, now, resetsAt, roomPerDay, title, used, warning, window }: LimitCardProps) {
  const tip = useTip();
  const verdict = limitVerdict({ forecast, now, resetsAt, roomPerDay, used, window });
  return (
    <section className={`card limit-card card-${verdict.kind}`}>
      <div className="limit-head">
        <h2>{title}</h2>
        <span className="limit-resets" {...tip(`Resets ${formatDateTime(resetsAt)}`)}>{`resets ${formatCountdown(resetsAt, now)}`}</span>
      </div>
      <div className="limit-number-row">
        <span className={warning ? 'limit-number dim' : 'limit-number'}>
          {`${estimated ? '≈ ' : ''}${formatPercent(used)}`}
        </span>
        {estimated && <InfoTip label="About this estimate">Last reading plus the usage seen in transcripts since.</InfoTip>}
        {warning && <EstimateWarning>{warning}</EstimateWarning>}
        {activeLeftMs !== undefined && <span className="limit-active">{`≈ ${formatDuration(activeLeftMs)} of active use left`}</span>}
      </div>
      {activeLeftByFamily && <FamilyHours current={currentFamily} items={activeLeftByFamily} />}
      <Meter estimated={estimated} forecast={forecast} used={used} />
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
  const fiveHour = summary.fiveHourSession;
  // A manual reading has no reset time: it counts for 5 hours from when it was taken.
  const fiveHourResetsAt = fiveHour && (fiveHour.resetsAt ? Date.parse(fiveHour.resetsAt) : Date.parse(fiveHour.readAt) + FIVE_HOURS_MS);

  return (
    <>
      <div className="overview-limits">
        {current
          ? (
              <LimitCard
                activeLeftByFamily={current.activeLeftByFamily}
                activeLeftMs={current.activeLeftMs}
                currentFamily={summary.currentFamily}
                estimated={current.estimatedNow !== undefined}
                forecast={current.forecast}
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
                activeLeftByFamily={fiveHour.activeLeftByFamily}
                activeLeftMs={fiveHour.activeLeftMs}
                currentFamily={summary.currentFamily}
                estimated={fiveHour.estimatedNow !== undefined}
                forecast={fiveHour.forecast}
                now={now}
                resetsAt={fiveHourResetsAt!}
                title="5-hour session"
                used={fiveHour.estimatedNow ?? fiveHour.percent}
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
    </>
  );
}
