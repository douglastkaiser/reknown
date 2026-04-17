import { useEffect, useState } from 'react';
import type { Category, EnrichMethod, EspnSport, EspnTeam } from '../../types';
import { WEB_TEAM_PROVIDERS, validateWebTeamProviderUrl } from '../../lib/web-team';
import type { WebTeamProvider } from '../../lib/web-team';
import { Button } from '../common/Button';
import { EspnTeamSelector } from './EspnTeamSelector';

type CreateInput = {
  name: string;
  enrichMethod: EnrichMethod;
  espnSport?: string;
  espnLeague?: string;
  espnTeamId?: string;
  espnTeamName?: string;
  espnSeason?: number;
  webTeamProvider?: string;
  webTeamUrl?: string;
};

export function NewCategoryDialog({
  open,
  onCancel,
  onCreate,
}: {
  open: boolean;
  onCancel: () => void;
  onCreate: (input: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void> | void;
}) {
  const [name, setName] = useState('');
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [method, setMethod] = useState<EnrichMethod>('linkedin');
  const [espnSelection, setEspnSelection] = useState<{
    sport: EspnSport;
    team: EspnTeam;
  } | null>(null);
  const [webTeamProvider, setWebTeamProvider] = useState<WebTeamProvider>('vast');
  const [webTeamUrl, setWebTeamUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setNameManuallyEdited(false);
      setMethod('linkedin');
      setEspnSelection(null);
      setWebTeamProvider('vast');
      setWebTeamUrl('');
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  function handleEspnSelect(
    selection: { sport: EspnSport; team: EspnTeam } | null,
  ) {
    setEspnSelection(selection);
    if (selection && !nameManuallyEdited) {
      const year = new Date().getFullYear();
      setName(`${selection.team.displayName} ${year}`);
    }
  }

  const isEspn = method === 'espn_roster';
  const isWebTeamPage = method === 'web_team_page';
  const normalizedWebTeamUrl = webTeamUrl.trim();
  const webTeamUrlError = (() => {
    if (!isWebTeamPage) return '';
    const validation = validateWebTeamProviderUrl(webTeamProvider, normalizedWebTeamUrl);
    if (!validation.ok) {
      return validation.reason;
    }
    return '';
  })();
  const canSubmit = isEspn
    ? !!name.trim() && !!espnSelection && !submitting
    : isWebTeamPage
      ? !!name.trim() && !webTeamUrlError && !submitting
      : !!name.trim() && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const input: CreateInput = { name: name.trim(), enrichMethod: method };
      if (isEspn && espnSelection) {
        input.espnSport = espnSelection.sport.slug;
        input.espnLeague = espnSelection.sport.leagueSlug;
        input.espnTeamId = espnSelection.team.id;
        input.espnTeamName = espnSelection.team.displayName;
        input.espnSeason = new Date().getFullYear();
      }
      if (isWebTeamPage) {
        input.webTeamProvider = webTeamProvider;
        input.webTeamUrl = normalizedWebTeamUrl;
      }
      await onCreate(input);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Create section"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-bg p-5 shadow-xl"
      >
        <h3 className="text-lg font-semibold text-text">New section</h3>

        <div className="space-y-2">
          <label className="text-xs text-muted">Source</label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-white/5 p-3 text-sm">
            <input
              type="radio"
              name="enrichMethod"
              checked={method === 'linkedin'}
              onChange={() => setMethod('linkedin')}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-text">LinkedIn</span>
              <span className="block text-xs text-muted">
                Import a LinkedIn CSV export and enrich photos via the reknown browser extension.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-white/5 p-3 text-sm">
            <input
              type="radio"
              name="enrichMethod"
              checked={method === 'civic_reps'}
              onChange={() => setMethod('civic_reps')}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-text">Local Politicians</span>
              <span className="block text-xs text-muted">
                Enter an address or ZIP code and import your local/state/federal representatives.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-white/5 p-3 text-sm">
            <input
              type="radio"
              name="enrichMethod"
              checked={isEspn}
              onChange={() => setMethod('espn_roster')}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-text">ESPN Roster</span>
              <span className="block text-xs text-muted">
                Pick a sport and team to import the full roster with player photos from ESPN.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-white/5 p-3 text-sm">
            <input
              type="radio"
              name="enrichMethod"
              checked={isWebTeamPage}
              onChange={() => setMethod('web_team_page')}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-text">Web Team Page</span>
              <span className="block text-xs text-muted">
                Import people from a supported team page URL.
              </span>
            </span>
          </label>

          {isEspn ? (
            <div className="pl-6">
              <EspnTeamSelector onSelect={handleEspnSelect} />
            </div>
          ) : null}
          {isWebTeamPage ? (
            <div className="space-y-2 pl-6">
              <div className="space-y-1">
                <label className="text-xs text-muted" htmlFor="web-team-provider">
                  Provider
                </label>
                <select
                  id="web-team-provider"
                  className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm"
                  value={webTeamProvider}
                  onChange={(e) => setWebTeamProvider(e.target.value as WebTeamProvider)}
                >
                  {Object.entries(WEB_TEAM_PROVIDERS).map(([provider, config]) => (
                    <option key={provider} value={provider}>
                      {config.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted" htmlFor="web-team-url">
                  URL
                </label>
                <input
                  id="web-team-url"
                  type="url"
                  className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm"
                  placeholder="https://www.vastspace.com/team"
                  value={webTeamUrl}
                  onChange={(e) => setWebTeamUrl(e.target.value)}
                />
                {webTeamUrlError ? (
                  <p className="text-xs text-rose-400" role="alert">
                    {webTeamUrlError}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted">Section name</label>
          <input
            autoFocus={!isEspn}
            className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm"
            placeholder={isEspn ? 'Auto-filled from team' : 'e.g. LinkedIn, Work'}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameManuallyEdited(true);
            }}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" className="bg-white/5" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting
              ? 'Creating…'
              : isEspn
                ? 'Create & Import Roster'
                : 'Create'}
          </Button>
        </div>
      </form>
    </div>
  );
}
