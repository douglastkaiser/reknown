// reknown — LinkedIn Photo Enricher background script
// Manifest V2, plain JS, no dependencies.

const browserApi = globalThis.browser || globalThis.chrome;

// Single source of truth for the extension version: the manifest.
const EXT_VERSION = browserApi.runtime.getManifest().version;
const THROTTLE_STORAGE_KEY = 'reknownEnrichThrottleProfile';
const DEBUG_CONFIG_STORAGE_KEY = 'reknownEnrichDebugConfig';
const THROTTLE_PROFILES = {
  normal: {
    perRequestMinMs: 2000,
    perRequestJitterMs: 2000,
    batchSize: 25,
    batchPauseMs: 30000,
    rateLimitCooldownMs: 20 * 60 * 1000,
  },
  // Default for LinkedIn enrichment: slower cadence lowers risk of authwall /
  // anti-automation responses during long runs.
  safe: {
    perRequestMinMs: 4000,
    perRequestJitterMs: 3000,
    batchSize: 12,
    batchPauseMs: 60000,
    rateLimitCooldownMs: 20 * 60 * 1000,
  },
};
const DEFAULT_THROTTLE_PROFILE = 'safe';

// Startup environment snapshot: confirms we're running in the expected
// browser with the expected feature set (createImageBitmap, OffscreenCanvas,
// FileReader). If any of these are missing, the resize/data-url path
// silently falls back and it's useful to see that in the first log line.
console.log(
  '[reknown-ext] background startup',
  'version=' + EXT_VERSION,
  'runtimeId=' + browserApi.runtime.id,
  'hasCreateImageBitmap=' + (typeof createImageBitmap),
  'hasOffscreenCanvas=' + (typeof OffscreenCanvas),
  'hasFileReader=' + (typeof FileReader),
  'hasFetch=' + (typeof fetch),
  'ua=' + (typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a').substring(0, 160),
);

// Keep-alive ports: while any are open, Firefox will not unload the
// non-persistent event page. The content script opens one per batch and
// closes it on REKNOWN_ENRICH_COMPLETE. Without this, runBatch's in-flight
// fetches and timers get torn down ~30-60s after the last tracked extension
// API event, killing batches mid-run.
const keepAliveConnections = new Map(); // requestId -> Set<Port>

browserApi.runtime.onConnect.addListener((port) => {
  if (!port.name || !port.name.startsWith('reknown-enrich-batch:')) return;
  const requestId = port.name.slice('reknown-enrich-batch:'.length);
  console.log(
    '[reknown-ext] keep-alive port connected name=' + port.name,
    'activeBatches=' + activeBatches.size,
    'existingPortsForReq=' + ((keepAliveConnections.get(requestId) || new Set()).size),
  );
  let set = keepAliveConnections.get(requestId);
  if (!set) {
    set = new Set();
    keepAliveConnections.set(requestId, set);
  }
  set.add(port);
  port.onDisconnect.addListener(() => {
    const lastErr = browserApi.runtime.lastError;
    set.delete(port);
    if (set.size === 0) keepAliveConnections.delete(requestId);
    // If the tab closed mid-batch, cancel cleanly so we stop hammering LinkedIn.
    const batch = activeBatches.get(requestId);
    if (batch) batch.cancelled = true;
    console.log(
      '[reknown-ext] keep-alive port disconnected name=' + port.name,
      'remainingPortsForReq=' + set.size,
      'batchFound=' + !!batch,
      'lastErr=' + (lastErr ? lastErr.message : 'none'),
    );
  });
});

const LINKEDIN_PROFILE_RE = /^https:\/\/(www\.)?linkedin\.com\/in\/[^\s?#]+/i;
const DEFAULT_AVATAR_MARKERS = ['ghost-person', 'ghosts/person', 'default-avatar', 'anon-user'];
const MAX_PHOTO_DIM = 400;
const RECENT_PROFILE_DEBUG_CACHE_LIMIT = 12;
const recentProfileDebugCache = [];
const DEFAULT_DEBUG_CONFIG = {
  debugSlug: '',
  debugRequestId: '',
  debugVerbose: false,
};
let activeDebugConfig = Object.assign({}, DEFAULT_DEBUG_CONFIG);
let debugConfigReadyPromise = null;
let DEBUG_VERBOSE = false;
const DEBUG_ENABLE_LEGACY_VECTOR_WINDOW_FALLBACK = false;

function debugEvent(stage, payload) {
  const event = Object.assign(
    {
      requestId: null,
      personId: null,
      slug: null,
      strategy: null,
      ms: null,
      status: null,
      rejectReason: null,
    },
    payload || {},
    { stage: String(stage || '') },
  );
  event.req = event.requestId;
  console.log('[reknown-ext][event] ' + JSON.stringify(event));
}

function logStageBoundary(stageContext, stage, startedAtMs) {
  const now = Date.now();
  const ctx = stageContext && typeof stageContext === 'object' ? stageContext : {};
  const elapsedMs = typeof startedAtMs === 'number' ? Math.max(0, now - startedAtMs) : 0;
  console.log(
    '[reknown-ext][stage] ' +
      JSON.stringify({
        requestId: ctx.requestId != null ? String(ctx.requestId) : null,
        personId: ctx.personId != null ? String(ctx.personId) : null,
        slug: ctx.slug != null ? String(ctx.slug) : null,
        stage: String(stage || ''),
        timestamp: new Date(now).toISOString(),
        elapsedMs: elapsedMs,
      }),
  );
}

// Track in-flight batches for cancellation. Keyed by requestId.
const activeBatches = new Map(); // requestId -> { cancelled: boolean }
let rateLimitCooldownUntil = 0;
let activeThrottleProfile = DEFAULT_THROTTLE_PROFILE;
let throttleConfigReadyPromise = null;

function normalizeDebugConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    debugSlug: typeof source.debugSlug === 'string' ? source.debugSlug.trim().toLowerCase() : '',
    debugRequestId: typeof source.debugRequestId === 'string' ? source.debugRequestId.trim() : '',
    debugVerbose: source.debugVerbose === true,
  };
}

function shouldEnableDeepLogs(context) {
  if (!activeDebugConfig.debugVerbose) return false;
  const ctx = context && typeof context === 'object' ? context : {};
  const ctxRequestId = ctx.requestId == null ? '' : String(ctx.requestId).trim();
  const ctxSlug = ctx.slug == null ? '' : String(ctx.slug).trim().toLowerCase();
  if (activeDebugConfig.debugRequestId && activeDebugConfig.debugRequestId !== ctxRequestId) return false;
  if (activeDebugConfig.debugSlug && activeDebugConfig.debugSlug !== ctxSlug) return false;
  return true;
}

function applyDebugContext(context) {
  DEBUG_VERBOSE = shouldEnableDeepLogs(context);
  return DEBUG_VERBOSE;
}

function loadStoredDebugConfig() {
  return new Promise((resolve) => {
    try {
      browserApi.storage.local.get([DEBUG_CONFIG_STORAGE_KEY], (items) => {
        const lastErr = browserApi.runtime.lastError;
        if (lastErr) {
          console.warn('[reknown-ext] debug config storage get failed', lastErr.message);
          resolve(Object.assign({}, DEFAULT_DEBUG_CONFIG));
          return;
        }
        resolve(normalizeDebugConfig(items ? items[DEBUG_CONFIG_STORAGE_KEY] : null));
      });
    } catch (err) {
      console.warn('[reknown-ext] debug config storage get threw', String(err));
      resolve(Object.assign({}, DEFAULT_DEBUG_CONFIG));
    }
  });
}

