// reknown — LinkedIn Photo Enricher background script
// Manifest V2, plain JS, no dependencies.

const browserApi = globalThis.browser || globalThis.chrome;

// Single source of truth for the extension version: the manifest.
const EXT_VERSION = browserApi.runtime.getManifest().version;
const THROTTLE_STORAGE_KEY = 'reknownEnrichThrottleProfile';
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
const DEBUG_VERBOSE = true;
const DEBUG_ENABLE_LEGACY_VECTOR_WINDOW_FALLBACK = false;

// Track in-flight batches for cancellation. Keyed by requestId.
const activeBatches = new Map(); // requestId -> { cancelled: boolean }
let rateLimitCooldownUntil = 0;
let activeThrottleProfile = DEFAULT_THROTTLE_PROFILE;
let throttleConfigReadyPromise = null;

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
function extractFromVectorImage(html, slug) {
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

  const objectExtraction = extractVectorCandidatesFromObjects(decoded, slug);
  let candidates = objectExtraction.candidates;
  let winningExtractor = 'object';

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
    const ownerOffsets = findOwnerOffsets(decoded, slug);
    const ownerSelection = chooseOwnerProximityCandidates(
      signed,
      function (c) { return typeof c.ownerAnchorOffset === 'number' ? c.ownerAnchorOffset : c.rootOffset; },
      ownerOffsets,
      'vector-image',
    );
    for (let ci = 0; ci < ownerSelection.scored.length; ci++) {
      ownerSelection.scored[ci].item.ownerDistance = ownerSelection.scored[ci].ownerDistance;
    }
    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] vector-image: owner-proximity filter',
        'slug=' + slug,
        'ownerMatches=' + ownerOffsets.length,
        'signedCount=' + signed.length,
        'inWindowCount=' + ownerSelection.pool.length,
        'mode=' + ownerSelection.mode,
        'reason=' + ownerSelection.reason,
        'window=' + OWNER_PROXIMITY_BYTES + 'B',
        'distances=' + JSON.stringify(signed.map(function (c) {
          return { rootIndex: c.rootIndex, dim: c.width + 'x' + c.height, dist: c.ownerDistance === Infinity ? -1 : c.ownerDistance };
        })),
      );
    }
    if (ownerSelection.pool.length === 0) {
      const relaxedSelection = chooseRelaxedSingleOwnerAssociation(signed, ownerOffsets, slug);
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
      'ownerDistance=' + (typeof best.ownerDistance === 'number' ? best.ownerDistance : 'n/a'),
      'url=' + best.url.substring(0, 140),
    );
  }

  console.log('[reknown-ext] vector-image: winning extractor=' + (best.extractor || winningExtractor));
  return best.url;
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
      candidates.push({
        url: fullUrl,
        width: width,
        height: height,
        hasSig: hasSig,
        hasExpiry: hasExpiry,
        hasResidualEntity: hasResidualEntity,
        rootIndex: rootIndex,
        rootOffset: rootOffset,
        ownerAnchorOffset: Math.floor((objectRange.start + objectRange.end) / 2),
        extractor: 'object',
        candidateSource: 'object',
        associationConfidence: 'strict-object',
        groupStart: objectRange.start,
        groupEnd: objectRange.end,
        groupTargetSlugNearby: groupMeta.targetSlugNearby,
        nearbyPublicIdentifiers: groupMeta.publicIdentifiers,
        nearbyMiniProfileRefs: groupMeta.miniProfileRefs,
        assetId: assetId,
        associationGroupKey: 'object:' + rootIndex + ':' + objectRange.start + '-' + objectRange.end,
        direction: 'object',
      });
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
      candidates.push({
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
      });
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
  ownerOffsets
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
      candidates.push({
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
        groupStart: range.start,
        groupEnd: range.end,
        groupTargetSlugNearby: groupMeta.targetSlugNearby,
        nearbyPublicIdentifiers: groupMeta.publicIdentifiers,
        nearbyMiniProfileRefs: groupMeta.miniProfileRefs,
        assetId: assetId,
        associationGroupKey: 'fallback:' + rootIndex + ':' + range.start + '-' + range.end,
        direction: 'context-fallback',
      });
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
    photoOwnerSelection = chooseOwnerProximityCandidates(
      allPhotoMatches,
      function (m) { return m.index; },
      ownerOffsets,
      'licdn-regex',
    );
    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] licdn-regex: photo owner selection',
        'ownerMatches=' + ownerOffsets.length,
        'candidateCount=' + allPhotoMatches.length,
        'selectedCount=' + photoOwnerSelection.pool.length,
        'mode=' + photoOwnerSelection.mode,
        'reason=' + photoOwnerSelection.reason,
      );
    }
    allowedPhotoOffsets = new Set(photoOwnerSelection.pool.map(function (m) { return m.index; }));
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

  if (bestPhoto && bestScore >= 20) {
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
  var allowedGenericOffsets = null;
  if (slug) {
    var genericOwnerSelection = chooseOwnerProximityCandidates(
      allGenericMatches,
      function (m) { return m.index; },
      ownerOffsets,
      'licdn-regex generic',
    );
    if (DEBUG_VERBOSE) {
      console.log(
        '[reknown-ext] licdn-regex: generic owner selection',
        'ownerMatches=' + ownerOffsets.length,
        'candidateCount=' + allGenericMatches.length,
        'selectedCount=' + genericOwnerSelection.pool.length,
        'mode=' + genericOwnerSelection.mode,
        'reason=' + genericOwnerSelection.reason,
      );
    }
    allowedGenericOffsets = new Set(genericOwnerSelection.pool.map(function (m) { return m.index; }));
  }
  for (var gi = 0; gi < allGenericMatches.length; gi++) {
    var gUrl = allGenericMatches[gi][0];
    if (/profile-displaybackgroundimage/.test(gUrl)) continue;
    if (allowedGenericOffsets && !allowedGenericOffsets.has(allGenericMatches[gi].index)) continue;
    if (gUrl.length > 100 && gUrl.includes('&v=')) {
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
  if (countOccurrences(decoded, 'profile-displayphoto-shrink') === 0) {
    return { url: null, rejectReason: 'no_displayphoto_artifacts' };
  }
  return null;
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
  if (!ownerOffsets || ownerOffsets.length === 0) {
    return { pool: [], mode: 'reject', reason: 'owner_proximity_reject_no_owner' };
  }

  const scored = [];
  for (let i = 0; i < items.length; i++) {
    const dist = nearestOwnerDistance(getOffset(items[i], i), ownerOffsets);
    scored.push({ item: items[i], ownerDistance: dist });
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
    reason: 'owner_proximity_strict_reject',
    scored: scored,
  };
}

function extractDigitalMediaAssetId(rootUrl) {
  if (!rootUrl) return '';
  const m = rootUrl.match(/\/dms\/image\/([^/]+\/[^/]+|[^/]+)\/profile-displayphoto-shrink_/i);
  return m ? m[1] : '';
}

function chooseRelaxedSingleOwnerAssociation(items, ownerOffsets, slug) {
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

function extractPhotoUrl(html, slug) {
  const makeFailure = function (reason, extra) {
    return Object.assign({ url: null, rejectReason: reason || null }, extra || {});
  };
  const normalizeStrategyResult = function (raw) {
    if (typeof raw === 'string') return { url: raw, rejectReason: null };
    if (raw && typeof raw === 'object') {
      return {
        url: typeof raw.url === 'string' ? raw.url : null,
        rejectReason: typeof raw.rejectReason === 'string' ? raw.rejectReason : null,
      };
    }
    return { url: null, rejectReason: null };
  };
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
    ['json-ld', extractFromJsonLd],
    ['og:image', extractFromOgImage],
    ['profile-img', extractFromProfileImg],
    ['vector-image', extractFromVectorImage],
    ['licdn-regex', extractFromLicdnRegex],
  ];
  const outcomes = [];
  for (const [name, fn] of strategies) {
    const t0 = Date.now();
    try {
      // All strategy fns accept (html, slug); most ignore the slug, but
      // vector-image and licdn-regex use it to pick the target's rootUrl
      // rather than whichever one happens to appear first in the page.
      const result = normalizeStrategyResult(fn(html, slug));
      const url = result.url;
      const dt = Date.now() - t0;
      if (url && !isDefaultAvatar(url)) {
        console.log('[reknown-ext] photo extracted via', name, 'in', dt + 'ms');
        if (DEBUG_VERBOSE) {
          outcomes.push({
            strategy: name,
            result: 'MATCH',
            rejectReason: result.rejectReason || null,
            urlPrefix: url.substring(0, 80),
            len: url.length,
            ms: dt,
          });
          console.log('[reknown-ext] strategy outcomes (on success):', JSON.stringify(outcomes));
        }
        return { url: url, rejectReason: result.rejectReason || null, dominantRejectReason: null };
      }
      // Record why this strategy didn't win.
      if (!url) {
        outcomes.push({ strategy: name, result: 'null', rejectReason: result.rejectReason || null, ms: dt });
      } else if (isDefaultAvatar(url)) {
        outcomes.push({
          strategy: name,
          result: 'default-avatar',
          rejectReason: result.rejectReason || null,
          urlPrefix: url.substring(0, 80),
          ms: dt,
        });
      }
    } catch (err) {
      console.warn('[reknown-ext] strategy failed', name, err);
      outcomes.push({ strategy: name, result: 'threw', error: String(err).substring(0, 100), ms: Date.now() - t0 });
    }
  }
  let dominantRejectReason = chooseDominantRejectReason(outcomes);
  if (!dominantRejectReason) {
    const authwallLike = /authwall|checkpoint/i.test(html) || /Join now/i.test(html) || /sign[- ]?in/i.test(html);
    const hasDisplayPhotoArtifacts = /profile-displayphoto-shrink/i.test(html) || /fileIdentifyingUrlPathSegment/i.test(html);
    if (authwallLike) dominantRejectReason = 'authwall_like_response';
    else if (!hasDisplayPhotoArtifacts) dominantRejectReason = 'no_displayphoto_artifacts';
  }
  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] all strategies failed, outcomes:',
      JSON.stringify(outcomes),
      'dominantRejectReason=' + (dominantRejectReason || 'none'),
      'snapshot=' + JSON.stringify(snapshot),
    );
  }
  return makeFailure(dominantRejectReason, { dominantRejectReason: dominantRejectReason || null, outcomes: outcomes });
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

