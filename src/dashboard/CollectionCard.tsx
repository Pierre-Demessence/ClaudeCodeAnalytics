import { CircleCheck, CircleX } from 'lucide-react';

import type { Summary } from '@/dashboard/api';

import { endpointResultText } from '@/dashboard/endpoint';
import { formatInteger, formatRelative } from '@/dashboard/format';

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

/** What the last collector run did. */
export function CollectionCard({ summary }: { summary: Summary }) {
  const { status } = summary;
  return (
    <section className="card cal-card">
      <h2>Collection</h2>
      <dl className="facts">
        <dt>Usage endpoint</dt>
        <dd>
          <EndpointStatus summary={summary} />
        </dd>
        <dt>Last run</dt>
        <dd>{status.lastRunAt ? formatRelative(status.lastRunAt) : 'never'}</dd>
        <dt>Messages imported</dt>
        <dd>{formatInteger(status.messages ?? 0)}</dd>
        {(status.malformedLines ?? 0) > 0 && (
          <>
            <dt>Malformed lines</dt>
            <dd>{status.malformedLines}</dd>
          </>
        )}
      </dl>
      {status.lastError && (
        <p className="callout critical">
          <CircleX aria-hidden="true" className="icon-inline icon-critical" size={16} />
          <span>{`Last run failed: ${status.lastError}`}</span>
        </p>
      )}
    </section>
  );
}
