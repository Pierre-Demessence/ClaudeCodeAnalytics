import type { Summary } from '@/dashboard/api';

import { CacheCard } from '@/dashboard/CacheCard';
import { Heatmap } from '@/dashboard/Heatmap';
import { MessageCostCard } from '@/dashboard/MessageCostCard';
import { UsageChart } from '@/dashboard/UsageChart';

export function Usage({ summary }: { summary: Summary }) {
  const { activity } = summary;
  return (
    <>
      <UsageChart summary={summary} />
      <Heatmap heatmap={activity.heatmap} />
      <div className="usage-grid">
        <CacheCard cache={activity.cache} />
        <MessageCostCard messageCost={activity.messageCost} />
      </div>
    </>
  );
}