function persistDebugConfig(config) {
  return new Promise((resolve) => {
    try {
      const payload = {};
      payload[DEBUG_CONFIG_STORAGE_KEY] = normalizeDebugConfig(config);
      browserApi.storage.local.set(payload, () => {
        const lastErr = browserApi.runtime.lastError;
        if (lastErr) {
          console.warn('[reknown-ext] debug config storage set failed', lastErr.message);
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch (err) {
      console.warn('[reknown-ext] debug config storage set threw', String(err));
      resolve(false);
    }
  });
}

async function setDebugConfig(nextConfig, options) {
  const normalized = normalizeDebugConfig(nextConfig);
  activeDebugConfig = normalized;
  const persist = !options || options.persist !== false;
  const persisted = persist ? await persistDebugConfig(normalized) : false;
  applyDebugContext(null);
  console.log(
    '[reknown-ext] debug config applied',
    'persist=' + persist,
    'persisted=' + persisted,
    'debugVerbose=' + normalized.debugVerbose,
    'debugRequestId=' + (normalized.debugRequestId || ''),
    'debugSlug=' + (normalized.debugSlug || ''),
  );
  return { config: Object.assign({}, normalized), persisted };
}

async function ensureDebugConfigReady() {
  if (!debugConfigReadyPromise) {
    debugConfigReadyPromise = (async () => {
      const stored = await loadStoredDebugConfig();
      return setDebugConfig(stored, { persist: false });
    })();
  }
  return debugConfigReadyPromise;
}

function getThrottleProfileConfig(profileName) {
  const requested = String(profileName || '');
  const resolvedProfile = Object.prototype.hasOwnProperty.call(THROTTLE_PROFILES, requested)
    ? requested
    : DEFAULT_THROTTLE_PROFILE;
  const base = THROTTLE_PROFILES[resolvedProfile];
  return {
    requestedProfile: requested || null,
    profile: resolvedProfile,
    perRequestMinMs: base.perRequestMinMs,
    perRequestJitterMs: base.perRequestJitterMs,
    perRequestMaxMs: base.perRequestMinMs + base.perRequestJitterMs,
    batchSize: base.batchSize,
    batchPauseMs: base.batchPauseMs,
    rateLimitCooldownMs: base.rateLimitCooldownMs,
  };
}

function getActiveThrottleConfig() {
  return getThrottleProfileConfig(activeThrottleProfile);
}

function loadStoredThrottleProfile() {
  return new Promise((resolve) => {
    try {
      browserApi.storage.local.get([THROTTLE_STORAGE_KEY], (items) => {
        const lastErr = browserApi.runtime.lastError;
        if (lastErr) {
          console.warn('[reknown-ext] throttle profile storage get failed', lastErr.message);
          resolve(DEFAULT_THROTTLE_PROFILE);
          return;
        }
        const stored = items ? items[THROTTLE_STORAGE_KEY] : null;
        resolve(stored || DEFAULT_THROTTLE_PROFILE);
      });
    } catch (err) {
      console.warn('[reknown-ext] throttle profile storage get threw', String(err));
      resolve(DEFAULT_THROTTLE_PROFILE);
    }
  });
}

function persistThrottleProfile(profileName) {
  return new Promise((resolve) => {
    try {
      const payload = {};
      payload[THROTTLE_STORAGE_KEY] = profileName;
      browserApi.storage.local.set(payload, () => {
        const lastErr = browserApi.runtime.lastError;
        if (lastErr) {
          console.warn('[reknown-ext] throttle profile storage set failed', lastErr.message);
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch (err) {
      console.warn('[reknown-ext] throttle profile storage set threw', String(err));
      resolve(false);
    }
  });
}

async function setThrottleProfile(profileName, options) {
  const config = getThrottleProfileConfig(profileName);
  activeThrottleProfile = config.profile;
  const persist = !options || options.persist !== false;
  const persisted = persist ? await persistThrottleProfile(config.profile) : false;
  console.log(
    '[reknown-ext] throttle profile applied',
    'profile=' + config.profile,
    'requested=' + (config.requestedProfile || 'n/a'),
    'persist=' + persist,
    'persisted=' + persisted,
    'config=' + JSON.stringify(config),
  );
  return { profile: config.profile, config, persisted };
}

async function ensureThrottleConfigReady() {
  if (!throttleConfigReadyPromise) {
    throttleConfigReadyPromise = (async () => {
      const storedProfile = await loadStoredThrottleProfile();
      return setThrottleProfile(storedProfile, { persist: false });
    })();
  }
  return throttleConfigReadyPromise;
}

ensureThrottleConfigReady()
  .then((info) => {
    const cfg = info && info.config ? info.config : getActiveThrottleConfig();
    console.log(
      '[reknown-ext] background startup throttle',
      'profile=' + cfg.profile,
      'perRequestMinMs=' + cfg.perRequestMinMs,
      'perRequestMaxMs=' + cfg.perRequestMaxMs,
      'batchSize=' + cfg.batchSize,
      'batchPauseMs=' + cfg.batchPauseMs,
      'rateLimitCooldownMs=' + cfg.rateLimitCooldownMs,
    );
  })
  .catch((err) => {
    console.warn('[reknown-ext] throttle startup init failed', String(err));
  });

ensureDebugConfigReady().catch((err) => {
  console.warn('[reknown-ext] debug config startup init failed', String(err));
});

let startupHealthProbePromise = null;

function getBrowserInfoString() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  if (!ua) return 'unknown';
  if (/firefox\/[\d.]+/i.test(ua)) {
    const match = ua.match(/firefox\/[\d.]+/i);
    return match ? match[0] : 'firefox';
  }
  if (/edg\/[\d.]+/i.test(ua)) {
    const match = ua.match(/edg\/[\d.]+/i);
    return match ? match[0] : 'edge';
  }
  if (/chrome\/[\d.]+/i.test(ua)) {
    const match = ua.match(/chrome\/[\d.]+/i);
    return match ? match[0] : 'chrome';
  }
  if (/safari\/[\d.]+/i.test(ua)) {
    const match = ua.match(/version\/[\d.]+/i);
    return match ? match[0] : 'safari';
  }
  return ua.substring(0, 80);
}

function ensureStartupHealthProbe() {
  if (startupHealthProbePromise) return startupHealthProbePromise;
  startupHealthProbePromise = (async () => {
    if (typeof navigator !== 'undefined' && /vitest/i.test(String(navigator.userAgent || ''))) {
      console.log('[reknown-ext] startup.health_probe skipped test_runtime');
      return;
    }
    const probeUrl = 'https://www.linkedin.com/';
    const startedAt = Date.now();
    try {
      const response = await fetch(probeUrl, { credentials: 'include', redirect: 'follow' });
      console.log(
        '[reknown-ext] startup.health_probe pass',
        'url=' + probeUrl,
        'status=' + response.status,
        'ok=' + response.ok,
        'durationMs=' + (Date.now() - startedAt),
      );
    } catch (err) {
      const errorCode = err && typeof err.code === 'string' ? err.code : 'unknown_error';
      console.warn(
        '[reknown-ext] startup.health_probe fail',
        'url=' + probeUrl,
        'errorCode=' + errorCode,
        'error=' + String(err),
        'durationMs=' + (Date.now() - startedAt),
      );
    }
  })();
  return startupHealthProbePromise;
}

function getPercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const pct = Math.max(0, Math.min(100, Number(percentile) || 0));
  const sorted = values
    .filter((v) => Number.isFinite(v))
    .slice()
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.ceil((pct / 100) * sorted.length) - 1;
  const idx = Math.max(0, Math.min(sorted.length - 1, rank));
  return Math.round(sorted[idx]);
}

function emitBatchSummaryLog(args) {
  const data = args && typeof args === 'object' ? args : {};
  const failuresByCode =
    data.failuresByCode && typeof data.failuresByCode === 'object' ? data.failuresByCode : {};
  const failuresByDominantRejectReason =
    data.failuresByDominantRejectReason && typeof data.failuresByDominantRejectReason === 'object'
      ? data.failuresByDominantRejectReason
      : {};
  const fetchDurationsMs = Array.isArray(data.fetchDurationsMs) ? data.fetchDurationsMs : [];
  const payload = {
    requestId: data.requestId || null,
    phase: data.phase || 'progress',
    processed: Number(data.processed) || 0,
    total: Number(data.total) || 0,
    success: Number(data.success) || 0,
    failed: Number(data.failed) || 0,
    failuresByCode: failuresByCode,
    internalErrorFailures: Number(failuresByCode.internal_error) || 0,
    failuresByDominantRejectReason: failuresByDominantRejectReason,
    fetchTimingMs: {
      p50: getPercentile(fetchDurationsMs, 50),
      p95: getPercentile(fetchDurationsMs, 95),
    },
    firstFailureTimestamp: data.firstFailureTimestamp || null,
    extensionVersion: EXT_VERSION,
    browser: getBrowserInfoString(),
  };
  console.log('[reknown-ext] batch.summary.stats ' + JSON.stringify(payload));
}

function normalizeRejectOwnerMismatch(reason) {
  if (!reason || typeof reason !== 'string') return null;
  if (/reject\.owner_mismatch|owner_mismatch|owner_proximity_reject/i.test(reason)) {
    return 'reject.owner_mismatch';
  }
  return reason;
}

function getProgressErrorMeta(error) {
  if (typeof error === 'string') {
    return { errorCode: error, dominantRejectReason: null };
  }
  if (!error || typeof error !== 'object') {
    return { errorCode: 'unknown_error', dominantRejectReason: null };
  }
  const baseCode = typeof error.code === 'string' ? error.code : 'unknown_error';
  const rawDominantRejectReason =
    typeof error.dominantRejectReason === 'string'
      ? error.dominantRejectReason
      : (typeof error.reason === 'string' ? error.reason : null);
  const normalizedDominantRejectReason = normalizeRejectOwnerMismatch(rawDominantRejectReason);
  if (baseCode === 'no_photo_found' && normalizedDominantRejectReason === 'reject.owner_mismatch') {
    return {
      errorCode: 'reject.owner_mismatch',
      dominantRejectReason: normalizedDominantRejectReason,
    };
  }
  return {
    errorCode: baseCode,
    dominantRejectReason: normalizedDominantRejectReason,
  };
}

ensureStartupHealthProbe().catch((err) => {
  console.warn('[reknown-ext] startup health probe init failed', String(err));
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepCancellable(ms, batch) {
  const step = 250;
  let remaining = ms;
  while (remaining > 0) {
    if (batch.cancelled) return;
    const chunk = Math.min(step, remaining);
    await sleep(chunk);
    remaining -= chunk;
  }
}

function createTypedFetchError(code, message, details) {
  const err = new Error(message || code || 'fetch_failed');
  err.code = code || 'fetch_failed';
  if (details && typeof details === 'object') {
    for (const key of Object.keys(details)) err[key] = details[key];
  }
  return err;
}

function isFetchTimeoutError(err) {
  return !!(err && typeof err === 'object' && err.code === 'fetch_timeout');
}

function isFetchCancelledError(err) {
  return !!(err && typeof err === 'object' && err.code === 'fetch_cancelled');
}

function getInternalErrorSubreason(err) {
  const name = err && typeof err.name === 'string' ? err.name : '';
  if (name === 'ReferenceError') return 'reference_error';
  if (name === 'TypeError') return 'type_error';
  return 'unexpected_exception';
}

function trimErrorStack(err, maxLines) {
  const limit = Math.max(1, Number(maxLines) || 6);
  const stack = err && typeof err.stack === 'string' ? err.stack : '';
  if (!stack) return null;
  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit)
    .join('\n');
}

function createInternalErrorResult(err) {
  return {
    code: 'internal_error',
    reason: getInternalErrorSubreason(err),
  };
}

function emitInternalExceptionTelemetry(stage, context, err) {
  const ctx = context && typeof context === 'object' ? context : {};
  debugEvent('internal.exception', {
    stage: String(stage || ''),
    requestId: ctx.requestId != null ? String(ctx.requestId) : null,
    personId: ctx.personId != null ? String(ctx.personId) : null,
    slug: ctx.slug != null ? String(ctx.slug) : null,
    exceptionName: err && typeof err.name === 'string' ? err.name : 'Error',
    exceptionMessage: err && typeof err.message === 'string' ? err.message : String(err),
  });
}

function toPathTemplate(pathname) {
  const parts = String(pathname || '')
    .split('/')
    .map((part) => {
      if (!part) return part;
      if (/^\d+$/.test(part)) return ':id';
      if (/^[0-9a-f]{8,}$/i.test(part)) return ':token';
      if (part.length > 40) return ':segment';
      return part;
    });
  return parts.join('/') || '/';
}

function getUrlDiagnostics(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    return {
      hostname: parsed.hostname || null,
      pathTemplate: toPathTemplate(parsed.pathname || '/'),
    };
  } catch {
    return {
      hostname: null,
      pathTemplate: null,
    };
  }
}

async function fetchWithTimeout(url, options, controlOptions) {
  const controls = controlOptions && typeof controlOptions === 'object' ? controlOptions : {};
  const timeoutMs = Math.max(1, Number(controls.timeoutMs) || 15000);
  const batch = controls.batch && typeof controls.batch === 'object' ? controls.batch : null;
  const externalSignal = controls.signal && typeof controls.signal === 'object' ? controls.signal : null;
  const diagnosticContext = controls.diagnosticContext && typeof controls.diagnosticContext === 'object'
    ? controls.diagnosticContext
    : {};
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const mergedOptions = Object.assign({}, options || {}, controller ? { signal: controller.signal } : {});
  const requestUrlMeta = getUrlDiagnostics(url);
  let timeoutTriggered = false;
  let timerId = null;
  let externalAbortCleanup = null;
  let abortReason = null;
  let abortControllerTriggered = false;
  console.log('[reknown-ext] fetch.diagnostics.request', {
    requestUrl: requestUrlMeta,
    fetchOptions: {
      method: mergedOptions.method || 'GET',
      mode: mergedOptions.mode || null,
      credentials: mergedOptions.credentials || null,
      redirect: mergedOptions.redirect || null,
    },
    timeoutMs: timeoutMs,
    diagnosticContext: diagnosticContext,
  });
  if (batch && batch.cancelled) {
    abortControllerTriggered = !!controller;
    abortReason = 'batch_cancelled_before_fetch';
    if (controller) controller.abort();
    throw createTypedFetchError('fetch_cancelled', 'batch_cancelled_before_fetch', { isBatchCancelled: true });
  }
  if (externalSignal && externalSignal.aborted) {
    abortControllerTriggered = !!controller;
    abortReason = 'request_cancelled_before_fetch';
    if (controller) controller.abort();
    throw createTypedFetchError('fetch_cancelled', 'request_cancelled_before_fetch', { isRequestCancelled: true });
  }
  if (externalSignal) {
    const onExternalAbort = () => {
      abortControllerTriggered = !!controller;
      abortReason = 'external_abort_signal';
      if (controller) controller.abort();
    };
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    externalAbortCleanup = () => {
      try {
        externalSignal.removeEventListener('abort', onExternalAbort);
      } catch {
        // no-op
      }
    };
  }
  timerId = setTimeout(() => {
    timeoutTriggered = true;
    abortControllerTriggered = !!controller;
    abortReason = 'timeout';
    if (controller) controller.abort();
  }, timeoutMs);
  try {
    if (batch && batch.cancelled) {
      abortControllerTriggered = !!controller;
      abortReason = 'batch_cancelled_before_fetch';
      if (controller) controller.abort();
      throw createTypedFetchError('fetch_cancelled', 'batch_cancelled_before_fetch', { isBatchCancelled: true });
    }
    const response = await fetch(url, mergedOptions);
    const finalUrlMeta = getUrlDiagnostics(response && response.url ? response.url : '');
    console.log('[reknown-ext] fetch.diagnostics.response', {
      response: {
        status: response.status,
        redirected: !!response.redirected,
        finalUrlHostname: finalUrlMeta.hostname,
      },
      headers: {
        contentType: response.headers.get('content-type') || null,
        contentLength: response.headers.get('content-length') || null,
      },
      timeoutMs: timeoutMs,
      abortControllerTriggered: abortControllerTriggered,
      abortReason: abortReason,
      diagnosticContext: diagnosticContext,
    });
    return response;
  } catch (err) {
    const abortErr = err && (err.name === 'AbortError' || err.code === 20);
    console.warn('[reknown-ext] fetch.diagnostics.exception', {
      exception: {
        name: err && err.name ? err.name : null,
        message: err && err.message ? err.message : String(err),
        stack: err && err.stack ? String(err.stack) : null,
      },
      timeoutMs: timeoutMs,
      abortControllerTriggered: abortControllerTriggered,
      abortReason: abortReason,
      diagnosticContext: diagnosticContext,
    });
    if (timeoutTriggered && abortErr) {
      throw createTypedFetchError('fetch_timeout', 'fetch timed out', {
        timeoutMs: timeoutMs,
        errorCode: 'timeout_abort',
        abortReason: abortReason,
      });
    }
    if (abortErr && ((batch && batch.cancelled) || (externalSignal && externalSignal.aborted))) {
      throw createTypedFetchError('fetch_cancelled', 'fetch_cancelled_during_fetch', {
        isBatchCancelled: !!(batch && batch.cancelled),
        isRequestCancelled: !!(externalSignal && externalSignal.aborted),
        abortReason: abortReason,
      });
    }
    throw createTypedFetchError('fetch_failed', 'network error during fetch', {
      errorCode: 'network_error',
      abortReason: abortReason,
      exceptionName: err && err.name ? err.name : null,
      exceptionMessage: err && err.message ? err.message : String(err),
      exceptionStack: err && err.stack ? String(err.stack) : null,
    });
  } finally {
    if (timerId) clearTimeout(timerId);
    if (externalAbortCleanup) externalAbortCleanup();
  }
}

function sendToTab(tabId, message) {
  try {
    browserApi.tabs.sendMessage(tabId, message, () => {
      // Log instead of swallowing: "receiving end does not exist" on a
      // closed tab is normal; anything else is actionable. "Message length
      // exceeded" would surface here if the data URL is too large to post.
      const lastErr = browserApi.runtime.lastError;
      if (lastErr && DEBUG_VERBOSE) {
        console.warn(
          '[reknown-ext] sendToTab lastError',
          'type=' + (message && message.type),
          'tabId=' + tabId,
          'msg=' + lastErr.message,
        );
      }
    });
  } catch (err) {
    console.warn('[reknown-ext] sendToTab threw', err);
  }
}

function getRateLimitCooldownMeta(nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const remainingMs = Math.max(0, rateLimitCooldownUntil - now);
  return {
    cooldownUntil: rateLimitCooldownUntil || null,
    cooldownRemainingMs: remainingMs,
    cooldownRemainingSeconds: Math.ceil(remainingMs / 1000),
  };
}

function setRateLimitCooldown(nowMs) {
  const throttleCfg = getActiveThrottleConfig();
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  rateLimitCooldownUntil = now + throttleCfg.rateLimitCooldownMs;
  const meta = getRateLimitCooldownMeta(now);
  console.warn(
    '[reknown-ext] rate-limit cooldown enabled',
    'profile=' + throttleCfg.profile,
    'durationMs=' + throttleCfg.rateLimitCooldownMs,
    'cooldownUntil=' + new Date(rateLimitCooldownUntil).toISOString(),
    'remainingMs=' + meta.cooldownRemainingMs,
  );
  return meta;
}

function isLoginWall(response) {
  if (!response) return true;
  const status = response.status;
  if (status === 401 || status === 403) return true;
  const url = response.url || '';
  return /\/(login|authwall|uas\/login|checkpoint)/i.test(url);
}

function isRateLimited(response) {
  if (!response) return false;
  return response.status === 429 || response.status === 999;
}

function extractFromJsonLd(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptCount = 0;
  let parseOkCount = 0;
  let parseFailCount = 0;
  const diagTypes = [];
  while ((match = re.exec(html)) !== null) {
    scriptCount++;
    try {
      const data = JSON.parse(match[1].trim());
      parseOkCount++;
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const graph = item && item['@graph'] ? item['@graph'] : [item];
        for (const node of graph) {
          if (!node) continue;
          if (DEBUG_VERBOSE && diagTypes.length < 8) {
            diagTypes.push({
              type: node['@type'],
              hasImage: typeof node.image !== 'undefined',
              imageKind: typeof node.image,
            });
          }
          const image = node.image;
          if (typeof image === 'string') {
            if (DEBUG_VERBOSE) {
              console.log(
                '[reknown-ext] json-ld: found string image',
                'type=' + node['@type'],
                'imgPrefix=' + image.substring(0, 90),
              );
            }
            return image;
          }
          if (image && typeof image === 'object') {
            if (typeof image.contentUrl === 'string') {
              if (DEBUG_VERBOSE) {
                console.log(
                  '[reknown-ext] json-ld: found image.contentUrl',
                  'type=' + node['@type'],
                  'imgPrefix=' + image.contentUrl.substring(0, 90),
                );
              }
              return image.contentUrl;
            }
            if (typeof image.url === 'string') {
              if (DEBUG_VERBOSE) {
                console.log(
                  '[reknown-ext] json-ld: found image.url',
                  'type=' + node['@type'],
                  'imgPrefix=' + image.url.substring(0, 90),
                );
              }
              return image.url;
            }
          }
        }
      }
    } catch (err) {
      parseFailCount++;
      // Ignore malformed JSON-LD blocks.
    }
  }
  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] json-ld: scanned',
      'scripts=' + scriptCount,
      'parseOk=' + parseOkCount,
      'parseFail=' + parseFailCount,
      'types=' + JSON.stringify(diagTypes),
    );
  }
  return null;
}

function extractFromOgImage(html) {
  const primary = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const swapped = primary ? null : html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const m = primary || swapped;
  if (DEBUG_VERBOSE) {
    const allOg = html.match(/property=["']og:image["']/gi);
    console.log(
      '[reknown-ext] og:image: primaryMatch=' + !!primary,
      'swappedMatch=' + !!swapped,
      'totalOgImageProps=' + (allOg ? allOg.length : 0),
      'rawContent=' + (m ? JSON.stringify(m[1].substring(0, 120)) : 'null'),
      'decodedContent=' + (m ? JSON.stringify(decodeHtml(m[1]).substring(0, 120)) : 'null'),
      'looksLikeGhost=' + (m ? /ghosts|default-avatar|anon-user/i.test(m[1]) : false),
      'looksLikeStatic=' + (m ? /static\.licdn\.com/i.test(m[1]) : false),
    );
  }
  return m ? decodeHtml(m[1]) : null;
}

function extractFromProfileImg(html) {
  const classPatterns = [
    { name: 'pv-top-card-profile-picture', re: /<img[^>]+class=["'][^"']*pv-top-card-profile-picture[^"']*["'][^>]*>/i },
    { name: 'profile-photo-edit__preview', re: /<img[^>]+class=["'][^"']*profile-photo-edit__preview[^"']*["'][^>]*>/i },
  ];
  for (const { name, re } of classPatterns) {
    const tag = html.match(re);
    if (DEBUG_VERBOSE) {
      // Log whether any <img> tag for this class was found, and if so
      // which attributes it carries. LinkedIn has been known to move the
      // real URL onto data-delayed-url / data-ghost-url for lazy loading,
      // so `src` alone may be the wrong attribute to read.
      let hasSrc = false;
      let hasDelayed = false;
      let hasGhost = false;
      let hasLazy = false;
      let hasDataSrc = false;
      if (tag) {
        hasSrc = /\bsrc=["']/i.test(tag[0]);
        hasDelayed = /\bdata-delayed-url=/i.test(tag[0]);
        hasGhost = /\bdata-ghost-url=/i.test(tag[0]);
        hasLazy = /\bdata-lazy-src=/i.test(tag[0]);
        hasDataSrc = /\bdata-src=/i.test(tag[0]);
      }
      console.log(
        '[reknown-ext] profile-img: pattern=' + name,
        'matched=' + !!tag,
        'hasSrc=' + hasSrc,
        'hasDelayed=' + hasDelayed,
        'hasGhost=' + hasGhost,
        'hasLazy=' + hasLazy,
        'hasDataSrc=' + hasDataSrc,
        'tagPrefix=' + (tag ? tag[0].substring(0, 180) : 'null'),
      );
    }
    if (tag) {
      const src = tag[0].match(/src=["']([^"']+)["']/i);
      if (src) return decodeHtml(src[1]);
    }
  }
  return null;
}

// Shared helper: normalize LinkedIn HTML for URL extraction.
//
// LinkedIn embeds JSON inside <code> elements and <script> blocks using a
// mix of:
//   1. JS unicode escapes: \u0026 for &, \u003d for =, \u003a for :,
//      \u002f for /, \u003f for ?
//   2. Escaped quotes/slashes: \" for ", \/ for /
//   3. HTML entities: &amp; &quot; &#39; &lt; &gt;
//
// We normalize JS escapes FIRST so that signed query strings
// (?e=...&v=beta&t=<hmac>) survive intact, then decode HTML entities so
// that `&quot;` becomes a real `"` terminator. Both the licdn-regex and
// vector-image strategies rely on this identical preprocessing.
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  var n = 0;
  var i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function countRegex(haystack, re) {
  var m = haystack.match(re);
  return m ? m.length : 0;
}

function normalizeLinkedInHtml(html, debugLabel) {
  const jsNormalized = html
    .replace(/\\u0026/g, '&')
    .replace(/\\u003d/g, '=')
    .replace(/\\u003a/g, ':')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\u003[fF]/g, '?')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/');
  const decoded = decodeHtml(jsNormalized);
  if (DEBUG_VERBOSE) {
    const beforeCounts = {
      'u0026': countOccurrences(html, '\\u0026'),
      'u003d': countOccurrences(html, '\\u003d'),
      'u003a': countOccurrences(html, '\\u003a'),
      'u002f': countOccurrences(html, '\\u002f') + countOccurrences(html, '\\u002F'),
      'bs-quote': countOccurrences(html, '\\"'),
      'amp': countOccurrences(html, '&amp;'),
      'quot': countOccurrences(html, '&quot;'),
      'lt': countOccurrences(html, '&lt;'),
      'gt': countOccurrences(html, '&gt;'),
      '#61': countOccurrences(html, '&#61;'),
      '#x3D': countOccurrences(html, '&#x3D;') + countOccurrences(html, '&#x3d;'),
      '#38': countOccurrences(html, '&#38;'),
      '#x26': countOccurrences(html, '&#x26;') + countOccurrences(html, '&#x26;'),
      'numeric-dec': countRegex(html, /&#\d+;/g),
      'numeric-hex': countRegex(html, /&#x[0-9a-fA-F]+;/g),
    };
    const afterCounts = {
      'u0026': countOccurrences(decoded, '\\u0026'),
      'u003d': countOccurrences(decoded, '\\u003d'),
      'amp': countOccurrences(decoded, '&amp;'),
      'quot': countOccurrences(decoded, '&quot;'),
      '#61': countOccurrences(decoded, '&#61;'),
      '#x3D': countOccurrences(decoded, '&#x3D;') + countOccurrences(decoded, '&#x3d;'),
      'numeric-dec': countRegex(decoded, /&#\d+;/g),
      'numeric-hex': countRegex(decoded, /&#x[0-9a-fA-F]+;/g),
    };
    console.log(
      '[reknown-ext] normalize summary' + (debugLabel ? ' (' + debugLabel + ')' : ''),
      'rawLen=' + html.length,
      'decodedLen=' + decoded.length,
      'before=' + JSON.stringify(beforeCounts),
      'after=' + JSON.stringify(afterCounts),
    );
  }
  return decoded;
}

// Extract profile photo URL using LinkedIn's VectorImage pattern.
//
// As of ~2026, LinkedIn's embedded preload JSON no longer includes the full
// signed photo URL as a single string. Instead, profile photos are described
// via `com.linkedin.common.VectorImage` objects:
//
//   "rootUrl": "https://media.licdn.com/dms/image/v2/<id>/profile-displayphoto-shrink_"
//   "artifacts": [
//     { "width":100, "height":100,
//       "fileIdentifyingUrlPathSegment":"100_100/0/<ts>?e=<exp>&v=beta&t=<hmac>" },
//     { "width":200, "height":200, "fileIdentifyingUrlPathSegment":"200_200/0/..." },
//     { "width":400, "height":400, "fileIdentifyingUrlPathSegment":"400_400/0/..." },
//     ...
//   ]
//
// The full photo URL = rootUrl + fileIdentifyingUrlPathSegment. The bare
// rootUrl (~85 chars) is what licdn-regex matches and rejects as truncated;
// we need this strategy to construct the real signed URL.
function extractFromVectorImage(html, slug, options) {
  const vectorOptions = options || {};
  const decoded = normalizeLinkedInHtml(html, 'vector-image');

  // Upfront diagnostics: how many artifacts / VectorImage objects / rootUrls
  // does the decoded HTML contain at all? If any of these are unexpectedly
  // zero we know the format has shifted and no amount of window-tuning will
  // help.
  if (DEBUG_VERBOSE) {
    const totalSegs = countRegex(decoded, /"fileIdentifyingUrlPathSegment"\s*:\s*"[^"]+"/g);
    const totalRootUrls = countRegex(decoded, /"rootUrl"\s*:\s*"[^"]*"/g);
    const totalDisplayPhotoRoots = countRegex(decoded, /"rootUrl"\s*:\s*"[^"]*profile-displayphoto-shrink_?"/g);
    const totalVectorImage = countOccurrences(decoded, 'com.linkedin.common.VectorImage');
    const totalVectorArtifact = countOccurrences(decoded, 'com.linkedin.common.VectorArtifact');
    console.log(
      '[reknown-ext] vector-image: decoded HTML stats',
      'totalSegs=' + totalSegs,
      'totalRootUrls=' + totalRootUrls,
      'totalDisplayPhotoRoots=' + totalDisplayPhotoRoots,
      'totalVectorImage=' + totalVectorImage,
      'totalVectorArtifact=' + totalVectorArtifact,
    );
  }

  const ownerObjectExtraction = extractVectorCandidatesFromTargetOwnerObjects(decoded, slug);
  const objectExtraction = extractVectorCandidatesFromObjects(decoded, slug);
  let candidates = objectExtraction.candidates;
  let winningExtractor = 'object';

  if (ownerObjectExtraction.candidates.length > 0) {
    candidates = ownerObjectExtraction.candidates;
    winningExtractor = 'owner-object';
    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] vector-image: preferring direct owner-object candidates',
        'slug=' + slug,
        'ownerObjectCandidates=' + ownerObjectExtraction.candidates.length,
        'ownerOffsets=' + ownerObjectExtraction.ownerOffsets.length,
        'ownerRangesExamined=' + ownerObjectExtraction.ownerRangesExamined,
        'objectCandidates=' + objectExtraction.candidates.length,
      );
    }
  } else if (DEBUG_VERBOSE && slug) {
    console.warn(
      '[reknown-ext] vector-image: owner-object candidates not found, falling back to root/object proximity logic',
      'slug=' + slug,
      'ownerOffsets=' + ownerObjectExtraction.ownerOffsets.length,
      'ownerRangesExamined=' + ownerObjectExtraction.ownerRangesExamined,
      'objectCandidates=' + objectExtraction.candidates.length,
    );
  }

  // Keep the old window-based matcher as an opt-in debug fallback only.
  // This allows temporary side-by-side troubleshooting without depending on
  // substring windows in normal operation.
  if (candidates.length === 0 && DEBUG_ENABLE_LEGACY_VECTOR_WINDOW_FALLBACK) {
    const legacyCandidates = extractVectorCandidatesByWindow(decoded);
    if (legacyCandidates.length > 0) {
      candidates = legacyCandidates;
      winningExtractor = 'legacy-window-fallback';
    }
  }

  if (candidates.length === 0) {
    if (DEBUG_VERBOSE) {
      // Log diagnostic info to help future debugging if the page format
      // changes again. Capture presence of related markers so logs alone
      // tell us whether the feature is there but shaped differently.
      const anyLicdnRootUrl = /"rootUrl"\s*:\s*"[^"]*licdn\.com[^"]*"/.test(decoded);
      const displayPhotoRoot = /"rootUrl"\s*:\s*"[^"]*profile-displayphoto-shrink[^"]*"/.test(decoded);
      const hasFilePathSeg = decoded.indexOf('fileIdentifyingUrlPathSegment') !== -1;
      const hasVectorImage = decoded.indexOf('VectorImage') !== -1;
      console.warn(
        '[reknown-ext] vector-image: no candidates',
        'rootUrlCount=' + objectExtraction.rootUrlCount,
        'objectGroups=' + objectExtraction.objectGroupCount,
        'contextFallbackGroups=' + (objectExtraction.contextFallbackGroupCount || 0),
        'contextFallbackSegments=' + (objectExtraction.contextFallbackSegmentCount || 0),
        'legacyFallbackEnabled=' + DEBUG_ENABLE_LEGACY_VECTOR_WINDOW_FALLBACK,
        'selectedExtractor=' + winningExtractor,
        'anyLicdnRootUrl=' + anyLicdnRootUrl,
        'displayPhotoRoot=' + displayPhotoRoot,
        'hasFilePathSeg=' + hasFilePathSeg,
        'hasVectorImage=' + hasVectorImage,
      );
      // Dump a small snippet around the first displayphoto occurrence to aid
      // future reverse-engineering if LinkedIn changes the field name.
      const dpIdx = decoded.indexOf('profile-displayphoto-shrink');
      if (dpIdx !== -1) {
        const start = Math.max(0, dpIdx - 200);
        const end = Math.min(decoded.length, dpIdx + 400);
        console.warn(
          '[reknown-ext] vector-image: snippet around first displayphoto occurrence:',
          decoded.substring(start, end),
        );
      }
    }
    return { url: null, rejectReason: 'no_displayphoto_artifacts' };
  }

  // Filter to candidates with a valid signature. LinkedIn rejects image
  // fetches without the signed query params.
  const signed = candidates.filter(function (c) { return c.hasSig && c.hasExpiry && c.width > 0; });

  if (DEBUG_VERBOSE) {
    // Tally reject reasons so we can tell at-a-glance which gate is killing
    // candidates: missing signature, missing expiry, zero-width (bad dim
    // regex), or residual entity (decoder miss).
    var rejectReasons = { unsignedOnly: 0, missingExpiry: 0, zeroWidth: 0, residualEntity: 0, dirBackward: 0, dirForward: 0 };
    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci];
      if (!c.hasSig) rejectReasons.unsignedOnly++;
      if (!c.hasExpiry) rejectReasons.missingExpiry++;
      if (c.width <= 0) rejectReasons.zeroWidth++;
      if (c.hasResidualEntity) rejectReasons.residualEntity++;
      if (c.direction === 'backward') rejectReasons.dirBackward++;
      if (c.direction === 'forward') rejectReasons.dirForward++;
    }
    console.log(
      '[reknown-ext] vector-image: ' + candidates.length + ' total candidates, ' + signed.length + ' signed',
      'extractor=' + winningExtractor,
      'sizes=' + JSON.stringify(candidates.map(function (c) { return c.width + 'x' + c.height + (c.hasSig ? 's' : '') + (c.hasExpiry ? 'e' : '') + (c.hasResidualEntity ? '!' : '') + '/' + ((c.direction || 'object').charAt(0)); })),
      'sources=' + JSON.stringify(candidates.map(function (c) { return (c.candidateSource || c.extractor || 'unknown') + ':' + (c.associationConfidence || 'n/a'); })),
      'rejectReasons=' + JSON.stringify(rejectReasons),
    );
  }

  if (signed.length === 0) {
    if (DEBUG_VERBOSE) {
      console.warn(
        '[reknown-ext] vector-image: ' + candidates.length + ' constructed candidates but none had both ?e= expiry and &v=/&t= signature',
        'sampleUrl=' + (candidates[0] ? candidates[0].url.substring(0, 160) : ''),
        'sampleHasResidualEntity=' + (candidates[0] ? candidates[0].hasResidualEntity : false),
      );
    }
    return { url: null, rejectReason: 'signed_candidates_found_but_rejected' };
  }

  // Disambiguate by target profile's publicIdentifier. Without this, when a
  // logged-in fetch returns HTML that embeds BOTH the viewer's own nav-menu
  // photo AND the target person's photo, we'd silently pick whichever one
  // sorts first — historically the viewer's. Matching by publicIdentifier
  // ties each rootUrl back to the miniProfile object that owns it.
  //
  // If slug is not provided (shouldn't happen: enrichOne extracts it before
  // calling), fall back to the historical size-only selection.
  let pool = signed;
  if (slug) {
    const directOwnerMatches = signed.filter(function (c) {
      return c.ownerPublicIdentifier && c.ownerPublicIdentifier.toLowerCase() === slug.toLowerCase();
    });
    const explicitNonTarget = signed.filter(function (c) {
      return c.ownerPublicIdentifier && c.ownerPublicIdentifier.toLowerCase() !== slug.toLowerCase();
    });
    if (DEBUG_VERBOSE && explicitNonTarget.length > 0) {
      console.warn(
        '[reknown-ext] vector-image: rejected explicit non-target owner candidates',
        'slug=' + slug,
        'rejected=' + explicitNonTarget.length,
        'reasons=' + JSON.stringify(explicitNonTarget.slice(0, 5).map(function (c) {
          return {
            rootIndex: c.rootIndex,
            ownerPublicIdentifier: c.ownerPublicIdentifier,
            associationMode: c.associationMode || 'n/a',
            reason: 'owner_publicIdentifier_mismatch',
          };
        })),
      );
    }
    if (directOwnerMatches.length > 0) {
      pool = directOwnerMatches;
      if (DEBUG_VERBOSE) {
        console.log(
          '[reknown-ext] vector-image: owner selection via object-owned match',
          'slug=' + slug,
          'selected=' + pool.length,
          'rejectedByOwnerMismatch=' + explicitNonTarget.length,
        );
      }
    } else {
      const proximityEligible = signed.filter(function (c) { return !c.ownerPublicIdentifier; });
      if (DEBUG_VERBOSE && signed.length !== proximityEligible.length) {
        console.log(
          '[reknown-ext] vector-image: proximity fallback eligible candidates',
          'slug=' + slug,
          'eligible=' + proximityEligible.length,
          'excludedExplicitOwner=' + (signed.length - proximityEligible.length),
        );
      }
    const ownerOffsets = findOwnerOffsets(decoded, slug);
    const ownerSelection = chooseOwnerProximityCandidates(
      proximityEligible,
      function (c) { return typeof c.ownerAnchorOffset === 'number' ? c.ownerAnchorOffset : c.rootOffset; },
      ownerOffsets,
      'vector-image',
      slug,
    );
    for (let ci = 0; ci < ownerSelection.scored.length; ci++) {
      ownerSelection.scored[ci].item.ownerDistance = ownerSelection.scored[ci].ownerDistance;
    }
    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] vector-image: owner-proximity filter',
        'slug=' + slug,
        'ownerMatches=' + ownerOffsets.length,
        'signedCount=' + proximityEligible.length,
        'inWindowCount=' + ownerSelection.pool.length,
        'mode=' + ownerSelection.mode,
        'reason=' + ownerSelection.reason,
        'window=' + OWNER_PROXIMITY_BYTES + 'B',
        'distances=' + JSON.stringify(proximityEligible.map(function (c) {
          return {
            rootIndex: c.rootIndex,
            dim: c.width + 'x' + c.height,
            ownerPublicIdentifier: c.ownerPublicIdentifier || 'n/a',
            associationMode: c.associationMode || 'proximity-fallback',
            dist: c.ownerDistance === Infinity ? -1 : c.ownerDistance,
          };
        })),
      );
    }
    if (ownerSelection.pool.length === 0) {
      const relaxedSelection = vectorOptions.allowRelaxedOwnerAssociation
        ? chooseRelaxedSingleOwnerAssociation(proximityEligible, ownerOffsets, slug, {
          requireSingleGroup: !!vectorOptions.relaxedRequiresSingleOwnerGroup,
        })
        : null;
      if (relaxedSelection && relaxedSelection.pool && relaxedSelection.pool.length > 0) {
        pool = relaxedSelection.pool;
        if (DEBUG_VERBOSE) {
          console.warn(
            '[reknown-ext] vector-image: relaxed owner association selected fallback group',
            'slug=' + slug,
            'mode=' + relaxedSelection.mode,
            'reason=' + relaxedSelection.reason,
            'groupKey=' + relaxedSelection.groupKey,
            'ownerDistance=' + (relaxedSelection.ownerDistance === Infinity ? 'inf' : relaxedSelection.ownerDistance),
            'hasTargetSlugNearby=' + relaxedSelection.hasTargetSlugNearby,
            'compatibleGroupCount=' + relaxedSelection.compatibleGroupCount,
            'sources=' + JSON.stringify(relaxedSelection.pool.map(function (c) {
              return {
                rootIndex: c.rootIndex,
                source: c.candidateSource || c.extractor || 'unknown',
                confidence: c.associationConfidence || 'n/a',
                ownerPublicIdentifier: c.ownerPublicIdentifier || 'n/a',
                associationMode: c.associationMode || 'proximity-fallback',
                ownerDistance: c.ownerDistance,
                range: (c.groupStart != null && c.groupEnd != null) ? (c.groupStart + '-' + c.groupEnd) : 'n/a',
              };
            })),
          );
        }
      } else {
      // Safer to fail than to return a stranger's photo. Common cause:
      // LinkedIn returned a logged-out shell that contains only the
      // viewer's own displayphoto data (no target miniProfile embedded).
        if (DEBUG_VERBOSE) {
          console.warn(
            '[reknown-ext] vector-image: no candidate is near "publicIdentifier":"' + slug + '"',
            'ownerMatches=' + ownerOffsets.length,
            'reason=' + ownerSelection.reason,
            'relaxedAssociation=not_found_or_ambiguous',
            'returning null instead of a likely-wrong photo',
          );
        }
        return { url: null, rejectReason: 'owner_mismatch' };
      }
    }
    if (ownerSelection.pool.length > 0) pool = ownerSelection.pool;
    }
    const nonViewerCandidates = pool.filter(function (c) { return !c.ownerIsViewer; });
    if (nonViewerCandidates.length > 0 && nonViewerCandidates.length !== pool.length) {
      if (DEBUG_VERBOSE) {
        console.warn(
          '[reknown-ext] vector-image: deprioritizing viewer-owned candidates',
          'dropped=' + (pool.length - nonViewerCandidates.length),
          'kept=' + nonViewerCandidates.length,
          'reason=viewer_identity_candidate_with_better_alternative_present',
        );
      }
      pool = nonViewerCandidates;
    }
  }

  // Prefer sizes near MAX_PHOTO_DIM. Sort ascending and pick the smallest
  // size that is >= MAX_PHOTO_DIM; if none, pick the largest available.
  pool.sort(function (a, b) { return a.width - b.width; });
  let best = pool[pool.length - 1];
  for (var i = 0; i < pool.length; i++) {
    if (pool[i].width >= MAX_PHOTO_DIM) { best = pool[i]; break; }
  }

  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] vector-image: selected',
      'dims=' + best.width + 'x' + best.height,
      'urlLen=' + best.url.length,
      'rootIndex=' + best.rootIndex,
      'extractor=' + (best.extractor || winningExtractor),
      'groupRange=' + (best.groupStart != null && best.groupEnd != null ? (best.groupStart + '-' + best.groupEnd) : 'n/a'),
      'groupTargetSlugNearby=' + (best.groupTargetSlugNearby === true),
      'ownerPublicIdentifier=' + (best.ownerPublicIdentifier || 'n/a'),
      'associationMode=' + (best.associationMode || 'proximity-fallback'),
      'ownerDistance=' + (typeof best.ownerDistance === 'number' ? best.ownerDistance : 'n/a'),
      'url=' + best.url.substring(0, 140),
    );
  }

  console.log('[reknown-ext] vector-image: winning extractor=' + (best.extractor || winningExtractor));
  return {
    url: best.url,
    source: 'vector-image-object',
    ownerIdentifiers: best.ownerPublicIdentifier ? [best.ownerPublicIdentifier] : [],
    ownerPublicIdentifier: best.ownerPublicIdentifier || null,
    ownerSourceLocation: 'vector_blob',
    ownerDistanceBytes: typeof best.ownerDistance === 'number' ? best.ownerDistance : null,
    ownerMatch:
      slug && best.ownerPublicIdentifier
        ? (best.ownerPublicIdentifier.toLowerCase() === slug.toLowerCase() ? 'exact' : 'mismatch')
        : 'probable',
    reasons: [
      'extractor:' + (best.extractor || winningExtractor),
      'associationMode:' + (best.associationMode || 'proximity-fallback'),
      'ownerDistance:' + (typeof best.ownerDistance === 'number' ? best.ownerDistance : 'n/a'),
    ],
  };
}

function extractVectorCandidatesFromObjects(decoded, slug) {
  const rootUrlRe = /"rootUrl"\s*:\s*"(https:\/\/media\.licdn\.com\/dms\/image\/[^"]*profile-displayphoto-shrink_)"/g;
  const objectRanges = buildJsonObjectRanges(decoded);
  const ownerOffsets = slug ? findOwnerOffsets(decoded, slug) : [];
  const candidates = [];
  let rootMatch;
  let rootUrlCount = 0;
  let objectGroupCount = 0;
  let contextFallbackGroupCount = 0;
  let contextFallbackSegmentCount = 0;

  while ((rootMatch = rootUrlRe.exec(decoded)) !== null) {
    const rootIndex = rootUrlCount;
    rootUrlCount++;
    const rootUrl = rootMatch[1];
    const rootOffset = rootMatch.index;
    const assetId = extractDigitalMediaAssetId(rootUrl);
    const objectRange = findNarrowestContainingRange(objectRanges, rootOffset);
    if (!objectRange) continue;

    const objectText = decoded.substring(objectRange.start, objectRange.end + 1);
    const artifactsMatch = objectText.match(/"artifacts"\s*:\s*\[([\s\S]*?)\]/);
    const groupMeta = getVectorGroupContext(decoded, objectRange.start, objectRange.end, slug);
    const ownerBinding = extractObjectOwnerBinding(objectText, slug);
    const enclosingOwnerBinding = findNearestEnclosingOwnerBinding(decoded, objectRanges, rootOffset, slug);
    const effectiveOwnerBinding = enclosingOwnerBinding || ownerBinding;
    if (!artifactsMatch) {
      const fallbackSegments = extractVectorContextFallbackSegments(
        decoded,
        objectRanges,
        objectRange,
        rootOffset,
        rootUrl,
        rootIndex,
        assetId,
        slug,
        ownerOffsets,
        effectiveOwnerBinding,
      );
      if (fallbackSegments.length > 0) {
        contextFallbackGroupCount++;
        contextFallbackSegmentCount += fallbackSegments.length;
        Array.prototype.push.apply(candidates, fallbackSegments);
      }
      continue;
    }

    objectGroupCount++;
    const artifactsBody = artifactsMatch[1];
    const segRe = /"fileIdentifyingUrlPathSegment"\s*:\s*"([^"]+)"/g;
    let segMatch;
    let segCount = 0;
    while ((segMatch = segRe.exec(artifactsBody)) !== null) {
      const segment = segMatch[1];
      const fullUrl = rootUrl + segment;
      const dimMatch = segment.match(/^(\d+)_(\d+)\//);
      const width = dimMatch ? parseInt(dimMatch[1], 10) : 0;
      const height = dimMatch ? parseInt(dimMatch[2], 10) : 0;
      const hasSig = fullUrl.includes('&v=') && fullUrl.includes('&t=');
      const hasExpiry = fullUrl.includes('?e=');
      const hasResidualEntity = /&#\d+;|&#x[0-9a-fA-F]+;|\\u00[0-9a-fA-F]{2}/.test(segment);
      const candidate = {
        url: fullUrl,
        width: width,
        height: height,
        hasSig: hasSig,
        hasExpiry: hasExpiry,
        hasResidualEntity: hasResidualEntity,
        rootIndex: rootIndex,
        rootOffset: rootOffset,
        ownerAnchorOffset: (effectiveOwnerBinding && typeof effectiveOwnerBinding.ownerAnchorOffset === 'number')
          ? effectiveOwnerBinding.ownerAnchorOffset
          : Math.floor((objectRange.start + objectRange.end) / 2),
        extractor: 'object',
        candidateSource: 'object',
        associationConfidence: 'strict-object',
        associationMode: effectiveOwnerBinding.associationMode,
        ownerPublicIdentifier: effectiveOwnerBinding.ownerPublicIdentifier,
        ownerIsViewer: effectiveOwnerBinding.ownerIsViewer,
        ownerBindingReason: effectiveOwnerBinding.ownerBindingReason,
        groupStart: objectRange.start,
        groupEnd: objectRange.end,
        groupTargetSlugNearby: groupMeta.targetSlugNearby,
        nearbyPublicIdentifiers: groupMeta.publicIdentifiers,
        nearbyMiniProfileRefs: groupMeta.miniProfileRefs,
        assetId: assetId,
        associationGroupKey: 'object:' + rootIndex + ':' + objectRange.start + '-' + objectRange.end,
        direction: 'object',
      };
      candidates.push(candidate);
      if (DEBUG_VERBOSE) {
        console.log(
          '[reknown-ext] vector-image: owner attribution',
          'ownerPublicIdentifier=' + (candidate.ownerPublicIdentifier || 'n/a'),
          'targetSlug=' + (slug || 'n/a'),
          'ownerDistance=' + (ownerOffsets.length > 0
            ? nearestOwnerDistance(candidate.ownerAnchorOffset, ownerOffsets)
            : 'n/a'),
          'associationMode=' + (candidate.associationMode || 'proximity-fallback'),
        );
      }
      segCount++;
    }

    if (segCount === 0) {
      const fallbackSegments = extractVectorContextFallbackSegments(
        decoded,
        objectRanges,
        objectRange,
        rootOffset,
        rootUrl,
        rootIndex,
        assetId,
        slug,
        ownerOffsets,
        effectiveOwnerBinding,
      );
      if (fallbackSegments.length > 0) {
        contextFallbackGroupCount++;
        contextFallbackSegmentCount += fallbackSegments.length;
        Array.prototype.push.apply(candidates, fallbackSegments);
      }
    }

    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] vector-image: object-group root#' + rootIndex,
        'range=' + objectRange.start + '-' + objectRange.end,
        'rootOffset=' + rootOffset,
        'assetId=' + (assetId || 'n/a'),
        'segmentsFound=' + segCount,
        'fallbackAdded=' + (segCount === 0 && candidates.some(function (c) { return c.rootIndex === rootIndex && c.extractor === 'context-fallback'; })),
        'targetSlugNearby=' + groupMeta.targetSlugNearby,
        'ownerPublicIdentifier=' + (effectiveOwnerBinding.ownerPublicIdentifier || 'n/a'),
        'associationMode=' + effectiveOwnerBinding.associationMode,
        'ownerBindingReason=' + effectiveOwnerBinding.ownerBindingReason,
        'publicIdentifiers=' + JSON.stringify(groupMeta.publicIdentifiers),
        'miniProfileRefs=' + groupMeta.miniProfileRefs,
      );
    }
  }

  return {
    candidates: candidates,
    rootUrlCount: rootUrlCount,
    objectGroupCount: objectGroupCount,
    contextFallbackGroupCount: contextFallbackGroupCount,
    contextFallbackSegmentCount: contextFallbackSegmentCount,
  };
}

