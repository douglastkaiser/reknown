import { useEffect, useState } from 'react';

export type ExtensionUnavailableReason =
  | 'not_injected'
  | 'ping_timeout'
  | 'origin_rejected'
  | 'listener_not_ready'
  | 'manifest_mismatch'
  | 'unknown';

export type ExtensionDetectionState = {
  extensionAvailable: boolean;
  unavailableReason: ExtensionUnavailableReason;
  lastPingAt: number | null;
  lastMessageAt: number | null;
  detectedVersion: string | null;
};

/**
 * Listens for the REKNOWN_EXTENSION_DETECTED message posted by the
 * reknown browser extension's content script on load (and on window focus).
 * Once detected, availability is sticky for the rest of the session.
 */
export function useExtensionDetection(): ExtensionDetectionState {
  const [extensionAvailable, setExtensionAvailable] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<ExtensionUnavailableReason>('unknown');
  const [lastPingAt, setLastPingAt] = useState<number | null>(null);
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);
  const [detectedVersion, setDetectedVersion] = useState<string | null>(null);
  const [locationKey, setLocationKey] = useState(
    () => `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`,
  );

  useEffect(() => {
    function onLocationChange() {
      setLocationKey(
        `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
    }
    window.addEventListener('hashchange', onLocationChange);
    window.addEventListener('popstate', onLocationChange);
    return () => {
      window.removeEventListener('hashchange', onLocationChange);
      window.removeEventListener('popstate', onLocationChange);
    };
  }, []);

  useEffect(() => {
    const DETECTION_LOG_WINDOW_MS = 7000;
    const verbose =
      (window as { __REKNOWN_EXTENSION_VERBOSE__?: boolean }).__REKNOWN_EXTENSION_VERBOSE__ === true ||
      window.location.search.includes('reknownExtVerbose=1') ||
      window.localStorage.getItem('reknownExtensionVerbose') === '1' ||
      window.sessionStorage.getItem('reknownExtensionVerbose') === '1';

    const startedAt = Date.now();
    const startedIso = new Date(startedAt).toISOString();
    console.log(
      '[reknown] useExtensionDetection mounted — listener registered before ping',
      'startedAt=' + startedIso,
      'locationKey=' + locationKey,
      'verbose=' + verbose,
    );
    let detected = false;
    let lastDetectionLogAt = 0;
    let lastPingLoggedAt = 0;

    setUnavailableReason('not_injected');

    function shouldLogDetection(explicitReconnect: boolean): boolean {
      if (verbose || explicitReconnect) return true;
      const now = Date.now();
      if (now - lastDetectionLogAt < DETECTION_LOG_WINDOW_MS) return false;
      lastDetectionLogAt = now;
      return true;
    }

    let pingAttempt = 0;

    function markDetected(
      path: 'proactive' | 'pong',
      meta?: { version?: string; reason?: string; explicitReconnect?: boolean },
    ) {
      const now = Date.now();
      const explicitReconnect = meta?.explicitReconnect === true;
      if (!detected || shouldLogDetection(explicitReconnect)) {
        console.log(
          '[reknown] extension detected',
          'path=' + path,
          'attempt=' + pingAttempt,
          'ts=' + new Date(now).toISOString(),
          'elapsedMs=' + (now - startedAt),
          'version=' + (meta?.version || '?'),
          'reason=' + (meta?.reason || 'unknown'),
          'explicitReconnect=' + explicitReconnect,
        );
      }
      detected = true;
      setExtensionAvailable(true);
      setUnavailableReason('unknown');
      if (meta?.version) setDetectedVersion(meta.version);
      setLastMessageAt(now);
    }

    const KNOWN_APP_ORIGINS = new Set([
      window.location.origin,
      'https://douglastkaiser.github.io',
      'https://douglastkaiser.com',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
    function logRejected(reason: string, event: MessageEvent, data?: unknown) {
      setLastMessageAt(Date.now());
      setUnavailableReason('origin_rejected');
      console.warn('[reknown] extension_detection_rejected', {
        reason,
        origin: event.origin,
        locationOrigin: window.location.origin,
        sourceIsWindow: event.source === window,
        dataType: typeof data,
        type: data && typeof data === 'object' ? (data as { type?: unknown }).type : undefined,
      });
    }
    function onMessage(event: MessageEvent) {
      const data = event.data as {
        type?: string;
        version?: string;
        reason?: string;
        explicitReconnect?: boolean;
      } | null;
      setLastMessageAt(Date.now());
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
      if (!data.type.startsWith('REKNOWN_EXTENSION_')) {
        logRejected('type_unexpected', event, data);
        return;
      }
      if (data.type === 'REKNOWN_EXTENSION_DETECTED') {
        if (typeof data.version !== 'string' || !data.version) {
          setUnavailableReason('manifest_mismatch');
          logRejected('version_missing', event, data);
          return;
        }
        markDetected('proactive', data);
      }
      if (data.type === 'REKNOWN_EXTENSION_PING') {
        markDetected('pong', data);
      }
    }

    function ping(reason: 'initial' | 'focus', explicitReconnect = false) {
      pingAttempt += 1;
      const now = Date.now();
      setLastPingAt(now);
      if (!verbose && reason === 'focus') {
        if (now - lastPingLoggedAt < DETECTION_LOG_WINDOW_MS) return;
        lastPingLoggedAt = now;
      }
      console.log(
        '[reknown] extension ping',
        'attempt=' + pingAttempt,
        'reason=' + reason,
        'explicitReconnect=' + explicitReconnect,
        'ts=' + new Date(now).toISOString(),
        'elapsedMs=' + (now - startedAt),
      );
      window.postMessage(
        { type: 'REKNOWN_EXTENSION_PING', reason, explicitReconnect },
        window.location.origin,
      );
    }

    function pingOnFocus() {
      ping('focus');
    }
    window.addEventListener('message', onMessage);
    window.addEventListener('focus', pingOnFocus);
    ping('initial');
    const retryInterval = window.setInterval(() => {
      if (detected) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed > 10000) {
        setUnavailableReason('ping_timeout');
        window.clearInterval(retryInterval);
        return;
      }
      ping('initial');
    }, 1500);
    const listenerReadyTimer = window.setTimeout(() => {
      if (!detected && pingAttempt > 0) {
        setUnavailableReason('listener_not_ready');
      }
    }, 1000);
    const warnTimer = window.setTimeout(() => {
      if (!detected) {
        setUnavailableReason('ping_timeout');
        console.warn(
          '[reknown] WARNING: extension not detected after 3s — content script may not be injected on this origin:',
          window.location.origin,
          '— If using Firefox temporary add-on, hard-refresh this tab (Ctrl+Shift+R) after loading/reloading the extension.',
        );
      }
    }, 3000);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('focus', pingOnFocus);
      window.clearTimeout(warnTimer);
      window.clearTimeout(listenerReadyTimer);
      window.clearInterval(retryInterval);
    };
  }, [locationKey]);

  return { extensionAvailable, unavailableReason, lastPingAt, lastMessageAt, detectedVersion };
}
