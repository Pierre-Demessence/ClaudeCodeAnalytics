import type { Summary } from '@/dashboard/api';
import type { HistoryView } from '@/dashboard/history';

import { CacheCard } from '@/dashboard/CacheCard';
import { CardGrid, Cell } from '@/dashboard/CardGrid';
import { Heatmap } from '@/dashboard/Heatmap';
import { defaultView, rangeText } from '@/dashboard/history';
import { MessageCostCard } from '@/dashboard/MessageCostCard';
import { RangeFrame } from '@/dashboard/RangePicker';
import { UsageChart } from '@/dashboard/UsageChart';
import { ValueCard } from '@/dashboard/ValueCard';

export function Usage({ summary, view = defaultView(summary) }: { summary: Summary; view?: HistoryView }) {
  const { activity } = view.history;
  const range = view.range && rangeText(view, '');
  return (
    <>
      {summary.value && <ValueCard value={summary.value} />}
      <RangeFrame view={view}>
        <UsageChart view={view} />
        <Heatmap heatmap={activity.heatmap} range={range} />
        <CardGrid>
          <Cell span={6}>
            <CacheCard cache={activity.cache} range={range} />
          </Cell>
          <Cell span={6}>
            <MessageCostCard messageCost={activity.messageCost} range={range} />
          </Cell>
        </CardGrid>
      </RangeFrame>
    </>
  );
}
