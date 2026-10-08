import { Activity } from 'lucide-react';

import type { FamilyActiveLeft } from '@/core/activePace';
import type { Family } from '@/core/family';

import { formatDuration } from '@/dashboard/format';
import { SERIES } from '@/dashboard/models';
import { Swatch } from '@/dashboard/Patterns';
import { InfoTip } from '@/dashboard/Tip';

/** Active use left if only one model family were used: the answer depends on how fast each one burns the limit. */
export function FamilyHours({ current, items }: { current?: Family; items: readonly FamilyActiveLeft[] }) {
  if (items.length === 0)
    return null;
  return (
    <div className="family-hours-row">
      <span className="family-hours-lead">If you only use</span>
      {/* Explicit role: `list-style: none` drops list semantics in Safari. */}
      <ul aria-label="Active use left if only one model is used" className="family-hours" role="list">
        {items.map((item) => {
          const series = SERIES.find(s => s.family === item.family)!;
          return (
            <li className={item.family === current ? 'current' : undefined} key={item.family}>
              <Swatch series={series} />
              <span>{series.label}</span>
              <strong>{`${item.lowConfidence ? '≈ ' : ''}${formatDuration(item.ms)}`}</strong>
              {item.lowConfidence && (
                <InfoTip label={`About the ${series.label} estimate`}>
                  {`Estimated from your overall pace and this model's price: there is too little active time on ${series.label} to measure its own pace.`}
                </InfoTip>
              )}
              {item.family === current && (
                <span className="family-current">
                  <Activity aria-hidden="true" size={14} />
                  last used
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
