import type { FormEvent } from 'react';

import { ChevronRight, CircleAlert, KeyRound } from 'lucide-react';
import { useState } from 'react';

import type { Plan } from '@/core/types';
import type { SettingsUpdate, Summary } from '@/dashboard/api';

import { PLAN_LABELS, PLANS } from '@/core/plans';
import { ConfirmDialog } from '@/dashboard/ConfirmDialog';
import { withPeriod } from '@/dashboard/planPeriods';
import { InfoTip } from '@/dashboard/Tip';

interface Props {
  busy: boolean;
  summary: Summary;
  /** Resolves to whether the settings were saved. */
  onSaveSettings: (settings: SettingsUpdate) => Promise<boolean>;
}

const DETECTED = 'detected';

/** Edits made since the last save; an absent field follows the saved value. */
interface Draft {
  endpointEnabled?: boolean;
  limitThreshold?: string;
  /** `DETECTED` or a plan. */
  plan?: string;
  throttleMinutes?: string;
  weekLimitThreshold?: string;
}

type NumberField = 'limitThreshold' | 'throttleMinutes' | 'weekLimitThreshold';

/** The server's bounds, checked here so a wrong value is explained next to its field. */
const BOUNDS: Record<NumberField, { max: number; message: string; min: number }> = {
  limitThreshold: { max: 100, message: 'A whole number from 50 to 100', min: 50 },
  throttleMinutes: { max: 1440, message: 'A whole number of minutes from 15 to 1440', min: 15 },
  weekLimitThreshold: { max: 100, message: 'A whole number from 50 to 100', min: 50 },
};

function invalid(field: NumberField, value: string): string | undefined {
  const { max, message, min } = BOUNDS[field];
  const number = Number(value);
  return value.trim() === '' || !Number.isInteger(number) || number < min || number > max ? message : undefined;
}

