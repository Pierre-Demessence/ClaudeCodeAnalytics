import type { FormEvent } from 'react';

import { CircleAlert } from 'lucide-react';
import { useState } from 'react';

import type { Plan } from '@/core/types';
import type { SettingsUpdate, Summary } from '@/dashboard/api';

import { PLAN_LABELS, PLANS } from '@/core/plans';
import { withPeriod } from '@/dashboard/planPeriods';
import { InfoTip } from '@/dashboard/Tip';

interface Props {
  busy: boolean;
  summary: Summary;
  onSaveSettings: (settings: SettingsUpdate) => Promise<void>;
}

const DETECTED = 'detected';

export function SettingsCard({ busy, onSaveSettings, summary }: Props) {
  // Undefined until edited (an emptied field stays empty), so the fields follow the saved values.
  const [editedThrottle, setEditedThrottle] = useState<string>();
  const [editedThreshold, setEditedThreshold] = useState<string>();
  const [editedWeekThreshold, setEditedWeekThreshold] = useState<string>();
  const throttle = editedThrottle ?? String(summary.throttleMinutes);
  const threshold = editedThreshold ?? String(summary.limitThreshold);
  const weekThreshold = editedWeekThreshold ?? String(summary.weekLimitThreshold);
  const { detected, detectedPlan, plan, planHistory, planSource } = summary;

  const choosePlan = (value: string) => {
    const from = new Date().toISOString();
    const added = value === DETECTED
      ? { from, plan: detected!, source: 'detected' as const }
      : { from, plan: value as Plan, source: 'manual' as const };
    void onSaveSettings({ planHistory: withPeriod(planHistory, plan, added) });
  };

  const saveThrottle = (event: FormEvent) => {
    event.preventDefault();
    void onSaveSettings({ throttleMinutes: Number(throttle) }).then(() => setEditedThrottle(undefined));
  };

  const saveThreshold = (event: FormEvent) => {
    event.preventDefault();
    void onSaveSettings({ limitThreshold: Number(threshold) }).then(() => setEditedThreshold(undefined));
  };

  const saveWeekThreshold = (event: FormEvent) => {
    event.preventDefault();
    void onSaveSettings({ weekLimitThreshold: Number(weekThreshold) }).then(() => setEditedWeekThreshold(undefined));
  };

  return (
    <section className="card cal-card">
      <h2>Settings</h2>
      <div className="field">
        <div className="field-label">
          <label htmlFor="plan-select">Plan</label>
          <InfoTip label="About the plan">&quot;Detected&quot; follows Claude Code&apos;s login; another choice applies from now.</InfoTip>
        </div>
        <select
          disabled={busy}
          id="plan-select"
          onChange={e => choosePlan(e.target.value)}
          value={planSource === 'detected' && detected ? DETECTED : plan}
        >
          {detected && <option value={DETECTED}>{`Detected: ${PLAN_LABELS[detected]}`}</option>}
          {PLANS.map(p => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
        </select>
      </div>
      {detectedPlan && (
        <p className="callout">
          <CircleAlert aria-hidden="true" className="icon-inline icon-warning" size={16} />
          <span>{`Claude Code reports ${PLAN_LABELS[detectedPlan]}, but your setting says ${PLAN_LABELS[plan]}.`}</span>
          <button
            disabled={busy}
            onClick={() => void onSaveSettings({ planHistory: [...planHistory, { from: new Date().toISOString(), plan: detectedPlan, source: 'manual' }] })}
            type="button"
          >
            {`Switch to ${PLAN_LABELS[detectedPlan]}`}
          </button>
        </p>
      )}
      <div className="cal-section">
        <label className="checkbox">
          <input
            checked={summary.endpointEnabled}
            disabled={busy}
            onChange={e => void onSaveSettings({ endpointEnabled: e.target.checked })}
            type="checkbox"
          />
          Read limits from the undocumented usage endpoint
        </label>
        <form className="inline-form" onSubmit={saveThrottle}>
          <div className="field">
            <div className="field-label">
              <label htmlFor="throttle-input">Minutes between endpoint calls</label>
              <InfoTip label="About minutes between endpoint calls">15 at least: the endpoint shares Claude Code&apos;s own rate limit.</InfoTip>
            </div>
            <input id="throttle-input" max="1440" min="15" onChange={e => setEditedThrottle(e.target.value)} required step="1" type="number" value={throttle} />
          </div>
          <button disabled={busy} type="submit">Save</button>
        </form>
      </div>
      <div className="cal-section">
        <form className="inline-form" onSubmit={saveThreshold}>
          <div className="field">
            <div className="field-label">
              <label htmlFor="threshold-input">5-hour limit hit from (%)</label>
              <InfoTip label="About the 5-hour limit threshold">A past 5-hour window counts as having hit the limit when a reading reached this %: close to 100%, a new agent run stops almost at once.</InfoTip>
            </div>
            <input id="threshold-input" max="100" min="50" onChange={e => setEditedThreshold(e.target.value)} required step="1" type="number" value={threshold} />
          </div>
          <button disabled={busy} type="submit">Save</button>
        </form>
        <form className="inline-form" onSubmit={saveWeekThreshold}>
          <div className="field">
            <div className="field-label">
              <label htmlFor="week-threshold-input">Weekly limit hit from (%)</label>
              <InfoTip label="About the weekly limit threshold">A past week counts as having hit the limit when its final reading reached this %: close to 100%, the week is as good as spent.</InfoTip>
            </div>
            <input id="week-threshold-input" max="100" min="50" onChange={e => setEditedWeekThreshold(e.target.value)} required step="1" type="number" value={weekThreshold} />
          </div>
          <button disabled={busy} type="submit">Save</button>
        </form>
      </div>
    </section>
  );
}
