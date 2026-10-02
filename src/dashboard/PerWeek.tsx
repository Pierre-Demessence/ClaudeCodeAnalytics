import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { Summary } from '@/dashboard/api';

import { convertPercent, PLAN_LABELS, PLANS } from '@/core/plans';
import { formatDay, formatPercent } from '@/dashboard/format';

export function PerWeek({ summary }: { summary: Summary }) {
  const { plan, typical, weeks } = summary;
  const data = weeks.map(week => ({
    estimated: week.estimated,
    label: `${formatPercent(convertPercent(week.percent, week.plan, plan))}${week.estimated ? ' est.' : ''}`,
    percent: convertPercent(week.percent, week.plan, plan),
    week: `to ${formatDay(week.resetsAt)}`,
  }));

  return (
    <section className="card">
      <h2>Share of the plan per week</h2>
      {weeks.length === 0
        ? (
            <p className="empty">
              No completed week with readings yet. The first full week ends at the next reset; until then only the
              current week is shown above.
            </p>
          )
        : (
            <>
              <p className="note">
                {`Final weekly % of each window, on your current plan (${PLAN_LABELS[plan]}). Hatched bars marked "est." were extended from a reading taken more than 12 h before reset.`}
              </p>
              <div className="chart" role="img" aria-label="Weekly usage per window, in percent of the plan">
                <ResponsiveContainer height={240} width="100%">
                  <BarChart data={data} margin={{ bottom: 0, left: 0, right: 16, top: 20 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="week" stroke="var(--text-secondary)" tickLine={false} />
                    <YAxis domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]} stroke="var(--text-secondary)" tickFormatter={(v: number) => `${v}%`} tickLine={false} width={48} />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      cursor={{ fill: 'var(--hover)' }}
                      formatter={(value, _name, item) => [`${formatPercent(Number(value))}${(item.payload as { estimated: boolean }).estimated ? ' (estimated)' : ''}`, 'Weekly used']}
                    />
                    <ReferenceLine
                      label={{ fill: 'var(--text-secondary)', position: 'insideTopRight', value: 'cap' }}
                      stroke="var(--text-secondary)"
                      strokeDasharray="4 4"
                      y={100}
                    />
                    {typical && (
                      <ReferenceLine
                        label={{ fill: 'var(--text-secondary)', position: 'insideTopLeft', value: `typical ${formatPercent(typical.median)}` }}
                        stroke="var(--text-primary)"
                        strokeDasharray="2 3"
                        y={typical.median}
                      />
                    )}
                    <Bar dataKey="percent" isAnimationActive={false} maxBarSize={56} radius={[4, 4, 0, 0]}>
                      {data.map(entry => (
                        <Cell fill={entry.estimated ? 'url(#pattern-estimate)' : 'var(--accent)'} key={entry.week} />
                      ))}
                      <LabelList dataKey="label" fill="var(--text-primary)" position="top" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

      {typical && (
        <table className="table" title="The typical week converted to each plan with the advertised multipliers (Max 5× ≈ 5× Pro, Max 20× ≈ 20× Pro). Approximate.">
          <caption>
            {`Typical week (median of ${typical.weeks} week${typical.weeks > 1 ? 's' : ''}) on each plan — approximate`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">Typical week</th>
              <th scope="col">Range</th>
            </tr>
          </thead>
          <tbody>
            {PLANS.map(p => (
              <tr className={p === plan ? 'current-plan' : undefined} key={p}>
                <th scope="row">
                  {PLAN_LABELS[p]}
                  {p === plan && <small> (your plan)</small>}
                </th>
                <td>{formatPercent(typical.byPlan[p])}</td>
                <td>{`${formatPercent(convertPercent(typical.min, plan, p))}–${formatPercent(convertPercent(typical.max, plan, p))}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
