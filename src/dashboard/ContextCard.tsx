import { Image as ImageIcon } from 'lucide-react';

import type { Breakdown } from '@/core/breakdown';

import { CHARS_PER_TOKEN, IMAGE_TOKENS } from '@/core/contextAdded';
import { formatPercent, formatTokens } from '@/dashboard/format';

const percentOf = (part: number, whole: number) => (whole > 0 ? part / whole * 100 : 0);

/** Tokens the tools' results added to the context, by tool, with the screenshots among them. */
export function ContextCard({ context }: { context: Breakdown['context'] }) {
  const { images, otherTools, tokens, tools } = context;
  const rows = [
    ...tools,
    ...(otherTools.count > 0 ? [{ name: `Other tools (${otherTools.count})`, images: otherTools.images, tokens: otherTools.tokens }] : []),
  ];
  const largest = Math.max(...rows.map(row => row.tokens));

  return (
    <section className="card">
      <div className="card-head">
        <h2>Where context grows</h2>
        <span className="card-head-spacer" />
        <span className="card-subtitle">{`${formatTokens(tokens)} input tokens`}</span>
      </div>
      <p className="note">{`Size of what each tool sent back into the conversation, estimated from its length: about ${CHARS_PER_TOKEN} characters per token, ${IMAGE_TOKENS.toLocaleString('en-US')} tokens per screenshot. It is what the results added, not what the calls cost.`}</p>
      {rows.length === 0
        ? <p className="note">No tool results in this period.</p>
        : (
            <div className="table-scroll">
              <table className="output-table">
                <thead>
                  <tr>
                    <th scope="col">Tool</th>
                    <th scope="col">Relative size</th>
                    <th scope="col">Screenshots</th>
                    <th scope="col">Tokens added</th>
                    <th scope="col">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.name}>
                      <th scope="row">
                        <span aria-hidden="true" className="output-swatch output-tool" />
                        {row.name}
                      </th>
                      <td className="output-bar-cell"><span className="share-track"><span className="share-fill output-tool" style={{ width: `${percentOf(row.tokens, largest)}%` }} /></span></td>
                      <td>
                        {row.images > 0
                          ? (
                              <span className="shot-count">
                                <ImageIcon aria-hidden="true" size={14} />
                                {row.images.toLocaleString('en-US')}
                              </span>
                            )
                          : <span className="secondary">–</span>}
                      </td>
                      <td><strong>{formatTokens(row.tokens)}</strong></td>
                      <td>{formatPercent(percentOf(row.tokens, tokens))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2} scope="row">All tool results</th>
                    <td><strong>{images.toLocaleString('en-US')}</strong></td>
                    <td><strong>{formatTokens(tokens)}</strong></td>
                    <td><strong>100%</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
    </section>
  );
}
