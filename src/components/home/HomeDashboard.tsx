import type { AppStats } from '../../types';
import { StatPill } from '../common/StatPill';
import { InstallPromptCard } from './InstallPromptCard';

export function HomeDashboard({
  stats,
  installPromptDismissed,
  onDismissInstallPrompt,
}: {
  stats: AppStats | null;
  installPromptDismissed: boolean;
  onDismissInstallPrompt: () => Promise<void>;
}) {
  return (
    <section className="space-y-3">
      <InstallPromptCard dismissed={installPromptDismissed} onDismiss={onDismissInstallPrompt} />
      <div className="grid grid-cols-2 gap-2">
        <StatPill label="Due" value={stats?.dueCards ?? 0} />
        <StatPill label="Reviews" value={stats?.totalReviews ?? 0} />
        <StatPill label="Mature" value={stats?.matureCards ?? 0} />
        <StatPill label="Avg EF" value={stats?.averageEaseFactor?.toFixed(2) ?? '2.50'} />
      </div>
    </section>
  );
}
