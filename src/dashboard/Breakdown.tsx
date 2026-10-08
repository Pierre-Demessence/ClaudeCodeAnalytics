import { useState } from 'react';

import type { BreakdownPeriod } from '@/core/summary';
import type { Summary } from '@/dashboard/api';
import type { Series } from '@/dashboard/models';

import { familyOf } from '@/core/family';
import { CardGrid, Cell } from '@/dashboard/CardGrid';
import { ContextCard } from '@/dashboard/ContextCard';
import { formatDateTime, formatDollars, formatDuration, formatPercent } from '@/dashboard/format';
import { ModelRatiosCard } from '@/dashboard/ModelRatios';
import { SERIES } from '@/dashboard/models';
import { OutputCard, SkillCard } from '@/dashboard/OutputCards';
import { Legend, Swatch } from '@/dashboard/Patterns';
import { InfoTip } from '@/dashboard/Tip';
import { Toggle } from '@/dashboard/Toggle';
import { useTip } from '@/dashboard/useTip';

const PERIODS: [BreakdownPeriod, string][] = [['week', 'This week'], ['fourWeeks', 'Last 4 weeks'], ['all', 'All time']];

const SURFACES: Record<string, string> = {
  'claude-desktop': 'Desktop',
  'claude-vscode': 'VS Code',
  'cli': 'Terminal',
  'sdk-py': 'Python SDK',
  'sdk-ts': 'TypeScript SDK',
};

const EFFORTS: Record<string, string> = { high: 'High', low: 'Low', max: 'Max', medium: 'Medium', xhigh: 'Extra high' };

const percentOf = (part: number, whole: number) => (whole > 0 ? part / whole * 100 : 0);

/** Cost per model family, in the families' fixed order. */
function familySplit(byModel: Record<string, number>): { cost: number; series: Series }[] {
  const costs = new Map<string, number>();
  for (const [model, cost] of Object.entries(byModel))
    costs.set(familyOf(model), (costs.get(familyOf(model)) ?? 0) + cost);
  return SERIES.filter(s => (costs.get(s.family) ?? 0) > 0).map(series => ({ cost: costs.get(series.family)!, series }));
}