async function enrichOne(person) {
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
    return { status: 'error', error: 'invalid_url' };
  }
  // publicIdentifier slug from the profile URL path. We use this inside
  // extractPhotoUrl to disambiguate the target's photo from the viewer's
  // own nav/menu photo when LinkedIn serves HTML containing both.
  const slugMatch = url.match(/\/in\/([^\s/?#]+)/i);
  const slug = slugMatch ? decodeURIComponent(slugMatch[1]) : '';
  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] enrichOne slug extracted',
      'slug=' + slug,
      'rawSegment=' + (slugMatch ? slugMatch[1] : ''),
    );
  }
  const fetchStart = Date.now();
  let pageRes;
  try {
    pageRes = await fetch(url, { credentials: 'include', redirect: 'follow' });
  } catch (err) {
    if (DEBUG_VERBOSE) console.warn('[reknown-ext] profile fetch threw', String(err), 'url=' + url);
    return { status: 'error', error: 'fetch_failed' };
  }
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
      'finalStillProfile=' + LINKEDIN_PROFILE_RE.test(pageRes.url || ''),
      'headers=' + JSON.stringify(pageHdrs),
    );
  }
  if (isRateLimited(pageRes)) {
    return { status: 'error', error: 'rate_limited', fatal: true };
  }
  if (isLoginWall(pageRes)) {
    return { status: 'error', error: 'login_wall', fatal: true };
  }
  let html;
  try {
    html = await pageRes.text();
  } catch (err) {
    if (DEBUG_VERBOSE) console.warn('[reknown-ext] profile body read threw', String(err));
    return { status: 'error', error: 'fetch_failed' };
  }
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
    };
    console.log(
      '[reknown-ext] page fetched status=' + pageRes.status,
      'finalUrl=' + (pageRes.url || '').substring(0, 120),
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
    return { status: 'error', error: 'login_wall', fatal: true };
  }
  const extraction = extractPhotoUrl(html, slug);
  const photoUrl =
    typeof extraction === 'string'
      ? extraction
      : (extraction && typeof extraction.url === 'string' ? extraction.url : null);
  const extractionRejectReason =
    extraction && typeof extraction === 'object' && typeof extraction.rejectReason === 'string'
      ? extraction.rejectReason
      : null;
  const extractionDominantRejectReason =
    extraction && typeof extraction === 'object' && typeof extraction.dominantRejectReason === 'string'
      ? extraction.dominantRejectReason
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
    );
  }
  if (!photoUrl) {
    return {
      status: 'error',
      error: {
        code: 'no_photo_found',
        reason: extractionRejectReason || extractionDominantRejectReason || null,
        dominantRejectReason: extractionDominantRejectReason || extractionRejectReason || null,
      },
    };
  }
  if (isDefaultAvatar(photoUrl)) {
    return { status: 'error', error: 'default_avatar' };
  }
  if (DEBUG_VERBOSE) {
    console.log('[reknown-ext] fetching photo url=' + photoUrl);
  }
  const photoFetchStart = Date.now();
  let imgRes;
  try {
    imgRes = await fetch(photoUrl, {
      credentials: 'include',
      referrer: 'https://www.linkedin.com/',
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
  } catch (err) {
    if (DEBUG_VERBOSE) console.warn('[reknown-ext] photo fetch threw', String(err));
    return { status: 'error', error: 'fetch_failed' };
  }
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
    return { status: 'error', error: 'fetch_failed' };
  }
  let blob;
  try {
    blob = await imgRes.blob();
  } catch (err) {
    if (DEBUG_VERBOSE) console.warn('[reknown-ext] photo blob read threw', String(err));
    return { status: 'error', error: 'fetch_failed' };
  }
  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] photo blob',
      'size=' + blob.size,
      'type=' + blob.type,
      'suspiciouslySmall=' + (blob.size < 1024),
    );
  }
  try {
    const dataUrl = await resizeBlob(blob);
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
    return { status: 'success', photoDataUrl: dataUrl, photoUrl: photoUrl };
  } catch (err) {
    if (DEBUG_VERBOSE) console.warn('[reknown-ext] resize threw', String(err));
    return { status: 'error', error: 'fetch_failed' };
  }
}

