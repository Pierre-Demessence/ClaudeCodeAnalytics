import type { FormEvent } from 'react';

import { useState } from 'react';

import type { Snapshot } from '@/core/types';
import type { ManualReading, Summary } from '@/dashboard/api';

import { formatDateTime } from '@/dashboard/format';
import { toLocalInput } from '@/dashboard/planPeriods';

interface Props {
  busy: boolean;
  summary: Summary;
  onAddReading: (reading: ManualReading) => Promise<void>;
  onDeleteReading: (ts: string) => Promise<void>;
}

const FIRST_ROWS = 10;
const MORE_ROWS = 20;

const percentOrDash = (value: number | undefined) => (value === undefined ? '—' : `${Math.round(value)}%`);

function ReadingRow({ busy, onDelete, reading }: { busy: boolean; onDelete: (ts: string) => void; reading: Snapshot }) {
  const time = formatDateTime(reading.ts);
  return (
    <tr>
      <td>{time}</td>
      <td>{reading.source}</td>
      <td>{`${reading.weekly}%`}</td>
      <td>{percentOrDash(reading.fiveHour)}</td>
      <td>{percentOrDash(reading.claudeCodeShare)}</td>
      <td>
        {reading.source === 'manual' && (
          <button
            aria-label={`Delete the manual reading of ${time}`}
            disabled={busy}
            onClick={() => {
              // eslint-disable-next-line no-alert -- deleting is irreversible from the dashboard: a native confirm is enough
              if (window.confirm(`Delete the manual reading of ${time}? It cannot be restored from the dashboard.`))
                onDelete(reading.ts);
            }}
            type="button"
          >
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}

/** Readings of the plan limits, newest first, and the form to add one by hand. */
export function ReadingsCard({ busy, onAddReading, onDeleteReading, summary }: Props) {
  const [shown, setShown] = useState(FIRST_ROWS);
  const [weekly, setWeekly] = useState('');
  const [fiveHour, setFiveHour] = useState('');
  const [share, setShare] = useState('');
  // Undefined until edited, so the default follows the latest reading across weekly resets.
  const [editedResetsAt, setEditedResetsAt] = useState<string>();
  const resetsAt = editedResetsAt ?? (summary.current ? toLocalInput(summary.current.resetsAt) : '');
  const { readings } = summary.limits;

  const submitReading = (event: FormEvent) => {
    event.preventDefault();
    void onAddReading({
      claudeCodeShare: share === '' ? undefined : Number(share),
      fiveHour: fiveHour === '' ? undefined : Number(fiveHour),
      weekly: Number(weekly),
      weeklyResetsAt: new Date(resetsAt).toISOString(),
    }).then(() => {
      setWeekly('');
      setFiveHour('');
      setShare('');
      setEditedResetsAt(undefined);
    });
  };

  return (
    <section className="card cal-card cal-wide">
      <h2>Readings</h2>
      {readings.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="table readings-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Source</th>
                  <th>Weekly</th>
                  <th>5-hour</th>
                  <th>Claude Code share</th>
                  <th><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {readings.slice(0, shown).map(reading => (
                  <ReadingRow busy={busy} key={`${reading.ts}-${reading.source}`} onDelete={ts => void onDeleteReading(ts)} reading={reading} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>{`Showing ${Math.min(shown, readings.length)} of ${readings.length} readings`}</span>
            {shown < readings.length && <button onClick={() => setShown(shown + MORE_ROWS)} type="button">Show more</button>}
          </div>
        </>
      )}
      <form className="cal-form" onSubmit={submitReading}>
        <div>
          <h3>Add a manual reading</h3>
          <span className="helper">
            Optional. Copy the numbers from
            {' '}
            <code>/usage</code>
            {' '}
            in Claude Code; they are used like endpoint readings.
          </span>
        </div>
        <div className="inline-form">
          <label>
            Weekly %
            <input max="100" min="0" onChange={e => setWeekly(e.target.value)} required step="1" type="number" value={weekly} />
          </label>
          <label>
            5-hour %
            <input max="100" min="0" onChange={e => setFiveHour(e.target.value)} placeholder="optional" step="1" type="number" value={fiveHour} />
          </label>
          <label>
            Claude Code share %
            <input max="100" min="0" onChange={e => setShare(e.target.value)} placeholder="optional" step="1" type="number" value={share} />
          </label>
          <label>
            Weekly reset
            <input onChange={e => setEditedResetsAt(e.target.value)} required type="datetime-local" value={resetsAt} />
          </label>
          <button disabled={busy} type="submit">Add manual reading</button>
        </div>
        <span className="helper">Without a Claude Code share, claude.ai use in the reading counts as Claude Code. The reset is prefilled from the latest reading.</span>
      </form>
    </section>
  );
}
