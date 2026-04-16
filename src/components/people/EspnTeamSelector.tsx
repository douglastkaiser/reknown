import { useEffect, useState } from 'react';
import { SPORTS, fetchTeams } from '../../lib/espn';
import type { EspnSport, EspnTeam } from '../../types';

export function EspnTeamSelector({
  onSelect,
}: {
  onSelect: (selection: { sport: EspnSport; team: EspnTeam } | null) => void;
}) {
  const [sportIndex, setSportIndex] = useState<number>(-1);
  const [teams, setTeams] = useState<EspnTeam[]>([]);
  const [teamId, setTeamId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSport = sportIndex >= 0 ? SPORTS[sportIndex] : null;

  useEffect(() => {
    if (!selectedSport) {
      setTeams([]);
      setTeamId('');
      onSelect(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setTeams([]);
    setTeamId('');
    onSelect(null);

    fetchTeams(selectedSport)
      .then((result) => {
        if (cancelled) return;
        setTeams(result);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[espn] fetchTeams failed', err);
        setError('Failed to load teams. Check your connection and try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportIndex]);

  function handleTeamChange(id: string) {
    setTeamId(id);
    if (!selectedSport || !id) {
      onSelect(null);
      return;
    }
    const team = teams.find((t) => t.id === id);
    if (team) {
      onSelect({ sport: selectedSport, team });
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          className="flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm"
          value={sportIndex}
          onChange={(e) => setSportIndex(Number(e.target.value))}
        >
          <option value={-1}>Select sport…</option>
          {SPORTS.map((s, i) => (
            <option key={s.leagueSlug} value={i}>
              {s.displayName}
            </option>
          ))}
        </select>

        <select
          className="flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm disabled:opacity-50"
          value={teamId}
          onChange={(e) => handleTeamChange(e.target.value)}
          disabled={!selectedSport || loading || teams.length === 0}
        >
          <option value="">
            {loading ? 'Loading teams…' : 'Select team…'}
          </option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
