import { useState } from 'react';
import type { Category, EspnSport, Person } from '../../types';
import { fetchRoster, rosterToPersonRecords, SPORTS } from '../../lib/espn';
import { createPerson, updatePerson } from '../../lib/storage';
import { Button } from '../common/Button';

function findSport(category: Category): EspnSport | undefined {
  return SPORTS.find(
    (s) => s.slug === category.espnSport && s.leagueSlug === category.espnLeague,
  );
}

export function EspnRosterPanel({
  category,
  people,
  onImported,
}: {
  category: Category;
  people: Person[];
  onImported: () => Promise<void> | void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sport = findSport(category);
  const teamId = category.espnTeamId;
  const teamName = category.espnTeamName ?? category.name;
  const season = category.espnSeason;

  async function handleRefresh() {
    if (!sport || !teamId || refreshing) return;
    setRefreshing(true);
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: 0 });

    try {
      const players = await fetchRoster(sport, teamId);
      const records = rosterToPersonRecords(players, teamName);
      setProgress({ done: 0, total: records.length });

      const existingByEspnId = new Map<string, Person>();
      for (const p of people) {
        if (p.espnPlayerId) existingByEspnId.set(p.espnPlayerId, p);
      }

      let added = 0;
      let updated = 0;

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const existing = record.espnPlayerId
          ? existingByEspnId.get(record.espnPlayerId)
          : undefined;

        if (existing) {
          await updatePerson(existing.id, {
            headline: record.headline,
            photoUrl: record.photoUrl,
          });
          updated++;
        } else {
          await createPerson({ ...record, categoryId: category.id });
          added++;
        }
        setProgress({ done: i + 1, total: records.length });
      }

      setResult({ added, updated });
      await onImported();
    } catch (err) {
      console.error('[espn] refresh failed', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch roster');
    } finally {
      setRefreshing(false);
    }
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const sportLabel = sport?.displayName ?? category.espnLeague?.toUpperCase() ?? 'ESPN';

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {teamName}
          </h3>
          <p className="text-xs text-muted">
            <span className="rounded-full border border-border px-2 py-0.5">
              {sportLabel}
            </span>
            {season ? (
              <>
                {' '}
                <span className="rounded-full border border-border px-2 py-0.5">
                  {season} roster
                </span>
              </>
            ) : null}{' '}
            · {people.length} {people.length === 1 ? 'player' : 'players'} imported
          </p>
        </div>
        <Button type="button" onClick={handleRefresh} disabled={refreshing || !sport}>
          {refreshing ? 'Refreshing…' : 'Refresh Roster'}
        </Button>
      </div>

      {refreshing && progress.total > 0 ? (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted">
            {progress.done} / {progress.total} players
          </p>
        </div>
      ) : null}

      {result ? (
        <p className="text-xs text-muted">
          {result.added > 0
            ? `Added ${result.added} new ${result.added === 1 ? 'player' : 'players'}`
            : 'No new players'}
          {result.updated > 0
            ? `, updated ${result.updated}`
            : ''}
          .
        </p>
      ) : null}

      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