/** A bar split by model family, each part filled with its family's pattern. */
function ModelBar({ byModel, width = 100 }: { byModel: Record<string, number>; width?: number }) {
  const tip = useTip();
  const parts = familySplit(byModel);
  const description = parts.map(p => `${p.series.label} ${formatDollars(p.cost)}`).join(', ');
  const details = (
    <ul>
      {parts.map(({ cost, series }) => (
        <li key={series.family}>
          <Swatch series={series} />
          {series.label}
          <span>{formatDollars(cost)}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <span className="model-bar" role="img" aria-label={description} style={{ width: `${width}%` }} {...tip(details)}>
      {parts.map(({ cost, series }) => (
        <svg aria-hidden="true" key={series.family} style={{ flexGrow: cost }}>
          <rect fill={`url(#${series.pattern})`} height="100%" width="100%" />
        </svg>
      ))}
    </span>
  );
}

/** Rows of label, bar and % of `total`. */
function ShareBars({ rows, total }: { rows: { cost: number; label: string; title?: string }[]; total: number }) {
  const tip = useTip();
  return (
    <ul className="share-bars">
      {rows.map(row => (
        <li key={row.label} {...tip(`${formatDollars(row.cost)}${row.title ? ` (${row.title})` : ''}`)}>
          <span>{row.label}</span>
          <span className="share-track"><span className="share-fill" style={{ width: `${percentOf(row.cost, total)}%` }} /></span>
          <strong>{formatPercent(percentOf(row.cost, total))}</strong>
        </li>
      ))}
    </ul>
  );
}

export function Breakdown({ summary }: { summary: Summary }) {
  const [period, setPeriod] = useState<BreakdownPeriod>('week');
  const breakdown = summary.breakdown[period];
  const { agents, conversations, effort, projects, subagentTypes, surfaces, total } = breakdown;
  const current = summary.current;
  const weeklyPercent = period === 'week' && current ? current.estimatedNow ?? current.weekly : undefined;
  const effortTotal = effort.reduce((sum, e) => sum + e.cost, 0);
  const largestProject = projects[0]?.cost ?? 0;
  const tip = useTip();
  const families = new Set(projects.flatMap(p => familySplit(p.byModel).map(part => part.series.family)));

  return (
    <>
      <div className="breakdown-controls">
        <Toggle label="Period" onChange={setPeriod} options={PERIODS} value={period} />
        <span className="breakdown-total">
          {'Total '}
          <strong>{formatDollars(total.cost)}</strong>
          {weeklyPercent !== undefined && ` · ${current?.estimatedNow !== undefined ? '≈ ' : ''}${formatPercent(weeklyPercent)} of the weekly limit`}
        </span>
      </div>

      {total.messages === 0
        ? <p className="empty">No usage in this period.</p>
        : (
            <>
              <CardGrid>
                <Cell span={6}>
                  <section className="card">
                    <h2>By project</h2>
                    <table className="project-table">
                      <thead>
                        <tr>
                          <th scope="col">Project</th>
                          <th scope="col">Cost by model</th>
                          <th scope="col">Cost</th>
                          <th scope="col">Share</th>
                          <th scope="col">Cache</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projects.map(project => (
                          <tr key={project.path}>
                            <th scope="row" {...tip(project.path)}>{project.name}</th>
                            <td className="project-bar"><ModelBar byModel={project.byModel} width={percentOf(project.cost, largestProject)} /></td>
                            <td><strong>{formatDollars(project.cost)}</strong></td>
                            <td>{formatPercent(percentOf(project.cost, total.cost))}</td>
                            <td className="secondary">{formatPercent(project.cacheShare * 100)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Legend series={SERIES.filter(s => families.has(s.family))} />
                  </section>
                </Cell>
                <Cell span={6}>
                  <SkillCard breakdown={breakdown} />
                </Cell>

                <Cell span={4}>
                  <section className="card">
                    <h2>Main agent vs subagents</h2>
                    <span className="agent-bar" role="img" aria-label={`Main agent ${formatPercent(percentOf(agents.main, total.cost))}, subagents ${formatPercent(percentOf(agents.subagents, total.cost))}`}>
                      <span className="agent-main" style={{ flexGrow: agents.main }} />
                      <span className="agent-sub" style={{ flexGrow: agents.subagents }} />
                    </span>
                    <p className="agent-labels">
                      <span>
                        <span className="legend-swatch agent-main" />
                        {'Main '}
                        <strong>{formatPercent(percentOf(agents.main, total.cost))}</strong>
                        {` · ${formatDollars(agents.main)}`}
                      </span>
                      <span>
                        <span className="legend-swatch agent-sub" />
                        {'Subagents '}
                        <strong>{formatPercent(percentOf(agents.subagents, total.cost))}</strong>
                        {` · ${formatDollars(agents.subagents)}`}
                      </span>
                    </p>
                    {subagentTypes.length > 0 && (
                      <>
                        <p className="note">Share of the subagents' cost, by type.</p>
                        <ShareBars rows={subagentTypes.map(s => ({ cost: s.cost, label: s.type ?? 'Unknown' }))} total={agents.subagents} />
                      </>
                    )}
                  </section>
                </Cell>

                <Cell span={4}>
                  <section className="card">
                    <h2>By effort level</h2>
                    <p className="note">Share of the main agent's cost; subagents record no effort.</p>
                    {effort.length === 0
                      ? <p className="note">No effort level recorded in this period.</p>
                      : <ShareBars rows={effort.map(e => ({ cost: e.cost, label: EFFORTS[e.level] ?? e.level }))} total={effortTotal} />}
                    <p className="note">
                      {'Thinking is '}
                      <strong>{formatPercent(breakdown.thinkingShare * 100)}</strong>
                      {' of output tokens, subagents included.'}
                    </p>
                  </section>
                </Cell>

                <Cell span={4}>
                  <section className="card">
                    <h2>By surface</h2>
                    <ShareBars
                      rows={surfaces.map(s => ({ cost: s.cost, label: s.entrypoint ? SURFACES[s.entrypoint] ?? s.entrypoint : 'Unknown', title: s.entrypoint }))}
                      total={total.cost}
                    />
                  </section>
                </Cell>

                <Cell span={6}>
                  <OutputCard output={breakdown.output} />
                </Cell>
                <Cell span={6}>
                  <ContextCard context={breakdown.context} />
                </Cell>
              </CardGrid>

              <ModelRatiosCard ratios={summary.modelRatios} />

              <section className="card">
                <div className="card-head">
                  <h2>Most expensive conversations</h2>
                  <span className="card-subtitle">{PERIODS.find(([id]) => id === period)![1].toLowerCase()}</span>
                </div>
                <div className="table-scroll">
                  <table className="table conversation-table">
                    <thead>
                      <tr>
                        <th scope="col">Conversation</th>
                        <th scope="col">Started</th>
                        <th scope="col">Duration</th>
                        <th scope="col">Messages</th>
                        <th scope="col">Models</th>
                        <th scope="col">
                          Subagents
                          <InfoTip label="About subagents">Share of the conversation's cost spent by subagents.</InfoTip>
                        </th>
                        <th scope="col">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conversations.map((c) => {
                        const place = c.branch ? `${c.name} · ${c.branch}` : c.name;
                        return (
                          <tr key={c.sessionId}>
                            <th scope="row" {...tip(c.path)}>
                              {c.title ?? place}
                              {c.title && <small>{place}</small>}
                            </th>
                            <td>{formatDateTime(c.start)}</td>
                            <td>{formatDuration(Date.parse(c.end) - Date.parse(c.start))}</td>
                            <td>{c.messages}</td>
                            <td className="conversation-models"><ModelBar byModel={c.byModel} /></td>
                            <td>{formatPercent(percentOf(c.subagentCost, c.cost))}</td>
                            <td><strong>{formatDollars(c.cost)}</strong></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
    </>
  );
}
