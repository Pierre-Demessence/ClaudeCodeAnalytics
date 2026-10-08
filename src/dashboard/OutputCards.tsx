import type { Breakdown } from '@/core/breakdown';

import { formatDollars, formatPercent, formatTokens } from '@/dashboard/format';
import { InfoTip } from '@/dashboard/Tip';
import { useTip } from '@/dashboard/useTip';

const percentOf = (part: number, whole: number) => (whole > 0 ? part / whole * 100 : 0);

type Fill = 'reply' | 'thinking' | 'tool' | 'untracked';

interface Bucket {
  fill: Fill;
  label: string;
  tokens: number;
}

/** Each bucket has its own texture as well as its label, so color is never the only cue. */
function Swatch({ fill }: { fill: Fill }) {
  return <span aria-hidden="true" className={`output-swatch output-${fill}`} />;
}

/** Output tokens by thinking, reply text and tool, whose parts sum to the period's output. */
export function OutputCard({ output }: { output: Breakdown['output'] }) {
  const { otherTools, reply, thinking, tools, total, untracked } = output;
  const toolTokens = tools.reduce((sum, tool) => sum + tool.tokens, 0) + otherTools.tokens;
  const groups: Bucket[] = [
    { fill: 'thinking', label: 'Thinking', tokens: thinking },
    { fill: 'reply', label: 'Reply text', tokens: reply },
    { fill: 'untracked', label: 'Untracked', tokens: untracked },
    { fill: 'tool', label: 'Tool calls', tokens: toolTokens },
  ];
  const shown = groups.filter(group => group.tokens > 0);
  const rows: Bucket[] = [
    ...shown.filter(group => group.fill !== 'tool'),
    ...tools.map(tool => ({ fill: 'tool' as const, label: tool.name, tokens: tool.tokens })),
    ...(otherTools.count > 0 ? [{ fill: 'tool' as const, label: `Other tools (${otherTools.count})`, tokens: otherTools.tokens }] : []),
  ];
  const largest = Math.max(...rows.map(row => row.tokens));
  const description = shown.map(group => `${group.label} ${formatPercent(percentOf(group.tokens, total))}`).join(', ');

  return (
    <section className="card">
      <div className="card-head">
        <h2>Where output goes</h2>
        <span class="card-head-spacer"></span>
        <span className="card-subtitle">{`${formatTokens(total)} output tokens`}</span>
      </div>
      <p className="note">Thinking and replies are counted exactly. Tool figures split each message's remaining tokens across its tool calls by the size of their input, so they are estimates.</p>
      <span aria-label={description} className="output-bar" role="img">
        {shown.map(group => <span className={`output-${group.fill}`} key={group.fill} style={{ flexGrow: group.tokens }} />)}
      </span>
      <ul className="legend">
        {shown.map(group => (
          <li key={group.fill}>
            <Swatch fill={group.fill} />
            {`${group.label} `}
            <strong>{formatPercent(percentOf(group.tokens, total))}</strong>
            {group.fill === 'tool' && <span className="secondary">(estimate)</span>}
          </li>
        ))}
      </ul>
      <div className="table-scroll">
        <table className="output-table">
          <thead>
            <tr>
              <th scope="col">Bucket</th>
              <th scope="col">Relative size</th>
              <th scope="col">Tokens</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={`${row.fill}-${row.label}`}>
                <th scope="row">
                  <Swatch fill={row.fill} />
                  {row.label}
                </th>
                <td className="output-bar-cell"><span className="share-track"><span className={`share-fill output-${row.fill}`} style={{ width: `${percentOf(row.tokens, largest)}%` }} /></span></td>
                <td>{formatTokens(row.tokens)}</td>
                <td><strong>{formatPercent(percentOf(row.tokens, total))}</strong></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2} scope="row">Output total</th>
              <td><strong>{formatTokens(total)}</strong></td>
              <td><strong>100%</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {untracked > 0 && <p className="note">Untracked: messages recorded before tool calls were kept.</p>}
    </section>
  );
}

/** Cost and output tokens per skill or slash command, with the rest under "No skill". */
export function SkillCard({ breakdown }: { breakdown: Breakdown }) {
  const tip = useTip();
  const { noSkill, otherSkills, skills, total } = breakdown;
  const hasSkills = skills.length > 0;
  // "No skill" is most of the cost, so its bar would shrink every skill's: only the skills are drawn, scaled to the largest.
  const rows = [
    { name: 'No skill', cost: noSkill.cost, kind: 'no skill active', output: noSkill.output, scaled: false },
    ...skills.map(skill => ({ ...skill, kind: skill.name.startsWith('/') ? 'slash command' : 'skill', scaled: true })),
    ...(otherSkills.count > 0 ? [{ name: `Other (${otherSkills.count})`, cost: otherSkills.cost, kind: 'skills and commands', output: otherSkills.output, scaled: true }] : []),
  ];
  const largest = Math.max(...rows.filter(row => row.scaled).map(row => row.cost));

  return (
    <section className="card">
      <div className="card-head">
        <h2>By skill or command</h2>
        <InfoTip label="About tokens and cost">Cost includes input and cache; tokens are output only.</InfoTip>
        <span className="card-head-spacer" />
        <span className="card-subtitle">{`${formatDollars(total.cost)} · ${formatTokens(breakdown.output.total)} output tokens`}</span>
      </div>
      <p className="note">A skill or slash command owns the messages after it until your next prompt. Subagents count under the skill their conversation was under when they ran.</p>
      {!hasSkills
        ? <p className="note">No skill or slash command in this period.</p>
        : (
            <div className="table-scroll">
              <table className="output-table">
                <thead>
                  <tr>
                    <th scope="col">Skill or command</th>
                    <th scope="col">Relative size</th>
                    <th scope="col">Output tokens</th>
                    <th scope="col">Cost</th>
                    <th scope="col">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.name}>
                      <th scope="row" {...tip(row.name)}>
                        {row.name}
                        <small>{row.kind}</small>
                      </th>
                      <td className="output-bar-cell">
                        {row.scaled && <span className="share-track"><span className="share-fill" style={{ width: `${percentOf(row.cost, largest)}%` }} /></span>}
                      </td>
                      <td>{formatTokens(row.output)}</td>
                      <td><strong>{formatDollars(row.cost)}</strong></td>
                      <td>{formatPercent(percentOf(row.cost, total.cost))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2} scope="row">All messages</th>
                    <td><strong>{formatTokens(breakdown.output.total)}</strong></td>
                    <td><strong>{formatDollars(total.cost)}</strong></td>
                    <td><strong>100%</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
    </section>
  );
}
