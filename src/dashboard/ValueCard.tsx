import { CircleDollarSign } from 'lucide-react';
import { useState } from 'react';

import type { ValueForMoney } from '@/core/valueForMoney';

import { formatPercent, formatUsdShort } from '@/dashboard/format';
import { Toggle } from '@/dashboard/Toggle';

type Period = 'allTime' | 'recent';

const RECENT_LABELS: Record<ValueForMoney['kind'], string> = { cycle: 'This billing cycle', fourWeeks: 'Last 4 weeks' };

/** What the plan cost against what the same usage would have cost at API prices. */
export function ValueCard({ value }: { value: ValueForMoney }) {
  const [period, setPeriod] = useState<Period>(value.recent ? 'recent' : 'allTime');
  const shown = value[period];
  const ahead = shown !== undefined && shown.saved >= 0;

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