async function runBatch(requestId, people, tabId) {
  await ensureThrottleConfigReady();
  const throttleCfg = getActiveThrottleConfig();
  const batch = { cancelled: false };
  activeBatches.set(requestId, batch);
  const batchStart = Date.now();
  console.log(
    '[reknown-ext] runBatch start requestId=' + requestId,
    'count=' + people.length,
    'tabId=' + tabId,
    'ext=' + EXT_VERSION,
    'DEBUG_VERBOSE=' + DEBUG_VERBOSE,
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
  try {
    for (let i = 0; i < people.length; i++) {
      if (batch.cancelled) {
        if (DEBUG_VERBOSE) console.log('[reknown-ext] runBatch: cancelled at loop-top i=' + i);
        break;
      }
      const person = people[i];
      const personStart = Date.now();
      console.log(
        '[reknown-ext] enriching',
        i + 1 + '/' + people.length,
        'name=' + (person && person.name),
        'elapsedBatchMs=' + (personStart - batchStart),
      );
      sendToTab(tabId, {
        type: 'REKNOWN_ENRICH_PROGRESS',
        requestId,
        personId: person.id,
        personName: person.name,
        status: 'started',
        index: i,
        total: people.length,
      });
      let result;
      try {
        result = await enrichOne(person);
      } catch (err) {
        console.error('[reknown-ext] unexpected error', err);
        result = { status: 'error', error: 'fetch_failed' };
      }
      console.log(
        '[reknown-ext] enrichOne result status=' + (result && result.status),
        'error=' + (result && result.error),
        'personMs=' + (Date.now() - personStart),
        'cancelledDuring=' + batch.cancelled,
      );
      if (batch.cancelled) break;
      if (result.status === 'success') {
        success++;
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
        });
      } else {
        failed++;
        sendToTab(tabId, {
          type: 'REKNOWN_ENRICH_PROGRESS',
          requestId,
          personId: person.id,
          personName: person.name,
          status: 'error',
          error: result.error,
          index: i,
          total: people.length,
        });
        if (result.fatal) {
          const cooldownMeta =
            result.error === 'rate_limited' ? setRateLimitCooldown() : getRateLimitCooldownMeta();
          console.log(
            '[reknown-ext] runBatch fatal-abort requestId=' + requestId,
            'reason=' + result.error,
            'success=' + success,
            'failed=' + failed,
          );
          sendToTab(tabId, {
            type: 'REKNOWN_ENRICH_COMPLETE',
            requestId,
            aborted: true,
            reason: result.error,
            cooldown: cooldownMeta,
            summary: { total: people.length, success, failed, processed: i + 1 },
          });
          return;
        }
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
      summary: { total: people.length, success, failed, processed: success + failed },
    });
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
      console.error('[reknown-ext] runBatch crashed', err);
    });
    sendResponse({ ok: true, requestId, cooldown: cooldownMeta });
    return;
  }
  if (msg.type === 'REKNOWN_ENRICH_CANCEL') {
    const requestId = String(msg.requestId || '');
    const batch = activeBatches.get(requestId);
    if (batch) batch.cancelled = true;
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'REKNOWN_PING') {
    const cfg = getActiveThrottleConfig();
    sendResponse({ ok: true, version: EXT_VERSION, profile: cfg.profile, config: cfg });
    return;
  }
});
