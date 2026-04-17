// reknown — LinkedIn Photo Enricher content script
// Bridges window.postMessage <-> background script runtime messages.

(function () {
  const browserApi = globalThis.browser || globalThis.chrome;

  console.log(
    '[reknown-ext] content-script loaded on',
    window.location.origin,
    'URL=' + window.location.href,
    'readyState=' + document.readyState,
    'runtimeId=' + (browserApi && browserApi.runtime && browserApi.runtime.id),
  );

  // Per-requestId tally of progress events forwarded to the page. Helps us
  // confirm the bridge is flowing even when the page isn't updating.
  const progressCounts = new Map(); // requestId -> { started, success, error, batch_pause, complete }

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

  // Single source of truth for the extension version: the manifest. Hard-coded
  // literals here drift from manifest.json silently, so pull it at runtime.
  const EXT_VERSION = browserApi.runtime.getManifest().version;

  // Announce presence to the page.
  function announce() {
    console.log('[reknown-ext] announcing REKNOWN_EXTENSION_DETECTED v' + EXT_VERSION);
    window.postMessage(
      { type: 'REKNOWN_EXTENSION_DETECTED', version: EXT_VERSION },
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
        'windowOrigin=' + window.location.origin,
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
        browserApi.runtime.sendMessage(data, (response) => {
          const lastErr = browserApi.runtime.lastError;
          if (lastErr) {
            console.warn(
              '[reknown-ext] content->bg sendMessage lastError',
              'type=' + type,
              'requestId=' + requestId,
              'msg=' + lastErr.message,
            );
            if (type === 'REKNOWN_ENRICH_REQUEST') closeKeepAlive(requestId);
            return;
          }
          if (type === 'REKNOWN_ENRICH_REQUEST' && response && response.ok === false) {
            console.warn(
              '[reknown-ext] background rejected REKNOWN_ENRICH_REQUEST',
              'requestId=' + requestId,
              'error=' + (response.error || 'unknown'),
              'activeRequestIds=' + JSON.stringify(response.activeRequestIds || []),
            );
            closeKeepAlive(requestId);
            window.postMessage(
              {
                type: 'REKNOWN_ENRICH_REJECTED',
                requestId,
                error: response.error || 'unknown',
                activeRequestIds: Array.isArray(response.activeRequestIds)
                  ? response.activeRequestIds
                  : [],
              },
              window.location.origin,
            );
          }
        });
        console.log('[reknown-ext] forwarded', type, 'to background requestId=' + requestId);
      } catch (err) {
        console.warn('[reknown-ext] content->bg sendMessage threw', err);
      }
      if (type === 'REKNOWN_ENRICH_CANCEL') {
        if (!keepAlivePorts.has(requestId)) {
          console.warn(
            '[reknown-ext] REKNOWN_ENRICH_CANCEL for unknown requestId — no open keep-alive port',
            'requestId=' + requestId,
            'openPorts=' + Array.from(keepAlivePorts.keys()).join(','),
          );
        }
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
      const requestId = String(msg.requestId || '');
      // Bucket progress events per requestId for end-of-batch summary.
      if (requestId) {
        let counts = progressCounts.get(requestId);
        if (!counts) {
          counts = { started: 0, success: 0, error: 0, batch_pause: 0, complete: 0, other: 0 };
          progressCounts.set(requestId, counts);
        }
        const bucket = msg.type === 'REKNOWN_ENRICH_COMPLETE'
          ? 'complete'
          : (counts.hasOwnProperty(msg.status) ? msg.status : 'other');
        counts[bucket]++;
      }
      console.log(
        '[reknown-ext] forwarding',
        msg.type,
        'to page status=' + (msg.status || '') + ' personId=' + (msg.personId || ''),
        'hasPhotoDataUrl=' + !!msg.photoDataUrl,
        'photoDataUrlLen=' + (msg.photoDataUrl ? msg.photoDataUrl.length : 0),
        'aborted=' + (msg.aborted === true),
        'error=' + (msg.error || ''),
      );
      try {
        window.postMessage(msg, window.location.origin);
      } catch (err) {
        console.warn(
          '[reknown-ext] window.postMessage threw',
          'type=' + msg.type,
          'err=' + String(err),
        );
      }
      if (msg.type === 'REKNOWN_ENRICH_COMPLETE') {
        const counts = progressCounts.get(requestId);
        console.log(
          '[reknown-ext] batch summary requestId=' + requestId,
          'counts=' + JSON.stringify(counts || null),
          'summary=' + JSON.stringify(msg.summary || null),
        );
        progressCounts.delete(requestId);
        closeKeepAlive(requestId);
      }
    }
  });
})();
