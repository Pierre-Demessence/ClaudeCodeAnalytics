import { CircleDollarSign } from 'lucide-react';
import { useState } from 'react';

import type { Value, ValueForMoney } from '@/core/valueForMoney';

import { PLAN_LABELS } from '@/core/plans';
import { formatPercent, formatUsdShort } from '@/dashboard/format';
import { Toggle } from '@/dashboard/Toggle';

type Period = 'allTime' | 'recent';

const RECENT_LABELS: Record<ValueForMoney['kind'], string> = { cycle: 'This billing cycle', fourWeeks: 'Last 4 weeks' };

/** The credits for unused time taken off the subscription; absent without one. */
function creditNote(credits: Value['credits']): string | undefined {
  if (!credits?.length)
    return undefined;
  const total = formatUsdShort(credits.reduce((sum, credit) => sum + credit.amount, 0));
  return credits.length === 1 ? `after ${total} credit for unused ${PLAN_LABELS[credits[0]!.plan]}` : `after ${total} credit for unused time`;
}

/** What the plan cost against what the same usage would have cost at API prices. */
export function ValueCard({ value }: { value: ValueForMoney }) {
  const [period, setPeriod] = useState<Period>(value.recent ? 'recent' : 'allTime');
  const shown = value[period];
  const ahead = shown !== undefined && shown.saved >= 0;
  const note = creditNote(shown?.credits);

  return (
    <section className="card value-card">
      <div className="card-head">
        <CircleDollarSign aria-hidden="true" className="icon-info" size={20} />
        <h2>Subscription vs API prices</h2>
        <span className="card-head-spacer" />
        <div className="controls">
          <Toggle label="Period" onChange={setPeriod} options={[['recent', RECENT_LABELS[value.kind]], ['allTime', 'All time']]} value={period} />
        </div>
      </div>
      {shown
        ? (
            <div className="stats">
              <div>
                <span>Subscription</span>
                <strong>{formatUsdShort(shown.paid)}</strong>
                {note && <span>{note}</span>}
              </div>
              <div>
                <span>API value</span>
                <strong>{formatUsdShort(shown.apiCost)}</strong>
              </div>
              <div className="value-saved">
                <span>{ahead ? 'Saved' : 'Extra cost'}</span>
                <strong>{formatUsdShort(Math.abs(shown.saved))}</strong>
                <span>{`${formatPercent(Math.abs(shown.savedPercent))} ${ahead ? 'below' : 'above'} API`}</span>
              </div>
            </div>
          )
        : <p className="empty">No usage in this period.</p>}
    </section>
  );
}
