// reknown — LinkedIn Photo Enricher content script
// Bridges window.postMessage <-> background script runtime messages.

(function () {
  const browserApi = globalThis.browser || globalThis.chrome;

  console.log(
    '[reknown-ext] content-script loaded on',
    window.location.origin,
    'URL=' + window.location.href,
  );

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
      console.log('[reknown-ext] keep-alive connected', port.name);
      port.onDisconnect.addListener(() => {
        void browserApi.runtime.lastError;
        keepAlivePorts.delete(requestId);
        console.log('[reknown-ext] keep-alive disconnected', 'reknown-enrich-batch:' + requestId);
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
    console.log('[reknown-ext] announcing REKNOWN_EXTENSION_DETECTED v1.0.0');
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
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    const type = typeof data.type === 'string' ? data.type : '';
    if (!type.startsWith('REKNOWN_')) return;
    if (!isAllowedOrigin(event.origin)) {
      console.warn(
        '[reknown-ext] IGNORED message',
        type,
        'from disallowed origin',
        event.origin,
        '— expected one of localhost/127.0.0.1/douglastkaiser.github.io/douglastkaiser.com',
      );
      return;
    }
    console.log('[reknown-ext] content-script received', type, 'requestId=' + (data.requestId || ''));
    if (type === 'REKNOWN_ENRICH_REQUEST' || type === 'REKNOWN_ENRICH_CANCEL') {
      const requestId = String(data.requestId || '');
      if (type === 'REKNOWN_ENRICH_REQUEST') {
        // Open the keep-alive BEFORE sending the request so the background
        // event page sees an open port immediately on wake.
        openKeepAlive(requestId);
      }
      try {
        browserApi.runtime.sendMessage(data, () => {
          void browserApi.runtime.lastError;
        });
        console.log('[reknown-ext] forwarded', type, 'to background requestId=' + requestId);
      } catch (err) {
        console.warn('[reknown-ext] content->bg sendMessage failed', err);
      }
      if (type === 'REKNOWN_ENRICH_CANCEL') {
        closeKeepAlive(requestId);
      }
    } else if (type === 'REKNOWN_EXTENSION_PING') {
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
      console.log(
        '[reknown-ext] forwarding',
        msg.type,
        'to page status=' + (msg.status || '') + ' personId=' + (msg.personId || ''),
      );
      window.postMessage(msg, window.location.origin);
      if (msg.type === 'REKNOWN_ENRICH_COMPLETE') {
        closeKeepAlive(String(msg.requestId || ''));
      }
    }
  });
})();
