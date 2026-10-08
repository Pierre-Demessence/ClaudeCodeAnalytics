import type { Summary } from '@/dashboard/api';

import { CacheCard } from '@/dashboard/CacheCard';
import { CardGrid, Cell } from '@/dashboard/CardGrid';
import { Heatmap } from '@/dashboard/Heatmap';
import { MessageCostCard } from '@/dashboard/MessageCostCard';
import { UsageChart } from '@/dashboard/UsageChart';
import { ValueCard } from '@/dashboard/ValueCard';

export function Usage({ summary }: { summary: Summary }) {
  const { activity, value } = summary;
  return (
    <>
      {value && <ValueCard value={value} />}
      <UsageChart summary={summary} />
      <Heatmap heatmap={activity.heatmap} />
      <CardGrid>
        <Cell span={6}>
          <CacheCard cache={activity.cache} />
        </Cell>
        <Cell span={6}>
          <MessageCostCard messageCost={activity.messageCost} />
        </Cell>
      </CardGrid>
    </>
  );
}
