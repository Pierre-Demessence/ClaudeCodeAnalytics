import type { FormEvent } from 'react';

import { useState } from 'react';

import type { Plan, PlanPeriod } from '@/core/types';
import type { SettingsUpdate, Summary } from '@/dashboard/api';

import { PLAN_LABELS, PLANS } from '@/core/plans';
import { formatDateTime, formatInteger } from '@/dashboard/format';
import { periodStart, toLocalInput, withPeriod } from '@/dashboard/planPeriods';

interface Props {
  busy: boolean;
  summary: Summary;
  onSaveSettings: (settings: SettingsUpdate) => Promise<void>;
}

const today = () => toLocalInput(new Date().toISOString()).slice(0, 10);

const fromText = (from: string) => (Date.parse(from) === 0 ? 'the start' : formatDateTime(from));

/** Every plan period, newest first: each reading is judged against the plan active when it was taken. */
export function PlanHistoryCard({ busy, onSaveSettings, summary }: Props) {
  const [newPlan, setNewPlan] = useState<Plan>(summary.plan);
  const [planFrom, setPlanFrom] = useState(today);
  const { generatedAt, limits, plan, planHistory } = summary;
  const currentIndex = planHistory.findLastIndex(period => Date.parse(period.from) <= Date.parse(generatedAt));

  const addPlanPeriod = (event: FormEvent) => {
    event.preventDefault();
    const added: PlanPeriod = { from: new Date(`${planFrom}T00:00`).toISOString(), plan: newPlan, source: 'manual' };
    void onSaveSettings({ planHistory: withPeriod(planHistory, plan, added) });
  };

  return (
    <section className="card cal-card">
      <div className="card-head">
        <h2>Plan history</h2>
        <span className="card-subtitle">each reading is judged against the plan active when it was taken</span>
      </div>
      <div className="table-scroll">
        <table className="table plan-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>From</th>
              <th>Until</th>
              <th>Source</th>
              <th>Readings</th>
              <th><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {planHistory.length === 0
              ? (
                  <tr>
                    <td>
                      <strong>{PLAN_LABELS[plan]}</strong>
                      {' '}
                      <span className="badge">current</span>
                    </td>
                    <td>the start</td>
                    <td>now</td>
                    <td>assumed</td>
                    <td>—</td>
                    <td />
                  </tr>
                )
              : planHistory.map((period, index) => (
                  <tr key={period.from}>
                    <td>
                      <strong>{PLAN_LABELS[period.plan]}</strong>
                      {index === currentIndex && (
                        <>
                          {' '}
                          <span className="badge">current</span>
                        </>
                      )}
                    </td>
                    <td>{fromText(period.from)}</td>
                    <td>{index === planHistory.length - 1 ? 'now' : fromText(planHistory[index + 1]!.from)}</td>
                    <td>{period.source}</td>
                    <td>{formatInteger(limits.readingsPerPeriod[index] ?? 0)}</td>
                    <td>
                      <button
                        aria-label={`Remove ${PLAN_LABELS[period.plan]} ${periodStart(period.from)}`}
                        disabled={busy}
                        onClick={() => void onSaveSettings({ planHistory: planHistory.filter((_, i) => i !== index) })}
                        type="button"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )).reverse()}
          </tbody>
        </table>
      </div>
      <form className="cal-form" onSubmit={addPlanPeriod}>
        <div>
          <h3>Add a plan period</h3>
          <span className="helper">For a plan change in the past; the Plan setting above changes it from now.</span>
        </div>
        <div className="inline-form">
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
        </div>
      </form>
    </section>
  );
}
