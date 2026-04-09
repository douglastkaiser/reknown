// reknown — LinkedIn Photo Enricher background script
// Manifest V2, plain JS, no dependencies.

const browserApi = globalThis.browser || globalThis.chrome;

// Single source of truth for the extension version: the manifest.
const EXT_VERSION = browserApi.runtime.getManifest().version;

// Keep-alive ports: while any are open, Firefox will not unload the
// non-persistent event page. The content script opens one per batch and
// closes it on REKNOWN_ENRICH_COMPLETE. Without this, runBatch's in-flight
// fetches and timers get torn down ~30-60s after the last tracked extension
// API event, killing batches mid-run.
const keepAliveConnections = new Map(); // requestId -> Set<Port>

browserApi.runtime.onConnect.addListener((port) => {
  if (!port.name || !port.name.startsWith('reknown-enrich-batch:')) return;
  const requestId = port.name.slice('reknown-enrich-batch:'.length);
  console.log('[reknown-ext] keep-alive port connected name=' + port.name);
  let set = keepAliveConnections.get(requestId);
  if (!set) {
    set = new Set();
    keepAliveConnections.set(requestId, set);
  }
  set.add(port);
  port.onDisconnect.addListener(() => {
    void browserApi.runtime.lastError;
    set.delete(port);
    if (set.size === 0) keepAliveConnections.delete(requestId);
    // If the tab closed mid-batch, cancel cleanly so we stop hammering LinkedIn.
    const batch = activeBatches.get(requestId);
    if (batch) batch.cancelled = true;
  });
});

const LINKEDIN_PROFILE_RE = /^https:\/\/(www\.)?linkedin\.com\/in\/[^\s?#]+/i;
const DEFAULT_AVATAR_MARKERS = ['ghost-person', 'ghosts/person', 'default-avatar', 'anon-user'];
const PER_REQUEST_MIN_MS = 2000;
const PER_REQUEST_JITTER_MS = 2000;
const BATCH_SIZE = 25;
const BATCH_PAUSE_MS = 30000;
const MAX_PHOTO_DIM = 400;
const DEBUG_VERBOSE = true;

// Track in-flight batches for cancellation. Keyed by requestId.
const activeBatches = new Map(); // requestId -> { cancelled: boolean }

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
      // Swallow "receiving end does not exist" errors (tab closed).
      void browserApi.runtime.lastError;
    });
  } catch (err) {
    console.warn('[reknown-ext] sendToTab failed', err);
  }
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
  while ((match = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1].trim());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const graph = item && item['@graph'] ? item['@graph'] : [item];
        for (const node of graph) {
          if (!node) continue;
          const image = node.image;
          if (typeof image === 'string') return image;
          if (image && typeof image === 'object') {
            if (typeof image.contentUrl === 'string') return image.contentUrl;
            if (typeof image.url === 'string') return image.url;
          }
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return null;
}

function extractFromOgImage(html) {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m ? decodeHtml(m[1]) : null;
}

