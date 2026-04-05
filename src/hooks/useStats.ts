import { useCallback, useEffect, useState } from 'react';
import type { AppStats, ReviewMetrics } from '../types';
import { getReviewMetrics, getStats, updateStats } from '../lib/storage';

export function useStats() {
  const [stats, setStats] = useState<AppStats | null>(null);
  const [reviewMetrics, setReviewMetrics] = useState<ReviewMetrics | null>(null);

  const refresh = useCallback(async () => {
    const [nextStats, nextMetrics] = await Promise.all([getStats(), getReviewMetrics()]);
    setStats(nextStats);
    setReviewMetrics(nextMetrics);
  }, []);

  useEffect(() => {
    void refresh();

    const onMetricsUpdated = () => {
      void refresh();
    };

    window.addEventListener('reknown:metrics-updated', onMetricsUpdated);
    return () => {
      window.removeEventListener('reknown:metrics-updated', onMetricsUpdated);
    };
  }, [refresh]);

  const patchStats = useCallback(async (updates: Partial<Omit<AppStats, 'id' | 'updatedAt'>>) => {
    setStats(await updateStats(updates));
    setReviewMetrics(await getReviewMetrics());
  }, []);

  return { stats, reviewMetrics, refresh, patchStats };
}
