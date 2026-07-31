import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PHOTO_INTEGRITY_LEGACY_SPEC,
  PHOTO_INTEGRITY_SPEC_V1,
  computeDataUrlSha256PrefixBySpec,
  matchesPhotoIntegritySpec,
  type PhotoIntegritySpec,
} from '../lib/photo-integrity';
import type { Person } from '../types';
import { needsProfileEnrichment } from '../lib/profile-enrichment';

export type EnrichErrorCode =
  | 'invalid_url'
  | 'no_photo_found'
  | 'default_avatar'
  | 'fetch_failed'
  | 'timeout_abort'
  | 'network_error'
  | 'http_4xx'
  | 'http_5xx'
  | 'challenge_page_detected'
  | 'empty_body'
  | 'parse_error'
  | 'login_wall'
  | 'rate_limited'
  | 'account_activity_warning'
  | 'batch_already_running'
  | 'reject.owner_mismatch'
  | 'owner_mismatch_stable';

export type EnrichMode = 'fill' | 'recheck';

export interface EnrichCooldown {
  cooldownUntil?: number | null;
  cooldownRemainingMs?: number;
  cooldownRemainingSeconds?: number;
}

export interface EnrichResult {
  id: string;
  name: string;
  status: 'success' | 'error';
  error?: EnrichErrorCode | string;
  errorDetail?: {
    reason?: string;
    dominantRejectReason?: string;
  };
}

export interface EnrichProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentPerson: string | null;
}

export interface EnrichAbortState {
  reason?: string;
  cooldown?: EnrichCooldown;
}

export interface UsePhotoEnrichmentOptions {
  onPhotoFetched: (
    personId: string,
    photoDataUrl: string,
    photoUrl?: string,
    companies?: string[],
  ) => Promise<void> | void;
  /**
   * Called when the extension scraped a work history but no photo was applied
   * (e.g. the profile only had a default avatar). Lets company capture happen
   * even when photo enrichment fails. On a photo success the companies ride
   * along `onPhotoFetched` instead, so this fires at most once per person and
   * never races the photo update.
   */
  onCompaniesFetched?: (
    personId: string,
    companies: string[],
  ) => Promise<void> | void;
}

const INITIAL_PROGRESS: EnrichProgress = {
  total: 0,
  completed: 0,
  succeeded: 0,
  failed: 0,
  currentPerson: null,
};

// Normalize the scraped-companies field off an incoming enrich message into a
// clean list of non-empty strings.
function readCompanies(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
}

function normalizeEnrichError(
  error: unknown,
): Pick<EnrichResult, 'error' | 'errorDetail'> {
  if (typeof error === 'string') {
    return { error };
  }
  if (error && typeof error === 'object') {
    const errorObject = error as {
      code?: unknown;
      reason?: unknown;
      dominantRejectReason?: unknown;
    };
    const errorCode =
      typeof errorObject.code === 'string' && errorObject.code.trim()
        ? errorObject.code
        : 'unknown_error';
    const errorDetail: EnrichResult['errorDetail'] = {
      reason: typeof errorObject.reason === 'string' ? errorObject.reason : undefined,
      dominantRejectReason:
        typeof errorObject.dominantRejectReason === 'string'
          ? errorObject.dominantRejectReason
          : undefined,
    };
    const hasErrorDetail = !!(errorDetail.reason || errorDetail.dominantRejectReason);
    return hasErrorDetail ? { error: errorCode, errorDetail } : { error: errorCode };
  }
  return { error: 'unknown_error' };
}


function resolveIntegritySpecFromPayload(payload: {
  photoHashAlgorithm?: string;
  photoHashInput?: string;
  photoHashPrefixLen?: number;
}): { spec: PhotoIntegritySpec; isLegacyPayload: boolean } {
  const payloadSpec: Partial<PhotoIntegritySpec> = {
    photoHashAlgorithm: payload.photoHashAlgorithm as PhotoIntegritySpec['photoHashAlgorithm'] | undefined,
    photoHashInput: payload.photoHashInput as PhotoIntegritySpec['photoHashInput'] | undefined,
    photoHashPrefixLen: payload.photoHashPrefixLen,
  };
  const hasAnyMetadata =
    typeof payload.photoHashAlgorithm === 'string' ||
    typeof payload.photoHashInput === 'string' ||
    typeof payload.photoHashPrefixLen === 'number';

  if (!hasAnyMetadata) {
    return { spec: PHOTO_INTEGRITY_LEGACY_SPEC, isLegacyPayload: true };
  }

  if (!matchesPhotoIntegritySpec(payloadSpec)) {
    console.warn('[reknown] integrity_metadata_mismatch', {
      expected: PHOTO_INTEGRITY_SPEC_V1,
      received: payloadSpec,
    });
  }

  if (
    payloadSpec.photoHashAlgorithm === 'sha256' &&
    (payloadSpec.photoHashInput === 'data_url_utf8' || payloadSpec.photoHashInput === 'decoded_bytes') &&
    typeof payloadSpec.photoHashPrefixLen === 'number'
  ) {
    return { spec: payloadSpec as PhotoIntegritySpec, isLegacyPayload: false };
  }

  return { spec: PHOTO_INTEGRITY_SPEC_V1, isLegacyPayload: false };
}

