import { useEffect, useState } from 'react';

/**
 * Listens for the REKNOWN_EXTENSION_DETECTED message posted by the
 * reknown browser extension's content script on load (and on window focus).
 * Once detected, availability is sticky for the rest of the session.
 */
export function useExtensionDetection(): { extensionAvailable: boolean } {
  const [extensionAvailable, setExtensionAvailable] = useState(false);
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
    let lastPingAt = 0;

    function shouldLogDetection(explicitReconnect: boolean): boolean {
      if (verbose || explicitReconnect) return true;
      const now = Date.now();
      if (now - lastDetectionLogAt < DETECTION_LOG_WINDOW_MS) return false;
      lastDetectionLogAt = now;
      return true;
    }

    let pingAttempt = 0;

    function markDetected(path: 'proactive' | 'pong', meta?: { version?: string; reason?: string; explicitReconnect?: boolean }) {
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
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        version?: string;
        reason?: string;
        explicitReconnect?: boolean;
      } | null;
      if (!data) return;
      if (data.type === 'REKNOWN_EXTENSION_DETECTED') {
        markDetected('proactive', data);
      }
      if (data.type === 'REKNOWN_EXTENSION_PING') {
        markDetected('pong', data);
      }
    }

    function ping(reason: 'initial' | 'focus', explicitReconnect = false) {
      pingAttempt += 1;
      const now = Date.now();
      if (!verbose && reason === 'focus') {
        if (now - lastPingAt < DETECTION_LOG_WINDOW_MS) return;
        lastPingAt = now;
      }
      console.log(
        '[reknown] extension ping',
        'attempt=' + pingAttempt,
        'reason=' + reason,
        'explicitReconnect=' + explicitReconnect,
        'ts=' + new Date(now).toISOString(),
        'elapsedMs=' + (now - startedAt),
      );
      // Ask the content script to re-announce itself.
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
    // Initial ping in case the content script loaded before this hook mounted.
    ping('initial');
    const retryInterval = window.setInterval(() => {
      if (detected) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed > 10000) {
        window.clearInterval(retryInterval);
        return;
      }
      ping('initial');
    }, 1500);
    const warnTimer = window.setTimeout(() => {
      if (!detected) {
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
      window.clearInterval(retryInterval);
    };
  }, [locationKey]);

  return { extensionAvailable };
}
