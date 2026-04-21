import { useEffect, useMemo } from 'react';
import type { Person } from '../../types';
import { Button } from '../common/Button';
import { useExtensionDetection } from '../../hooks/useExtensionDetection';
import {
  usePhotoEnrichment,
  type EnrichErrorCode,
} from '../../hooks/usePhotoEnrichment';
import { detectPhotoFocus } from '../../lib/face-focus';

const ERROR_LABELS: Record<EnrichErrorCode, string> = {
  invalid_url: 'Invalid LinkedIn URL',
  no_photo_found: 'No photo found',
  default_avatar: 'Only default avatar',
  fetch_failed: 'Fetch failed',
  timeout_abort: 'Request timed out',
  network_error: 'Network error',
  http_4xx: 'Profile request returned 4xx',
  http_5xx: 'Profile request returned 5xx',
  challenge_page_detected: 'Challenge page detected',
  empty_body: 'Empty profile response body',
  parse_error: 'Failed to parse profile response',
  login_wall: 'LinkedIn login wall',
  rate_limited: 'Rate limited by LinkedIn',
  batch_already_running: 'Another enrichment batch is already running',
  'reject.owner_mismatch': 'Profile owner mismatch',
};

function formatEta(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatCooldown(minutesFromNowMs: number | undefined): string {
  if (!minutesFromNowMs || minutesFromNowMs <= 0) return 'a few minutes';
  const mins = Math.max(1, Math.ceil(minutesFromNowMs / 60000));
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

function formatFailureError(error?: string, reason?: string): string {
  const normalized = typeof error === 'string' && error.trim() ? error : 'unknown_error';
  const label = ERROR_LABELS[normalized as EnrichErrorCode] ?? normalized;
  const shouldAppendReason = !ERROR_LABELS[normalized as EnrichErrorCode] && reason;
  return shouldAppendReason ? `${label} (${reason})` : label;
}

export function EnrichPhotosPanel({
  people,
  onUpdate,
}: {
  people: Person[];
  onUpdate: (id: string, updates: Partial<Person>) => Promise<void> | void;
}) {
  const { extensionAvailable } = useExtensionDetection();
  const enrichment = usePhotoEnrichment({
    onPhotoFetched: async (id, photoDataUrl, photoUrl) => {
      const photoFocus = await detectPhotoFocus(photoDataUrl || photoUrl);
      // Persist the raw licdn URL alongside the base64 data URL when the
      // extension provides it, so the "Edit person" form has something to
      // show in the Photo URL field instead of appearing blank.
      const updates: Partial<Person> = photoUrl
        ? { photoDataUrl, photoUrl, photoFocus }
        : { photoDataUrl, photoFocus };
      return onUpdate(id, updates);
    },
  });

  const eligible = useMemo(
    () => people.filter((p) => p.linkedinUrl && !p.photoDataUrl && !p.photoUrl),
    [people],
  );
  const withLinkedinUrl = useMemo(
    () => people.filter((p) => !!p.linkedinUrl).length,
    [people],
  );
  const alreadyHavePhoto = useMemo(
    () => people.filter((p) => !!p.photoDataUrl || !!p.photoUrl).length,
    [people],
  );

  const debugStatus = (
    <p className="rounded bg-bg/50 px-2 py-1 text-[10px] font-mono text-muted">
      [Debug] extensionAvailable={String(extensionAvailable)} total={people.length}{' '}
      withLinkedinUrl={withLinkedinUrl} alreadyHavePhoto={alreadyHavePhoto}{' '}
      eligible={eligible.length} isRunning={String(enrichment.isRunning)}{' '}
      origin={typeof window !== 'undefined' ? window.location.origin : ''}
    </p>
  );

  useEffect(() => {
    console.log(
      '[reknown] EnrichPhotosPanel mounted extensionAvailable=' + extensionAvailable,
      'total=' + people.length,
      'withLinkedinUrl=' + withLinkedinUrl,
      'alreadyHavePhoto=' + alreadyHavePhoto,
      'eligible=' + eligible.length,
    );
    // Intentionally only on mount and when extensionAvailable flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensionAvailable]);

  if (!extensionAvailable) {
    return (
      <div className="card space-y-2">
        <h3 className="font-semibold">Enrich Photos from LinkedIn</h3>
        {debugStatus}
        <p className="text-sm text-muted">
          Install the reknown browser extension to automatically fetch LinkedIn
          profile photos for your connections using your own logged-in session.
        </p>
        <ul className="list-disc pl-5 text-xs text-muted">
          <li>
            <strong>Firefox:</strong> open <code>about:debugging</code> → "Load
            Temporary Add-on" → pick <code>extension/manifest.json</code>.
          </li>
          <li>
            <strong>Chrome:</strong> open <code>chrome://extensions</code> →
            enable Developer mode → "Load unpacked" → pick the{' '}
            <code>extension/</code> folder.
          </li>
        </ul>
        <p className="text-xs text-muted">
          Full instructions:{' '}
          <a
            href="https://github.com/douglastkaiser/reknown/blob/main/extension/README.md"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            extension/README.md
          </a>
          . Alternatively, you can add photos manually by editing each person
          below.
        </p>
      </div>
    );
  }

  const { isRunning, progress, results, completed, aborted } = enrichment;
  const pct =
    progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const remaining = Math.max(0, progress.total - progress.completed);
  const etaSeconds = remaining * 3;
  const failedResults = results.filter((r) => r.status === 'error');
  const cooldownRemainingMs =
    aborted?.cooldown?.cooldownRemainingMs ??
    ((aborted?.cooldown?.cooldownRemainingSeconds ?? 0) * 1000);
  const showCooldownMessage =
    aborted?.reason === 'rate_limited' &&
    typeof cooldownRemainingMs === 'number' &&
    cooldownRemainingMs > 0;

  function retryFailed() {
    const failedIds = new Set(failedResults.map((r) => r.id));
    const retryPeople = people.filter((p) => failedIds.has(p.id));
    enrichment.reset();
    enrichment.startEnrichment(retryPeople);
  }

  function scrollToImportCsv() {
    const el = document.getElementById('import-csv-toggle');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (el instanceof HTMLElement) el.focus();
  }

  function handleEnrichClick() {
    console.log(
      '[reknown] Enrich click: extensionAvailable=' + extensionAvailable,
      'total=' + people.length,
      'withLinkedinUrl=' + withLinkedinUrl,
      'alreadyHavePhoto=' + alreadyHavePhoto,
      'eligible=' + eligible.length,
      'isRunning=' + isRunning,
    );
    if (!extensionAvailable) {
      window.alert(
        'Enrich blocked: reknown extension not detected on this page.\n\n' +
          'Make sure the extension is loaded in Firefox (about:debugging) and hard-refresh this tab (Ctrl+Shift+R).',
      );
      return;
    }
    if (isRunning) {
      window.alert('Enrich blocked: an enrichment batch is already running.');
      return;
    }
    if (eligible.length === 0) {
      let reason: string;
      if (people.length === 0) {
        reason =
          "No people imported yet. This extension only fills in photos for " +
          "people already on your list — go to Import CSV above (or the About page for full instructions) first.";
      } else if (withLinkedinUrl === 0) {
        reason = 'No imported people have a LinkedIn URL. Add LinkedIn URLs first.';
      } else if (alreadyHavePhoto >= withLinkedinUrl) {
        reason = 'Everyone with a LinkedIn URL already has a photo.';
      } else {
        reason = 'No eligible people to enrich.';
      }
      window.alert(
        'Enrich blocked: ' +
          reason +
          '\n\n[Debug] total=' +
          people.length +
          ' withLinkedinUrl=' +
          withLinkedinUrl +
          ' alreadyHavePhoto=' +
          alreadyHavePhoto +
          ' eligible=' +
          eligible.length,
      );
      return;
    }
    enrichment.startEnrichment(eligible);
  }

  const subtitle =
    people.length === 0
      ? 'Import your LinkedIn CSV first — this extension fills in profile photos for people already on this list.'
      : withLinkedinUrl === 0
      ? 'No imported people have a LinkedIn URL. Edit them to add URLs, then click Enrich.'
      : `${eligible.length} ${eligible.length === 1 ? 'person has' : 'people have'} a LinkedIn URL but no photo.`;

  return (
    <div className="card space-y-3">
      {debugStatus}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Enrich Photos from LinkedIn</h3>
          <p className="text-[11px] text-muted/80">
            Uses your logged-in LinkedIn session to fetch profile photos for people you've
            already imported. It does not scrape your connections list — you import those via
            CSV first.
          </p>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        {isRunning ? (
          <Button type="button" className="bg-red-400/20" onClick={enrichment.cancelEnrichment}>
            Stop
          </Button>
        ) : people.length === 0 ? (
          <Button type="button" onClick={scrollToImportCsv}>
            Import CSV →
          </Button>
        ) : (
          <Button
            type="button"
            className={eligible.length === 0 ? 'opacity-50' : ''}
            onClick={handleEnrichClick}
          >
            Enrich {eligible.length > 0 ? `(${eligible.length})` : ''}
          </Button>
        )}
      </div>
      {showCooldownMessage ? (
        <p className="rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
          LinkedIn asked us to slow down. Please try again in{' '}
          <strong>{formatCooldown(cooldownRemainingMs)}</strong>.
        </p>
      ) : null}

      {(isRunning || completed) && progress.total > 0 ? (
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>
              {progress.completed} / {progress.total} · {progress.succeeded} ok ·{' '}
              {progress.failed} failed
            </span>
            {isRunning ? <span>ETA ~{formatEta(etaSeconds)}</span> : null}
          </div>
          {progress.currentPerson ? (
            <p className="truncate text-xs text-muted">
              Current: <span className="text-text">{progress.currentPerson}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {completed ? (
        <div className="space-y-2 rounded-lg border border-border bg-bg/50 p-3 text-xs">
          {aborted ? (
            <p className="text-red-400">
              Aborted{aborted.reason ? `: ${ERROR_LABELS[aborted.reason as EnrichErrorCode] ?? aborted.reason}` : ''}.
              Check your LinkedIn session and retry.
            </p>
          ) : (
            <p>
              Added photos for {progress.succeeded} of {progress.total} people.
              {progress.failed > 0 ? ` ${progress.failed} failed.` : ''}
            </p>
          )}
          {failedResults.length > 0 ? (
            <>
              <details>
                <summary className="cursor-pointer text-muted">
                  Show failures ({failedResults.length})
                </summary>
                <ul className="mt-2 space-y-1">
                  {failedResults.map((r) => (
                    <li key={r.id} className="text-muted">
                      {r.name || r.id}:{' '}
                      {formatFailureError(
                        r.error,
                        r.errorDetail?.reason ?? r.errorDetail?.dominantRejectReason,
                      )}
                    </li>
                  ))}
                </ul>
              </details>
              <Button type="button" onClick={retryFailed}>
                Retry failed
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