function extractVectorCandidatesByWindow(decoded) {
  const rootUrlRe = /"rootUrl"\s*:\s*"(https:\/\/media\.licdn\.com\/dms\/image\/[^"]*profile-displayphoto-shrink_)"/g;
  const candidates = [];
  let rootMatch;
  let rootUrlCount = 0;

  while ((rootMatch = rootUrlRe.exec(decoded)) !== null) {
    rootUrlCount++;
    const rootUrl = rootMatch[1];
    const beforeRoot = rootMatch.index;
    const afterRoot = rootMatch.index + rootMatch[0].length;
    const windowStart = Math.max(0, beforeRoot - 4000);
    const windowEnd = Math.min(decoded.length, afterRoot + 4000);
    const backwardWindow = decoded.substring(windowStart, beforeRoot);
    const forwardWindow = decoded.substring(afterRoot, windowEnd);
    const segRe = /"fileIdentifyingUrlPathSegment"\s*:\s*"([^"]+)"/g;
    const windowSegments = [];
    let bwMatch;
    while ((bwMatch = segRe.exec(backwardWindow)) !== null) {
      windowSegments.push({ direction: 'backward', segment: bwMatch[1] });
    }
    const segReFwd = /"fileIdentifyingUrlPathSegment"\s*:\s*"([^"]+)"/g;
    let fwMatch;
    while ((fwMatch = segReFwd.exec(forwardWindow)) !== null) {
      windowSegments.push({ direction: 'forward', segment: fwMatch[1] });
    }
    for (let si = 0; si < windowSegments.length; si++) {
      const segment = windowSegments[si].segment;
      const fullUrl = rootUrl + segment;
      const dimMatch = segment.match(/^(\d+)_(\d+)\//);
      const width = dimMatch ? parseInt(dimMatch[1], 10) : 0;
      const height = dimMatch ? parseInt(dimMatch[2], 10) : 0;
      const candidate = {
        url: fullUrl,
        width: width,
        height: height,
        hasSig: fullUrl.includes('&v=') && fullUrl.includes('&t='),
        hasExpiry: fullUrl.includes('?e='),
        hasResidualEntity: /&#\d+;|&#x[0-9a-fA-F]+;|\\u00[0-9a-fA-F]{2}/.test(segment),
        rootIndex: rootUrlCount - 1,
        rootOffset: rootMatch.index,
        ownerAnchorOffset: rootMatch.index,
        extractor: 'legacy-window-fallback',
        direction: windowSegments[si].direction,
      };
      candidates.push(candidate);
    }
  }
  if (DEBUG_VERBOSE && candidates.length > 0) {
    console.warn(
      '[reknown-ext] vector-image: used legacy window fallback',
      'candidateCount=' + candidates.length,
    );
  }
  return candidates;
}

function extractVectorContextFallbackSegments(
  decoded,
  objectRanges,
  rootObjectRange,
  rootOffset,
  rootUrl,
  rootIndex,
  assetId,
  slug,
  ownerOffsets,
  parentOwnerBinding
) {
  if (!assetId) return [];
  const fallbackStart = Math.max(0, rootOffset - VECTOR_CONTEXT_FALLBACK_MAX_BYTES);
  const fallbackEnd = Math.min(decoded.length, rootOffset + VECTOR_CONTEXT_FALLBACK_MAX_BYTES);
  const candidates = [];
  for (let i = 0; i < objectRanges.length; i++) {
    const range = objectRanges[i];
    if (range.start === rootObjectRange.start && range.end === rootObjectRange.end) continue;
    if (range.end < fallbackStart || range.start > fallbackEnd) continue;
    const bytesFromRoot = Math.min(Math.abs(range.start - rootOffset), Math.abs(range.end - rootOffset));
    if (bytesFromRoot < VECTOR_CONTEXT_FALLBACK_MIN_BYTES || bytesFromRoot > VECTOR_CONTEXT_FALLBACK_MAX_BYTES) continue;
    const objectText = decoded.substring(range.start, range.end + 1);
    if (objectText.indexOf(assetId) === -1) continue;
    if (objectText.indexOf('fileIdentifyingUrlPathSegment') === -1) continue;
    const groupMeta = getVectorGroupContext(decoded, range.start, range.end, slug);
    const ownerBinding = extractObjectOwnerBinding(objectText, slug);
    const effectiveBinding = ownerBinding.ownerPublicIdentifier ? ownerBinding : (parentOwnerBinding || ownerBinding);
    const ownerAnchorOffset = Math.floor((range.start + range.end) / 2);
    const ownerDistance = nearestOwnerDistance(ownerAnchorOffset, ownerOffsets);
    const segRe = /"fileIdentifyingUrlPathSegment"\s*:\s*"([^"]+)"/g;
    let segMatch;
    let segCount = 0;
    while ((segMatch = segRe.exec(objectText)) !== null) {
      const segment = segMatch[1];
      const fullUrl = rootUrl + segment;
      const dimMatch = segment.match(/^(\d+)_(\d+)\//);
      const width = dimMatch ? parseInt(dimMatch[1], 10) : 0;
      const height = dimMatch ? parseInt(dimMatch[2], 10) : 0;
      const strongAssociation = groupMeta.targetSlugNearby || ownerDistance <= OWNER_PROXIMITY_FALLBACK_BYTES;
      if (!strongAssociation) continue;
      const candidate = {
        url: fullUrl,
        width: width,
        height: height,
        hasSig: fullUrl.includes('&v=') && fullUrl.includes('&t='),
        hasExpiry: fullUrl.includes('?e='),
        hasResidualEntity: /&#\d+;|&#x[0-9a-fA-F]+;|\\u00[0-9a-fA-F]{2}/.test(segment),
        rootIndex: rootIndex,
        rootOffset: rootOffset,
        ownerAnchorOffset: ownerAnchorOffset,
        extractor: 'context-fallback',
        candidateSource: 'context-fallback',
        associationConfidence: groupMeta.targetSlugNearby ? 'strong-owner-context' : 'weak-owner-context',
        associationMode: effectiveBinding.ownerPublicIdentifier ? 'object-owned' : 'proximity-fallback',
        ownerPublicIdentifier: effectiveBinding.ownerPublicIdentifier,
        ownerIsViewer: effectiveBinding.ownerIsViewer,
        ownerBindingReason: effectiveBinding.ownerBindingReason,
        groupStart: range.start,
        groupEnd: range.end,
        groupTargetSlugNearby: groupMeta.targetSlugNearby,
        nearbyPublicIdentifiers: groupMeta.publicIdentifiers,
        nearbyMiniProfileRefs: groupMeta.miniProfileRefs,
        assetId: assetId,
        associationGroupKey: 'fallback:' + rootIndex + ':' + range.start + '-' + range.end,
        direction: 'context-fallback',
      };
      candidates.push(candidate);
      if (DEBUG_VERBOSE) {
        console.log(
          '[reknown-ext] vector-image: owner attribution',
          'ownerPublicIdentifier=' + (candidate.ownerPublicIdentifier || 'n/a'),
          'targetSlug=' + (slug || 'n/a'),
          'ownerDistance=' + (ownerDistance === Infinity ? 'inf' : ownerDistance),
          'associationMode=' + (candidate.associationMode || 'proximity-fallback'),
        );
      }
      segCount++;
    }

    if (DEBUG_VERBOSE && segCount > 0) {
      console.log(
        '[reknown-ext] vector-image: context-fallback root#' + rootIndex,
        'rootOffset=' + rootOffset,
        'fallbackRange=' + range.start + '-' + range.end,
        'distanceFromRoot=' + bytesFromRoot,
        'assetId=' + assetId,
        'segmentsFound=' + segCount,
        'targetSlugNearby=' + groupMeta.targetSlugNearby,
        'ownerPublicIdentifier=' + (effectiveBinding.ownerPublicIdentifier || 'n/a'),
        'associationMode=' + (effectiveBinding.ownerPublicIdentifier ? 'object-owned' : 'proximity-fallback'),
        'ownerDistance=' + (ownerDistance === Infinity ? 'inf' : ownerDistance),
      );
    }
  }
  return candidates;
}

function buildJsonObjectRanges(text) {
  const ranges = [];
  const stack = [];
  let inString = false;
  let escaping = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === '\\') {
        escaping = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      stack.push(i);
      continue;
    }
    if (ch === '}') {
      if (stack.length > 0) {
        const start = stack.pop();
        ranges.push({ start: start, end: i, length: i - start + 1 });
      }
    }
  }
  return ranges;
}

function findNarrowestContainingRange(ranges, offset) {
  let best = null;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r.start <= offset && r.end >= offset) {
      if (!best || r.length < best.length) best = r;
    }
  }
  return best;
}

function findNearestEnclosingOwnerBinding(decoded, ranges, offset, slug) {
  const containing = [];
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r.start <= offset && r.end >= offset) containing.push(r);
  }
  containing.sort(function (a, b) { return a.length - b.length; });

  for (let i = 0; i < containing.length; i++) {
    const range = containing[i];
    const objectText = decoded.substring(range.start, range.end + 1);
    const publicIdentifiers = collectPublicIdentifiersFromText(objectText, 8);
    if (publicIdentifiers.length === 0) continue;
    const binding = extractObjectOwnerBinding(objectText, slug);
    const ownerAnchorOffset = Math.floor((range.start + range.end) / 2);
    return {
      ownerPublicIdentifier: binding.ownerPublicIdentifier || publicIdentifiers[0] || null,
      associationMode: binding.ownerPublicIdentifier ? binding.associationMode : 'enclosing-publicIdentifier',
      ownerIsViewer: binding.ownerIsViewer,
      ownerBindingReason: binding.ownerPublicIdentifier
        ? binding.ownerBindingReason
        : ('nearest_enclosing_publicIdentifier:' + publicIdentifiers[0]),
      ownerAnchorOffset: ownerAnchorOffset,
      ownerRangeStart: range.start,
      ownerRangeEnd: range.end,
    };
  }
  return null;
}

function collectPublicIdentifiersFromText(text, maxCount) {
  const identifiers = [];
  const limit = typeof maxCount === 'number' ? maxCount : 10;
  const pidRe = /"publicIdentifier"\s*:\s*"([^"]+)"/g;
  let match;
  while ((match = pidRe.exec(text)) !== null) {
    const pid = match[1];
    if (identifiers.indexOf(pid) === -1) identifiers.push(pid);
    if (identifiers.length >= limit) break;
  }
  return identifiers;
}

function looksLikeViewerIdentityObject(text) {
  return /global-nav|nav-profile|feed-identity-module|\"viewer\"|\"\$type\"\s*:\s*\"com\.linkedin\.voyager\.identity/i.test(text);
}

function extractObjectOwnerBinding(objectText, slug) {
  const publicIdentifiers = collectPublicIdentifiersFromText(objectText, 8);
  if (publicIdentifiers.length === 0) {
    return {
      ownerPublicIdentifier: null,
      associationMode: 'proximity-fallback',
      ownerIsViewer: false,
      ownerBindingReason: 'no_public_identifier_in_object',
    };
  }

  const miniProfileMatch = objectText.match(/"miniProfile"\s*:\s*\{[\s\S]*?"publicIdentifier"\s*:\s*"([^"]+)"/i);
  let ownerPublicIdentifier = miniProfileMatch ? miniProfileMatch[1] : null;
  let ownerBindingReason = miniProfileMatch ? 'miniProfile.publicIdentifier' : '';

  if (!ownerPublicIdentifier && publicIdentifiers.length === 1) {
    ownerPublicIdentifier = publicIdentifiers[0];
    ownerBindingReason = 'single_publicIdentifier_in_object';
  }
  if (!ownerPublicIdentifier && slug && publicIdentifiers.indexOf(slug) !== -1) {
    ownerPublicIdentifier = slug;
    ownerBindingReason = 'slug_present_in_object';
  }

  if (!ownerPublicIdentifier) {
    return {
      ownerPublicIdentifier: null,
      associationMode: 'proximity-fallback',
      ownerIsViewer: false,
      ownerBindingReason: 'ambiguous_public_identifier_set:' + publicIdentifiers.join(','),
    };
  }

  const viewerByContext = looksLikeViewerIdentityObject(objectText);
  const ownerIsViewer = !!slug && ownerPublicIdentifier !== slug && viewerByContext;
  return {
    ownerPublicIdentifier: ownerPublicIdentifier,
    associationMode: 'object-owned',
    ownerIsViewer: ownerIsViewer,
    ownerBindingReason: ownerBindingReason + (ownerIsViewer ? '+viewer_context' : ''),
  };
}

function getVectorGroupContext(decoded, groupStart, groupEnd, slug) {
  const contextStart = Math.max(0, groupStart - 1500);
  const contextEnd = Math.min(decoded.length, groupEnd + 1500);
  const context = decoded.substring(contextStart, contextEnd);
  const publicIdentifiers = [];
  const pidRe = /"publicIdentifier"\s*:\s*"([^"]+)"/g;
  let pidMatch;
  while ((pidMatch = pidRe.exec(context)) !== null) {
    const pid = pidMatch[1];
    if (publicIdentifiers.indexOf(pid) === -1) publicIdentifiers.push(pid);
    if (publicIdentifiers.length >= 5) break;
  }
  const slugPattern = slug ? new RegExp('"publicIdentifier"\\s*:\\s*"' + escapeRegExp(slug) + '"', 'i') : null;
  return {
    publicIdentifiers: publicIdentifiers,
    miniProfileRefs: countOccurrences(context, 'MiniProfile') + countOccurrences(context, 'miniProfile'),
    targetSlugNearby: slugPattern ? slugPattern.test(context) : false,
  };
}

function collectOwnerObjectRanges(decoded, objectRanges, slug) {
  const ownerOffsets = slug ? findOwnerOffsets(decoded, slug) : [];
  const seen = new Set();
  const ownerRanges = [];
  for (let i = 0; i < ownerOffsets.length; i++) {
    const ownerOffset = ownerOffsets[i];
    const containing = [];
    for (let ri = 0; ri < objectRanges.length; ri++) {
      const range = objectRanges[ri];
      if (range.start <= ownerOffset && range.end >= ownerOffset) {
        containing.push(range);
      }
    }
    containing.sort(function (a, b) { return a.length - b.length; });
    for (let ci = 0; ci < containing.length; ci++) {
      const range = containing[ci];
      const key = range.start + ':' + range.end;
      if (seen.has(key)) continue;
      seen.add(key);
      ownerRanges.push(range);
    }
  }
  return {
    ownerOffsets: ownerOffsets,
    ownerRanges: ownerRanges,
  };
}

function extractVectorCandidatesFromTargetOwnerObjects(decoded, slug) {
  if (!slug) {
    return { candidates: [], ownerOffsets: [], ownerRangesExamined: 0 };
  }
  const objectRanges = buildJsonObjectRanges(decoded);
  const ownerMeta = collectOwnerObjectRanges(decoded, objectRanges, slug);
  const ownerOffsets = ownerMeta.ownerOffsets;
  const ownerRanges = ownerMeta.ownerRanges;
  const candidates = [];
  let rangesWithRoot = 0;
  let rangesWithArtifacts = 0;

  for (let i = 0; i < ownerRanges.length; i++) {
    const range = ownerRanges[i];
    if (range.length > 200000) continue;
    const objectText = decoded.substring(range.start, range.end + 1);
    if (!new RegExp('"publicIdentifier"\\s*:\\s*"' + escapeRegExp(slug) + '"', 'i').test(objectText)) continue;

    const rootRe = /"rootUrl"\s*:\s*"(https:\/\/media\.licdn\.com\/dms\/image\/[^"]*profile-displayphoto-shrink_)"/g;
    const rootMatches = [...objectText.matchAll(rootRe)];
    if (rootMatches.length === 0) continue;
    rangesWithRoot++;

    const segRe = /"fileIdentifyingUrlPathSegment"\s*:\s*"([^"]+)"/g;
    const segMatches = [...objectText.matchAll(segRe)];
    if (segMatches.length === 0) continue;
    rangesWithArtifacts++;

    for (let rmi = 0; rmi < rootMatches.length; rmi++) {
      const rootUrl = rootMatches[rmi][1];
      for (let si = 0; si < segMatches.length; si++) {
        const segment = segMatches[si][1];
        const dimMatch = segment.match(/^(\d+)_(\d+)\//);
        if (!dimMatch) continue;
        const width = parseInt(dimMatch[1], 10) || 0;
        const height = parseInt(dimMatch[2], 10) || 0;
        const fullUrl = rootUrl + segment;
        if (!fullUrl.includes('?e=') || !fullUrl.includes('&v=') || !fullUrl.includes('&t=')) continue;
        candidates.push({
          url: fullUrl,
          width: width,
          height: height,
          hasSig: true,
          hasExpiry: true,
          hasResidualEntity: /&#\d+;|&#x[0-9a-fA-F]+;|\\u00[0-9a-fA-F]{2}/.test(segment),
          rootIndex: -1,
          rootOffset: range.start,
          ownerAnchorOffset: Math.floor((range.start + range.end) / 2),
          extractor: 'owner-object',
          candidateSource: 'owner-object',
          associationConfidence: 'direct-owner-object',
          associationMode: 'object-owned',
          ownerPublicIdentifier: slug,
          ownerIsViewer: false,
          ownerBindingReason: 'target-owner-object',
          groupStart: range.start,
          groupEnd: range.end,
          groupTargetSlugNearby: true,
          nearbyPublicIdentifiers: [slug],
          nearbyMiniProfileRefs: countOccurrences(objectText, 'MiniProfile') + countOccurrences(objectText, 'miniProfile'),
          assetId: extractDigitalMediaAssetId(rootUrl),
          associationGroupKey: 'owner-object:' + range.start + '-' + range.end,
          direction: 'owner-object',
        });
      }
    }
  }

  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] vector-image: owner-object probe',
      'slug=' + slug,
      'ownerOffsets=' + ownerOffsets.length,
      'ownerRanges=' + ownerRanges.length,
      'rangesWithRoot=' + rangesWithRoot,
      'rangesWithArtifacts=' + rangesWithArtifacts,
      'candidates=' + candidates.length,
    );
  }

  return {
    candidates: candidates,
    ownerOffsets: ownerOffsets,
    ownerRangesExamined: ownerRanges.length,
  };
}

