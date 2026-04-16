import type { EspnPlayer, EspnSport, EspnTeam, Person } from '../types';

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

export const SPORTS: EspnSport[] = [
  { slug: 'football', leagueSlug: 'nfl', displayName: 'NFL' },
  { slug: 'basketball', leagueSlug: 'nba', displayName: 'NBA' },
  { slug: 'baseball', leagueSlug: 'mlb', displayName: 'MLB' },
  { slug: 'hockey', leagueSlug: 'nhl', displayName: 'NHL' },
  { slug: 'soccer', leagueSlug: 'usa.1', displayName: 'MLS' },
  { slug: 'basketball', leagueSlug: 'wnba', displayName: 'WNBA' },
];

async function espnFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ESPN API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

interface EspnTeamsResponse {
  sports: Array<{
    leagues: Array<{
      teams: Array<{ team: EspnTeam & { logos?: Array<{ href: string }> } }>;
    }>;
  }>;
}

export async function fetchTeams(sport: EspnSport): Promise<EspnTeam[]> {
  const url = `${ESPN_API_BASE}/${sport.slug}/${sport.leagueSlug}/teams?limit=100`;
  const data = await espnFetch<EspnTeamsResponse>(url);

  const league = data.sports?.[0]?.leagues?.[0];
  if (!league) return [];

  return league.teams
    .map((entry) => ({
      id: entry.team.id,
      displayName: entry.team.displayName,
      abbreviation: entry.team.abbreviation,
      slug: entry.team.slug,
      logo: entry.team.logos?.[0]?.href,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

interface EspnRosterResponse {
  athletes: Array<{
    position?: string;
    items: Array<{
      id: string;
      displayName: string;
      fullName: string;
      jersey?: string;
      position?: { abbreviation: string; name: string };
      headshot?: { href: string };
    }>;
  }>;
}

export async function fetchRoster(
  sport: EspnSport,
  teamId: string,
): Promise<EspnPlayer[]> {
  const url = `${ESPN_API_BASE}/${sport.slug}/${sport.leagueSlug}/teams/${teamId}/roster`;
  const data = await espnFetch<EspnRosterResponse>(url);

  if (!data.athletes) return [];

  return data.athletes.flatMap((group) =>
    group.items.map((item) => ({
      id: item.id,
      displayName: item.displayName,
      fullName: item.fullName,
      position: item.position ?? { abbreviation: '', name: '' },
      jersey: item.jersey,
      headshot: item.headshot,
    })),
  );
}

export function rosterToPersonRecords(
  players: EspnPlayer[],
  teamName: string,
): Array<Omit<Person, 'id' | 'categoryId' | 'createdAt' | 'updatedAt'>> {
  return players.map((player) => {
    const positionLabel = player.position.name || player.position.abbreviation;
    const jersey = player.jersey ? `#${player.jersey}` : '';
    const headline = [positionLabel, jersey].filter(Boolean).join(' ');

    return {
      name: player.fullName || player.displayName,
      headline: headline || undefined,
      company: teamName,
      photoUrl: player.headshot?.href ?? undefined,
      espnPlayerId: player.id,
    };
  });
}
