import type { RangeChoice } from '@/core/range';
import type { SummaryInput } from '@/core/summary';
import type { Summary } from '@/dashboard/api';
import type { HistoryView } from '@/dashboard/history';

import { resolveRange } from '@/core/range';
import { buildRanged } from '@/core/ranged';
import { buildSummary } from '@/core/summary';
import { defaultView, rangeContext } from '@/dashboard/history';

/** For the tabs' tests: the summary of `input` and the view of a tab with `choice` picked, its data from the ranged builders. */
export function viewOver(input: SummaryInput, choice: RangeChoice, onChoose: HistoryView['onChoose'] = () => {}): { summary: Summary; view: HistoryView } {
  const summary: Summary = { ...buildSummary(input), status: {} };
  const range = resolveRange(choice, rangeContext(summary));
  return { summary, view: { ...defaultView(summary, onChoose), choice, history: buildRanged(input, range), range } };
}
