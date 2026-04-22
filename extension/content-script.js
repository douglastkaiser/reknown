// reknown — LinkedIn Photo Enricher content script
// Bridges window.postMessage <-> background script runtime messages.

(function () {
  const browserApi = globalThis.browser || globalThis.chrome;
  const DETECT_LOG_WINDOW_MS = 7000;
  const verbose = (() => {
    try {
      if (globalThis.__REKNOWN_EXTENSION_VERBOSE__ === true) return true;
      if (window.location.search.includes('reknownExtVerbose=1')) return true;
      if (window.localStorage.getItem('reknownExtensionVerbose') === '1') return true;
      if (window.sessionStorage.getItem('reknownExtensionVerbose') === '1') return true;
    } catch {
      // noop
    }
    return false;
  })();
  let hasAnnouncedDetection = false;
  let lastDetectLogAt = 0;

  console.log(
    '[reknown-ext] content-script loaded on',
    window.location.origin,
    'URL=' + window.location.href,
    'readyState=' + document.readyState,
    'runtimeId=' + (browserApi && browserApi.runtime && browserApi.runtime.id),
    'verbose=' + verbose,
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
  function logDetection(message, details) {
    const now = Date.now();
    if (!verbose && now - lastDetectLogAt < DETECT_LOG_WINDOW_MS) return;
    lastDetectLogAt = now;
    console.log(message, details || '');
  }

  function announce(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const reason = typeof opts.reason === 'string' ? opts.reason : 'unspecified';
    const explicitReconnect = opts.explicitReconnect === true;
    if (explicitReconnect) {
      hasAnnouncedDetection = false;
    }
    if (hasAnnouncedDetection && !verbose) {
      return;
    }
    logDetection('[reknown-ext] announcing REKNOWN_EXTENSION_DETECTED v' + EXT_VERSION, 'reason=' + reason);
    window.postMessage(
      {
        type: 'REKNOWN_EXTENSION_DETECTED',
        version: EXT_VERSION,
        reason,
        explicitReconnect,
      },
      window.location.origin,
    );
    hasAnnouncedDetection = true;
  }
  announce({ reason: 'content-script-load' });
  // Re-announce on focus in case the webapp mounted its listener late.
  window.addEventListener('focus', () => announce({ reason: 'window-focus' }));

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
    if (
      type === 'REKNOWN_ENRICH_REQUEST' ||
      type === 'REKNOWN_ENRICH_CANCEL' ||
      type === 'REKNOWN_ENRICH_GET_PROFILE' ||
      type === 'REKNOWN_ENRICH_SET_PROFILE'
    ) {
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
                cooldown:
                  response.cooldown && typeof response.cooldown === 'object'
                    ? response.cooldown
                    : undefined,
              },
              window.location.origin,
            );
          }
          if (type === 'REKNOWN_ENRICH_GET_PROFILE' || type === 'REKNOWN_ENRICH_SET_PROFILE') {
            window.postMessage(
              {
                type: 'REKNOWN_ENRICH_PROFILE',
                ok: !!(response && response.ok),
                requestId,
                action: type === 'REKNOWN_ENRICH_SET_PROFILE' ? 'set' : 'get',
                profile: response && response.profile ? response.profile : undefined,
                config: response && response.config ? response.config : undefined,
                persisted: response && response.persisted === true,
                error: response && response.error ? response.error : undefined,
                detail: response && response.detail ? response.detail : undefined,
                activeRequestIds:
                  response && Array.isArray(response.activeRequestIds)
                    ? response.activeRequestIds
                    : undefined,
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
        console.warn(
          '[reknown-ext] REKNOWN_ENRICH_CANCEL received in content-script',
          'requestId=' + requestId,
          'origin=' + event.origin,
          'href=' + window.location.href,
          'keepAliveOpen=' + keepAlivePorts.has(requestId),
          'openPorts=' + Array.from(keepAlivePorts.keys()).join(','),
        );
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
      const explicitReconnect =
        data.explicitReconnect === true ||
        data.reconnect === true ||
        data.force === true;
      announce({
        reason: explicitReconnect ? 'explicit-reconnect' : 'page-ping',
        explicitReconnect,
      });
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
        'intendedPersonId=' + (msg.intendedPersonId || ''),
        'slug=' + (msg.slug || ''),
        'photoSha256Prefix=' + (msg.photoSha256Prefix || ''),
        'hasPhotoDataUrl=' + !!msg.photoDataUrl,
        'photoDataUrlLen=' + (msg.photoDataUrl ? msg.photoDataUrl.length : 0),
        'selectedUrlFingerprint=' + (msg.selectedUrlFingerprint || ''),
        'aborted=' + (msg.aborted === true),
        'error=' + (typeof msg.error === 'undefined' ? '' : JSON.stringify(msg.error)),
      );
      try {
        // Forward the runtime message payload as-is (including rich `error`
        // objects) so the page can branch on detailed reason codes.
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
