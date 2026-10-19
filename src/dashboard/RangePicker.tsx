import type { ReactNode } from 'react';

import { ChevronLeft, ChevronRight, CircleX, LoaderCircle } from 'lucide-react';

import type { PresetId, RangeChoice } from '@/core/range';
import type { HistoryView } from '@/dashboard/history';

import { dayKey } from '@/core/aggregate';
import { customFromRange, PRESETS, rangeLabel, resolveRange, stepRange } from '@/core/range';
import { Toggle } from '@/dashboard/Toggle';

type Selection = 'custom' | 'default' | PresetId;

const OPTIONS: [Selection, string][] = [['default', 'Default'], ...PRESETS.map(({ id, label }): [Selection, string] => [id, label]), ['custom', 'Custom']];

const pickOf = (choice?: RangeChoice): Selection => (!choice ? 'default' : choice.kind === 'custom' ? 'custom' : choice.preset);

/** The range shared by the Usage, Breakdown, Sessions and Weeks tabs: presets, stepping and custom days. */
export function RangePicker({ view }: { view: HistoryView }) {
  const { choice, ctx, loading, onChoose, range } = view;
  const previous = choice && stepRange(choice, -1, ctx);
  const next = choice && stepRange(choice, 1, ctx);
  const today = dayKey(ctx.now, ctx.timeZone);

  const pick = (value: Selection) => {
    if (value === 'default')
      onChoose(undefined);
    else if (value === 'custom')
      onChoose(customFromRange(range ?? resolveRange({ back: 0, kind: 'preset', preset: 'week' }, ctx), ctx));
    else
      onChoose({ back: 0, kind: 'preset', preset: value });
  };

  /** Moves the other end along when the dates cross. */
  const setDay = (end: 'from' | 'to', value: string) => {
    if (choice?.kind !== 'custom' || value === '')
      return;
    const days = { ...choice, [end]: value };
    if (days.from > days.to)
      days[end === 'from' ? 'to' : 'from'] = value;
    onChoose(days);
  };

  return (
    <div className="range-picker">
      <Toggle label="Range" onChange={pick} options={OPTIONS} value={pickOf(choice)} />
      <div className="range-step">
        <button aria-label="Previous period" className="icon-button" disabled={!previous} onClick={() => onChoose(previous)} type="button">
          <ChevronLeft aria-hidden="true" size={18} />
        </button>
        <span className="range-label">{range ? rangeLabel(range, ctx.timeZone) : 'Default windows'}</span>
        <button aria-label="Next period" className="icon-button" disabled={!next} onClick={() => onChoose(next)} type="button">
          <ChevronRight aria-hidden="true" size={18} />
        </button>
      </div>
      {choice?.kind === 'custom' && (
        <div className="range-dates">
          <label>
            From
            <input max={today} onChange={e => setDay('from', e.target.value)} type="date" value={choice.from} />
          </label>
          <label>
            To
            <input max={today} onChange={e => setDay('to', e.target.value)} type="date" value={choice.to} />
          </label>
        </div>
      )}
      {loading && (
        <span className="busy range-loading" role="status">
          <LoaderCircle aria-hidden="true" className="icon-inline" size={16} />
          Loading…
        </span>
      )}
    </div>
  );
}

/** A history tab: the picker, then the content, dimmed while the range's data is on its way. */
export function RangeFrame({ aside, children, view }: { aside?: ReactNode; children: ReactNode; view: HistoryView }) {
  return (
    <>
      <div className="range-bar">
        <RangePicker view={view} />
        {aside}
      </div>
      {view.error && (
        <p className="error" role="alert">
          <CircleX aria-hidden="true" className="icon-inline" size={16} />
          {view.error}
        </p>
      )}
      {/* After a failure the content still holds the previous range's data: it stays dimmed beside the error. */}
      <div aria-busy={view.loading} className={view.loading || view.error ? 'range-content loading' : 'range-content'}>
        {children}
      </div>
    </>
  );
}