/** Every setting is a draft until Save sends the changed ones together; Discard drops them. */
export function SettingsCard({ busy, onSaveSettings, summary }: Props) {
  const [draft, setDraft] = useState<Draft>({});
  // Errors show once Save was tried, then follow the edits.
  const [tried, setTried] = useState(false);
  const [failed, setFailed] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // An update that turns the endpoint on, held until its token use is confirmed.
  const [confirming, setConfirming] = useState<SettingsUpdate>();
  const { detected, detectedPlan, plan, planHistory, planSource } = summary;
  const saved = {
    endpointEnabled: summary.endpointEnabled,
    limitThreshold: String(summary.limitThreshold),
    plan: planSource === 'detected' && detected ? DETECTED : plan,
    throttleMinutes: String(summary.throttleMinutes),
    weekLimitThreshold: String(summary.weekLimitThreshold),
  };
  const current = { ...saved, ...draft };
  const changed = (key: keyof Draft) => current[key] !== saved[key];
  const dirty = (Object.keys(saved) as (keyof Draft)[]).some(changed);
  const edit = (change: Draft) => {
    setDraft(d => ({ ...d, ...change }));
    setFailed(false);
  };
  const reset = () => {
    setDraft({});
    setTried(false);
    setFailed(false);
  };

  // The interval is hidden and left unsent while the endpoint is off, so it is not checked then.
  const errors = {
    limitThreshold: invalid('limitThreshold', current.limitThreshold),
    throttleMinutes: current.endpointEnabled ? invalid('throttleMinutes', current.throttleMinutes) : undefined,
    weekLimitThreshold: invalid('weekLimitThreshold', current.weekLimitThreshold),
  };
  const shown = (field: NumberField) => (tried ? errors[field] : undefined);

  // A failed save keeps the edits so they can be retried.
  const send = (update: SettingsUpdate) => {
    void onSaveSettings(update).then((ok) => {
      if (ok)
        reset();
      else
        setFailed(true);
    });
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (errors.limitThreshold || errors.weekLimitThreshold)
      setAdvancedOpen(true);
    if (Object.values(errors).some(Boolean))
      return;
    const update: SettingsUpdate = {};
    if (changed('plan')) {
      const from = new Date().toISOString();
      const added = current.plan === DETECTED
        ? { from, plan: detected!, source: 'detected' as const }
        : { from, plan: current.plan as Plan, source: 'manual' as const };
      update.planHistory = withPeriod(planHistory, plan, added);
    }
    if (changed('endpointEnabled'))
      update.endpointEnabled = current.endpointEnabled;
    if (changed('throttleMinutes') && current.endpointEnabled)
      update.throttleMinutes = Number(current.throttleMinutes);
    if (changed('limitThreshold'))
      update.limitThreshold = Number(current.limitThreshold);
    if (changed('weekLimitThreshold'))
      update.weekLimitThreshold = Number(current.weekLimitThreshold);
    if (update.endpointEnabled)
      setConfirming(update);
    else
      send(update);
  };

  const numberInput = (field: NumberField, id: string, unit: string) => (
    <span className="input-unit">
      <input
        aria-describedby={shown(field) ? `${id}-error` : undefined}
        aria-invalid={shown(field) ? true : undefined}
        disabled={busy}
        id={id}
        inputMode="numeric"
        max={BOUNDS[field].max}
        min={BOUNDS[field].min}
        onChange={e => edit({ [field]: e.target.value })}
        step="1"
        type="number"
        value={current[field]}
      />
      <span aria-hidden="true">{unit}</span>
    </span>
  );
  const fieldError = (field: NumberField, id: string) => shown(field) && (
    <p className="field-error" id={`${id}-error`}>{shown(field)}</p>
  );

  return (
    <section className="card cal-card">
      <h2>Settings</h2>
      <form className="settings-form" noValidate onSubmit={save}>
        <div className="settings-group">
          <div className="setting-row">
            <span className="setting-label">
              <label htmlFor="plan-select">Plan</label>
              <InfoTip label="About the plan">&quot;Detected&quot; follows Claude Code&apos;s login; another choice applies from when you save it.</InfoTip>
            </span>
            <select disabled={busy} id="plan-select" onChange={e => edit({ plan: e.target.value })} value={current.plan}>
              {detected && <option value={DETECTED}>{`Detected: ${PLAN_LABELS[detected]}`}</option>}
              {PLANS.map(p => <option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
            </select>
          </div>
          {detectedPlan && current.plan === saved.plan && (
            <p className="callout">
              <CircleAlert aria-hidden="true" className="icon-inline icon-warning" size={16} />
              <span>{`Claude Code reports ${PLAN_LABELS[detectedPlan]}, but your setting says ${PLAN_LABELS[plan]}.`}</span>
              <button disabled={busy} onClick={() => edit({ plan: detectedPlan })} type="button">
                {`Switch to ${PLAN_LABELS[detectedPlan]}`}
              </button>
            </p>
          )}
        </div>
        <div className="settings-group">
          <div className="setting-row">
            <span className="setting-label">
              <label htmlFor="endpoint-switch">Usage endpoint</label>
              <InfoTip label="About the usage endpoint">Reads your actual limits from Claude Code&apos;s undocumented usage endpoint, which also detects your plan. It uses your Claude Code login token.</InfoTip>
            </span>
            <input
              checked={current.endpointEnabled}
              className="switch"
              disabled={busy}
              id="endpoint-switch"
              onChange={e => edit({ endpointEnabled: e.target.checked })}
              role="switch"
              type="checkbox"
            />
          </div>
          {current.endpointEnabled && (
            <>
              <div className="setting-row">
                <span className="setting-label">
                  <label htmlFor="throttle-input">Check every</label>
                  <InfoTip label="About the check interval">15 minutes at least: the endpoint shares Claude Code&apos;s own rate limit.</InfoTip>
                </span>
                {numberInput('throttleMinutes', 'throttle-input', 'min')}
              </div>
              {fieldError('throttleMinutes', 'throttle-input')}
            </>
          )}
        </div>
        <details className="settings-group settings-advanced" onToggle={e => setAdvancedOpen(e.currentTarget.open)} open={advancedOpen}>
          <summary>
            <ChevronRight aria-hidden="true" className="settings-chevron" size={16} />
            Advanced
          </summary>
          <div className="settings-advanced-body">
            <p className="setting-caption">
              Counts as a limit hit from
              <InfoTip label="About the limit hit thresholds">A past window counts as having hit its limit when a reading reached this %: close to 100%, a new agent run stops almost at once and the week is as good as spent.</InfoTip>
            </p>
            <div className="setting-row">
              <label className="setting-label" htmlFor="threshold-input">5-hour window</label>
              {numberInput('limitThreshold', 'threshold-input', '%')}
            </div>
            {fieldError('limitThreshold', 'threshold-input')}
            <div className="setting-row">
              <label className="setting-label" htmlFor="week-threshold-input">Week</label>
              {numberInput('weekLimitThreshold', 'week-threshold-input', '%')}
            </div>
            {fieldError('weekLimitThreshold', 'week-threshold-input')}
          </div>
        </details>
        {dirty && (
          <div className="settings-actions">
            <span className={failed ? 'field-error' : 'helper'} role={failed ? 'alert' : undefined}>
              {failed ? 'Not saved: your changes are kept.' : 'Unsaved changes'}
            </span>
            <button disabled={busy} onClick={reset} type="button">Discard</button>
            <button className="primary" disabled={busy} type="submit">Save</button>
          </div>
        )}
      </form>
      <ConfirmDialog
        confirmLabel="Turn on and save"
        icon={<KeyRound aria-hidden="true" size={20} />}
        onCancel={() => setConfirming(undefined)}
        onConfirm={() => {
          send(confirming!);
          setConfirming(undefined);
        }}
        open={confirming !== undefined}
        title="Turn on the usage endpoint?"
      >
        <p>
          The dashboard will read your actual limits from Claude Code&apos;s undocumented usage endpoint, using your Claude Code login token (
          <code>~/.claude/.credentials.json</code>
          ).
        </p>
        <ul>
          <li>Held in memory only, never logged or stored</li>
          <li>Sent only to api.anthropic.com</li>
          <li>Never refreshed or changed</li>
        </ul>
        <p className="helper">You can turn it off again at any time.</p>
      </ConfirmDialog>
    </section>
  );
}
