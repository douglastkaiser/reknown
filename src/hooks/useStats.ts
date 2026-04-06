import { useCallback, useEffect, useState } from 'react';
import type { AppStats, ReviewMetrics } from '../types';
import { getReviewMetrics, getStats, updateStats } from '../lib/storage';
import { useAuth } from '../contexts/AuthContext';

export function useStats() {
  const { scope } = useAuth();
  const [stats, setStats] = useState<AppStats | null>(null);
  const [reviewMetrics, setReviewMetrics] = useState<ReviewMetrics | null>(null);

  const refresh = useCallback(async () => {
    if (!scope) {
      setStats(null);
      setReviewMetrics(null);
      return;
    }
    const [nextStats, nextMetrics] = await Promise.all([getStats(), getReviewMetrics()]);
    setStats(nextStats);
    setReviewMetrics(nextMetrics);
  }, [scope]);

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
