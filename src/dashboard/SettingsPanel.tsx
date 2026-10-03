import type { FormEvent } from 'react';

import { CircleAlert, CircleCheck, CircleX } from 'lucide-react';
import { useState } from 'react';

import type { Plan, PlanPeriod } from '@/core/types';
import type { ManualReading, Summary } from '@/dashboard/api';

import { PLAN_LABELS, PLANS } from '@/core/plans';
import { endpointResultText } from '@/dashboard/endpoint';
import { formatDateTime, formatRelative } from '@/dashboard/format';

interface Props {
  busy: boolean;
  summary: Summary;
  onAddReading: (reading: ManualReading) => Promise<void>;
  onSaveSettings: (settings: { endpointEnabled?: boolean; planHistory?: readonly PlanPeriod[] }) => Promise<void>;
}

/** `datetime-local` value for an instant, in local time. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function periodStart(from: string): string {
  return Date.parse(from) === 0 ? 'from the start' : `from ${formatDateTime(from)}`;
}

function today(): string {
  return toLocalInput(new Date().toISOString()).slice(0, 10);
}

function EndpointStatus({ summary }: { summary: Summary }) {
  const result = summary.status.endpointResult;
  if (!summary.endpointEnabled)
    return <span>Disabled</span>;
  if (!result)
    return <span>Not called yet</span>;
  const ok = result === 'ok';
  return (
    <span className={ok ? 'status-good' : 'status-bad'}>
      {ok ? <CircleCheck aria-hidden="true" className="icon-inline" size={16} /> : <CircleX aria-hidden="true" className="icon-inline" size={16} />}
      {endpointResultText(result)}
    </span>
  );
}

export function SettingsPanel({ busy, onAddReading, onSaveSettings, summary }: Props) {
  const [newPlan, setNewPlan] = useState<Plan>(summary.plan);
  const [planFrom, setPlanFrom] = useState(today);
  const [weekly, setWeekly] = useState('');
  const [fiveHour, setFiveHour] = useState('');
  // Empty until edited, so the default follows the latest reading across weekly resets.
  const [editedResetsAt, setEditedResetsAt] = useState('');
  const resetsAt = editedResetsAt || (summary.current ? toLocalInput(summary.current.resetsAt) : '');
  const { calibration, planHistory, status } = summary;

  const addPlanPeriod = (event: FormEvent) => {
    event.preventDefault();
    const added: PlanPeriod = { from: new Date(`${planFrom}T00:00`).toISOString(), plan: newPlan, source: 'manual' };
    // Without history, everything before the new period would take its plan; keep the plan assumed so far instead.
    const before: PlanPeriod[] = planHistory.length === 0 && newPlan !== summary.plan
      ? [{ from: new Date(0).toISOString(), plan: summary.plan, source: 'manual' }]
      : [];
    void onSaveSettings({ planHistory: [...before, ...planHistory, added] });
  };

  const submitReading = (event: FormEvent) => {
    event.preventDefault();
    void onAddReading({
      fiveHour: fiveHour === '' ? undefined : Number(fiveHour),
      weekly: Number(weekly),
      weeklyResetsAt: new Date(resetsAt).toISOString(),
    }).then(() => {
      setWeekly('');
      setFiveHour('');
      setEditedResetsAt('');
    });
  };

  return (
    <section className="card">
      <h2>Settings &amp; data</h2>

      <div className="settings-grid">
        <div>
          <h3>Plan</h3>
          <p>
            {'Current plan: '}
            <strong>{PLAN_LABELS[summary.plan]}</strong>
          </p>
          {summary.detectedPlan && (
            <p className="status-bad">
              <CircleAlert aria-hidden="true" className="icon-inline" size={16} />
              {`Claude Code reports ${PLAN_LABELS[summary.detectedPlan]}, but your setting says ${PLAN_LABELS[summary.plan]}. `}
              <button
                disabled={busy}
                onClick={() => void onSaveSettings({ planHistory: [...planHistory, { from: new Date().toISOString(), plan: summary.detectedPlan!, source: 'manual' }] })}
                type="button"
              >
                {`Switch to ${PLAN_LABELS[summary.detectedPlan]}`}
              </button>
            </p>
          )}
          {planHistory.length > 0 && (
            <>
              <p className="note">Each reading is judged against the plan active when it was taken.</p>
              <ul className="plain-list">
                {planHistory.map((period, index) => (
                  <li key={period.from}>
                    {`${PLAN_LABELS[period.plan]} ${periodStart(period.from)} (${period.source})`}
                    {' '}
                    <button
                      aria-label={`Remove ${PLAN_LABELS[period.plan]} ${periodStart(period.from)}`}
                      disabled={busy}
                      onClick={() => void onSaveSettings({ planHistory: planHistory.filter((_, i) => i !== index) })}
                      type="button"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <form className="inline-form" onSubmit={addPlanPeriod}>
            <label>
              Plan
              <select onChange={e => setNewPlan(e.target.value as Plan)} value={newPlan}>
                {PLANS.map(p => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
              </select>
            </label>
            <label>
              From
              <input onChange={e => setPlanFrom(e.target.value)} required type="date" value={planFrom} />
            </label>
            <button disabled={busy} type="submit">Set plan</button>
          </form>
        </div>

        <div>
          <h3>Manual reading</h3>
          <p className="note">
            Optional. Copy the numbers from
            {' '}
            <code>/usage</code>
            {' '}
            in Claude Code; they are used like endpoint readings.
          </p>
          <form className="inline-form" onSubmit={submitReading}>
            <label>
              Weekly %
              <input max="100" min="0" onChange={e => setWeekly(e.target.value)} required step="1" type="number" value={weekly} />
            </label>
            <label>
              5-hour %
              <input max="100" min="0" onChange={e => setFiveHour(e.target.value)} step="1" type="number" value={fiveHour} />
            </label>
            <label>
              Weekly reset
              <input onChange={e => setEditedResetsAt(e.target.value)} required type="datetime-local" value={resetsAt} />
            </label>
            <button disabled={busy} type="submit">Add reading</button>
          </form>
        </div>

        <div>
          <h3>Collection</h3>
          <dl className="facts">
            <dt>Usage endpoint</dt>
            <dd>
              <EndpointStatus summary={summary} />
            </dd>
            <dt>Last run</dt>
            <dd>{status.lastRunAt ? formatRelative(status.lastRunAt) : 'never'}</dd>
            <dt>Messages imported</dt>
            <dd>{status.messages ?? 0}</dd>
            {(status.malformedLines ?? 0) > 0 && (
              <>
                <dt>Malformed lines</dt>
                <dd>{status.malformedLines}</dd>
              </>
            )}
          </dl>
          {status.lastError && (
            <p className="status-bad">
              <CircleX aria-hidden="true" className="icon-inline" size={16} />
              {`Last run failed: ${status.lastError}`}
            </p>
          )}
          <label className="checkbox">
            <input
              checked={summary.endpointEnabled}
              disabled={busy}
              onChange={e => void onSaveSettings({ endpointEnabled: e.target.checked })}
              type="checkbox"
            />
            Read limits from the undocumented usage endpoint
          </label>
        </div>

        <div>
          <h3>Calibration</h3>
          {calibration
            ? (
                <dl className="facts">
                  <dt>% per $1</dt>
                  <dd>{calibration.k.toFixed(2)}</dd>
                  <dt>$ per 1 %</dt>
                  <dd>{(1 / calibration.k).toFixed(2)}</dd>
                  <dt>Readings</dt>
                  <dd>{calibration.n}</dd>
                  <dt>Typical error</dt>
                  <dd>{`±${calibration.rmse.toFixed(1)} pts`}</dd>
                </dl>
              )
            : <p className="note">Needs at least 3 readings of 5% or more on the current plan.</p>}
          {calibration && (
            <p className="note">
              Fitted on your readings of 5% or more on the current plan: % per $1 is how much of the weekly limit $1 of API-equivalent usage consumes.
              Typical error is the usual gap between the fit and the readings; large values mean the projection is rough.
            </p>
          )}
          {summary.unknownModels.length > 0 && (
            <p className="status-bad">
              <CircleAlert aria-hidden="true" className="icon-inline" size={16} />
              {`No price for ${summary.unknownModels.join(', ')}: counted as $0.`}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