function extractFromLicdnRegex(html, slug) {
  // LinkedIn embeds preload JSON inside <code> elements with HTML-entity-
  // escaped delimiters. The original implementation matched before decoding,
  // using a char class that excluded raw `"` but not `&`, so the regex ran
  // past `&quot;` and gobbled JSON structure (`...profile-displaybackground
  // image-shrink_","$type":"com.linkedin...`). We must decode FIRST so that
  // `&quot;` becomes `"` (a real terminator) and `&amp;` becomes `&` (a valid
  // character inside the URL's signed query string — required or LinkedIn
  // rejects the fetch). After decoding, the char class still needs to
  // exclude `\` to stop at JS string-literal escapes in <script>-embedded
  // JSON, where quotes are backslash-escaped instead of HTML-entity-escaped.
  //
  // Note: the JS unicode-escape + HTML-entity normalization is shared with
  // extractFromVectorImage via normalizeLinkedInHtml().
  const decoded = normalizeLinkedInHtml(html, 'licdn-regex');
  const URL_BODY = '[^"\'\\s<>\\\\]';

  // Prefer the avatar URL explicitly. LinkedIn's preload JSON lists the
  // banner (profile-displaybackgroundimage) *before* the avatar
  // (profile-displayphoto), so a generic match gets the wrong image.
  //
  // Use matchAll (global flag) instead of match, because the FIRST
  // occurrence is often a truncated template/placeholder URL from
  // LinkedIn's shared JS bundle (same hash for every profile, ~85 chars,
  // no signature params). The real signed photo URL appears later.
  const photoRe = new RegExp(
    'https://media\\.licdn\\.com/dms/image/' + URL_BODY + '*profile-displayphoto-shrink' + URL_BODY + '*',
    'g',
  );
  const allPhotoMatches = [...decoded.matchAll(photoRe)];
  const objectRanges = buildJsonObjectRanges(decoded);
  const ownerBindingByRangeKey = new Map();
  const getOwnerBindingAtOffset = function (offset) {
    const range = findNarrowestContainingRange(objectRanges, offset);
    if (!range) {
      return {
        ownerPublicIdentifier: null,
        associationMode: 'proximity-fallback',
        ownerIsViewer: false,
        ownerBindingReason: 'no_containing_object',
      };
    }
    const key = range.start + ':' + range.end;
    if (!ownerBindingByRangeKey.has(key)) {
      ownerBindingByRangeKey.set(
        key,
        extractObjectOwnerBinding(decoded.substring(range.start, range.end + 1), slug),
      );
    }
    return ownerBindingByRangeKey.get(key);
  };
  const photoCandidates = allPhotoMatches.map(function (m) {
    const binding = getOwnerBindingAtOffset(m.index);
    return {
      match: m,
      url: m[0],
      index: m.index,
      ownerPublicIdentifier: binding.ownerPublicIdentifier,
      associationMode: binding.associationMode,
      ownerIsViewer: binding.ownerIsViewer,
      ownerBindingReason: binding.ownerBindingReason,
    };
  });
  const synthesizedCandidates = [];
  let rootUrlCount = 0;
  let artifactSegmentCount = 0;
  let truncatedRootOnlyCount = 0;
  for (let ri = 0; ri < objectRanges.length; ri++) {
    const range = objectRanges[ri];
    const objectText = decoded.substring(range.start, range.end + 1);
    const rootMatches = [...objectText.matchAll(
      /"rootUrl"\s*:\s*"(https:\/\/media\.licdn\.com\/dms\/image\/[^"]*profile-displayphoto-shrink_[^"]*)"/g,
    )];
    const segMatches = [...objectText.matchAll(/"fileIdentifyingUrlPathSegment"\s*:\s*"([^"]+)"/g)];
    rootUrlCount += rootMatches.length;
    artifactSegmentCount += segMatches.length;
    if (rootMatches.length === 0) continue;
    if (segMatches.length === 0) {
      truncatedRootOnlyCount += rootMatches.length;
      continue;
    }
    const binding = extractObjectOwnerBinding(objectText, slug);
    for (let rmi = 0; rmi < rootMatches.length; rmi++) {
      const rootUrl = rootMatches[rmi][1];
      for (let si = 0; si < segMatches.length; si++) {
        const segment = segMatches[si][1];
        const fullUrl = rootUrl + segment;
        const dimMatch = segment.match(/^(\d+)_(\d+)\//);
        const width = dimMatch ? (parseInt(dimMatch[1], 10) || 0) : 0;
        const height = dimMatch ? (parseInt(dimMatch[2], 10) || 0) : 0;
        const hasSig = fullUrl.includes('&v=') && fullUrl.includes('&t=');
        const hasExpiry = fullUrl.includes('?e=');
        let score = 0;
        if (width > 0 && height > 0) score += Math.min(12, Math.floor((width * height) / 10000));
        if (hasSig) score += 16;
        if (hasExpiry) score += 8;
        if (slug && binding.ownerPublicIdentifier) {
          if (binding.ownerPublicIdentifier.toLowerCase() === slug.toLowerCase()) score += 24;
          else score -= 24;
        }
        if (binding.ownerIsViewer) score -= 6;
        synthesizedCandidates.push({
          url: fullUrl,
          width: width,
          height: height,
          hasSig: hasSig,
          hasExpiry: hasExpiry,
          score: score,
          index: range.start,
          ownerPublicIdentifier: binding.ownerPublicIdentifier,
          associationMode: binding.associationMode,
          ownerIsViewer: binding.ownerIsViewer,
          ownerBindingReason: binding.ownerBindingReason,
        });
      }
    }
  }

  if (DEBUG_VERBOSE) {
    // Raw occurrence counts vs regex-match count. If these diverge it means
    // the char class is terminating too early on some encoding we haven't
    // accounted for yet. `profile-displayphoto-shrink` is the string itself;
    // `displayphotoOccurrences` tells us how many distinct photo objects are
    // really in the decoded HTML, regardless of how the regex fared.
    const displayphotoOccurrences = countOccurrences(decoded, 'profile-displayphoto-shrink');
    const rawDisplayphotoOccurrences = countOccurrences(html, 'profile-displayphoto-shrink');
    console.log(
      '[reknown-ext] licdn-regex: found ' + allPhotoMatches.length + ' displayphoto URLs',
      'rawDisplayphotoOccurrences=' + rawDisplayphotoOccurrences,
      'decodedDisplayphotoOccurrences=' + displayphotoOccurrences,
      JSON.stringify(allPhotoMatches.map(function (m, i) {
        return {
          i: i,
          len: m[0].length,
          hasSig: m[0].includes('&v=') && m[0].includes('&t='),
          hasExpiry: m[0].includes('?e='),
          residualEntity: /&#\d+;|&#x[0-9a-fA-F]+;|\\u00[0-9a-fA-F]{2}/.test(m[0]),
          url: m[0].substring(0, 90),
        };
      })),
    );
    const signedSynthesizedCount = synthesizedCandidates.filter(function (c) {
      return c.hasSig && c.hasExpiry;
    }).length;
    console.log(
      '[reknown-ext] licdn-regex: synthesized candidates',
      'rootUrlCount=' + rootUrlCount,
      'artifactSegmentCount=' + artifactSegmentCount,
      'synthesizedCandidateCount=' + synthesizedCandidates.length,
      'signedSynthesizedCount=' + signedSynthesizedCount,
      'truncatedRootOnlyCount=' + truncatedRootOnlyCount,
    );
    // For each match, log the 40 chars AFTER the match end so we can see
    // exactly what character terminated the regex body — this is the
    // smoking-gun view for "why is everything truncated to 85 chars".
    for (let mi = 0; mi < Math.min(allPhotoMatches.length, 3); mi++) {
      const mm = allPhotoMatches[mi];
      const endIdx = mm.index + mm[0].length;
      const tail = decoded.substring(endIdx, Math.min(decoded.length, endIdx + 60));
      console.log(
        '[reknown-ext] licdn-regex: match #' + mi + ' terminator context',
        'endIdx=' + endIdx,
        'firstCharAfter=' + JSON.stringify(tail.charAt(0)),
        'tail=' + JSON.stringify(tail),
        'tailHasAmpEnt=' + /&#\d+;|&#x[0-9a-fA-F]+;/.test(tail),
        'tailHasUnicodeEsc=' + /\\u00[0-9a-fA-F]{2}/.test(tail),
        'tailHasBsQuote=' + tail.includes('\\"'),
        'tailHasLiteralAmp=' + (tail.charAt(0) === '&'),
      );
    }
  }

  // Owner-proximity gating: when the page embeds multiple profiles (the
  // viewer's own nav photo plus the target profile), require each candidate
  // URL to appear near the target's publicIdentifier. Without this, we'd
  // silently return whichever signed URL happens to match first.
  var ownerOffsets = slug ? findOwnerOffsets(decoded, slug) : [];
  if (slug && ownerOffsets.length === 0) {
    if (DEBUG_VERBOSE) {
      console.warn(
        '[reknown-ext] licdn-regex: no "publicIdentifier":"' + slug + '" in HTML — refusing to guess',
        'reason=owner_proximity_reject_no_owner',
      );
    }
    return { url: null, rejectReason: 'owner_mismatch' };
  }

  var photoOwnerSelection = null;
  var allowedPhotoOffsets = null;
  if (slug) {
    const directOwnerCandidates = photoCandidates.filter(function (c) {
      return c.ownerPublicIdentifier && c.ownerPublicIdentifier.toLowerCase() === slug.toLowerCase();
    });
    const explicitOwnerMismatch = photoCandidates.filter(function (c) {
      return c.ownerPublicIdentifier && c.ownerPublicIdentifier.toLowerCase() !== slug.toLowerCase();
    });
    if (directOwnerCandidates.length > 0) {
      allowedPhotoOffsets = new Set(directOwnerCandidates.map(function (c) { return c.index; }));
      photoOwnerSelection = {
        pool: directOwnerCandidates,
        mode: 'object-owned',
        reason: 'owner_public_identifier_match',
      };
    } else {
      photoOwnerSelection = {
        pool: [],
        mode: 'strict-owner-required',
        reason: 'owner_public_identifier_missing',
      };
      if (DEBUG_VERBOSE) {
        console.warn(
          '[reknown-ext] licdn-regex: strict owner gating rejected non-bound displayphoto candidates',
          'slug=' + slug,
          'photoCandidates=' + photoCandidates.length,
          'explicitOwnerMismatch=' + explicitOwnerMismatch.length,
        );
      }
      return { url: null, rejectReason: 'owner_mismatch' };
    }
    if (allowedPhotoOffsets && directOwnerCandidates.some(function (c) { return c.ownerIsViewer; })) {
      const nonViewerAllowed = directOwnerCandidates.filter(function (c) {
        return allowedPhotoOffsets.has(c.index) && !c.ownerIsViewer;
      });
      if (nonViewerAllowed.length > 0) {
        allowedPhotoOffsets = new Set(nonViewerAllowed.map(function (c) { return c.index; }));
        photoOwnerSelection.pool = nonViewerAllowed;
      }
    }
    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] licdn-regex: photo owner selection',
        'ownerMatches=' + ownerOffsets.length,
        'candidateCount=' + photoCandidates.length,
        'selectedCount=' + photoOwnerSelection.pool.length,
        'mode=' + photoOwnerSelection.mode,
        'reason=' + photoOwnerSelection.reason,
        'rejectedOwnerMismatch=' + explicitOwnerMismatch.length,
        'selection=' + JSON.stringify(photoCandidates.map(function (c) {
          return {
            idx: c.index,
            ownerPublicIdentifier: c.ownerPublicIdentifier || 'n/a',
            associationMode: c.associationMode,
            ownerIsViewer: c.ownerIsViewer,
            selected: !!(allowedPhotoOffsets && allowedPhotoOffsets.has(c.index)),
            rejectReason: allowedPhotoOffsets && !allowedPhotoOffsets.has(c.index)
              ? (c.ownerPublicIdentifier ? 'owner_publicIdentifier_mismatch' : 'owner_proximity_reject')
              : null,
          };
        })),
      );
    }
  }

  // First pass: synthesize full URLs from rootUrl + fileIdentifyingUrlPathSegment
  // pairs in the same JSON object. rootUrl alone is never a valid candidate.
  var allowedSynthesizedOffsets = null;
  if (slug) {
    const directSynthesizedOwner = synthesizedCandidates.filter(function (c) {
      return c.ownerPublicIdentifier && c.ownerPublicIdentifier.toLowerCase() === slug.toLowerCase();
    });
    if (directSynthesizedOwner.length === 0) {
      if (DEBUG_VERBOSE && synthesizedCandidates.length > 0) {
        console.warn(
          '[reknown-ext] licdn-regex synthesized: strict owner gating rejected non-bound candidates',
          'slug=' + slug,
          'candidateCount=' + synthesizedCandidates.length,
        );
      }
      return { url: null, rejectReason: 'owner_mismatch' };
    }
    var synthesizedOwnerSelection = {
      pool: directSynthesizedOwner,
      mode: 'object-owned',
      reason: 'owner_public_identifier_match',
    };
    var selectedSynthesized = synthesizedOwnerSelection.pool;
    var nonViewerSynthesized = selectedSynthesized.filter(function (c) { return !c.ownerIsViewer; });
    if (nonViewerSynthesized.length > 0) selectedSynthesized = nonViewerSynthesized;
    allowedSynthesizedOffsets = new Set(selectedSynthesized.map(function (c) { return c.index; }));
  }
  var bestSynthesized = null;
  var bestSynthesizedScore = -1;
  for (var sci = 0; sci < synthesizedCandidates.length; sci++) {
    var synthesizedCandidate = synthesizedCandidates[sci];
    if (allowedSynthesizedOffsets && !allowedSynthesizedOffsets.has(synthesizedCandidate.index)) continue;
    if (!synthesizedCandidate.hasSig || !synthesizedCandidate.hasExpiry) continue;
    if (synthesizedCandidate.score > bestSynthesizedScore) {
      bestSynthesized = synthesizedCandidate;
      bestSynthesizedScore = synthesizedCandidate.score;
    }
  }
  if (bestSynthesized) {
    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] licdn-regex: selected synthesized URL',
        'score=' + bestSynthesizedScore,
        'selectedDimensions=' + bestSynthesized.width + 'x' + bestSynthesized.height,
        'len=' + bestSynthesized.url.length,
        'url=' + bestSynthesized.url.substring(0, 120),
      );
    }
    return bestSynthesized.url;
  }

  // Score each match. A valid signed LinkedIn photo URL is 200+ chars and
  // contains expiry/signature params (?e=…&v=…&t=…). Template URLs from
  // LinkedIn's JS bundles are ~85 chars with no query string.
  var bestPhoto = null;
  var bestScore = -1;
  for (var pi = 0; pi < allPhotoMatches.length; pi++) {
    var candidate = allPhotoMatches[pi][0];
    if (allowedPhotoOffsets && !allowedPhotoOffsets.has(allPhotoMatches[pi].index)) continue;
    var score = 0;
    if (candidate.length > 100) score += 10;
    if (candidate.includes('&v=') && candidate.includes('&t=')) score += 10;
    if (/shrink_\d+_\d+/.test(candidate)) score += 5;
    if (candidate.includes('?e=')) score += 3;
    if (score > bestScore) { bestScore = score; bestPhoto = candidate; }
  }

  if (
    bestPhoto &&
    bestScore >= 20 &&
    bestPhoto.includes('&v=') &&
    bestPhoto.includes('&t=') &&
    bestPhoto.includes('?e=')
  ) {
    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] licdn-regex: selected URL score=' + bestScore,
        'len=' + bestPhoto.length,
        'url=' + bestPhoto.substring(0, 120),
      );
    }
    return bestPhoto;
  }

  // If no URL scored high enough, warn and fall through to the generic
  // fallback below instead of returning a known-bad truncated URL.
  if (DEBUG_VERBOSE && allPhotoMatches.length > 0) {
    console.warn(
      '[reknown-ext] licdn-regex: all ' + allPhotoMatches.length +
      ' displayphoto URLs look truncated/invalid, bestScore=' + bestScore,
      bestPhoto ? ('bestUrl=' + bestPhoto) : '',
    );
    // Dump HTML context around the first truncated match so that we can
    // diagnose what encoding LinkedIn is now using without having to save
    // the full 1.3MB page. Shows ~200 chars before and ~400 chars after.
    var firstMatch = allPhotoMatches[0];
    if (firstMatch && typeof firstMatch.index === 'number') {
      var ctxStart = Math.max(0, firstMatch.index - 200);
      var ctxEnd = Math.min(decoded.length, firstMatch.index + 400);
      console.warn(
        '[reknown-ext] licdn-regex: context around truncated match:',
        decoded.substring(ctxStart, ctxEnd),
      );
    }
  }

  // Fallback: any licdn image URL, but explicitly skip background banners.
  // Same matchAll approach — skip truncated/template URLs. Also gate by
  // owner proximity when a slug is available, for the same reason as above.
  const genericRe = new RegExp('https://media\\.licdn\\.com/dms/image/' + URL_BODY + '+', 'g');
  const allGenericMatches = [...decoded.matchAll(genericRe)];
  const genericCandidates = allGenericMatches.map(function (m) {
    const binding = getOwnerBindingAtOffset(m.index);
    return {
      match: m,
      url: m[0],
      index: m.index,
      ownerPublicIdentifier: binding.ownerPublicIdentifier,
      associationMode: binding.associationMode,
      ownerIsViewer: binding.ownerIsViewer,
    };
  });
  var allowedGenericOffsets = null;
  if (slug) {
    var directGenericOwner = genericCandidates.filter(function (c) {
      return c.ownerPublicIdentifier && c.ownerPublicIdentifier.toLowerCase() === slug.toLowerCase();
    });
    if (directGenericOwner.length === 0) {
      if (DEBUG_VERBOSE && genericCandidates.length > 0) {
        console.warn(
          '[reknown-ext] licdn-regex generic: strict owner gating rejected non-bound candidates',
          'slug=' + slug,
          'candidateCount=' + genericCandidates.length,
        );
      }
      return { url: null, rejectReason: 'owner_mismatch' };
    }
    var genericOwnerSelection = {
      pool: directGenericOwner,
      mode: 'object-owned',
      reason: 'owner_public_identifier_match',
    };
    var selectedGeneric = genericOwnerSelection.pool;
    var selectedNonViewerGeneric = selectedGeneric.filter(function (c) { return !c.ownerIsViewer; });
    if (selectedNonViewerGeneric.length > 0) selectedGeneric = selectedNonViewerGeneric;
    genericOwnerSelection.pool = selectedGeneric;
    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] licdn-regex: generic owner selection',
        'ownerMatches=' + ownerOffsets.length,
        'candidateCount=' + genericCandidates.length,
        'selectedCount=' + genericOwnerSelection.pool.length,
        'mode=' + genericOwnerSelection.mode,
        'reason=' + genericOwnerSelection.reason,
      );
    }
    allowedGenericOffsets = new Set(genericOwnerSelection.pool.map(function (c) { return c.index; }));
  }
  for (var gi = 0; gi < allGenericMatches.length; gi++) {
    var gUrl = allGenericMatches[gi][0];
    if (/profile-displaybackgroundimage/.test(gUrl)) continue;
    if (allowedGenericOffsets && !allowedGenericOffsets.has(allGenericMatches[gi].index)) continue;
    if (gUrl.length > 100 && gUrl.includes('&v=') && gUrl.includes('&t=') && gUrl.includes('?e=')) {
      if (DEBUG_VERBOSE) {
        console.log(
          '[reknown-ext] licdn-regex generic fallback: selected len=' + gUrl.length,
          'url=' + gUrl.substring(0, 120),
        );
      }
      return gUrl;
    }
  }
  var hasSignedPhotoCandidates = allPhotoMatches.some(function (m) {
    var u = m && m[0] ? m[0] : '';
    return u.includes('&v=') && u.includes('&t=') && u.includes('?e=');
  });
  if (hasSignedPhotoCandidates) {
    return { url: null, rejectReason: 'signed_candidates_found_but_rejected' };
  }
  if (truncatedRootOnlyCount > 0 && rootUrlCount > 0 && artifactSegmentCount === 0) {
    return { url: null, rejectReason: 'reject.truncated_root_only' };
  }
  if (countOccurrences(decoded, 'profile-displayphoto-shrink') === 0) {
    return { url: null, rejectReason: 'no_displayphoto_artifacts' };
  }
  return null;
}

async function extractFromOverlayPhoto(slug, options) {
  const overlayOptions = options && typeof options === 'object' ? options : {};
  if (!slug) {
    if (DEBUG_VERBOSE) {
      console.log('[reknown-ext] overlay-photo: reject reason', 'missing_slug');
    }
    return { url: null, rejectReason: 'missing_slug' };
  }
  const overlayUrl = 'https://www.linkedin.com/in/' + encodeURIComponent(slug) + '/overlay/photo/';
  let response;
  const fetchStart = Date.now();
  try {
    response = await fetchWithTimeout(
      overlayUrl,
      {
        credentials: 'include',
        redirect: 'follow',
        referrer: 'https://www.linkedin.com/',
        referrerPolicy: 'strict-origin-when-cross-origin',
      },
      { timeoutMs: overlayOptions.timeoutMs, batch: overlayOptions.batch },
    );
  } catch (err) {
    const rejectReason = isFetchTimeoutError(err) ? 'overlay_fetch_timeout' : 'overlay_fetch_failed';
    if (DEBUG_VERBOSE) {
      console.warn('[reknown-ext] overlay-photo: reject reason', rejectReason, String(err));
    }
    return { url: null, rejectReason: rejectReason };
  }
  let overlayHtml = '';
  try {
    overlayHtml = await response.text();
  } catch (err) {
    if (DEBUG_VERBOSE) {
      console.warn('[reknown-ext] overlay-photo: reject reason', 'overlay_read_failed', String(err));
    }
    return { url: null, rejectReason: 'overlay_read_failed' };
  }
  if (DEBUG_VERBOSE) {
    const contentType = response.headers && response.headers.get ? (response.headers.get('content-type') || '') : '';
    console.log(
      '[reknown-ext] overlay-photo: fetched',
      'slug=' + slug,
      'status=' + response.status,
      'ok=' + response.ok,
      'redirected=' + response.redirected,
      'contentType=' + contentType.substring(0, 100),
      'fetchMs=' + (Date.now() - fetchStart),
      'htmlLen=' + overlayHtml.length,
      'finalUrl=' + (response.url || '').substring(0, 140),
    );
  }
  const decoded = normalizeLinkedInHtml(overlayHtml, 'overlay-photo');
  const candidates = [];
  const seen = new Set();
  const pushCandidate = function (candidateUrl, source) {
    if (!candidateUrl || typeof candidateUrl !== 'string') return;
    const clean = candidateUrl.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    candidates.push({ url: clean, source: source });
  };
  try {
    const doc = new DOMParser().parseFromString(decoded, 'text/html');
    const modalNodes = doc.querySelectorAll(
      'img.pv-member-photo-modal__content-image, .pv-member-photo-modal__content-image img, img[class*="pv-member-photo-modal__content-image"]',
    );
    const altNodes = doc.querySelectorAll('img[alt^="Profile photo"], img[alt*="Profile photo"]');
    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] overlay-photo: selector hits',
        'modalClass=' + modalNodes.length,
        'profilePhotoAlt=' + altNodes.length,
      );
    }
    for (let i = 0; i < modalNodes.length; i++) {
      const node = modalNodes[i];
      pushCandidate(node.getAttribute('src'), 'modal-selector:src');
      pushCandidate(node.getAttribute('data-delayed-url'), 'modal-selector:data-delayed-url');
      pushCandidate(node.getAttribute('data-ghost-url'), 'modal-selector:data-ghost-url');
    }
    for (let i = 0; i < altNodes.length; i++) {
      const node = altNodes[i];
      pushCandidate(node.getAttribute('src'), 'profile-photo-alt:src');
      pushCandidate(node.getAttribute('data-delayed-url'), 'profile-photo-alt:data-delayed-url');
      pushCandidate(node.getAttribute('data-ghost-url'), 'profile-photo-alt:data-ghost-url');
    }
  } catch (err) {
    if (DEBUG_VERBOSE) {
      console.warn('[reknown-ext] overlay-photo: selector parse failed', String(err));
    }
  }
  const regex = /https:\/\/media\.licdn\.com\/dms\/image\/[^"'\\\s<>]*profile-displayphoto(?:-shrink)?[^"'\\\s<>]*/g;
  const regexMatches = decoded.match(regex) || [];
  if (DEBUG_VERBOSE) {
    console.log('[reknown-ext] overlay-photo: strict fallback regex hits', regexMatches.length);
  }
  for (let i = 0; i < regexMatches.length; i++) {
    pushCandidate(regexMatches[i], 'fallback-regex');
  }
  if (candidates.length === 0) {
    if (DEBUG_VERBOSE) {
      console.log('[reknown-ext] overlay-photo: reject reason', 'overlay_no_displayphoto_artifacts');
    }
    return { url: null, rejectReason: 'overlay_no_displayphoto_artifacts' };
  }
  const evaluateCandidate = function (entry) {
    const url = entry && typeof entry.url === 'string' ? entry.url : '';
    const reasons = [];
    let pass = true;
    let host = '';
    try {
      host = (new URL(url)).hostname.toLowerCase();
    } catch (_err) {
      host = '';
    }
    if (host === 'media.licdn.com') reasons.push('pass:media.licdn host');
    else {
      reasons.push('fail:non-media.licdn host');
      pass = false;
    }
    if (url.includes('&v=') && url.includes('&t=')) reasons.push('pass:signature fields present');
    else {
      reasons.push('fail:missing signature fields');
      pass = false;
    }
    if (url.includes('?e=') || url.includes('&e=')) reasons.push('pass:expiry field present');
    else {
      reasons.push('fail:missing expiry field');
      pass = false;
    }
    if (/profile-displaybackgroundimage|background-image|cover-photo|ghost-person|ghosts\/person|default-avatar|anon-user/i.test(url)) {
      reasons.push('fail:obvious non-profile asset');
      pass = false;
    } else {
      reasons.push('pass:not obvious non-profile asset');
    }
    reasons.push('pass:owner association probable');
    const firstFail = reasons.find(function (r) { return r.indexOf('fail:') === 0; }) || '';
    return {
      accepted: pass,
      rejectReason: firstFail ? firstFail.replace(/^fail:/, '') : null,
      reasons: reasons,
    };
  };
  let firstRejected = null;
  let selected = null;
  for (let i = 0; i < candidates.length; i++) {
    const entry = candidates[i];
    const assessment = evaluateCandidate(entry);
    if (assessment.accepted) {
      selected = {
        url: entry.url,
        source: entry.source,
        reasons: assessment.reasons,
      };
      break;
    }
    if (!firstRejected) {
      firstRejected = {
        url: entry.url,
        source: entry.source,
        rejectReason: assessment.rejectReason || 'overlay_candidate_rejected',
      };
    }
  }
  if (!selected) {
    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] overlay-photo: first rejected',
        'source=' + (firstRejected ? firstRejected.source : 'none'),
        'reason=' + (firstRejected ? firstRejected.rejectReason : 'overlay_no_acceptable_candidates'),
        'url=' + ((firstRejected && firstRejected.url) ? firstRejected.url.substring(0, 140) : ''),
      );
    }
    return { url: null, rejectReason: (firstRejected && firstRejected.rejectReason) || 'overlay_no_acceptable_candidates' };
  }
  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] overlay-photo: first accepted',
      'source=' + selected.source,
      'urlLen=' + selected.url.length,
      'url=' + selected.url.substring(0, 140),
    );
    if (firstRejected) {
      console.log(
        '[reknown-ext] overlay-photo: first rejected',
        'source=' + firstRejected.source,
        'reason=' + firstRejected.rejectReason,
        'url=' + firstRejected.url.substring(0, 140),
      );
    }
  }
  return { url: selected.url, rejectReason: null, source: selected.source, ownerMatch: 'probable', reasons: selected.reasons };
}

// LinkedIn embeds JSON inside HTML <code>/<script> blocks using a mix of
// named entities (&amp;, &quot;, &#39;, &lt;, &gt;), decimal numeric entities
// (&#61; = '='), and hex numeric entities (&#x3D; = '='). The signed photo
// URL's query string is `?e=...&v=beta&t=<hmac>` — if we fail to decode
// `&#61;` back to `=`, every signature check later on fails and the URL is
// rejected as "unsigned", which was the exact symptom in the earlier logs.
//
// Decimal/hex numeric entities are collapsed via a single regex pass. We
// guard against absurd code points (> 0x10FFFF) by returning the original
// match verbatim, so malformed input can never make this throw.
function decodeHtml(s) {
  var named = s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return named.replace(/&#(x[0-9a-fA-F]+|\d+);/g, function (match, body) {
    var code;
    if (body.charAt(0) === 'x' || body.charAt(0) === 'X') {
      code = parseInt(body.substring(1), 16);
    } else {
      code = parseInt(body, 10);
    }
    if (!Number.isFinite(code) || code < 0 || code > 0x10FFFF) return match;
    try {
      return String.fromCodePoint(code);
    } catch (err) {
      return match;
    }
  });
}

