import { useCallback, useEffect, useRef, useState } from 'react';
import type { Person } from '../types';

export type EnrichErrorCode =
  | 'invalid_url'
  | 'no_photo_found'
  | 'default_avatar'
  | 'fetch_failed'
  | 'login_wall'
  | 'rate_limited';

export interface EnrichResult {
  id: string;
  name: string;
  status: 'success' | 'error';
  error?: EnrichErrorCode;
}

export interface EnrichProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentPerson: string | null;
}

export interface UsePhotoEnrichmentOptions {
  onPhotoFetched: (personId: string, photoDataUrl: string) => Promise<void> | void;
}

const INITIAL_PROGRESS: EnrichProgress = {
  total: 0,
  completed: 0,
  succeeded: 0,
  failed: 0,
  currentPerson: null,
};

export function usePhotoEnrichment({ onPhotoFetched }: UsePhotoEnrichmentOptions) {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<EnrichProgress>(INITIAL_PROGRESS);
  const [results, setResults] = useState<EnrichResult[]>([]);
  const [aborted, setAborted] = useState<{ reason?: string } | null>(null);
  const [completed, setCompleted] = useState(false);

  const requestIdRef = useRef<string | null>(null);
  const onPhotoFetchedRef = useRef(onPhotoFetched);
  useEffect(() => {
    onPhotoFetchedRef.current = onPhotoFetched;
  }, [onPhotoFetched]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as
        | {
            type?: string;
            requestId?: string;
            personId?: string;
            personName?: string;
            status?: string;
            photoDataUrl?: string;
            error?: EnrichErrorCode;
            aborted?: boolean;
            reason?: string;
            summary?: { total: number; success: number; failed: number };
          }
        | null;
      if (!data || !data.type) return;
      if (data.requestId && requestIdRef.current && data.requestId !== requestIdRef.current) {
        return;
      }
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
          const dataUrl = data.photoDataUrl;
          void Promise.resolve(onPhotoFetchedRef.current(id, dataUrl)).catch((err) =>
            console.error('[reknown] onPhotoFetched failed', err),
          );
          setResults((r) => [...r, { id, name: data.personName ?? '', status: 'success' }]);
          setProgress((p) => ({
            ...p,
            completed: p.completed + 1,
            succeeded: p.succeeded + 1,
          }));
          return;
        }
        if (data.status === 'error' && data.personId) {
          setResults((r) => [
            ...r,
            { id: data.personId!, name: data.personName ?? '', status: 'error', error: data.error },
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
        setIsRunning(false);
        setCompleted(true);
        if (data.aborted) {
          setAborted({ reason: data.reason });
        }
        requestIdRef.current = null;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const startEnrichment = useCallback((people: Person[]) => {
    const eligible = people
      .filter((p) => p.linkedinUrl && !p.photoDataUrl && !p.photoUrl)
      .map((p) => ({ id: p.id, name: p.name, linkedinUrl: p.linkedinUrl! }));
    if (eligible.length === 0) return;
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    requestIdRef.current = requestId;
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
    window.postMessage(
      { type: 'REKNOWN_ENRICH_REQUEST', requestId, people: eligible },
      window.location.origin,
    );
  }, []);

  const cancelEnrichment = useCallback(() => {
    if (!requestIdRef.current) return;
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
    progress,
    results,
    completed,
    aborted,
    startEnrichment,
    cancelEnrichment,
    reset,
  };
}
