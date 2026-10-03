import type { ManualReading, SettingsUpdate, Summary } from '@/dashboard/api';

import { CollectionCard } from '@/dashboard/CollectionCard';
import { DriftCard } from '@/dashboard/DriftCard';
import { FitCard } from '@/dashboard/FitCard';
import { PlanHistoryCard } from '@/dashboard/PlanHistoryCard';
import { ReadingsCard } from '@/dashboard/ReadingsCard';
import { SettingsCard } from '@/dashboard/SettingsCard';

interface Props {
  busy: boolean;
  summary: Summary;
  onAddReading: (reading: ManualReading) => Promise<void>;
  onDeleteReading: (ts: string) => Promise<void>;
  onSaveSettings: (settings: SettingsUpdate) => Promise<void>;
}

/** Limit drift and the fit, the readings beside the settings and collection status, then the plan history. */
export function Calibration({ busy, onAddReading, onDeleteReading, onSaveSettings, summary }: Props) {
  return (
    <>
      <div className="cal-row">
        <DriftCard summary={summary} />
        <FitCard summary={summary} />
      </div>
      <div className="cal-row cal-row-top">
        <ReadingsCard busy={busy} onAddReading={onAddReading} onDeleteReading={onDeleteReading} summary={summary} />
        <div className="cal-column">
          <SettingsCard busy={busy} onSaveSettings={onSaveSettings} summary={summary} />
          <CollectionCard summary={summary} />
        </div>
      </div>
      <PlanHistoryCard busy={busy} onSaveSettings={onSaveSettings} summary={summary} />
    </>
  );
}