function isDefaultAvatar(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return DEFAULT_AVATAR_MARKERS.some((m) => lower.includes(m));
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Find every byte-offset in `decoded` where the target profile's
// publicIdentifier appears. LinkedIn embeds this inside each miniProfile
// object that owns a VectorImage photo, so the target person's photo
// rootUrl is the one whose offset is closest to one of these matches.
//
// Returns [] if slug is empty/missing, or if the HTML has no matches (e.g.
// LinkedIn returned a logged-out shell that only contains the viewer's own
// photo). Callers treat an empty result from a non-empty slug as a signal
// to FAIL extraction rather than silently pick the wrong person.
function findOwnerOffsets(decoded, slug) {
  if (!slug) return [];
  const offsets = [];
  const re = new RegExp('"publicIdentifier"\\s*:\\s*"' + escapeRegExp(slug) + '"', 'gi');
  let m;
  while ((m = re.exec(decoded)) !== null) {
    offsets.push(m.index);
    // Prevent pathological zero-length matches from looping forever.
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return offsets;
}

// Window around each publicIdentifier occurrence inside which a rootUrl is
// considered to belong to that profile. LinkedIn's miniProfile JSON objects
// for a single profile's photo + publicIdentifier typically sit within a
// few KB of each other; 8 KB gives comfortable headroom without matching
// across unrelated profiles in the page.
const OWNER_PROXIMITY_BYTES = 8000;
const OWNER_PROXIMITY_FALLBACK_BYTES = 80000;
const VECTOR_CONTEXT_FALLBACK_MIN_BYTES = 20000;
const VECTOR_CONTEXT_FALLBACK_MAX_BYTES = 60000;
const RELAXED_ASSOCIATION_UNIQUENESS_GAP_BYTES = 2000;

function nearestOwnerDistance(offset, ownerOffsets) {
  if (!ownerOffsets || ownerOffsets.length === 0) return Infinity;
  let best = Infinity;
  for (let i = 0; i < ownerOffsets.length; i++) {
    const d = Math.abs(offset - ownerOffsets[i]);
    if (d < best) best = d;
  }
  return best;
}

function chooseOwnerProximityCandidates(items, getOffset, ownerOffsets, contextLabel) {
  const targetSlug = arguments.length > 4 ? arguments[4] : '';
  const normalizedTargetSlug = targetSlug ? String(targetSlug).toLowerCase() : '';
  const directOwnerMatches = [];
  const explicitOwnerMismatch = [];
  const proximityEligible = [];
  for (let i = 0; i < items.length; i++) {
    const ownerPid = items[i] && items[i].ownerPublicIdentifier
      ? String(items[i].ownerPublicIdentifier).toLowerCase()
      : '';
    if (!normalizedTargetSlug || !ownerPid) {
      proximityEligible.push(items[i]);
      continue;
    }
    if (ownerPid === normalizedTargetSlug) {
      directOwnerMatches.push(items[i]);
    } else {
      explicitOwnerMismatch.push(items[i]);
    }
  }

  if (directOwnerMatches.length > 0) {
    return {
      pool: directOwnerMatches,
      mode: 'object-owned',
      reason: 'owner_public_identifier_match',
      scored: directOwnerMatches.map(function (item, i) {
        return { item: item, ownerDistance: nearestOwnerDistance(getOffset(item, i), ownerOffsets) };
      }),
    };
  }

  const scored = [];
  for (let i = 0; i < proximityEligible.length; i++) {
    const dist = nearestOwnerDistance(getOffset(proximityEligible[i], i), ownerOffsets);
    scored.push({ item: proximityEligible[i], ownerDistance: dist });
  }
  if (DEBUG_VERBOSE && scored.length > 0) {
    console.log(
      '[reknown-ext] ' + contextLabel + ': owner attribution',
      'attribution=' + JSON.stringify(scored.map(function (s) {
        return {
          ownerPublicIdentifier: s.item.ownerPublicIdentifier || 'n/a',
          targetSlug: targetSlug || 'n/a',
          ownerDistance: s.ownerDistance === Infinity ? 'inf' : s.ownerDistance,
          associationMode: s.item.associationMode || 'proximity-fallback',
        };
      })),
      'explicitOwnerMismatch=' + explicitOwnerMismatch.length,
    );
  }

  if (!ownerOffsets || ownerOffsets.length === 0) {
    return { pool: [], mode: 'reject', reason: 'owner_proximity_reject_no_owner', scored: scored };
  }

  const inStrictWindow = scored.filter(function (s) {
    return s.ownerDistance <= OWNER_PROXIMITY_BYTES;
  });
  if (inStrictWindow.length > 0) {
    return {
      pool: inStrictWindow.map(function (s) { return s.item; }),
      mode: 'strict',
      reason: 'owner_proximity_strict',
      scored: scored,
    };
  }

  if (ownerOffsets.length === 1 && scored.length > 0) {
    const nearest = scored.reduce(function (best, cur) {
      return cur.ownerDistance < best.ownerDistance ? cur : best;
    }, scored[0]);
    if (nearest.ownerDistance <= OWNER_PROXIMITY_FALLBACK_BYTES) {
      if (DEBUG_VERBOSE) {
        console.warn(
          '[reknown-ext] ' + contextLabel + ': owner_proximity_fallback',
          'strictWindow=' + OWNER_PROXIMITY_BYTES + 'B',
          'fallbackWindow=' + OWNER_PROXIMITY_FALLBACK_BYTES + 'B',
          'selectedDistance=' + nearest.ownerDistance,
        );
      }
      return {
        pool: [nearest.item],
        mode: 'fallback',
        reason: 'owner_proximity_fallback',
        scored: scored,
      };
    }
  }

  return {
    pool: [],
    mode: 'reject',
    reason: explicitOwnerMismatch.length > 0 && proximityEligible.length === 0
      ? 'owner_public_identifier_mismatch'
      : 'owner_proximity_strict_reject',
    scored: scored,
  };
}

function extractDigitalMediaAssetId(rootUrl) {
  if (!rootUrl) return '';
  const m = rootUrl.match(/\/dms\/image\/([^/]+\/[^/]+|[^/]+)\/profile-displayphoto-shrink_/i);
  return m ? m[1] : '';
}

function chooseRelaxedSingleOwnerAssociation(items, ownerOffsets, slug, options) {
  const relaxedOptions = options || {};
  if (!slug || !ownerOffsets || ownerOffsets.length === 0 || !items || items.length === 0) return null;

  const groups = new Map();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.extractor !== 'context-fallback') continue;
    const key = item.associationGroupKey || ('root:' + item.rootIndex);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  if (groups.size === 0) return null;

  const scoredGroups = [];
  groups.forEach(function (groupItems, key) {
    let minDistance = Infinity;
    let hasTargetSlugNearby = false;
    for (let i = 0; i < groupItems.length; i++) {
      const d = typeof groupItems[i].ownerDistance === 'number' ? groupItems[i].ownerDistance : Infinity;
      if (d < minDistance) minDistance = d;
      if (groupItems[i].groupTargetSlugNearby === true) hasTargetSlugNearby = true;
    }
    if (hasTargetSlugNearby || minDistance <= OWNER_PROXIMITY_FALLBACK_BYTES) {
      scoredGroups.push({ key: key, items: groupItems, ownerDistance: minDistance, hasTargetSlugNearby: hasTargetSlugNearby });
    }
  });
  if (scoredGroups.length === 0) return null;
  if (relaxedOptions.requireSingleGroup && scoredGroups.length !== 1) return null;

  scoredGroups.sort(function (a, b) { return a.ownerDistance - b.ownerDistance; });
  const best = scoredGroups[0];
  const runnerUp = scoredGroups[1] || null;
  const uniqueNearest = !runnerUp || (runnerUp.ownerDistance - best.ownerDistance) > RELAXED_ASSOCIATION_UNIQUENESS_GAP_BYTES;
  if (!uniqueNearest) return null;

  return {
    pool: best.items,
    mode: 'relaxed-single-owner',
    reason: 'owner_proximity_relaxed_unique_nearest_segment_set',
    ownerDistance: best.ownerDistance,
    groupKey: best.key,
    hasTargetSlugNearby: best.hasTargetSlugNearby,
    compatibleGroupCount: scoredGroups.length,
  };
}

async function extractPhotoUrl(html, slug, eventContext, options) {
  const extractOptions = Object.assign(
    {
      includeOverlayFallback: true,
      allowRelaxedOwnerAssociation: true,
      relaxedRequiresSingleOwnerGroup: false,
      enableAlternateOwnerLinkingFallback: false,
      network: null,
    },
    options || {},
  );
  const makeFailure = function (reason, extra) {
    return Object.assign({ url: null, rejectReason: reason || null }, extra || {});
  };
  const hasSignatureFields = function (url) {
    return !!url && (url.includes('&v=') && url.includes('&t='));
  };
  const hasExpiryField = function (url) {
    return !!url && (url.includes('?e=') || url.includes('&e='));
  };
  const parseDimsFromUrl = function (url) {
    if (!url) return null;
    const m = url.match(/(?:shrink_|\/)(\d{2,4})_(\d{2,4})(?:\/|$)/i);
    if (!m) return null;
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    return { width: w, height: h };
  };
  const isObviousNonProfileAsset = function (url) {
    if (!url) return true;
    if (isDefaultAvatar(url)) return true;
    return /profile-displaybackgroundimage|background-image|cover-photo|ghost-person|ghosts\/person|default-avatar|anon-user/i.test(url);
  };
  const inferOwnerMatch = function (raw, strategyName, strategySlug) {
    if (raw && typeof raw.ownerMatch === 'string') return raw.ownerMatch;
    const rejectReason = raw && typeof raw.rejectReason === 'string' ? raw.rejectReason : '';
    if (/owner_mismatch|owner_proximity_reject/i.test(rejectReason)) return 'mismatch';
    if (!strategySlug) return 'unknown';
    if (strategyName === 'vector-image' || strategyName === 'licdn-regex') return 'probable';
    if (strategyName === 'overlay-photo') return 'probable';
    return 'unknown';
  };
  const normalizeStrategyResult = function (raw, strategyName, strategySlug, fallbackSource) {
    if (typeof raw === 'string') {
      return {
        url: raw,
        rejectReason: null,
        source: fallbackSource,
        ownerMatch: inferOwnerMatch({}, strategyName, strategySlug),
        reasons: [],
        ownerIdentifiers: [],
        ownerSourceLocation: null,
        ownerDistanceBytes: null,
      };
    }
    if (raw && typeof raw === 'object') {
      return {
        url: typeof raw.url === 'string' ? raw.url : null,
        rejectReason: typeof raw.rejectReason === 'string' ? raw.rejectReason : null,
        source: typeof raw.source === 'string' && raw.source ? raw.source : fallbackSource,
        ownerMatch: inferOwnerMatch(raw, strategyName, strategySlug),
        reasons: Array.isArray(raw.reasons) ? raw.reasons.slice(0, 12) : [],
        ownerIdentifiers: Array.isArray(raw.ownerIdentifiers)
          ? raw.ownerIdentifiers.filter(function (v) { return typeof v === 'string' && v.trim(); }).slice(0, 5)
          : (typeof raw.ownerPublicIdentifier === 'string' && raw.ownerPublicIdentifier
            ? [raw.ownerPublicIdentifier]
            : []),
        ownerSourceLocation:
          typeof raw.ownerSourceLocation === 'string' && raw.ownerSourceLocation
            ? raw.ownerSourceLocation
            : null,
        ownerDistanceBytes:
          typeof raw.ownerDistanceBytes === 'number' && Number.isFinite(raw.ownerDistanceBytes)
            ? raw.ownerDistanceBytes
            : null,
      };
    }
    return {
      url: null,
      rejectReason: null,
      source: fallbackSource,
      ownerMatch: inferOwnerMatch({}, strategyName, strategySlug),
      reasons: [],
      ownerIdentifiers: [],
      ownerSourceLocation: null,
      ownerDistanceBytes: null,
    };
  };
  const scoreCandidateComponents = function (candidate) {
    const baseByStrategy = {
      'vector-image': 65,
      'licdn-regex': 58,
      'overlay-photo': 52,
      'profile-img': 44,
      'json-ld': 40,
      'og:image': 34,
    };
    const base = baseByStrategy[candidate.strategy] || 30;
    const hostBonus = candidate.isMediaLicdn ? 12 : 0;
    const signatureBonus = candidate.hasSig ? 10 : 0;
    const expiryBonus = candidate.hasExpiry ? 8 : 0;
    const ownerBonus = candidate.ownerMatch === 'exact' ? 12 : (candidate.ownerMatch === 'probable' ? 6 : 0);
    const ownerPenalty = candidate.ownerMatch === 'mismatch' ? -30 : 0;
    const dimsBonus =
      candidate.dims && candidate.dims.width >= 300 && candidate.dims.height >= 300
        ? 6
        : 0;
    const nonProfilePenalty = candidate.isNonProfileAsset ? -45 : 0;
    const rawScore = base + hostBonus + signatureBonus + expiryBonus + ownerBonus + ownerPenalty + dimsBonus + nonProfilePenalty;
    const finalScore = Math.max(0, Math.min(100, rawScore));
    return {
      base: base,
      hostBonus: hostBonus,
      signatureBonus: signatureBonus,
      expiryBonus: expiryBonus,
      ownerBonus: ownerBonus,
      ownerPenalty: ownerPenalty,
      dimsBonus: dimsBonus,
      nonProfilePenalty: nonProfilePenalty,
      rawScore: rawScore,
      finalScore: finalScore,
    };
  };
  const scoreCandidate = function (candidate) {
    return scoreCandidateComponents(candidate).finalScore;
  };
  const minAcceptScore =
    options && typeof options.minAcceptScore === 'number'
      ? Math.max(0, Math.min(100, Math.floor(options.minAcceptScore)))
      : 80;
  const fallbackAllowed = !!(options && options.allowLowConfidenceFallback);
  const fallbackPolicyName =
    fallbackAllowed && options && typeof options.fallbackPolicyName === 'string' && options.fallbackPolicyName
      ? options.fallbackPolicyName
      : (fallbackAllowed ? 'top_score_min_threshold' : null);
  const keyAnchorSignals = {
    topCard:
      /pv-top-card-profile-picture|pv-top-card|top-card-profile-picture|profile-photo-edit__preview/i.test(html),
    jsonLd:
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>/i.test(html) &&
      /"@type"\s*:\s*"Person"/i.test(html),
  };
  const driftFlags = [];
  if (!keyAnchorSignals.topCard && !keyAnchorSignals.jsonLd) {
    driftFlags.push('missing_key_anchors');
  }
  const shouldTryAlternateOwnerLinking =
    extractOptions.enableAlternateOwnerLinkingFallback ||
    (driftFlags.indexOf('missing_key_anchors') !== -1 &&
      (/profile-displayphoto-shrink|fileIdentifyingUrlPathSegment|com\.linkedin\.common\.VectorImage/i.test(html)));
  if (driftFlags.length > 0) {
    console.warn(
      '[reknown-ext] drift flag triggered',
      JSON.stringify({
        driftFlags: driftFlags,
        keyAnchors: keyAnchorSignals,
        alternateOwnerLinking: shouldTryAlternateOwnerLinking,
      }),
    );
  }
  const chooseDominantRejectReason = function (strategyOutcomes) {
    const counts = new Map();
    for (let i = 0; i < strategyOutcomes.length; i++) {
      const reason = strategyOutcomes[i] && strategyOutcomes[i].rejectReason;
      if (!reason) continue;
      if (!counts.has(reason)) counts.set(reason, { count: 0, firstIndex: i });
      counts.get(reason).count++;
    }
    let bestReason = null;
    let bestCount = -1;
    let bestFirstIndex = Infinity;
    for (const [reason, meta] of counts.entries()) {
      if (meta.count > bestCount || (meta.count === bestCount && meta.firstIndex < bestFirstIndex)) {
        bestReason = reason;
        bestCount = meta.count;
        bestFirstIndex = meta.firstIndex;
      }
    }
    return bestReason;
  };
  const normalizeExplicitRejectCode = function (reason) {
    if (!reason || typeof reason !== 'string') return null;
    if (reason.indexOf('reject.') === 0) return reason;
    if (/owner_mismatch|owner_proximity_reject/i.test(reason)) return 'reject.owner_mismatch';
    if (/truncated_root_only/i.test(reason)) return 'reject.truncated_root_only';
    return null;
  };
  const getCandidateRejectCodes = function (candidate) {
    const codes = [];
    if (!candidate.isMediaLicdn) codes.push('reject.host_not_licdn');
    if (!candidate.hasSig) codes.push('reject.missing_sig');
    if (!candidate.hasExpiry) codes.push('reject.missing_expiry');
    if (candidate.ownerMatch === 'mismatch') codes.push('reject.owner_mismatch');
    if (isDefaultAvatar(candidate.url)) codes.push('reject.default_avatar');
    const strategyCode = normalizeExplicitRejectCode(candidate.rejectReason);
    if (strategyCode && codes.indexOf(strategyCode) === -1) codes.push(strategyCode);
    if (codes.length === 0) codes.push('reject.low_confidence');
    return codes;
  };
  const getDominantCandidateRejectCode = function (candidate) {
    const codes = getCandidateRejectCodes(candidate);
    return codes[0];
  };
  // Upfront HTML-landscape snapshot: single-line view of every interesting
  // marker so we can correlate strategy outcomes with the underlying page
  // shape without having to parse other logs.
  let snapshot = null;
  if (DEBUG_VERBOSE) {
    snapshot = {
      htmlLen: html.length,
      jsonLdPerson: countRegex(html, /"@type"\s*:\s*"Person"/g),
      ldJsonScripts: countRegex(html, /type=["']application\/ld\+json["']/g),
      ogImageMeta: countRegex(html, /property=["']og:image["']/g),
      pvTopCardPic: countOccurrences(html, 'pv-top-card-profile-picture'),
      profilePhotoEdit: countOccurrences(html, 'profile-photo-edit__preview'),
      vectorImage: countOccurrences(html, 'com.linkedin.common.VectorImage'),
      vectorArtifact: countOccurrences(html, 'com.linkedin.common.VectorArtifact'),
      filePathSegment: countOccurrences(html, 'fileIdentifyingUrlPathSegment'),
      displayPhoto: countOccurrences(html, 'profile-displayphoto-shrink'),
      displayBackground: countOccurrences(html, 'profile-displaybackgroundimage'),
      ghostPerson: countOccurrences(html, 'ghost-person') + countOccurrences(html, 'ghosts/person'),
      authwall: countOccurrences(html, 'authwall'),
      joinNow: countOccurrences(html, 'Join now'),
      signIn: countOccurrences(html, 'Sign in'),
      bpr: countOccurrences(html, 'bpr-guid'),
    };
    console.log('[reknown-ext] extractPhotoUrl: HTML landscape', JSON.stringify(snapshot));
  }

  const strategies = [
    { name: 'json-ld', version: 'jsonld_v1', fn: extractFromJsonLd, defaultSource: 'json-ld-image' },
    { name: 'og:image', version: 'ogimage_v1', fn: extractFromOgImage, defaultSource: 'og-image-meta' },
    { name: 'profile-img', version: 'profileimg_v1', fn: extractFromProfileImg, defaultSource: 'profile-image-tag' },
    {
      name: 'vector-image',
      version: 'vector_v1',
      fn: extractFromVectorImage,
      defaultSource: 'vector-image-object',
      strategyOptions: {
        allowRelaxedOwnerAssociation: !!extractOptions.allowRelaxedOwnerAssociation,
        relaxedRequiresSingleOwnerGroup: !!extractOptions.relaxedRequiresSingleOwnerGroup,
      },
    },
    {
      name: 'vector-image',
      version: 'vector_v2',
      fn: extractFromVectorImage,
      defaultSource: 'vector-image-object',
      onlyWhen: function () { return shouldTryAlternateOwnerLinking; },
      strategyOptions: {
        allowRelaxedOwnerAssociation: true,
        relaxedRequiresSingleOwnerGroup: false,
      },
    },
    { name: 'licdn-regex', version: 'licdn_v1', fn: extractFromLicdnRegex, defaultSource: 'licdn-root+artifact' },
  ];
  const outcomes = [];
  const allCandidates = [];
  const validCandidates = [];
  for (const strategyDef of strategies) {
    if (typeof strategyDef.onlyWhen === 'function' && !strategyDef.onlyWhen()) continue;
    const name = strategyDef.name;
    const strategyVersion = strategyDef.version || (name + '_v1');
    const fn = strategyDef.fn;
    const defaultSource = strategyDef.defaultSource;
    const t0 = Date.now();
    try {
      // All strategy fns accept (html, slug); most ignore the slug, but
      // vector-image and licdn-regex use it to pick the target's rootUrl
      // rather than whichever one happens to appear first in the page.
      const result = normalizeStrategyResult(
        await fn(html, slug, {
          allowRelaxedOwnerAssociation: !!(
            strategyDef.strategyOptions &&
            Object.prototype.hasOwnProperty.call(strategyDef.strategyOptions, 'allowRelaxedOwnerAssociation')
              ? strategyDef.strategyOptions.allowRelaxedOwnerAssociation
              : extractOptions.allowRelaxedOwnerAssociation
          ),
          relaxedRequiresSingleOwnerGroup: !!(
            strategyDef.strategyOptions &&
            Object.prototype.hasOwnProperty.call(strategyDef.strategyOptions, 'relaxedRequiresSingleOwnerGroup')
              ? strategyDef.strategyOptions.relaxedRequiresSingleOwnerGroup
              : extractOptions.relaxedRequiresSingleOwnerGroup
          ),
        }),
        name,
        slug,
        defaultSource,
      );
      const url = result.url;
      const dt = Date.now() - t0;
      const stageByStrategy = {
        'json-ld': 'extract.jsonld',
        'vector-image': 'extract.vector',
        'licdn-regex': 'extract.licdn',
      };
      if (stageByStrategy[name]) {
        debugEvent(stageByStrategy[name], {
          requestId: eventContext && eventContext.requestId,
          personId: eventContext && eventContext.personId,
          slug: slug || null,
          strategy: name,
          strategyVersion: strategyVersion,
          ms: dt,
          status: url ? 'ok' : 'empty',
          rejectReason: result.rejectReason || null,
          candidateUrl: url ? redactAndStripUrl(url) : null,
          candidateHost: url ? getUrlHost(url) : null,
          candidatePathTail: url ? getUrlPathTail(url) : null,
          candidateSource: name,
          confidenceScore: null,
        });
      }
      if (!url) {
        outcomes.push({ strategy: name, strategyVersion: strategyVersion, result: 'null', source: result.source, rejectReason: result.rejectReason || null, ms: dt });
        continue;
      }

      const host = getUrlHost(url);
      const isMediaLicdn = host === 'media.licdn.com';
      const hasSig = hasSignatureFields(url);
      const hasExpiry = hasExpiryField(url);
      const dims = parseDimsFromUrl(url);
      const isNonProfileAsset = isObviousNonProfileAsset(url);
      const reasons = [];
      reasons.push(isMediaLicdn ? 'pass:media.licdn host' : 'fail:non-media.licdn host');
      reasons.push(hasSig ? 'pass:signature fields present' : 'fail:missing signature fields');
      reasons.push(hasExpiry ? 'pass:expiry field present' : 'fail:missing expiry field');
      reasons.push(isNonProfileAsset ? 'fail:obvious non-profile asset' : 'pass:not obvious non-profile asset');
      if (result.rejectReason) reasons.push('strategyReject:' + result.rejectReason);
      if (result.ownerMatch === 'mismatch') reasons.push('fail:owner mismatch');
      if (result.ownerMatch === 'exact' || result.ownerMatch === 'probable') reasons.push('pass:owner association ' + result.ownerMatch);

      const candidate = {
        url: url,
        strategy: name,
        strategyVersion: strategyVersion,
        source: result.source || defaultSource,
        ownerMatch: result.ownerMatch || 'unknown',
        ownerIdentifiers: result.ownerIdentifiers || [],
        ownerSourceLocation: result.ownerSourceLocation || null,
        ownerDistanceBytes: result.ownerDistanceBytes,
        confidence: 0,
        reasons: result.reasons.concat(reasons),
        len: url.length,
        dims: dims,
        hasSig: hasSig,
        hasExpiry: hasExpiry,
        isMediaLicdn: isMediaLicdn,
        isNonProfileAsset: isNonProfileAsset,
        rejectReason: result.rejectReason || null,
        rejectReasons: [],
      };
      candidate.confidence = scoreCandidate(candidate);
      candidate.scoreComponents = scoreCandidateComponents(candidate);
      candidate.rejectReasons = getCandidateRejectCodes(candidate);
      candidate.rejectReason = getDominantCandidateRejectCode(candidate);
      candidate.urlPrefix = (summarizeCandidateUrl(candidate.url) || {}).prefix || null;
      candidate.urlHash = getNormalizedUrlFingerprint(candidate.url);

      const accepted = candidate.isMediaLicdn && candidate.hasSig && candidate.hasExpiry && !candidate.isNonProfileAsset && candidate.ownerMatch !== 'mismatch';
      allCandidates.push(candidate);
      console.log(
        '[reknown-ext] candidate.considered',
        JSON.stringify({
          strategy: candidate.strategy,
          strategyVersion: candidate.strategyVersion,
          source: candidate.source,
          ownerSourceLocation: candidate.ownerSourceLocation || name,
          ownerIdentifiers: candidate.ownerIdentifiers,
          ownerDistanceBytes:
            typeof candidate.ownerDistanceBytes === 'number' ? candidate.ownerDistanceBytes : null,
          slugProximity: {
            withinOwnerWindow:
              typeof candidate.ownerDistanceBytes === 'number' ? candidate.ownerDistanceBytes <= OWNER_PROXIMITY_BYTES : null,
            withinFallbackWindow:
              typeof candidate.ownerDistanceBytes === 'number' ? candidate.ownerDistanceBytes <= OWNER_PROXIMITY_FALLBACK_BYTES : null,
          },
          urlPrefix: candidate.urlPrefix,
          urlHash: candidate.urlHash,
          acceptance: {
            hardGates: {
              mediaLicdnHost: candidate.isMediaLicdn,
              signaturePresent: candidate.hasSig,
              expiryPresent: candidate.hasExpiry,
              notNonProfileAsset: !candidate.isNonProfileAsset,
              ownerNotMismatch: candidate.ownerMatch !== 'mismatch',
            },
            confidenceScore: candidate.confidence,
            minAcceptScore: minAcceptScore,
            minAcceptScoreHit: candidate.confidence >= minAcceptScore,
            scoreComponents: candidate.scoreComponents,
          },
        }),
      );
      outcomes.push({
        strategy: name,
        strategyVersion: strategyVersion,
        result: accepted ? 'candidate-accepted' : 'candidate-rejected',
        source: candidate.source,
        ownerMatch: candidate.ownerMatch,
        confidence: candidate.confidence,
        rejectReason: accepted ? null : candidate.rejectReason,
        rejectReasons: accepted ? [] : candidate.rejectReasons,
        len: candidate.len,
        dims: candidate.dims ? (candidate.dims.width + 'x' + candidate.dims.height) : null,
        hasSig: candidate.hasSig,
        hasExpiry: candidate.hasExpiry,
        ms: dt,
      });
      if (accepted) validCandidates.push(candidate);
      if (stageByStrategy[name]) {
        debugEvent(stageByStrategy[name], {
          requestId: eventContext && eventContext.requestId,
          personId: eventContext && eventContext.personId,
          slug: slug || null,
          strategy: name,
          strategyVersion: strategyVersion,
          ms: dt,
          status: accepted ? 'candidate-accepted' : 'candidate-rejected',
          rejectReason: accepted ? null : candidate.rejectReason,
          candidateUrl: redactAndStripUrl(candidate.url),
          candidateHost: getUrlHost(candidate.url),
          candidatePathTail: getUrlPathTail(candidate.url),
          candidateSource: name,
          confidenceScore: candidate.confidence,
        });
      }
    } catch (err) {
      console.warn('[reknown-ext] strategy failed', name, err);
      outcomes.push({ strategy: name, strategyVersion: strategyVersion, result: 'threw', error: String(err).substring(0, 100), ms: Date.now() - t0 });
    }
  }
  if (validCandidates.length === 0 && extractOptions.includeOverlayFallback) {
    const overlayStart = Date.now();
    try {
      const overlayResult = normalizeStrategyResult(
        await extractFromOverlayPhoto(slug, extractOptions.network),
        'overlay-photo',
        slug,
        'overlay-photo-img',
      );
      const overlayUrl = overlayResult.url;
      const dt = Date.now() - overlayStart;
      debugEvent('extract.overlay', {
        requestId: eventContext && eventContext.requestId,
        personId: eventContext && eventContext.personId,
        slug: slug || null,
        strategy: 'overlay-photo',
        strategyVersion: 'overlay_v1',
        ms: dt,
        status: overlayUrl ? 'ok' : 'empty',
        rejectReason: overlayResult.rejectReason || null,
        candidateUrl: overlayUrl ? redactAndStripUrl(overlayUrl) : null,
        candidateHost: overlayUrl ? getUrlHost(overlayUrl) : null,
        candidatePathTail: overlayUrl ? getUrlPathTail(overlayUrl) : null,
        candidateSource: 'overlay-photo',
        confidenceScore: null,
      });
      if (!overlayUrl) {
        outcomes.push({
          strategy: 'overlay-photo',
          strategyVersion: 'overlay_v1',
          result: 'null',
          source: overlayResult.source,
          rejectReason: overlayResult.rejectReason || null,
          ms: dt,
        });
      } else {
        const host = getUrlHost(overlayUrl);
        const isMediaLicdn = host === 'media.licdn.com';
        const hasSig = hasSignatureFields(overlayUrl);
        const hasExpiry = hasExpiryField(overlayUrl);
        const dims = parseDimsFromUrl(overlayUrl);
        const isNonProfileAsset = isObviousNonProfileAsset(overlayUrl);
        const reasons = [];
        reasons.push(isMediaLicdn ? 'pass:media.licdn host' : 'fail:non-media.licdn host');
        reasons.push(hasSig ? 'pass:signature fields present' : 'fail:missing signature fields');
        reasons.push(hasExpiry ? 'pass:expiry field present' : 'fail:missing expiry field');
        reasons.push(isNonProfileAsset ? 'fail:obvious non-profile asset' : 'pass:not obvious non-profile asset');
        if (overlayResult.rejectReason) reasons.push('strategyReject:' + overlayResult.rejectReason);
        if (overlayResult.ownerMatch === 'mismatch') reasons.push('fail:owner mismatch');
        if (overlayResult.ownerMatch === 'exact' || overlayResult.ownerMatch === 'probable') reasons.push('pass:owner association ' + overlayResult.ownerMatch);
      const candidate = {
          url: overlayUrl,
          strategy: 'overlay-photo',
          strategyVersion: 'overlay_v1',
          source: overlayResult.source || 'overlay-photo-img',
          ownerMatch: overlayResult.ownerMatch || 'unknown',
          ownerIdentifiers: overlayResult.ownerIdentifiers || [],
          ownerSourceLocation: overlayResult.ownerSourceLocation || 'overlay',
          ownerDistanceBytes: overlayResult.ownerDistanceBytes,
          confidence: 0,
          reasons: overlayResult.reasons.concat(reasons),
          len: overlayUrl.length,
          dims: dims,
          hasSig: hasSig,
          hasExpiry: hasExpiry,
          isMediaLicdn: isMediaLicdn,
          isNonProfileAsset: isNonProfileAsset,
          rejectReason: overlayResult.rejectReason || null,
          rejectReasons: [],
        };
        candidate.confidence = scoreCandidate(candidate);
        candidate.scoreComponents = scoreCandidateComponents(candidate);
        candidate.rejectReasons = getCandidateRejectCodes(candidate);
        candidate.rejectReason = getDominantCandidateRejectCode(candidate);
        candidate.urlPrefix = (summarizeCandidateUrl(candidate.url) || {}).prefix || null;
        candidate.urlHash = getNormalizedUrlFingerprint(candidate.url);
        const accepted = candidate.isMediaLicdn && candidate.hasSig && candidate.hasExpiry && !candidate.isNonProfileAsset && candidate.ownerMatch !== 'mismatch';
        allCandidates.push(candidate);
        console.log(
          '[reknown-ext] candidate.considered',
          JSON.stringify({
            strategy: candidate.strategy,
            strategyVersion: candidate.strategyVersion,
            source: candidate.source,
            ownerSourceLocation: candidate.ownerSourceLocation,
            ownerIdentifiers: candidate.ownerIdentifiers,
            ownerDistanceBytes:
              typeof candidate.ownerDistanceBytes === 'number' ? candidate.ownerDistanceBytes : null,
            slugProximity: {
              withinOwnerWindow:
                typeof candidate.ownerDistanceBytes === 'number' ? candidate.ownerDistanceBytes <= OWNER_PROXIMITY_BYTES : null,
              withinFallbackWindow:
                typeof candidate.ownerDistanceBytes === 'number' ? candidate.ownerDistanceBytes <= OWNER_PROXIMITY_FALLBACK_BYTES : null,
            },
            urlPrefix: candidate.urlPrefix,
            urlHash: candidate.urlHash,
            acceptance: {
              hardGates: {
                mediaLicdnHost: candidate.isMediaLicdn,
                signaturePresent: candidate.hasSig,
                expiryPresent: candidate.hasExpiry,
                notNonProfileAsset: !candidate.isNonProfileAsset,
                ownerNotMismatch: candidate.ownerMatch !== 'mismatch',
              },
              confidenceScore: candidate.confidence,
              minAcceptScore: minAcceptScore,
              minAcceptScoreHit: candidate.confidence >= minAcceptScore,
              scoreComponents: candidate.scoreComponents,
            },
          }),
        );
        outcomes.push({
          strategy: 'overlay-photo',
          strategyVersion: 'overlay_v1',
          result: accepted ? 'candidate-accepted' : 'candidate-rejected',
          source: candidate.source,
          ownerMatch: candidate.ownerMatch,
          confidence: candidate.confidence,
          rejectReason: accepted ? null : candidate.rejectReason,
          rejectReasons: accepted ? [] : candidate.rejectReasons,
          len: candidate.len,
          dims: candidate.dims ? (candidate.dims.width + 'x' + candidate.dims.height) : null,
          hasSig: candidate.hasSig,
          hasExpiry: candidate.hasExpiry,
          ms: dt,
        });
        if (accepted) validCandidates.push(candidate);
        debugEvent('extract.overlay', {
          requestId: eventContext && eventContext.requestId,
          personId: eventContext && eventContext.personId,
          slug: slug || null,
          strategy: 'overlay-photo',
          strategyVersion: 'overlay_v1',
          ms: dt,
          status: accepted ? 'candidate-accepted' : 'candidate-rejected',
          rejectReason: accepted ? null : candidate.rejectReason,
          candidateUrl: redactAndStripUrl(candidate.url),
          candidateHost: getUrlHost(candidate.url),
          candidatePathTail: getUrlPathTail(candidate.url),
          candidateSource: 'overlay-photo',
          confidenceScore: candidate.confidence,
        });
      }
    } catch (err) {
      console.warn('[reknown-ext] strategy failed', 'overlay-photo', err);
      outcomes.push({
        strategy: 'overlay-photo',
        strategyVersion: 'overlay_v1',
        result: 'threw',
        error: String(err).substring(0, 100),
        ms: Date.now() - overlayStart,
      });
    }
  }
  validCandidates.sort(function (a, b) { return b.confidence - a.confidence; });
  allCandidates.sort(function (a, b) { return b.confidence - a.confidence; });
  const primaryWinner = validCandidates.length > 0 ? validCandidates[0] : null;
  const fallbackWinner =
    !primaryWinner && fallbackAllowed
      ? (allCandidates.find(function (candidate) {
        return (
          candidate &&
          candidate.confidence >= minAcceptScore &&
          candidate.ownerMatch !== 'mismatch' &&
          !candidate.isNonProfileAsset
        );
      }) || null)
      : null;
  const winner = primaryWinner || fallbackWinner;
  const decisionStatus = primaryWinner
    ? 'accepted_primary'
    : (fallbackWinner ? 'accepted_fallback_low_confidence' : 'rejected_no_candidate');
  const decisionReason = primaryWinner
    ? 'primary_candidate_meets_hard_requirements'
    : (fallbackWinner ? 'fallback_top_candidate_meets_min_score' : 'no_candidate_met_acceptance_rules');
  const candidateSummary = validCandidates.map(function (c) {
    return {
      source: c.source,
      confidence: c.confidence,
      ownerMatch: c.ownerMatch,
      len: c.len,
      dims: c.dims ? (c.dims.width + 'x' + c.dims.height) : null,
      hasSig: c.hasSig,
      hasExpiry: c.hasExpiry,
    };
  });
  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] candidateSummary=' + JSON.stringify(candidateSummary),
      'winner=' + JSON.stringify(
        winner
          ? {
            source: winner.source,
            confidence: winner.confidence,
            ownerMatch: winner.ownerMatch,
            len: winner.len,
            dims: winner.dims ? (winner.dims.width + 'x' + winner.dims.height) : null,
            hasSig: winner.hasSig,
            hasExpiry: winner.hasExpiry,
          }
          : null
      ),
    );
  }
  debugEvent('candidate.rank', {
    requestId: eventContext && eventContext.requestId,
    personId: eventContext && eventContext.personId,
    slug: slug || null,
    strategy: winner ? winner.strategy : null,
    strategyVersion: winner ? winner.strategyVersion : null,
    ms: null,
    status: decisionStatus,
    decisionReason: decisionReason,
    score: winner ? winner.confidence : null,
    minAcceptScore: minAcceptScore,
    fallbackAllowed: fallbackAllowed,
    fallbackPolicyName: fallbackPolicyName,
    warning: decisionStatus === 'accepted_fallback_low_confidence',
    rejectReason: winner ? (winner.rejectReason || null) : (chooseDominantRejectReason(outcomes) || null),
    candidateCount: allCandidates.length,
    topCandidates: allCandidates
      .slice()
      .slice(0, 3)
      .map(function (c) {
        return {
          score: c.confidence,
          rejectReasons: c.rejectReasons,
          ownerIdentifiers: c.ownerIdentifiers || [],
          ownerSourceLocation: c.ownerSourceLocation || c.strategy,
          ownerDistanceBytes: typeof c.ownerDistanceBytes === 'number' ? c.ownerDistanceBytes : null,
          candidateUrlPrefix: c.urlPrefix || null,
          normalizedUrlFingerprint: getNormalizedUrlFingerprint(c.url),
          scoreComponents: c.scoreComponents || null,
          thresholdHits: {
            minAcceptScore: c.confidence >= minAcceptScore,
            hardAccept:
              c.isMediaLicdn && c.hasSig && c.hasExpiry && !c.isNonProfileAsset && c.ownerMatch !== 'mismatch',
          },
        };
      }),
  });
  if (!winner) {
    console.warn(
      '[reknown-ext] candidate.top3.masked.no_winner',
      JSON.stringify(
        allCandidates.slice(0, 3).map(function (c) {
          return {
            strategy: c.strategy,
            strategyVersion: c.strategyVersion || null,
            source: c.source,
            score: c.confidence,
            minAcceptScore: minAcceptScore,
            minAcceptScoreHit: c.confidence >= minAcceptScore,
            ownerSourceLocation: c.ownerSourceLocation || c.strategy,
            ownerIdentifiers: c.ownerIdentifiers || [],
            ownerDistanceBytes: typeof c.ownerDistanceBytes === 'number' ? c.ownerDistanceBytes : null,
            candidateUrlPrefix: c.urlPrefix || null,
            normalizedUrlFingerprint: c.urlHash || getNormalizedUrlFingerprint(c.url),
            rejectReasons: c.rejectReasons || [],
            scoreComponents: c.scoreComponents || null,
          };
        }),
      ),
    );
  }
  const topCandidatesForDebug = allCandidates
    .slice(0, 5)
    .map(function (c) {
      return {
        strategy: c.strategy,
        strategyVersion: c.strategyVersion || null,
        source: c.source || null,
        score: c.confidence,
        minAcceptScore: minAcceptScore,
        minAcceptScoreHit: c.confidence >= minAcceptScore,
        ownerMatch: c.ownerMatch || null,
        ownerIdentifiers: c.ownerIdentifiers || [],
        ownerSourceLocation: c.ownerSourceLocation || c.strategy || null,
        ownerDistanceBytes: typeof c.ownerDistanceBytes === 'number' ? c.ownerDistanceBytes : null,
        candidateUrlPrefix: c.urlPrefix || null,
        normalizedUrlFingerprint: c.urlHash || getNormalizedUrlFingerprint(c.url),
        rejectReasons: c.rejectReasons || [],
        scoreComponents: c.scoreComponents || null,
      };
    });
  if (winner) {
    console.log(
      '[reknown-ext] strategy matched',
      'strategy=' + winner.strategy,
      'version=' + (winner.strategyVersion || (winner.strategy + '_v1')),
      'source=' + winner.source,
      'score=' + winner.confidence,
    );
    logStageBoundary(
      {
        requestId: eventContext && eventContext.requestId,
        personId: eventContext && eventContext.personId,
        slug: slug || null,
      },
      'candidate.selected',
      null,
    );
    if (decisionStatus === 'accepted_fallback_low_confidence' && eventContext && eventContext.batchStats) {
      eventContext.batchStats.lowConfidenceFallbackAcceptedCount =
        (eventContext.batchStats.lowConfidenceFallbackAcceptedCount || 0) + 1;
    }
    return {
      url: winner.url,
      confidence: winner.confidence,
      ownerMatch: winner.ownerMatch,
      source: winner.source,
      reasons: winner.reasons,
      selectedCandidate: {
        score: winner.confidence,
        strategy: winner.strategy,
        strategyVersion: winner.strategyVersion || null,
        source: winner.source,
        decisionStatus: decisionStatus,
        warning: decisionStatus === 'accepted_fallback_low_confidence',
        selectedUrlFingerprint: getNormalizedUrlFingerprint(winner.url),
      },
      rejectReason: winner.rejectReason || null,
      dominantRejectReason: null,
      outcomes: outcomes,
      driftFlags: driftFlags,
    };
  }
  let dominantRejectReason = chooseDominantRejectReason(outcomes);
  dominantRejectReason = normalizeExplicitRejectCode(dominantRejectReason) || dominantRejectReason;
  const normalizedOutcomeReasons = outcomes
    .map(function (o) { return normalizeExplicitRejectCode(o && o.rejectReason) || (o && o.rejectReason) || null; })
    .filter(function (r) { return !!r; });
  if (normalizedOutcomeReasons.indexOf('reject.truncated_root_only') !== -1) {
    dominantRejectReason = 'reject.truncated_root_only';
  }
  const hasDisplayPhotoRootsWithoutArtifacts =
    /"rootUrl"\s*:\s*"[^"]*profile-displayphoto-shrink_?"/i.test(html) &&
    !/"fileIdentifyingUrlPathSegment"\s*:\s*"[^"]+"/i.test(html);
  if (hasDisplayPhotoRootsWithoutArtifacts && dominantRejectReason === 'no_displayphoto_artifacts') {
    dominantRejectReason = 'reject.truncated_root_only';
  }
  if (!dominantRejectReason) {
    const authwallLike = /authwall|checkpoint/i.test(html) || /Join now/i.test(html) || /sign[- ]?in/i.test(html);
    const hasDisplayPhotoArtifacts = /profile-displayphoto-shrink/i.test(html) || /fileIdentifyingUrlPathSegment/i.test(html);
    if (authwallLike) dominantRejectReason = 'authwall_like_response';
    else if (!hasDisplayPhotoArtifacts) dominantRejectReason = 'no_displayphoto_artifacts';
  } else if (dominantRejectReason === 'no_displayphoto_artifacts') {
    const authwallLike = /authwall|checkpoint/i.test(html) || /Join now/i.test(html) || /sign[- ]?in/i.test(html);
    if (authwallLike) dominantRejectReason = 'authwall_like_response';
  }
  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] all strategies failed, outcomes:',
      JSON.stringify(outcomes),
      'dominantRejectReason=' + (dominantRejectReason || 'none'),
      'snapshot=' + JSON.stringify(snapshot),
    );
  }
  return makeFailure(dominantRejectReason, {
    dominantRejectReason: dominantRejectReason || null,
    outcomes: outcomes,
    driftFlags: driftFlags,
    candidateDiagnostics: topCandidatesForDebug,
    decisionSummary: {
      decisionStatus: decisionStatus,
      decisionReason: decisionReason,
      minAcceptScore: minAcceptScore,
      fallbackAllowed: fallbackAllowed,
      fallbackPolicyName: fallbackPolicyName,
      candidateCount: allCandidates.length,
    },
  });
}

