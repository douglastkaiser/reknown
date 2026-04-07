import { useEffect, useState } from 'react';

/**
 * Listens for the REKNOWN_EXTENSION_DETECTED message posted by the
 * reknown browser extension's content script on load (and on window focus).
 * Once detected, availability is sticky for the rest of the session.
 */
export function useExtensionDetection(): { extensionAvailable: boolean } {
  const [extensionAvailable, setExtensionAvailable] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string } | null;
      if (data && data.type === 'REKNOWN_EXTENSION_DETECTED') {
        setExtensionAvailable(true);
      }
    }
    function pingOnFocus() {
      // Ask the content script to re-announce itself.
      window.postMessage({ type: 'REKNOWN_EXTENSION_PING' }, window.location.origin);
    }
    window.addEventListener('message', onMessage);
    window.addEventListener('focus', pingOnFocus);
    // Initial ping in case the content script loaded before this hook mounted.
    pingOnFocus();
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('focus', pingOnFocus);
    };
  }, []);

  return { extensionAvailable };
}
