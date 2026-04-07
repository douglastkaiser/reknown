// reknown — LinkedIn Photo Enricher content script
// Bridges window.postMessage <-> background script runtime messages.

(function () {
  const browserApi = globalThis.browser || globalThis.chrome;

  // Keep in sync with manifest.json content_scripts.matches.
  const ALLOWED_ORIGIN_PATTERNS = [
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    /^https:\/\/douglastkaiser\.github\.io$/,
    /^https:\/\/(www\.)?douglastkaiser\.com$/,
  ];

  function isAllowedOrigin(origin) {
    return ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
  }

  // Keep-alive ports keyed by requestId. Holding an open runtime.Port keeps
  // the non-persistent background event page alive for the entire batch.
  const keepAlivePorts = new Map(); // requestId -> Port

  function openKeepAlive(requestId) {
    if (!requestId || keepAlivePorts.has(requestId)) return;
    try {
      const port = browserApi.runtime.connect({
        name: 'reknown-enrich-batch:' + requestId,
      });
      keepAlivePorts.set(requestId, port);
      port.onDisconnect.addListener(() => {
        void browserApi.runtime.lastError;
        keepAlivePorts.delete(requestId);
      });
    } catch (err) {
      console.warn('[reknown-ext] keep-alive connect failed', err);
    }
  }

  function closeKeepAlive(requestId) {
    if (!requestId) return;
    const port = keepAlivePorts.get(requestId);
    if (!port) return;
    try { port.disconnect(); } catch { /* ignore */ }
    keepAlivePorts.delete(requestId);
  }

  // Announce presence to the page.
  function announce() {
    window.postMessage(
      { type: 'REKNOWN_EXTENSION_DETECTED', version: '1.0.0' },
      window.location.origin,
    );
  }
  announce();
  // Re-announce on focus in case the webapp mounted its listener late.
  window.addEventListener('focus', announce);

  // Page -> background
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!isAllowedOrigin(event.origin)) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'REKNOWN_ENRICH_REQUEST' || data.type === 'REKNOWN_ENRICH_CANCEL') {
      const requestId = String(data.requestId || '');
      if (data.type === 'REKNOWN_ENRICH_REQUEST') {
        // Open the keep-alive BEFORE sending the request so the background
        // event page sees an open port immediately on wake.
        openKeepAlive(requestId);
      }
      try {
        browserApi.runtime.sendMessage(data, () => {
          void browserApi.runtime.lastError;
        });
      } catch (err) {
        console.warn('[reknown-ext] content->bg sendMessage failed', err);
      }
      if (data.type === 'REKNOWN_ENRICH_CANCEL') {
        closeKeepAlive(requestId);
      }
    } else if (data.type === 'REKNOWN_EXTENSION_PING') {
      announce();
    }
  });

  // Background -> page
  browserApi.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (
      msg.type === 'REKNOWN_ENRICH_PROGRESS' ||
      msg.type === 'REKNOWN_ENRICH_COMPLETE'
    ) {
      window.postMessage(msg, window.location.origin);
      if (msg.type === 'REKNOWN_ENRICH_COMPLETE') {
        closeKeepAlive(String(msg.requestId || ''));
      }
    }
  });
})();
