import type { AppStats, ReviewMetrics } from '../../types';
import { StatPill } from '../common/StatPill';

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

export function StatsPage({
  stats,
  reviewMetrics,
}: {
  stats: AppStats | null;
  reviewMetrics: ReviewMetrics | null;
}) {
  const gotIt = reviewMetrics?.overall.accuracy ?? 0;
  const needsWork = 100 - gotIt;

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <StatPill label="Due" value={stats?.dueCards ?? 0} />
        <StatPill label="Reviews" value={stats?.totalReviews ?? 0} />
        <StatPill label="Mature" value={stats?.matureCards ?? 0} />
        <StatPill label="Avg EF" value={stats?.averageEaseFactor?.toFixed(2) ?? '2.50'} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatPill label="Got it %" value={formatPercent(gotIt)} />
        <StatPill label="Needs work %" value={formatPercent(needsWork)} />
      </div>

      <div className="rounded-xl border border-outline bg-surface p-3 text-sm text-muted">
        <p>Face→Name accuracy: {formatPercent(reviewMetrics?.faceToName.accuracy ?? 0)}</p>
        <p>Name→Face accuracy: {formatPercent(reviewMetrics?.nameToFace.accuracy ?? 0)}</p>
        <p>Trend (7d): {formatPercent(reviewMetrics?.trend7d.accuracy ?? 0)}</p>
        <p>Trend (30d): {formatPercent(reviewMetrics?.trend30d.accuracy ?? 0)}</p>
      </div>
    </section>
  );
}