export function usePhotoEnrichment({
  onPhotoFetched,
  onCompaniesFetched,
}: UsePhotoEnrichmentOptions) {
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState<EnrichMode>('fill');
  const [progress, setProgress] = useState<EnrichProgress>(INITIAL_PROGRESS);
  const [results, setResults] = useState<EnrichResult[]>([]);
  const [aborted, setAborted] = useState<EnrichAbortState | null>(null);
  const [completed, setCompleted] = useState(false);

  const requestIdRef = useRef<string | null>(null);
  const onPhotoFetchedRef = useRef(onPhotoFetched);
  const onCompaniesFetchedRef = useRef(onCompaniesFetched);
  useEffect(() => {
    onPhotoFetchedRef.current = onPhotoFetched;
  }, [onPhotoFetched]);
  useEffect(() => {
    onCompaniesFetchedRef.current = onCompaniesFetched;
  }, [onCompaniesFetched]);

  useEffect(() => {
    const KNOWN_APP_ORIGINS = new Set([
      window.location.origin,
      'https://douglastkaiser.github.io',
      'https://douglastkaiser.com',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
    const EXPECTED_TYPES = new Set([
      'REKNOWN_ENRICH_PROGRESS',
      'REKNOWN_ENRICH_COMPLETE',
      'REKNOWN_ENRICH_REJECTED',
      'REKNOWN_ENRICH_PROFILE',
    ]);
    function logRejected(reason: string, event: MessageEvent, data?: unknown) {
      console.warn('[reknown] enrich_message_rejected', {
        reason,
        origin: event.origin,
        locationOrigin: window.location.origin,
        sourceIsWindow: event.source === window,
        dataType: typeof data,
        type: data && typeof data === 'object' ? (data as { type?: unknown }).type : undefined,
      });
    }
    function onMessage(event: MessageEvent) {
      const data = event.data as
        | {
            type?: string;
            version?: string;
            requestId?: string;
            personId?: string;
            personName?: string;
            status?: string;
            photoDataUrl?: string;
            photoUrl?: string;
            companies?: string[];
            intendedPersonId?: string | null;
            slug?: string | null;
            photoSha256Prefix?: string | null;
            photoHashAlgorithm?: string;
            photoHashInput?: string;
            photoHashPrefixLen?: number;
            photoDataUrlLen?: number;
            selectedUrlFingerprint?: string | null;
            error?:
              | EnrichErrorCode
              | string
              | {
                  code?: string;
                  reason?: string;
                  dominantRejectReason?: string;
                };
            errorCode?: string;
            aborted?: boolean;
            reason?: string;
            summary?: { total: number; success: number; failed: number };
            activeRequestIds?: string[];
            cooldown?: EnrichCooldown;
          }
        | null;
      if (event.source !== window) {
        logRejected('source_mismatch', event, data);
        return;
      }
      if (!KNOWN_APP_ORIGINS.has(event.origin)) {
        logRejected('origin_mismatch', event, data);
        return;
      }
      if (!data || typeof data !== 'object') {
        logRejected('data_missing_or_invalid', event, data);
        return;
      }
      if (typeof data.type !== 'string' || !data.type) {
        logRejected('type_missing', event, data);
        return;
      }
      if (!EXPECTED_TYPES.has(data.type)) {
        logRejected('type_unexpected', event, data);
        return;
      }
      if (typeof data.version !== 'undefined' && typeof data.version !== 'string') {
        logRejected('version_invalid', event, data);
        return;
      }
      if (data.requestId && requestIdRef.current && data.requestId !== requestIdRef.current) {
        console.log(
          '[reknown] ignored',
          data.type,
          'requestId mismatch got=' + data.requestId,
          'expected=' + requestIdRef.current,
        );
        return;
      }
      console.log(
        '[reknown] received',
        data.type,
        'status=' + (data.status || ''),
        'personId=' + (data.personId || ''),
        'personName=' + (data.personName || ''),
        'intendedPersonId=' + (data.intendedPersonId || ''),
        'slug=' + (data.slug || ''),
        'photoSha256Prefix=' + (data.photoSha256Prefix || ''),
        'photoDataUrlLen=' + (typeof data.photoDataUrlLen === 'number' ? data.photoDataUrlLen : 0),
        'selectedUrlFingerprint=' + (data.selectedUrlFingerprint || ''),
      );
      if (data.type === 'REKNOWN_ENRICH_PROGRESS') {
        if (data.status === 'started') {
          setProgress((p) => ({ ...p, currentPerson: data.personName ?? null }));
          return;
        }
        if (data.status === 'batch_pause') {
          setProgress((p) => ({ ...p, currentPerson: 'Pausing to avoid rate limits…' }));
          return;
        }
        if (data.status === 'success' && data.personId && data.photoDataUrl) {
          const id = data.personId;
          const intendedPersonId = data.intendedPersonId ?? null;
          const dataUrl = data.photoDataUrl;
          const rawUrl = data.photoUrl;
          const photoDataUrlLen = typeof data.photoDataUrlLen === 'number' ? data.photoDataUrlLen : 0;
          const lengthMatches = dataUrl.length === photoDataUrlLen;
          const { spec: integritySpec, isLegacyPayload } = resolveIntegritySpecFromPayload(data);

          if (isLegacyPayload) {
            console.warn('[reknown] integrity_metadata_deprecated_missing', {
              expected: PHOTO_INTEGRITY_SPEC_V1,
              fallback: PHOTO_INTEGRITY_LEGACY_SPEC,
            });
          }

          void computeDataUrlSha256PrefixBySpec(dataUrl, integritySpec).then((computedPrefix) => {
            const expectedPrefix = data.photoSha256Prefix ?? null;
            const hashMatches =
              expectedPrefix === null ? computedPrefix === null : expectedPrefix === computedPrefix;
            const personMatches = intendedPersonId !== null && id === intendedPersonId;
            console.log(
              '[reknown] received REKNOWN_ENRICH_PROGRESS',
              'receivedPersonId=' + id,
              'intendedPersonId=' + (intendedPersonId || ''),
              'slug=' + (data.slug || ''),
              'photoSha256Prefix=' + (data.photoSha256Prefix || ''),
              'photoHashAlgorithm=' + (data.photoHashAlgorithm || ''),
              'photoHashInput=' + (data.photoHashInput || ''),
              'photoHashPrefixLen=' + (typeof data.photoHashPrefixLen === 'number' ? data.photoHashPrefixLen : 0),
              'photoDataUrlLen=' + photoDataUrlLen,
              'selectedUrlFingerprint=' + (data.selectedUrlFingerprint || ''),
              'lengthMatches=' + lengthMatches,
              'hashMatches=' + hashMatches,
            );
            if (!personMatches || !lengthMatches || !hashMatches) {
              console.error('[reknown] message_integrity_error', {
                sourcePersonId: intendedPersonId,
                destinationPersonId: id,
                lengthMatches,
                hashMatches,
                expectedPhotoSha256Prefix: expectedPrefix,
                computedPhotoSha256Prefix: computedPrefix,
                integritySpec,
              });
            }
          });
          const scrapedCompanies = readCompanies(data.companies);
          void Promise.resolve(
            onPhotoFetchedRef.current(
              id,
              dataUrl,
              rawUrl,
              Array.isArray(data.companies) ? scrapedCompanies : undefined,
            ),
          ).catch((err) => console.error('[reknown] onPhotoFetched failed', err));
          setResults((r) => [...r, { id, name: data.personName ?? '', status: 'success' }]);
          setProgress((p) => ({
            ...p,
            completed: p.completed + 1,
            succeeded: p.succeeded + 1,
          }));
          return;
        }
        if (data.status === 'error' && data.personId) {
          // The photo failed, but if we still scraped a work history, capture
          // it. onPhotoFetched won't fire here, so this is the only path.
          const scrapedCompanies = readCompanies(data.companies);
          if (Array.isArray(data.companies) && onCompaniesFetchedRef.current) {
            void Promise.resolve(
              onCompaniesFetchedRef.current(data.personId, scrapedCompanies),
            ).catch((err) => console.error('[reknown] onCompaniesFetched failed', err));
          }
          const normalized =
            typeof data.errorCode === 'string' && data.errorCode.trim()
              ? {
                  error: data.errorCode,
                  errorDetail:
                    data.error && typeof data.error === 'object'
                      ? normalizeEnrichError(data.error).errorDetail
                      : undefined,
                }
              : normalizeEnrichError(data.error);
          setResults((r) => [
            ...r,
            {
              id: data.personId!,
              name: data.personName ?? '',
              status: 'error',
              error: normalized.error,
              errorDetail: normalized.errorDetail,
            },
          ]);
          setProgress((p) => ({
            ...p,
            completed: p.completed + 1,
            failed: p.failed + 1,
          }));
          return;
        }
      }
      if (data.type === 'REKNOWN_ENRICH_COMPLETE') {
        console.log(
          '[reknown] ENRICH_COMPLETE aborted=' + !!data.aborted,
          'reason=' + (data.reason || ''),
          'summary=' + JSON.stringify(data.summary || {}),
          'activeRequestId=' + (requestIdRef.current || ''),
        );
        setIsRunning(false);
        setCompleted(true);
        if (data.aborted) {
          setAborted({ reason: data.reason, cooldown: data.cooldown });
        }
        requestIdRef.current = null;
        return;
      }
      if (data.type === 'REKNOWN_ENRICH_REJECTED') {
        console.warn(
          '[reknown] ENRICH_REJECTED requestId=' + (data.requestId || ''),
          'error=' + (typeof data.error === 'string' ? data.error : JSON.stringify(data.error || {})),
          'activeRequestIds=' + JSON.stringify(data.activeRequestIds || []),
        );
        const normalized = normalizeEnrichError(data.error);
        setIsRunning(false);
        setCompleted(true);
        setAborted({ reason: normalized.error || 'unknown_error', cooldown: data.cooldown });
        requestIdRef.current = null;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const startEnrichment = useCallback((people: Person[], options?: { mode?: EnrichMode }) => {
    const mode: EnrichMode = options?.mode ?? 'fill';
    console.log('[reknown] startEnrichment called with', people.length, 'people', 'mode=' + mode);
    // In `fill` mode fetch profiles missing any currently supported enriched
    // field. This also upgrades people enriched before company history existed.
    // In `recheck` mode we re-fetch for everyone with a LinkedIn URL, so a
    // wrong photo saved by an older extension version gets overwritten with a
    // freshly-disambiguated one.
    const eligible = people
      .filter((p) => p.linkedinUrl && (mode === 'recheck' || needsProfileEnrichment(p)))
      .map((p) => ({ id: p.id, name: p.name, linkedinUrl: p.linkedinUrl! }));
    console.log('[reknown] startEnrichment eligible after filter=' + eligible.length);
    if (eligible.length === 0) {
      console.warn('[reknown] startEnrichment: 0 eligible people, aborting');
      return;
    }
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    requestIdRef.current = requestId;
    setMode(mode);
    setIsRunning(true);
    setCompleted(false);
    setAborted(null);
    setResults([]);
    setProgress({
      total: eligible.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      currentPerson: null,
    });
    console.log(
      '[reknown] startEnrichment posting REKNOWN_ENRICH_REQUEST requestId=' + requestId,
      'count=' + eligible.length,
      'mode=' + mode,
      'origin=' + window.location.origin,
    );
    window.postMessage(
      { type: 'REKNOWN_ENRICH_REQUEST', requestId, people: eligible, force: mode === 'recheck' },
      window.location.origin,
    );
    console.log('[reknown] startEnrichment postMessage returned');
  }, []);

  const cancelEnrichment = useCallback(() => {
    if (!requestIdRef.current) return;
    console.warn(
      '[reknown] cancelEnrichment requested requestId=' + requestIdRef.current,
      'origin=' + window.location.origin,
      'href=' + window.location.href,
    );
    console.trace('[reknown] cancelEnrichment callsite');
    window.postMessage(
      { type: 'REKNOWN_ENRICH_CANCEL', requestId: requestIdRef.current },
      window.location.origin,
    );
  }, []);

  const reset = useCallback(() => {
    setProgress(INITIAL_PROGRESS);
    setResults([]);
    setCompleted(false);
    setAborted(null);
  }, []);

  return {
    isRunning,
    mode,
    progress,
    results,
    completed,
    aborted,
    startEnrichment,
    cancelEnrichment,
    reset,
  };
}