async function blobToDataUrl(blob) {
  // In a background page (non-persistent), FileReader is available.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

async function resizeBlob(blob) {
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
      if (DEBUG_VERBOSE) {
        console.log(
          '[reknown-ext] resize: canvas APIs unavailable, falling back to raw',
          'hasCreateImageBitmap=' + (typeof createImageBitmap),
          'hasOffscreenCanvas=' + (typeof OffscreenCanvas),
          'inputSize=' + blob.size,
        );
      }
      return await blobToDataUrl(blob);
    }
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_PHOTO_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] resize done',
        'inputSize=' + blob.size,
        'srcDims=' + bitmap.width + 'x' + bitmap.height,
        'scale=' + scale.toFixed(3),
        'outDims=' + w + 'x' + h,
        'outSize=' + outBlob.size,
      );
    }
    return await blobToDataUrl(outBlob);
  } catch (err) {
    console.warn('[reknown-ext] resize failed, falling back to original', err);
    return await blobToDataUrl(blob);
  }
}

function stableHash32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function extractTopPublicIdentifiers(html, limit) {
  const maxItems = Math.max(1, Math.min(10, typeof limit === 'number' ? limit : 5));
  if (!html || typeof html !== 'string') return [];
  const counts = new Map();
  const pattern = /"publicIdentifier"\s*:\s*"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const id = String(match[1] || '').trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(function (a, b) { return b[1] - a[1]; })
    .slice(0, maxItems)
    .map(function (entry) {
      return { publicIdentifier: entry[0], hits: entry[1] };
    });
}

function logProfilePayloadComparisonSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return;
  const entry = Object.assign({}, payload, {
    timestamp: new Date().toISOString(),
  });
  recentProfileDebugCache.push(entry);
  if (recentProfileDebugCache.length > RECENT_PROFILE_DEBUG_CACHE_LIMIT) {
    recentProfileDebugCache.splice(0, recentProfileDebugCache.length - RECENT_PROFILE_DEBUG_CACHE_LIMIT);
  }
  const sameFingerprintCount = recentProfileDebugCache.filter(function (item) {
    return item && item.htmlHash32 && payload.htmlHash32 && item.htmlHash32 === payload.htmlHash32;
  }).length;
  const recentComparisons = recentProfileDebugCache
    .slice(-3)
    .map(function (item) {
      return {
        slug: item.slug || null,
        htmlHash32: item.htmlHash32 || null,
        htmlLen: item.htmlLen || null,
        targetPublicIdentifierHits: item.targetPublicIdentifierHits || 0,
        topPublicIdentifiers: Array.isArray(item.topPublicIdentifiers) ? item.topPublicIdentifiers.slice(0, 3) : [],
      };
    });
  console.log(
    '[reknown-ext] profile_payload.compare',
    JSON.stringify({
      current: {
        slug: payload.slug || null,
        htmlHash32: payload.htmlHash32 || null,
        htmlLen: payload.htmlLen || null,
        targetPublicIdentifierHits: payload.targetPublicIdentifierHits || 0,
        topPublicIdentifiers: Array.isArray(payload.topPublicIdentifiers) ? payload.topPublicIdentifiers.slice(0, 5) : [],
      },
      recentWindowSize: recentProfileDebugCache.length,
      sameFingerprintCount: sameFingerprintCount,
      recentComparisons: recentComparisons,
    }),
  );
}