function extractFromProfileImg(html) {
  const classPatterns = [
    /<img[^>]+class=["'][^"']*pv-top-card-profile-picture[^"']*["'][^>]*>/i,
    /<img[^>]+class=["'][^"']*profile-photo-edit__preview[^"']*["'][^>]*>/i,
  ];
  for (const pat of classPatterns) {
    const tag = html.match(pat);
    if (tag) {
      const src = tag[0].match(/src=["']([^"']+)["']/i);
      if (src) return decodeHtml(src[1]);
    }
  }
  return null;
}

function extractFromLicdnRegex(html) {
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
  // Additionally, <script>-embedded JSON may use JS unicode escapes like
  // \u0026 for &, \" for ", and \/ for /. We normalize these BEFORE the
  // HTML-entity decode so that signed query strings (&v=beta&t=<hmac>)
  // survive intact rather than being truncated at the first backslash.
  const jsNormalized = html
    .replace(/\\u0026/g, '&')
    .replace(/\\u003d/g, '=')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/');
  const decoded = decodeHtml(jsNormalized);
  const URL_BODY = '[^"\'\\s<>\\\\]';

  // Prefer the avatar URL explicitly. LinkedIn's preload JSON lists the
  // banner (profile-displaybackgroundimage) *before* the avatar
  // (profile-displayphoto), so a generic match gets the wrong image.
  const photoRe = new RegExp(
    'https://media\\.licdn\\.com/dms/image/' + URL_BODY + '*profile-displayphoto-shrink' + URL_BODY + '*',
  );
  const photoMatch = decoded.match(photoRe);
  if (photoMatch) {
    const url = photoMatch[0];
    // Sanity check: a valid signed licdn URL should be >100 chars and
    // contain the signature params. Warn (but still return) if truncated.
    if (DEBUG_VERBOSE && (url.length < 100 || !url.includes('&v='))) {
      console.warn(
        '[reknown-ext] licdn-regex: URL looks truncated len=' + url.length,
        'hasV=' + url.includes('&v='),
        'hasT=' + url.includes('&t='),
        'url=' + url,
      );
    }
    return url;
  }

  // Fallback: any licdn image URL, but explicitly skip background banners.
  const genericRe = new RegExp('https://media\\.licdn\\.com/dms/image/' + URL_BODY + '+');
  const genericMatch = decoded.match(genericRe);
  if (genericMatch && !/profile-displaybackgroundimage/.test(genericMatch[0])) {
    return genericMatch[0];
  }
  return null;
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function isDefaultAvatar(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return DEFAULT_AVATAR_MARKERS.some((m) => lower.includes(m));
}

function extractPhotoUrl(html) {
  const strategies = [
    ['json-ld', extractFromJsonLd],
    ['og:image', extractFromOgImage],
    ['profile-img', extractFromProfileImg],
    ['licdn-regex', extractFromLicdnRegex],
  ];
  const outcomes = [];
  for (const [name, fn] of strategies) {
    try {
      const url = fn(html);
      if (url && !isDefaultAvatar(url)) {
        console.log('[reknown-ext] photo extracted via', name);
        if (DEBUG_VERBOSE) {
          outcomes.push({ strategy: name, result: 'MATCH', urlPrefix: url.substring(0, 80), len: url.length });
          console.log('[reknown-ext] strategy outcomes:', JSON.stringify(outcomes));
        }
        return url;
      }
      // Record why this strategy didn't win.
      if (!url) {
        outcomes.push({ strategy: name, result: 'null' });
      } else if (isDefaultAvatar(url)) {
        outcomes.push({ strategy: name, result: 'default-avatar', urlPrefix: url.substring(0, 80) });
      }
    } catch (err) {
      console.warn('[reknown-ext] strategy failed', name, err);
      outcomes.push({ strategy: name, result: 'threw', error: String(err).substring(0, 100) });
    }
  }
  if (DEBUG_VERBOSE) {
    console.log('[reknown-ext] all strategies failed, outcomes:', JSON.stringify(outcomes));
  }
  return null;
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
    return await blobToDataUrl(outBlob);
  } catch (err) {
    console.warn('[reknown-ext] resize failed, falling back to original', err);
    return await blobToDataUrl(blob);
  }
}

async function enrichOne(person) {
  const url = String(person.linkedinUrl || '').trim();
  if (!LINKEDIN_PROFILE_RE.test(url)) {
    return { status: 'error', error: 'invalid_url' };
  }
  let pageRes;
  try {
    pageRes = await fetch(url, { credentials: 'include', redirect: 'follow' });
  } catch (err) {
    return { status: 'error', error: 'fetch_failed' };
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
  } catch {
    return { status: 'error', error: 'fetch_failed' };
  }
  if (DEBUG_VERBOSE) {
    const markers = {
      jsonLdPerson: html.includes('"@type":"Person"') || html.includes('"@type": "Person"'),
      ogImage: /property=["']og:image["']/i.test(html),
      displayPhoto: html.includes('profile-displayphoto-shrink'),
      authwall: /authwall|checkpoint/i.test(html),
      pvTopCard: html.includes('pv-top-card'),
      bprGuid: html.includes('bpr-guid'),
    };
    console.log(
      '[reknown-ext] page fetched status=' + pageRes.status,
      'finalUrl=' + (pageRes.url || '').substring(0, 120),
      'htmlLen=' + html.length,
      'contentType=' + (pageRes.headers.get('content-type') || ''),
      'markers=' + JSON.stringify(markers),
    );
  }
  if (/<title>[^<]*(sign[- ]?in|login)[^<]*<\/title>/i.test(html) && /authwall|login/i.test(html)) {
    return { status: 'error', error: 'login_wall', fatal: true };
  }
  const photoUrl = extractPhotoUrl(html);
  if (DEBUG_VERBOSE) {
    console.log(
      '[reknown-ext] extractPhotoUrl result:',
      photoUrl ? ('url=' + photoUrl) : 'null',
      'len=' + (photoUrl ? photoUrl.length : 0),
      'hasSignature=' + (photoUrl ? (photoUrl.includes('&v=') && photoUrl.includes('&t=')) : false),
      'endsWithBackslash=' + (photoUrl ? photoUrl.endsWith('\\') : false),
    );
  }
  if (!photoUrl) {
    return { status: 'error', error: 'no_photo_found' };
  }
  if (isDefaultAvatar(photoUrl)) {
    return { status: 'error', error: 'default_avatar' };
  }
  if (DEBUG_VERBOSE) {
    console.log('[reknown-ext] fetching photo url=' + photoUrl);
  }
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
      'url=' + (imgRes.url || '').substring(0, 120),
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
  } catch {
    return { status: 'error', error: 'fetch_failed' };
  }
  try {
    const dataUrl = await resizeBlob(blob);
    return { status: 'success', photoDataUrl: dataUrl };
  } catch {
    return { status: 'error', error: 'fetch_failed' };
  }
}

async function runBatch(requestId, people, tabId) {
  const batch = { cancelled: false };
  activeBatches.set(requestId, batch);
  console.log(
    '[reknown-ext] runBatch start requestId=' + requestId,
    'count=' + people.length,
    'tabId=' + tabId,
    'ext=' + EXT_VERSION,
    'DEBUG_VERBOSE=' + DEBUG_VERBOSE,
  );
  let success = 0;
  let failed = 0;
  try {
    for (let i = 0; i < people.length; i++) {
      if (batch.cancelled) break;
      const person = people[i];
      console.log(
        '[reknown-ext] enriching',
        i + 1 + '/' + people.length,
        'name=' + (person && person.name),
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
            summary: { total: people.length, success, failed, processed: i + 1 },
          });
          return;
        }
      }
      // Throttle before next request (skip after last).
      if (i < people.length - 1) {
        const delay = PER_REQUEST_MIN_MS + Math.random() * PER_REQUEST_JITTER_MS;
        await sleepCancellable(delay, batch);
        if (batch.cancelled) break;
        if ((i + 1) % BATCH_SIZE === 0) {
          sendToTab(tabId, {
            type: 'REKNOWN_ENRICH_PROGRESS',
            requestId,
            status: 'batch_pause',
            index: i,
            total: people.length,
            pauseMs: BATCH_PAUSE_MS,
          });
          await sleepCancellable(BATCH_PAUSE_MS, batch);
        }
      }
    }
    console.log(
      '[reknown-ext] runBatch complete requestId=' + requestId,
      'success=' + success,
      'failed=' + failed,
      'aborted=' + batch.cancelled,
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
  if (msg.type === 'REKNOWN_ENRICH_REQUEST') {
    if (typeof tabId !== 'number') {
      console.warn('[reknown-ext] REKNOWN_ENRICH_REQUEST ignored: no tabId on sender');
      return;
    }
    const people = Array.isArray(msg.people) ? msg.people : [];
    const requestId = String(msg.requestId || Date.now());
    runBatch(requestId, people, tabId).catch((err) => {
      console.error('[reknown-ext] runBatch crashed', err);
    });
    sendResponse({ ok: true, requestId });
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
    sendResponse({ ok: true, version: EXT_VERSION });
    return;
  }
});
