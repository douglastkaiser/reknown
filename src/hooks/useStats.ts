import { useCallback, useEffect, useState } from 'react';
import type { AppStats } from '../types';
import { getStats, updateStats } from '../lib/storage';

export function useStats() {
  const [stats, setStats] = useState<AppStats | null>(null);

  const refresh = useCallback(async () => {
    setStats(await getStats());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patchStats = useCallback(async (updates: Partial<Omit<AppStats, 'id' | 'updatedAt'>>) => {
    setStats(await updateStats(updates));
  }, []);

  return { stats, refresh, patchStats };
}