function maskSensitiveUrlBits(text) {
  if (!text) return '';
  return String(text)
    .replace(/([?&]t=)[^&"'\\\s<>]+/gi, '$1<redacted>')
    .replace(/([?&]v=)[^&"'\\\s<>]+/gi, '$1<redacted>')
    .replace(/([?&](?:e|sig|signature)=)[^&"'\\\s<>]+/gi, '$1<redacted>');
}

function summarizeCandidateUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const qIndex = url.indexOf('?');
  return {
    prefix: (qIndex === -1 ? url : url.substring(0, qIndex)).substring(0, 96),
    hasParams: {
      e: /[?&]e=/.test(url),
      v: /[?&]v=/.test(url),
      t: /[?&]t=/.test(url),
    },
  };
}

function redactAndStripUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return maskSensitiveUrlBits(parsed.toString());
  } catch (_err) {
    const cleaned = String(url).split('#')[0].split('?')[0];
    return maskSensitiveUrlBits(cleaned);
  }
}

function getUrlHost(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    return (new URL(url)).hostname.toLowerCase();
  } catch (_err) {
    return '';
  }
}

function getUrlPathTail(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const path = (new URL(url)).pathname || '';
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return '';
    return parts.slice(-2).join('/');
  } catch (_err) {
    return '';
  }
}

function getNormalizedUrlFingerprint(url) {
  const redacted = redactAndStripUrl(url);
  if (!redacted) return null;
  return stableHash32(redacted.toLowerCase());
}

function getLinkedInSlugFromProfileUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  const slugMatch = trimmed.match(/\/in\/([^\s/?#]+)/i);
  return slugMatch ? decodeURIComponent(slugMatch[1]) : '';
}

function getPhotoIntegritySpec() {
  const spec =
    globalThis.REKNOWN_PHOTO_INTEGRITY && globalThis.REKNOWN_PHOTO_INTEGRITY.PHOTO_INTEGRITY_SPEC
      ? globalThis.REKNOWN_PHOTO_INTEGRITY.PHOTO_INTEGRITY_SPEC
      : null;
  if (!spec) {
    return {
      photoHashAlgorithm: 'sha256',
      photoHashInput: 'data_url_utf8',
      photoHashPrefixLen: 12,
    };
  }
  return spec;
}

async function computeDataUrlSha256Prefix(dataUrl, prefixLen) {
  const len = Math.max(8, Math.min(12, prefixLen || 12));
  try {
    if (
      globalThis.REKNOWN_PHOTO_INTEGRITY &&
      typeof globalThis.REKNOWN_PHOTO_INTEGRITY.computePhotoHashPrefixFromDataUrl === 'function'
    ) {
      return await globalThis.REKNOWN_PHOTO_INTEGRITY.computePhotoHashPrefixFromDataUrl(dataUrl, len);
    }
    if (!globalThis.crypto || !globalThis.crypto.subtle) return null;
    const bytes = new TextEncoder().encode(String(dataUrl || '').normalize('NFC'));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const hashBytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < hashBytes.length; i++) {
      hex += hashBytes[i].toString(16).padStart(2, '0');
      if (hex.length >= len) break;
    }
    return hex.substring(0, len);
  } catch (_err) {
    return null;
  }
}

function compactNoPhotoFoundBundle(html, slug, extraction) {
  const decoded = normalizeLinkedInHtml(html || '', 'no-photo-bundle');
  const targetSlug = typeof slug === 'string' ? slug.toLowerCase() : '';
  const tokenCounts = {
    publicIdentifier: countOccurrences(decoded, 'publicIdentifier'),
    rootUrl: countOccurrences(decoded, 'rootUrl'),
    fileIdentifyingUrlPathSegment: countOccurrences(decoded, 'fileIdentifyingUrlPathSegment'),
    profileDisplayphoto: countOccurrences(decoded, 'profile-displayphoto'),
  };
  const targetPublicIdentifierHits = targetSlug
    ? countRegex(decoded, new RegExp('"publicIdentifier"\\s*:\\s*"' + escapeRegExp(targetSlug) + '"', 'gi'))
    : 0;
  const candidateRegex = /https:\/\/media\.licdn\.com\/dms\/image\/[^"'\\\s<>]*profile-displayphoto(?:-shrink)?[^"'\\\s<>]*/g;
  const ownerCounts = new Map();
  const snippets = [];
  const maskedUrls = [];
  let match;
  while ((match = candidateRegex.exec(decoded)) !== null && maskedUrls.length < 3) {
    const idx = match.index;
    const url = match[0];
    maskedUrls.push(summarizeCandidateUrl(maskSensitiveUrlBits(url)));
    const ownerWindow = decoded.substring(Math.max(0, idx - 450), Math.min(decoded.length, idx + 450));
    const pidRegex = /"publicIdentifier"\s*:\s*"([^"]+)"/g;
    let pidMatch;
    while ((pidMatch = pidRegex.exec(ownerWindow)) !== null) {
      const pid = pidMatch[1];
      ownerCounts.set(pid, (ownerCounts.get(pid) || 0) + 1);
    }
    const snipStart = Math.max(0, idx - 100);
    const snipEnd = Math.min(decoded.length, idx + 180);
    const snippet = maskSensitiveUrlBits(decoded.substring(snipStart, snipEnd)).replace(/\s+/g, ' ').trim();
    snippets.push(snippet.substring(0, 240));
  }
  const rejectedOutcomes = extraction && Array.isArray(extraction.outcomes)
    ? extraction.outcomes.filter(function (o) { return o && o.result === 'candidate-rejected'; }).slice(0, 3)
    : [];
  const candidateDiagnostics = extraction && Array.isArray(extraction.candidateDiagnostics)
    ? extraction.candidateDiagnostics.slice(0, 5)
    : [];
  const decisionSummary =
    extraction && extraction.decisionSummary && typeof extraction.decisionSummary === 'object'
      ? extraction.decisionSummary
      : null;
  const topOwners = Array.from(ownerCounts.entries())
    .sort(function (a, b) { return b[1] - a[1]; })
    .slice(0, 3)
    .map(function (entry) { return { publicIdentifier: entry[0], hitsNearCandidates: entry[1] }; });
  const fallbackSnippetAnchor = decoded.search(/profile-displayphoto|fileIdentifyingUrlPathSegment|rootUrl/i);
  if (snippets.length === 0 && fallbackSnippetAnchor !== -1) {
    const fallbackSnippet = decoded.substring(
      Math.max(0, fallbackSnippetAnchor - 100),
      Math.min(decoded.length, fallbackSnippetAnchor + 180),
    );
    snippets.push(maskSensitiveUrlBits(fallbackSnippet).replace(/\s+/g, ' ').trim().substring(0, 240));
  }
  if (slug && topOwners.length === 0) {
    topOwners.push({ publicIdentifier: slug, hitsNearCandidates: 0, note: 'target_slug_no_nearby_candidate_owner' });
  }
  return {
    htmlFingerprint: {
      length: decoded.length,
      hash32: stableHash32(decoded),
    },
    tokenCounts: tokenCounts,
    targetPublicIdentifierHits: targetPublicIdentifierHits,
    topOwnerIdentifiers: topOwners,
    maskedCandidateUrls: maskedUrls.filter(Boolean),
    rejectedMatchSnippets: snippets.slice(0, 3),
    rejectedOutcomes: rejectedOutcomes.map(function (o) {
      return {
        strategy: o.strategy || null,
        source: o.source || null,
        ownerMatch: o.ownerMatch || null,
        rejectReason: o.rejectReason || null,
        rejectReasons: Array.isArray(o.rejectReasons) ? o.rejectReasons.slice(0, 8) : [],
        hasSig: !!o.hasSig,
        hasExpiry: !!o.hasExpiry,
      };
    }),
    candidateDiagnostics: candidateDiagnostics,
    decisionSummary: decisionSummary,
  };
}

function getNoPhotoRetrySignal(html, slug, extraction, rejectReason, dominantRejectReason) {
  const compactBundle = compactNoPhotoFoundBundle(html, slug, extraction);
  const dominantOwnerIdentifier =
    compactBundle &&
    Array.isArray(compactBundle.topOwnerIdentifiers) &&
    compactBundle.topOwnerIdentifiers[0] &&
    typeof compactBundle.topOwnerIdentifiers[0].publicIdentifier === 'string'
      ? compactBundle.topOwnerIdentifiers[0].publicIdentifier
      : null;
  const normalizedReject =
    normalizeExplicitRejectCode(rejectReason) ||
    normalizeExplicitRejectCode(dominantRejectReason) ||
    rejectReason ||
    dominantRejectReason ||
    'no_photo_found';
  return {
    htmlFingerprint: compactBundle && compactBundle.htmlFingerprint ? compactBundle.htmlFingerprint : null,
    dominantOwnerIdentifier: dominantOwnerIdentifier,
    rejectionCode: normalizedReject,
    compactBundle: compactBundle,
  };
}

async function enrichOne(person, context) {
  const requestIdForDebug = context && context.requestId ? String(context.requestId) : '';
  applyDebugContext({ requestId: requestIdForDebug, slug: null });
  const rawUrl = person && person.linkedinUrl;
  const url = String(rawUrl || '').trim();
  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] enrichOne input',
      'personId=' + (person && person.id),
      'personName=' + (person && person.name),
      'rawUrlType=' + typeof rawUrl,
      'rawLen=' + (rawUrl ? String(rawUrl).length : 0),
      'trimmedLen=' + url.length,
      'hadWhitespace=' + (rawUrl ? (String(rawUrl) !== url) : false),
      'url=' + url.substring(0, 120),
      'matchesProfileRe=' + LINKEDIN_PROFILE_RE.test(url),
    );
  }
  if (!LINKEDIN_PROFILE_RE.test(url)) {
    return finalizeResult({ status: 'error', error: 'invalid_url' });
  }
  // publicIdentifier slug from the profile URL path. We use this inside
  // extractPhotoUrl to disambiguate the target's photo from the viewer's
  // own nav/menu photo when LinkedIn serves HTML containing both.
  const slug = getLinkedInSlugFromProfileUrl(url);
  const expectedProfilePath = slug ? '/in/' + slug.toLowerCase() : '';
  const eventBase = {
    requestId: requestIdForDebug || null,
    personId: person && person.id ? String(person.id) : null,
    slug: slug || null,
  };
  const stageContext = {
    requestId: eventBase.requestId,
    personId: eventBase.personId,
    slug: eventBase.slug,
  };
  if (context && context.batchStats && typeof context.batchStats === 'object') {
    eventBase.batchStats = context.batchStats;
  }
  const traceId = context && context.traceId ? String(context.traceId) : null;
  const batchRef = context && context.batch && typeof context.batch === 'object' ? context.batch : null;
  const requestScopedControllers = new Map();
  const profileFetchTimeoutMs = 15000;
  const photoFetchTimeoutMs = 20000;
  let fetchProfileDurationMs = null;
  const enrichLocalState = {
    selectedCandidate: null,
    photoDataUrl: null,
    photoBlob: null,
    photoHash: null,
  };
  const assertionMeta =
    context && context.assertionMeta && typeof context.assertionMeta === 'object'
      ? context.assertionMeta
      : null;
  if (
    assertionMeta &&
    assertionMeta.intendedPersonId &&
    eventBase.personId &&
    assertionMeta.intendedPersonId !== eventBase.personId
  ) {
    console.warn(
      '[reknown-ext] assertion.person_id_mismatch',
      'traceId=' + (traceId || ''),
      'intendedPersonId=' + assertionMeta.intendedPersonId,
      'actualPersonId=' + eventBase.personId,
    );
  }
  const selectedCandidateSourceInput = null;
  console.log(
    '[reknown-ext] enrichOne local-state start',
    'traceId=' + (traceId || ''),
    'personId=' + (eventBase.personId || ''),
    'selectedCandidate=' + JSON.stringify(enrichLocalState.selectedCandidate),
    'photoDataUrl=' + (enrichLocalState.photoDataUrl ? ('len:' + enrichLocalState.photoDataUrl.length) : null),
    'photoBlob=' + (enrichLocalState.photoBlob ? ('size:' + enrichLocalState.photoBlob.size) : null),
    'photoHash=' + (enrichLocalState.photoHash || null),
  );
  function finalizeResult(resultObj) {
    if (
      resultObj &&
      typeof resultObj === 'object' &&
      !Object.prototype.hasOwnProperty.call(resultObj, 'fetchProfileDurationMs')
    ) {
      resultObj.fetchProfileDurationMs = fetchProfileDurationMs;
    }
    if (!resultObj || typeof resultObj !== 'object') return resultObj;
    const selectedUrlFingerprint =
      enrichLocalState.selectedCandidate &&
      typeof enrichLocalState.selectedCandidate === 'object' &&
      typeof enrichLocalState.selectedCandidate.selectedUrlFingerprint === 'string'
        ? enrichLocalState.selectedCandidate.selectedUrlFingerprint
        : null;
    resultObj.progressMeta = Object.freeze({
      photoSha256Prefix:
        enrichLocalState.photoHash && typeof enrichLocalState.photoHash === 'string'
          ? enrichLocalState.photoHash
          : null,
      photoDataUrlLen:
        enrichLocalState.photoDataUrl && typeof enrichLocalState.photoDataUrl === 'string'
          ? enrichLocalState.photoDataUrl.length
          : 0,
      selectedUrlFingerprint: selectedUrlFingerprint,
    });
    return resultObj;
  }
  function withRequestController(stage, work) {
    if (batchRef && batchRef.cancelled) {
      console.log(
        '[reknown-ext] abort short-circuit',
        'requestId=' + (eventBase.requestId || ''),
        'personId=' + (eventBase.personId || ''),
        'stage=' + stage,
      );
      return Promise.reject(
        createTypedFetchError('fetch_cancelled', 'batch_cancelled_before_stage', { isBatchCancelled: true, stage: stage }),
      );
    }
    const requestController = new AbortController();
    const controllerKey = (eventBase.personId || 'unknown') + ':' + stage;
    const controllerEntry = {
      controller: requestController,
      personId: eventBase.personId || null,
      stage: stage,
    };
    requestScopedControllers.set(controllerKey, controllerEntry);
    if (batchRef && batchRef.activeControllers && typeof batchRef.activeControllers.set === 'function') {
      batchRef.activeControllers.set(controllerKey, controllerEntry);
    }
    return Promise.resolve()
      .then(() => work(requestController))
      .finally(() => {
        requestScopedControllers.delete(controllerKey);
        if (batchRef && batchRef.activeControllers && typeof batchRef.activeControllers.delete === 'function') {
          batchRef.activeControllers.delete(controllerKey);
        }
      });
  }
  applyDebugContext({ requestId: eventBase.requestId, slug: slug || null });
  const personFieldPresence = {
    hasPersonObject: !!(person && typeof person === 'object'),
    hasId: !!(person && person.id),
    hasName: !!(person && person.name),
    hasLinkedinUrl: !!url,
  };
  console.log(
    '[reknown-ext] enrichOne input snapshot',
    JSON.stringify({
      hasUrlOrCandidate: !!(url || selectedCandidateSourceInput),
      hasUrl: !!url,
      hasSelectedCandidate: !!selectedCandidateSourceInput,
      normalizedSlug: slug || null,
      selectedCandidateSource: selectedCandidateSourceInput,
      personFields: personFieldPresence,
      hasPhotoUrl: !!(person && typeof person.photoUrl === 'string' && person.photoUrl.trim()),
      hasPhotoData: !!(person && typeof person.photoDataUrl === 'string' && person.photoDataUrl.trim()),
    }),
  );
  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] enrichOne slug extracted',
      'slug=' + slug,
      'rawSegment=' + (slugMatch ? slugMatch[1] : ''),
    );
  }
  const fetchStart = Date.now();
  logStageBoundary(stageContext, 'fetch.started', fetchStart);
  let pageRes;
  try {
    pageRes = await withRequestController('fetch.profile', function (requestController) {
      return fetchWithTimeout(
        url,
        { credentials: 'include', redirect: 'follow' },
        {
          timeoutMs: profileFetchTimeoutMs,
          batch: batchRef,
          signal: requestController.signal,
          diagnosticContext: {
            stage: 'fetch.profile',
            requestId: eventBase.requestId || null,
            personId: eventBase.personId || null,
          },
        },
      );
    });
  } catch (err) {
    fetchProfileDurationMs = Date.now() - fetchStart;
    const fetchErrorCode =
      err && typeof err === 'object' && typeof err.errorCode === 'string'
        ? err.errorCode
        : (isFetchTimeoutError(err) ? 'timeout_abort' : 'network_error');
    const rejectReason = isFetchCancelledError(err)
      ? 'cancelled'
      : (isFetchTimeoutError(err) ? 'fetch_timeout' : 'fetch_failed');
    if (DEBUG_VERBOSE) console.warn('[reknown-ext] profile fetch threw', String(err), 'url=' + url);
    if (isFetchCancelledError(err)) {
      console.log(
        '[reknown-ext] abort handled',
        'requestId=' + (eventBase.requestId || ''),
        'personId=' + (eventBase.personId || ''),
        'stage=fetch.profile',
      );
    }
    debugEvent('fetch.profile', Object.assign({}, eventBase, { ms: Date.now() - fetchStart, status: 'error', rejectReason: rejectReason }));
    logStageBoundary(stageContext, 'fetch.completed', fetchStart);
    return finalizeResult({
      status: 'error',
      fetchProfileDurationMs: fetchProfileDurationMs,
      error: isFetchCancelledError(err)
        ? rejectReason
        : {
            code: fetchErrorCode,
            reason: rejectReason,
      },
    });
  }
  fetchProfileDurationMs = Date.now() - fetchStart;
  debugEvent('fetch.profile', Object.assign({}, eventBase, { ms: Date.now() - fetchStart, status: pageRes.ok ? 'ok' : 'http_error', rejectReason: null }));
  logStageBoundary(stageContext, 'fetch.completed', fetchStart);
  if (DEBUG_VERBOSE) {
    const pageHdrs = {};
    for (const key of ['content-type', 'content-length', 'content-encoding', 'server', 'x-li-fabric', 'x-li-pop', 'x-frame-options']) {
      const v = pageRes.headers.get(key);
      if (v) pageHdrs[key] = v;
    }
    console.log(
      '[reknown-ext] profile fetch response',
      'fetchMs=' + (Date.now() - fetchStart),
      'status=' + pageRes.status,
      'statusText=' + pageRes.statusText,
      'redirected=' + pageRes.redirected,
      'type=' + pageRes.type,
      'ok=' + pageRes.ok,
      'finalUrl=' + (pageRes.url || '').substring(0, 160),
      'expectedProfilePath=' + expectedProfilePath,
      'finalUrlContainsExpectedPath=' + (expectedProfilePath ? String(pageRes.url || '').toLowerCase().includes(expectedProfilePath) : false),
      'finalStillProfile=' + LINKEDIN_PROFILE_RE.test(pageRes.url || ''),
      'headers=' + JSON.stringify(pageHdrs),
    );
  }
  if (isRateLimited(pageRes)) {
    return finalizeResult({
      status: 'error',
      error: 'rate_limited',
      fatal: true,
      fetchProfileDurationMs: fetchProfileDurationMs,
    });
  }
  if (isLoginWall(pageRes)) {
    return finalizeResult({
      status: 'error',
      fetchProfileDurationMs: fetchProfileDurationMs,
      error: { code: 'challenge_page_detected', reason: 'login_wall' },
      fatal: true,
    });
  }
  if (pageRes.status >= 500) {
    return finalizeResult({
      status: 'error',
      fetchProfileDurationMs: fetchProfileDurationMs,
      error: { code: 'http_5xx', reason: 'status_' + pageRes.status },
    });
  }
  if (pageRes.status >= 400) {
    return finalizeResult({
      status: 'error',
      fetchProfileDurationMs: fetchProfileDurationMs,
      error: { code: 'http_4xx', reason: 'status_' + pageRes.status },
    });
  }
  let html;
  const parseStart = Date.now();
  logStageBoundary(stageContext, 'parse.started', parseStart);
  try {
    html = await pageRes.text();
  } catch (err) {
    if (DEBUG_VERBOSE) console.warn('[reknown-ext] profile body read threw', String(err));
    debugEvent('parse.snapshot', Object.assign({}, eventBase, { ms: null, status: 'error', rejectReason: 'fetch_failed' }));
    logStageBoundary(stageContext, 'parse.completed', parseStart);
    return finalizeResult({
      status: 'error',
      error: {
        code: 'parse_error',
        reason: 'response_text_read_failed',
      },
    });
  }
  if (!html || !html.trim()) {
    console.log(
      '[reknown-ext] enrichOne fetch payload snapshot',
      JSON.stringify({
        htmlNonEmpty: false,
        jsonPayloadNonEmpty: false,
        selectorsMatched: false,
      }),
    );
    debugEvent('parse.snapshot', Object.assign({}, eventBase, { ms: null, status: 'error', rejectReason: 'empty_body' }));
    logStageBoundary(stageContext, 'parse.completed', parseStart);
    return finalizeResult({
      status: 'error',
      error: {
        code: 'empty_body',
        reason: 'profile_html_empty',
      },
    });
  }
  const parserSignals = {
    hasJsonLdPerson: html.includes('"@type":"Person"') || html.includes('"@type": "Person"'),
    hasTopCardSelector: html.includes('pv-top-card'),
    hasDisplayPhotoSelector: html.includes('profile-displayphoto-shrink'),
  };
  const topPublicIdentifiers = extractTopPublicIdentifiers(html, 5);
  const targetPublicIdentifierHits = slug
    ? countRegex(
      html,
      new RegExp('"publicIdentifier"\\s*:\\s*"' + escapeRegExp(slug.toLowerCase()) + '"', 'gi'),
    )
    : 0;
  logProfilePayloadComparisonSnapshot({
    slug: slug || null,
    htmlHash32: stableHash32(html),
    htmlLen: html.length,
    targetPublicIdentifierHits: targetPublicIdentifierHits,
    topPublicIdentifiers: topPublicIdentifiers,
  });
  const jsonPayloadNonEmpty =
    (html.includes('application/ld+json') && parserSignals.hasJsonLdPerson) ||
    /"included"\s*:/.test(html) ||
    /"entityUrn"\s*:/.test(html);
  console.log(
    '[reknown-ext] enrichOne fetch payload snapshot',
    JSON.stringify({
      htmlNonEmpty: true,
      jsonPayloadNonEmpty: jsonPayloadNonEmpty,
      selectorsMatched: !!(
        parserSignals.hasJsonLdPerson ||
        parserSignals.hasTopCardSelector ||
        parserSignals.hasDisplayPhotoSelector
      ),
      parserSignals: parserSignals,
    }),
  );
  if (DEBUG_VERBOSE) {
    // Body-level sanity: truncation detector, logged-out-shell detector,
    // and a compact fingerprint so we can tell if LinkedIn is returning
    // an identical minimal shell for every profile (a common symptom of
    // the fetch being un-authenticated when the user expects it to be).
    const startsHtml = html.substring(0, 120);
    const endsHtml = html.substring(Math.max(0, html.length - 120));
    const fingerprint = html.length + '|' + startsHtml.charCodeAt(0) + '|' + endsHtml.charCodeAt(endsHtml.length - 1);
    const markers = {
      jsonLdPerson: html.includes('"@type":"Person"') || html.includes('"@type": "Person"'),
      ogImage: /property=["']og:image["']/i.test(html),
      displayPhoto: html.includes('profile-displayphoto-shrink'),
      vectorImage: html.includes('VectorImage'),
      rootUrl: html.includes('rootUrl'),
      filePathSegment: html.includes('fileIdentifyingUrlPathSegment'),
      authwall: /authwall|checkpoint/i.test(html),
      pvTopCard: html.includes('pv-top-card'),
      bprGuid: html.includes('bpr-guid'),
      joinNow: html.includes('Join now'),
      signIn: /sign[- ]?in/i.test(html),
      hasDoctype: /^<!doctype html/i.test(html),
      hasHtmlClose: html.indexOf('</html>') !== -1,
      entity61: html.includes('&#61;'),
      entityHex3D: /&#x3[dD];/.test(html),
      unicodeU003D: html.includes('\\u003d'),
      bsQuotes: html.includes('\\"'),
      targetPublicIdentifierHits:
        slug && slug.length > 0
          ? countRegex(
              html,
              new RegExp('"publicIdentifier"\\s*:\\s*"' + escapeRegExp(slug) + '"', 'gi'),
            )
          : 0,
      finalUrlContainsExpectedPath:
        expectedProfilePath.length > 0
          ? String(pageRes.url || '').toLowerCase().includes(expectedProfilePath)
          : false,
    };
    console.log(
      '[reknown-ext] page fetched status=' + pageRes.status,
      'finalUrl=' + (pageRes.url || '').substring(0, 120),
      'expectedProfilePath=' + expectedProfilePath,
      'htmlLen=' + html.length,
      'contentType=' + (pageRes.headers.get('content-type') || ''),
      'fingerprint=' + fingerprint,
      'startsWith=' + JSON.stringify(startsHtml.substring(0, 40)),
      'endsWith=' + JSON.stringify(endsHtml.substring(endsHtml.length - 40)),
      'markers=' + JSON.stringify(markers),
    );

    // Raw vs decoded snippet dump around first profile-displayphoto-shrink
    // occurrence. Gives us an unambiguous view of what encoding LinkedIn
    // is using *before* and *after* our normalizer touches it. Capped to
    // one pair per fetch.
    const dpIdx = html.indexOf('profile-displayphoto-shrink');
    if (dpIdx !== -1) {
      const rawStart = Math.max(0, dpIdx - 150);
      const rawEnd = Math.min(html.length, dpIdx + 450);
      const rawSnip = html.substring(rawStart, rawEnd);
      // Avoid invoking normalizeLinkedInHtml on the full page (which would
      // trigger an extra normalize-summary log); normalize just the snippet
      // for the comparison view.
      const decodedSnip = normalizeLinkedInHtml(rawSnip, 'snippet-probe');
      console.log('[reknown-ext] raw snippet around displayphoto (±):', rawSnip);
      console.log('[reknown-ext] decoded snippet around displayphoto (±):', decodedSnip);
    } else {
      console.log('[reknown-ext] no profile-displayphoto-shrink occurrence found in raw HTML');
    }
  }
  if (/<title>[^<]*(sign[- ]?in|login)[^<]*<\/title>/i.test(html) && /authwall|login/i.test(html)) {
    logStageBoundary(stageContext, 'parse.completed', parseStart);
    return finalizeResult({
      status: 'error',
      error: {
        code: 'challenge_page_detected',
        reason: 'authwall_like_html',
      },
      fatal: true,
    });
  }
  debugEvent('parse.snapshot', Object.assign({}, eventBase, { ms: null, status: 'ok', rejectReason: null }));
  logStageBoundary(stageContext, 'parse.completed', parseStart);
  let extraction = await extractPhotoUrl(html, slug, eventBase, {
    includeOverlayFallback: false,
    allowRelaxedOwnerAssociation: false,
  });
  let photoUrl =
    typeof extraction === 'string'
      ? extraction
      : (extraction && typeof extraction.url === 'string' ? extraction.url : null);
  let extractionRejectReason =
    extraction && typeof extraction === 'object' && typeof extraction.rejectReason === 'string'
      ? extraction.rejectReason
      : null;
  let extractionDominantRejectReason =
    extraction && typeof extraction === 'object' && typeof extraction.dominantRejectReason === 'string'
      ? extraction.dominantRejectReason
      : null;
  let extractionDriftFlags =
    extraction && typeof extraction === 'object' && Array.isArray(extraction.driftFlags)
      ? extraction.driftFlags.slice(0, 8)
      : [];
  enrichLocalState.selectedCandidate =
    extraction && typeof extraction === 'object' && Object.prototype.hasOwnProperty.call(extraction, 'selectedCandidate')
      ? extraction.selectedCandidate
      : null;
  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] extractPhotoUrl result:',
      photoUrl ? ('url=' + photoUrl) : 'null',
      'len=' + (photoUrl ? photoUrl.length : 0),
      'hasSignature=' + (photoUrl ? (photoUrl.includes('&v=') && photoUrl.includes('&t=')) : false),
      'hasExpiry=' + (photoUrl ? photoUrl.includes('?e=') : false),
      'endsWithBackslash=' + (photoUrl ? photoUrl.endsWith('\\') : false),
      'residualUnicodeEsc=' + (photoUrl ? /\\u00[0-9a-fA-F]{2}/.test(photoUrl) : false),
      'residualEntity=' + (photoUrl ? /&#\d+;|&#x[0-9a-fA-F]+;/.test(photoUrl) : false),
      'residualBsSlash=' + (photoUrl ? photoUrl.includes('\\/') : false),
      'hostIsMediaLicdn=' + (photoUrl ? /^https:\/\/media\.licdn\.com\//.test(photoUrl) : false),
      'rejectReason=' + (extractionRejectReason || ''),
      'dominantRejectReason=' + (extractionDominantRejectReason || ''),
      'driftFlags=' + JSON.stringify(extractionDriftFlags),
    );
  }
  if (!photoUrl) {
    const firstPassSignal = getNoPhotoRetrySignal(
      html,
      slug,
      extraction,
      extractionRejectReason,
      extractionDominantRejectReason,
    );
    const driftTriggered = extractionDriftFlags.indexOf('missing_key_anchors') !== -1;
    const retryPlan = driftTriggered
      ? ['profile_retry', 'relaxed_owner', 'overlay']
      : ['profile_retry', 'overlay', 'relaxed_owner'];
    const executed = [];
    let failFastDiagnosticCode = null;
    const jitterMs = 35 + Math.floor(Math.random() * 70);
    executed.push('profile_retry');
    await new Promise(function (resolve) { setTimeout(resolve, jitterMs); });
    try {
      const retryFetchStart = Date.now();
      const retryRes = await withRequestController('fetch.profile.retry', function (requestController) {
        return fetchWithTimeout(
          url,
          { credentials: 'include', redirect: 'follow' },
          { timeoutMs: profileFetchTimeoutMs, batch: batchRef, signal: requestController.signal },
        );
      });
      debugEvent('fetch.profile.retry', Object.assign({}, eventBase, {
        ms: Date.now() - retryFetchStart,
        status: retryRes.ok ? 'ok' : 'http_error',
        rejectReason: null,
      }));
      if (!isRateLimited(retryRes) && !isLoginWall(retryRes)) {
        html = await retryRes.text();
        if (!(/<title>[^<]*(sign[- ]?in|login)[^<]*<\/title>/i.test(html) && /authwall|login/i.test(html))) {
          extraction = await extractPhotoUrl(html, slug, eventBase, {
            includeOverlayFallback: false,
            allowRelaxedOwnerAssociation: false,
          });
          photoUrl =
            typeof extraction === 'string'
              ? extraction
              : (extraction && typeof extraction.url === 'string' ? extraction.url : null);
          extractionRejectReason =
            extraction && typeof extraction === 'object' && typeof extraction.rejectReason === 'string'
              ? extraction.rejectReason
              : null;
          extractionDominantRejectReason =
            extraction && typeof extraction === 'object' && typeof extraction.dominantRejectReason === 'string'
              ? extraction.dominantRejectReason
              : null;
          extractionDriftFlags =
            extraction && typeof extraction === 'object' && Array.isArray(extraction.driftFlags)
              ? extraction.driftFlags.slice(0, 8)
              : extractionDriftFlags;
        }
      }
    } catch (retryErr) {
      if (DEBUG_VERBOSE) console.warn('[reknown-ext] profile retry fetch threw', String(retryErr));
      if (isFetchCancelledError(retryErr)) {
        console.log(
          '[reknown-ext] abort handled',
          'requestId=' + (eventBase.requestId || ''),
          'personId=' + (eventBase.personId || ''),
          'stage=fetch.profile.retry',
        );
      }
      debugEvent('fetch.profile.retry', Object.assign({}, eventBase, {
        ms: null,
        status: 'error',
        rejectReason: isFetchCancelledError(retryErr)
          ? 'cancelled'
          : (isFetchTimeoutError(retryErr) ? 'fetch_timeout' : 'fetch_failed'),
      }));
      if (isFetchCancelledError(retryErr)) {
        return finalizeResult({ status: 'error', error: 'cancelled' });
      }
    }
    if (!photoUrl) {
      const retrySignal = getNoPhotoRetrySignal(
        html,
        slug,
        extraction,
        extractionRejectReason,
        extractionDominantRejectReason,
      );
      const firstFingerprint = firstPassSignal && firstPassSignal.htmlFingerprint
        ? firstPassSignal.htmlFingerprint
        : null;
      const retryFingerprint = retrySignal && retrySignal.htmlFingerprint
        ? retrySignal.htmlFingerprint
        : null;
      const sameHtmlFingerprint = !!(
        firstFingerprint &&
        retryFingerprint &&
        firstFingerprint.length === retryFingerprint.length &&
        firstFingerprint.hash32 === retryFingerprint.hash32
      );
      const sameDominantOwnerIdentifier =
        (firstPassSignal ? firstPassSignal.dominantOwnerIdentifier : null) ===
        (retrySignal ? retrySignal.dominantOwnerIdentifier : null);
      const sameRejectionCode =
        (firstPassSignal ? firstPassSignal.rejectionCode : null) ===
        (retrySignal ? retrySignal.rejectionCode : null);
      if (
        sameHtmlFingerprint &&
        sameDominantOwnerIdentifier &&
        sameRejectionCode &&
        retrySignal.rejectionCode === 'reject.owner_mismatch'
      ) {
        failFastDiagnosticCode = 'owner_mismatch_stable';
        console.warn(
          '[reknown-ext] retry fail-fast',
          JSON.stringify({
            code: failFastDiagnosticCode,
            htmlFingerprint: retryFingerprint,
            dominantOwnerIdentifier: retrySignal.dominantOwnerIdentifier,
            rejectionCode: retrySignal.rejectionCode,
            executed: executed.slice(),
          }),
        );
      }
    }
    const runRelaxedOwnerBeforeOverlay = driftTriggered;
    if (!photoUrl && !failFastDiagnosticCode && runRelaxedOwnerBeforeOverlay) {
      executed.push('relaxed_owner');
      extraction = await extractPhotoUrl(html, slug, eventBase, {
        includeOverlayFallback: false,
        allowRelaxedOwnerAssociation: true,
        relaxedRequiresSingleOwnerGroup: true,
        allowLowConfidenceFallback: true,
        minAcceptScore: 58,
        fallbackPolicyName: 'drift_relaxed_owner_low_confidence',
        enableAlternateOwnerLinkingFallback: true,
      });
      photoUrl =
        typeof extraction === 'string'
          ? extraction
          : (extraction && typeof extraction.url === 'string' ? extraction.url : null);
      extractionRejectReason =
        extraction && typeof extraction === 'object' && typeof extraction.rejectReason === 'string'
          ? extraction.rejectReason
          : null;
      extractionDominantRejectReason =
        extraction && typeof extraction === 'object' && typeof extraction.dominantRejectReason === 'string'
          ? extraction.dominantRejectReason
          : null;
      extractionDriftFlags =
        extraction && typeof extraction === 'object' && Array.isArray(extraction.driftFlags)
          ? extraction.driftFlags.slice(0, 8)
          : extractionDriftFlags;
    }
    if (!photoUrl && !failFastDiagnosticCode) {
      executed.push('overlay');
      extraction = await extractPhotoUrl(html, slug, eventBase, {
        includeOverlayFallback: true,
        allowRelaxedOwnerAssociation: false,
        network: { timeoutMs: profileFetchTimeoutMs, batch: batchRef },
      });
      photoUrl =
        typeof extraction === 'string'
          ? extraction
          : (extraction && typeof extraction.url === 'string' ? extraction.url : null);
      extractionRejectReason =
        extraction && typeof extraction === 'object' && typeof extraction.rejectReason === 'string'
          ? extraction.rejectReason
          : null;
      extractionDominantRejectReason =
        extraction && typeof extraction === 'object' && typeof extraction.dominantRejectReason === 'string'
          ? extraction.dominantRejectReason
          : null;
      extractionDriftFlags =
        extraction && typeof extraction === 'object' && Array.isArray(extraction.driftFlags)
          ? extraction.driftFlags.slice(0, 8)
          : extractionDriftFlags;
    }
    if (!photoUrl && !failFastDiagnosticCode && !runRelaxedOwnerBeforeOverlay) {
      executed.push('relaxed_owner');
      extraction = await extractPhotoUrl(html, slug, eventBase, {
        includeOverlayFallback: false,
        allowRelaxedOwnerAssociation: true,
        relaxedRequiresSingleOwnerGroup: true,
        allowLowConfidenceFallback: true,
        minAcceptScore: 58,
        fallbackPolicyName: 'relaxed_owner_low_confidence',
      });
      photoUrl =
        typeof extraction === 'string'
          ? extraction
          : (extraction && typeof extraction.url === 'string' ? extraction.url : null);
      extractionRejectReason =
        extraction && typeof extraction === 'object' && typeof extraction.rejectReason === 'string'
          ? extraction.rejectReason
          : null;
      extractionDominantRejectReason =
        extraction && typeof extraction === 'object' && typeof extraction.dominantRejectReason === 'string'
          ? extraction.dominantRejectReason
          : null;
      extractionDriftFlags =
        extraction && typeof extraction === 'object' && Array.isArray(extraction.driftFlags)
          ? extraction.driftFlags.slice(0, 8)
          : extractionDriftFlags;
    }
    console.log(
      '[reknown-ext] enrichOne retry decision',
      'retryPlan=' + JSON.stringify(retryPlan),
      'executed=' + JSON.stringify(executed),
      'driftFlags=' + JSON.stringify(extractionDriftFlags),
      'failFastDiagnosticCode=' + (failFastDiagnosticCode || ''),
      'finalDecision=' + (photoUrl ? 'photo_found' : 'no_photo_found'),
    );
    if (!photoUrl && failFastDiagnosticCode) {
      extractionRejectReason = failFastDiagnosticCode;
      extractionDominantRejectReason = failFastDiagnosticCode;
    }
  }
  if (!photoUrl) {
    const compactBundle = compactNoPhotoFoundBundle(html, slug, extraction);
    console.warn(
      '[reknown-ext] no_photo_found compact bundle',
      JSON.stringify(Object.assign({}, compactBundle, {
        requestedProfileUrl: url.substring(0, 160),
        fetchedFinalUrl: String(pageRes && pageRes.url ? pageRes.url : '').substring(0, 160),
        expectedProfilePath: expectedProfilePath,
        finalUrlContainsExpectedPath:
          expectedProfilePath.length > 0
            ? String(pageRes && pageRes.url ? pageRes.url : '').toLowerCase().includes(expectedProfilePath)
            : false,
        rejectReason: extractionRejectReason || extractionDominantRejectReason || 'no_photo_found',
      })),
    );
    debugEvent('result', Object.assign({}, eventBase, {
      strategy: null,
      ms: null,
      status: 'error',
      rejectReason: extractionRejectReason || extractionDominantRejectReason || 'no_photo_found',
      photoSha256Prefix: null,
      photoByteLength: null,
      requestId: eventBase.requestId,
      personId: eventBase.personId,
      slug: eventBase.slug,
    }));
    return finalizeResult({
      status: 'error',
      error: {
        code:
          extractionRejectReason === 'owner_mismatch_stable' ||
          extractionDominantRejectReason === 'owner_mismatch_stable'
            ? 'owner_mismatch_stable'
            : 'no_photo_found',
        reason: extractionRejectReason || extractionDominantRejectReason || null,
        dominantRejectReason: extractionDominantRejectReason || extractionRejectReason || null,
      },
    });
  }
  if (isDefaultAvatar(photoUrl)) {
    return finalizeResult({ status: 'error', error: 'default_avatar' });
  }
  if (DEBUG_VERBOSE) {
    console.log('[reknown-ext] fetching photo url=' + photoUrl);
  }
  const photoFetchStart = Date.now();
  let imgRes;
  try {
    imgRes = await withRequestController('fetch.photo', function (requestController) {
      return fetchWithTimeout(
        photoUrl,
        {
          credentials: 'include',
          referrer: 'https://www.linkedin.com/',
          referrerPolicy: 'strict-origin-when-cross-origin',
        },
        { timeoutMs: photoFetchTimeoutMs, batch: batchRef, signal: requestController.signal },
      );
    });
  } catch (err) {
    const rejectReason = isFetchCancelledError(err)
      ? 'cancelled'
      : (isFetchTimeoutError(err) ? 'fetch_timeout' : 'fetch_failed');
    if (DEBUG_VERBOSE) console.warn('[reknown-ext] photo fetch threw', String(err));
    if (isFetchCancelledError(err)) {
      console.log(
        '[reknown-ext] abort handled',
        'requestId=' + (eventBase.requestId || ''),
        'personId=' + (eventBase.personId || ''),
        'stage=fetch.photo',
      );
    }
    debugEvent('fetch.photo', Object.assign({}, eventBase, { ms: Date.now() - photoFetchStart, status: 'error', rejectReason: rejectReason }));
    return finalizeResult({ status: 'error', error: rejectReason });
  }
  debugEvent('fetch.photo', Object.assign({}, eventBase, {
    ms: Date.now() - photoFetchStart,
    status: imgRes.ok ? 'ok' : 'http_error',
    rejectReason: null,
    finalFetchUrl: redactAndStripUrl(imgRes.url || photoUrl),
    httpStatus: imgRes.status,
    contentType: imgRes.headers.get('content-type') || null,
    bytesDownloaded: null,
  }));
  if (DEBUG_VERBOSE) {
    const hdrs = {};
    for (const key of ['content-type', 'content-length', 'server', 'x-li-fabric', 'x-li-pop', 'x-cache', 'cf-ray']) {
      const v = imgRes.headers.get(key);
      if (v) hdrs[key] = v;
    }
    console.log(
      '[reknown-ext] photo fetch response status=' + imgRes.status,
      'statusText=' + imgRes.statusText,
      'type=' + imgRes.type,
      'redirected=' + imgRes.redirected,
      'ok=' + imgRes.ok,
      'fetchMs=' + (Date.now() - photoFetchStart),
      'url=' + (imgRes.url || '').substring(0, 120),
      'finalRedirectedToGhost=' + /ghosts|default-avatar|anon-user/i.test(imgRes.url || ''),
      'headers=' + JSON.stringify(hdrs),
    );
  }
  if (!imgRes.ok) {
    if (DEBUG_VERBOSE) {
      try {
        const errBody = await imgRes.text();
        console.warn('[reknown-ext] photo fetch error body (first 300):', errBody.substring(0, 300));
      } catch { /* ignore body read failure */ }
    }
    debugEvent('result', Object.assign({}, eventBase, {
      ms: null,
      status: 'error',
      rejectReason: 'fetch_failed',
      photoSha256Prefix: null,
      photoByteLength: null,
      requestId: eventBase.requestId,
      personId: eventBase.personId,
      slug: eventBase.slug,
    }));
    return finalizeResult({ status: 'error', error: 'fetch_failed' });
  }
  let blob;
  try {
    blob = await imgRes.blob();
  } catch (err) {
    if (DEBUG_VERBOSE) console.warn('[reknown-ext] photo blob read threw', String(err));
    debugEvent('result', Object.assign({}, eventBase, {
      ms: null,
      status: 'error',
      rejectReason: 'fetch_failed',
      photoSha256Prefix: null,
      photoByteLength: null,
      requestId: eventBase.requestId,
      personId: eventBase.personId,
      slug: eventBase.slug,
    }));
    return finalizeResult({ status: 'error', error: 'fetch_failed' });
  }
  enrichLocalState.photoBlob = blob;
  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] photo blob',
      'size=' + blob.size,
      'type=' + blob.type,
      'suspiciouslySmall=' + (blob.size < 1024),
    );
  }
  debugEvent('fetch.photo', Object.assign({}, eventBase, {
    ms: Date.now() - photoFetchStart,
    status: 'complete',
    rejectReason: null,
    finalFetchUrl: redactAndStripUrl(imgRes.url || photoUrl),
    httpStatus: imgRes.status,
    contentType: imgRes.headers.get('content-type') || blob.type || null,
    bytesDownloaded: blob.size,
  }));
  try {
    const dataUrl = await resizeBlob(blob);
    const integritySpec = getPhotoIntegritySpec();
    const photoSha256Prefix = await computeDataUrlSha256Prefix(dataUrl, integritySpec.photoHashPrefixLen);
    enrichLocalState.photoHash = photoSha256Prefix;
    enrichLocalState.photoDataUrl = dataUrl;
    if (DEBUG_VERBOSE) {
      // Message-passing to the tab has a size cap; huge data URLs can be
      // silently dropped on some browsers. Flag that here so we see it
      // correlated with a missing UI update rather than having to dig
      // through `sendToTab` failures.
      console.log(
        '[reknown-ext] photo encoded',
        'dataUrlLen=' + dataUrl.length,
        'prefix=' + dataUrl.substring(0, 32),
        'approxMB=' + (dataUrl.length / (1024 * 1024)).toFixed(2),
        'overMessageCap=' + (dataUrl.length > 60 * 1024 * 1024),
      );
    }
    // Return the raw licdn URL alongside the base64 data URL so the web
    // app can persist it on the person. Having the original URL stored
    // means the "Edit person" form has something to show in the Photo URL
    // field instead of appearing blank after a successful enrichment.
    debugEvent('result', Object.assign({}, eventBase, {
      ms: null,
      status: 'success',
      rejectReason: null,
      photoSha256Prefix: photoSha256Prefix,
      photoByteLength: blob.size,
      requestId: eventBase.requestId,
      personId: eventBase.personId,
      slug: eventBase.slug,
    }));
    const resultPayload = { status: 'success', photoDataUrl: dataUrl, photoUrl: photoUrl };
    return finalizeResult(resultPayload);
  } catch (err) {
    if (DEBUG_VERBOSE) console.warn('[reknown-ext] resize threw', String(err));
    debugEvent('result', Object.assign({}, eventBase, {
      ms: null,
      status: 'error',
      rejectReason: 'fetch_failed',
      photoSha256Prefix: null,
      photoByteLength: blob && typeof blob.size === 'number' ? blob.size : null,
      requestId: eventBase.requestId,
      personId: eventBase.personId,
      slug: eventBase.slug,
    }));
    return finalizeResult({ status: 'error', error: 'fetch_failed' });
  }
}

