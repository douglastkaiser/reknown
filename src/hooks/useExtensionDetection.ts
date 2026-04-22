import { useEffect, useState } from 'react';

/**
 * Listens for the REKNOWN_EXTENSION_DETECTED message posted by the
 * reknown browser extension's content script on load (and on window focus).
 * Once detected, availability is sticky for the rest of the session.
 */
export function useExtensionDetection(): { extensionAvailable: boolean } {
  const [extensionAvailable, setExtensionAvailable] = useState(false);

  useEffect(() => {
    const DETECTION_LOG_WINDOW_MS = 7000;
    const verbose =
      (window as { __REKNOWN_EXTENSION_VERBOSE__?: boolean }).__REKNOWN_EXTENSION_VERBOSE__ === true ||
      window.location.search.includes('reknownExtVerbose=1') ||
      window.localStorage.getItem('reknownExtensionVerbose') === '1' ||
      window.sessionStorage.getItem('reknownExtensionVerbose') === '1';

    console.log('[reknown] useExtensionDetection mounted — sending ping', 'verbose=' + verbose);
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

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        version?: string;
        reason?: string;
        explicitReconnect?: boolean;
      } | null;
      if (data && data.type === 'REKNOWN_EXTENSION_DETECTED') {
        const explicitReconnect = data.explicitReconnect === true;
        if (!detected || shouldLogDetection(explicitReconnect)) {
          console.log(
            '[reknown] extension detected v' + (data.version || '?'),
            'reason=' + (data.reason || 'unknown'),
            'explicitReconnect=' + explicitReconnect,
          );
        }
        detected = true;
        setExtensionAvailable((previous) => previous || true);
      }
    }

    function ping(reason: 'initial' | 'focus', explicitReconnect = false) {
      if (!verbose && reason === 'focus') {
        const now = Date.now();
        if (now - lastPingAt < DETECTION_LOG_WINDOW_MS) return;
        lastPingAt = now;
      }
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
    };
  }, []);

  return { extensionAvailable };
}