async function runBatch(requestId, people, tabId) {
  ensureStartupHealthProbe();
  await ensureThrottleConfigReady();
  await ensureDebugConfigReady();
  applyDebugContext({ requestId: requestId, slug: null });
  const throttleCfg = getActiveThrottleConfig();
  const batch = { cancelled: false, activeControllers: new Map() };
  const batchStats = {
    lowConfidenceFallbackAcceptedCount: 0,
  };
  let previousProgressMeta = null;
  activeBatches.set(requestId, batch);
  const batchStart = Date.now();
  console.log(
    '[reknown-ext] runBatch start requestId=' + requestId,
    'count=' + people.length,
    'tabId=' + tabId,
    'ext=' + EXT_VERSION,
    'deepLogs=' + DEBUG_VERBOSE,
    'debugConfig=' + JSON.stringify(activeDebugConfig),
    'profile=' + throttleCfg.profile,
    'throttle=' + JSON.stringify(throttleCfg),
  );
  // Log the shape of the first few person objects — a malformed payload
  // from the web app is a plausible silent-failure source.
  if (DEBUG_VERBOSE) {
    const sample = people.slice(0, Math.min(3, people.length)).map(function (p, i) {
      return {
        i: i,
        hasId: !!(p && p.id),
        hasName: !!(p && p.name),
        hasLinkedinUrl: !!(p && p.linkedinUrl),
        urlType: typeof (p && p.linkedinUrl),
        urlLen: p && p.linkedinUrl ? String(p.linkedinUrl).length : 0,
        urlPrefix: p && p.linkedinUrl ? String(p.linkedinUrl).substring(0, 60) : null,
        keys: p ? Object.keys(p).slice(0, 8) : null,
      };
    });
    console.log('[reknown-ext] runBatch person-sample', JSON.stringify(sample));
  }
  let success = 0;
  let failed = 0;
  const failuresByCode = { internal_error: 0 };
  const failuresByDominantRejectReason = {};
  const fetchDurationsMs = [];
  let firstFailureTimestamp = null;
  try {
    for (let i = 0; i < people.length; i++) {
      if (batch.cancelled) {
        if (DEBUG_VERBOSE) console.log('[reknown-ext] runBatch: cancelled at loop-top i=' + i);
        break;
      }
      const person = people[i];
      const personStart = Date.now();
      const personIdForTrace = person && person.id ? String(person.id) : 'unknown';
      const personSlug = getLinkedInSlugFromProfileUrl(person && person.linkedinUrl);
      const personStageContext = {
        requestId: requestId,
        personId: person && person.id ? String(person.id) : null,
        slug: personSlug || null,
      };
      const traceId = [String(requestId || 'req'), String(personIdForTrace), String(i), Date.now().toString(36)].join(':');
      console.log(
        '[reknown-ext] enriching',
        i + 1 + '/' + people.length,
        'name=' + (person && person.name),
        'elapsedBatchMs=' + (personStart - batchStart),
      );
      if (
        previousProgressMeta &&
        previousProgressMeta.intendedPersonId &&
        previousProgressMeta.intendedPersonId !== personIdForTrace &&
        previousProgressMeta.photoDataUrlLen > 0
      ) {
        console.warn(
          '[reknown-ext] assertion.previous_progress_meta',
          'traceId=' + traceId,
          'personId=' + personIdForTrace,
          'previousPersonId=' + previousProgressMeta.intendedPersonId,
          'previousPhotoDataUrlLen=' + String(previousProgressMeta.photoDataUrlLen || 0),
        );
      }
      const immutableProgressMeta = Object.freeze({
        intendedPersonId: person && person.id ? String(person.id) : null,
        slug: personSlug,
        photoSha256Prefix: null,
        photoDataUrlLen: 0,
        selectedUrlFingerprint: null,
      });
      sendToTab(tabId, {
        type: 'REKNOWN_ENRICH_PROGRESS',
        requestId,
        personId: person.id,
        personName: person.name,
        status: 'started',
        index: i,
        total: people.length,
        intendedPersonId: immutableProgressMeta.intendedPersonId,
        slug: immutableProgressMeta.slug,
        photoSha256Prefix: immutableProgressMeta.photoSha256Prefix,
        photoDataUrlLen: immutableProgressMeta.photoDataUrlLen,
        selectedUrlFingerprint: immutableProgressMeta.selectedUrlFingerprint,
      });
      let result;
      try {
        result = await enrichOne(person, {
          requestId,
          traceId: traceId,
          assertionMeta: immutableProgressMeta,
          batchStats,
          batch,
        });
      } catch (err) {
        const stage = 'runBatch.enrichOne';
        const errorStackPreview = trimErrorStack(err, 7);
        console.error(
          '[reknown-ext] unexpected exception in enrichOne',
          JSON.stringify({
            stage: stage,
            requestId: requestId,
            personId: person && person.id ? String(person.id) : null,
            slug: personSlug || null,
            exceptionName: err && err.name ? err.name : 'Error',
            exceptionMessage: err && err.message ? err.message : String(err),
            stack: errorStackPreview,
          }),
        );
        emitInternalExceptionTelemetry(stage, {
          requestId: requestId,
          personId: person && person.id ? String(person.id) : null,
          slug: personSlug || null,
        }, err);
        result = { status: 'error', error: createInternalErrorResult(err) };
      }
      const resultErrorLog =
        result && typeof result.error === 'object' && result.error !== null
          ? JSON.stringify(result.error)
          : String(result && result.error);
      console.log(
        '[reknown-ext] enrichOne result status=' + (result && result.status),
        'error=' + resultErrorLog,
        'personMs=' + (Date.now() - personStart),
        'cancelledDuring=' + batch.cancelled,
      );
      if (batch.cancelled) break;
      if (result && Number.isFinite(result.fetchProfileDurationMs)) {
        fetchDurationsMs.push(result.fetchProfileDurationMs);
      }
      if (result.status === 'success') {
        success++;
        const successDataUrlLen =
          result && typeof result.photoDataUrl === 'string' ? result.photoDataUrl.length : 0;
        const resultProgressMeta = Object.freeze(
          Object.assign({}, immutableProgressMeta, result && result.progressMeta && typeof result.progressMeta === 'object' ? result.progressMeta : {}),
        );
        sendToTab(tabId, {
          type: 'REKNOWN_ENRICH_PROGRESS',
          requestId,
          personId: person.id,
          personName: person.name,
          status: 'success',
          photoDataUrl: result.photoDataUrl,
          photoUrl: result.photoUrl,
          index: i,
          total: people.length,
          intendedPersonId: person && person.id ? String(person.id) : null,
          slug: personSlug,
          photoSha256Prefix: resultProgressMeta.photoSha256Prefix,
          photoHashAlgorithm: getPhotoIntegritySpec().photoHashAlgorithm,
          photoHashInput: getPhotoIntegritySpec().photoHashInput,
          photoHashPrefixLen: getPhotoIntegritySpec().photoHashPrefixLen,
          photoDataUrlLen: resultProgressMeta.photoDataUrlLen || successDataUrlLen,
          selectedUrlFingerprint: resultProgressMeta.selectedUrlFingerprint,
        });
        logStageBoundary(personStageContext, 'result.emitted', personStart);
        previousProgressMeta = resultProgressMeta;
      } else {
        failed++;
        const progressErrorMeta = getProgressErrorMeta(result ? result.error : null);
        const progressErrorCode = progressErrorMeta.errorCode;
        failuresByCode[progressErrorCode] = (failuresByCode[progressErrorCode] || 0) + 1;
        if (progressErrorMeta.dominantRejectReason) {
          failuresByDominantRejectReason[progressErrorMeta.dominantRejectReason] =
            (failuresByDominantRejectReason[progressErrorMeta.dominantRejectReason] || 0) + 1;
        }
        if (!firstFailureTimestamp) firstFailureTimestamp = new Date().toISOString();
        const resultProgressMeta = Object.freeze(
          Object.assign({}, immutableProgressMeta, result && result.progressMeta && typeof result.progressMeta === 'object' ? result.progressMeta : {}),
        );
        sendToTab(tabId, {
          type: 'REKNOWN_ENRICH_PROGRESS',
          requestId,
          personId: person.id,
          personName: person.name,
          status: 'error',
          error: result.error,
          errorCode: progressErrorCode,
          index: i,
          total: people.length,
          intendedPersonId: person && person.id ? String(person.id) : null,
          slug: personSlug,
          photoSha256Prefix: null,
          photoDataUrlLen: 0,
          selectedUrlFingerprint: resultProgressMeta.selectedUrlFingerprint,
        });
        logStageBoundary(personStageContext, 'result.emitted', personStart);
        previousProgressMeta = resultProgressMeta;
        if (result.fatal) {
          const cooldownMeta =
            result.error === 'rate_limited' ? setRateLimitCooldown() : getRateLimitCooldownMeta();
          console.log(
            '[reknown-ext] runBatch fatal-abort requestId=' + requestId,
            'reason=' + resultErrorLog,
            'success=' + success,
            'failed=' + failed,
          );
          sendToTab(tabId, {
            type: 'REKNOWN_ENRICH_COMPLETE',
            requestId,
            aborted: true,
            reason: result.error,
            cooldown: cooldownMeta,
            summary: {
              total: people.length,
              success,
              failed,
              processed: i + 1,
              lowConfidenceFallbackAcceptedCount: batchStats.lowConfidenceFallbackAcceptedCount,
              failuresByCode: failuresByCode,
              failuresByDominantRejectReason: failuresByDominantRejectReason,
            },
          });
          debugEvent('batch.summary', {
            requestId: requestId,
            status: 'aborted',
            lowConfidenceFallbackAcceptedCount: batchStats.lowConfidenceFallbackAcceptedCount,
          });
          emitBatchSummaryLog({
            requestId: requestId,
            phase: 'fatal_abort',
            processed: i + 1,
            total: people.length,
            success: success,
            failed: failed,
            failuresByCode: failuresByCode,
            failuresByDominantRejectReason: failuresByDominantRejectReason,
            fetchDurationsMs: fetchDurationsMs,
            firstFailureTimestamp: firstFailureTimestamp,
          });
          return;
        }
      }
      if ((i + 1) % throttleCfg.batchSize === 0 || i === people.length - 1) {
        emitBatchSummaryLog({
          requestId: requestId,
          phase: i === people.length - 1 ? 'batch_end' : 'interval',
          processed: i + 1,
          total: people.length,
          success: success,
          failed: failed,
          failuresByCode: failuresByCode,
          failuresByDominantRejectReason: failuresByDominantRejectReason,
          fetchDurationsMs: fetchDurationsMs,
          firstFailureTimestamp: firstFailureTimestamp,
        });
      }
      // Throttle before next request (skip after last).
      if (i < people.length - 1) {
        const delay = throttleCfg.perRequestMinMs + Math.random() * throttleCfg.perRequestJitterMs;
        await sleepCancellable(delay, batch);
        if (batch.cancelled) break;
        if ((i + 1) % throttleCfg.batchSize === 0) {
          sendToTab(tabId, {
            type: 'REKNOWN_ENRICH_PROGRESS',
            requestId,
            status: 'batch_pause',
            index: i,
            total: people.length,
            pauseMs: throttleCfg.batchPauseMs,
            profile: throttleCfg.profile,
            intendedPersonId: null,
            personId: null,
            slug: null,
            photoSha256Prefix: null,
            photoDataUrlLen: 0,
            selectedUrlFingerprint: null,
          });
          await sleepCancellable(throttleCfg.batchPauseMs, batch);
        }
      }
    }
    console.log(
      '[reknown-ext] runBatch complete requestId=' + requestId,
      'success=' + success,
      'failed=' + failed,
      'aborted=' + batch.cancelled,
      'profile=' + throttleCfg.profile,
      'throttle=' + JSON.stringify(throttleCfg),
    );
    sendToTab(tabId, {
      type: 'REKNOWN_ENRICH_COMPLETE',
      requestId,
      aborted: batch.cancelled,
      summary: {
        total: people.length,
        success,
        failed,
        processed: success + failed,
        lowConfidenceFallbackAcceptedCount: batchStats.lowConfidenceFallbackAcceptedCount,
        failuresByCode: failuresByCode,
        failuresByDominantRejectReason: failuresByDominantRejectReason,
      },
    });
    debugEvent('batch.summary', {
      requestId: requestId,
      status: batch.cancelled ? 'cancelled' : 'complete',
      lowConfidenceFallbackAcceptedCount: batchStats.lowConfidenceFallbackAcceptedCount,
    });
    emitBatchSummaryLog({
      requestId: requestId,
      phase: batch.cancelled ? 'cancelled' : 'complete',
      processed: success + failed,
      total: people.length,
      success: success,
      failed: failed,
      failuresByCode: failuresByCode,
      failuresByDominantRejectReason: failuresByDominantRejectReason,
      fetchDurationsMs: fetchDurationsMs,
      firstFailureTimestamp: firstFailureTimestamp,
    });
  } catch (err) {
    const stage = 'runBatch.main';
    const errorStackPreview = trimErrorStack(err, 7);
    console.error(
      '[reknown-ext] runBatch unhandled exception',
      JSON.stringify({
        stage: stage,
        requestId: requestId,
        personId: null,
        slug: null,
        exceptionName: err && err.name ? err.name : 'Error',
        exceptionMessage: err && err.message ? err.message : String(err),
        stack: errorStackPreview,
      }),
    );
    emitInternalExceptionTelemetry(stage, { requestId: requestId, personId: null, slug: null }, err);
    throw err;
  } finally {
    activeBatches.delete(requestId);
    // Defensively close any keep-alive ports still open for this batch, in
    // case the content-script-side close raced the COMPLETE message.
    const set = keepAliveConnections.get(requestId);
    if (set) {
      for (const p of set) {
        try { p.disconnect(); } catch { /* ignore */ }
      }
      keepAliveConnections.delete(requestId);
    }
  }
}

browserApi.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  const tabId = sender && sender.tab && sender.tab.id;
  if (typeof msg.type === 'string' && msg.type.startsWith('REKNOWN_')) {
    console.log(
      '[reknown-ext] background received',
      msg.type,
      'requestId=' + (msg.requestId || ''),
      'tabId=' + tabId,
      'people=' + (Array.isArray(msg.people) ? msg.people.length : 0),
    );
  }
  if (msg.type === 'REKNOWN_ENRICH_GET_PROFILE') {
    ensureThrottleConfigReady()
      .then(() => {
        const cfg = getActiveThrottleConfig();
        sendResponse({ ok: true, profile: cfg.profile, config: cfg });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: 'profile_init_failed', detail: String(err) });
      });
    return true;
  }
  if (msg.type === 'REKNOWN_ENRICH_GET_DEBUG') {
    ensureDebugConfigReady()
      .then(() => {
        sendResponse({ ok: true, config: Object.assign({}, activeDebugConfig) });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: 'debug_config_init_failed', detail: String(err) });
      });
    return true;
  }
  if (msg.type === 'REKNOWN_ENRICH_SET_DEBUG') {
    if (activeBatches.size > 0) {
      const activeRequestIds = Array.from(activeBatches.keys());
      sendResponse({
        ok: false,
        error: 'batch_active',
        activeRequestIds,
      });
      return;
    }
    ensureDebugConfigReady()
      .then(() => setDebugConfig(msg.config || {}, { persist: true }))
      .then((result) => {
        sendResponse({
          ok: true,
          config: result.config,
          persisted: result.persisted,
        });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: 'debug_config_set_failed', detail: String(err) });
      });
    return true;
  }
  if (msg.type === 'REKNOWN_ENRICH_SET_PROFILE') {
    const requestedProfile = msg.profile;
    if (activeBatches.size > 0) {
      const activeRequestIds = Array.from(activeBatches.keys());
      sendResponse({
        ok: false,
        error: 'batch_active',
        activeRequestIds,
      });
      return;
    }
    ensureThrottleConfigReady()
      .then(() => setThrottleProfile(requestedProfile, { persist: true }))
      .then((result) => {
        sendResponse({
          ok: true,
          profile: result.profile,
          config: result.config,
          persisted: result.persisted,
        });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: 'profile_set_failed', detail: String(err) });
      });
    return true;
  }
  if (msg.type === 'REKNOWN_ENRICH_REQUEST') {
    if (typeof tabId !== 'number') {
      console.warn('[reknown-ext] REKNOWN_ENRICH_REQUEST ignored: no tabId on sender');
      return;
    }
    const people = Array.isArray(msg.people) ? msg.people : [];
    const requestId = String(msg.requestId || Date.now());
    const force = msg.force === true;
    logStageBoundary(
      { requestId: requestId, personId: null, slug: null },
      'request.received',
      null,
    );
    const cooldownMeta = getRateLimitCooldownMeta();
    if (cooldownMeta.cooldownRemainingMs > 0) {
      console.warn(
        '[reknown-ext] REKNOWN_ENRICH_REQUEST rejected due to active cooldown',
        'requestId=' + requestId,
        'tabId=' + tabId,
        'cooldownRemainingMs=' + cooldownMeta.cooldownRemainingMs,
      );
      sendResponse({
        ok: false,
        error: 'rate_limited',
        requestId,
        cooldown: cooldownMeta,
      });
      return;
    }
    if (activeBatches.size > 0 && !force) {
      const activeRequestIds = Array.from(activeBatches.keys());
      console.warn(
        '[reknown-ext] REKNOWN_ENRICH_REQUEST rejected batch already running',
        'requestId=' + requestId,
        'tabId=' + tabId,
        'activeRequestIds=' + activeRequestIds.join(','),
      );
      sendResponse({
        ok: false,
        error: 'batch_already_running',
        requestId,
        activeRequestIds,
        cooldown: cooldownMeta,
      });
      return;
    }
    if (activeBatches.size > 0 && force) {
      console.warn(
        '[reknown-ext] REKNOWN_ENRICH_REQUEST force accepted while batch active',
        'requestId=' + requestId,
        'tabId=' + tabId,
        'activeRequestIds=' + Array.from(activeBatches.keys()).join(','),
      );
    }
    runBatch(requestId, people, tabId).catch((err) => {
      const stage = 'runBatch.top_level';
      const errorStackPreview = trimErrorStack(err, 7);
      console.error(
        '[reknown-ext] runBatch crashed',
        JSON.stringify({
          stage: stage,
          requestId: requestId,
          personId: null,
          slug: null,
          exceptionName: err && err.name ? err.name : 'Error',
          exceptionMessage: err && err.message ? err.message : String(err),
          stack: errorStackPreview,
        }),
      );
      emitInternalExceptionTelemetry(stage, { requestId: requestId, personId: null, slug: null }, err);
    });
    sendResponse({ ok: true, requestId, cooldown: cooldownMeta });
    return;
  }
  if (msg.type === 'REKNOWN_ENRICH_CANCEL') {
    const requestId = String(msg.requestId || '');
    const batch = activeBatches.get(requestId);
    if (batch) {
      batch.cancelled = true;
      if (batch.activeControllers && typeof batch.activeControllers.values === 'function') {
        for (const entry of batch.activeControllers.values()) {
          if (!entry || !entry.controller) continue;
          try {
            entry.controller.abort();
          } catch {
            // no-op
          }
          console.log(
            '[reknown-ext] cancel abort controller',
            'requestId=' + requestId,
            'personId=' + (entry.personId || ''),
            'stage=' + (entry.stage || 'unknown'),
          );
        }
      }
    }
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'REKNOWN_PING') {
    const cfg = getActiveThrottleConfig();
    sendResponse({ ok: true, version: EXT_VERSION, profile: cfg.profile, config: cfg });
    return;
  }
});
