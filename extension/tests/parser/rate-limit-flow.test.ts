import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const backgroundPath = path.resolve(__dirname, '../../background.js');
const stages = [
  ['primary profile', 'https://www.linkedin.com/in/first/', 429],
  ['profile retry', 'https://www.linkedin.com/in/first/', 999],
  ['overlay photo', 'https://www.linkedin.com/in/first/overlay/photo/', 429],
  ['image download', 'https://media.licdn.com/dms/image/test', 999],
] as const;

function loadHarness(stageUrl: string, status: number) {
  const source = fs.readFileSync(backgroundPath, 'utf8');
  const messages: Array<Record<string, any>> = [];
  const writes: Array<Record<string, any>> = [];
  let fetchCount = 0;
  const headers = new Headers({ 'content-type': 'text/html', 'retry-after': '120' });
  const response = {
    status,
    ok: false,
    redirected: false,
    url: stageUrl,
    headers,
    clone: () => ({ text: async () => '<html>limited</html>' }),
  };
  const context: Record<string, any> = {
    console,
    URL,
    Headers,
    AbortController,
    navigator: { userAgent: 'vitest' },
    setTimeout,
    clearTimeout,
    fetch: async () => { fetchCount++; return response; },
    chrome: {
      runtime: {
        id: 'test-extension', getManifest: () => ({ version: 'test' }),
        onConnect: { addListener: () => undefined }, onMessage: { addListener: () => undefined }, lastError: null,
      },
      storage: { local: {
        get: (_keys: unknown, cb: (v: object) => void) => cb({}),
        set: (payload: Record<string, any>, cb: () => void) => { writes.push(payload); cb(); },
      } },
      tabs: { sendMessage: (_id: number, message: Record<string, any>, cb?: () => void) => { messages.push(message); cb?.(); } },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\n;globalThis.__api = {
    runBatch,
    setHooks(hooks) {
      enrichOne = hooks.enrichOne;
      getActiveThrottleConfig = hooks.getActiveThrottleConfig;
      ensureThrottleConfigReady = async () => undefined;
      ensureDebugConfigReady = async () => undefined;
      ensureStartupHealthProbe = () => undefined;
    },
    fetchWithTimeout
  };`, context, { filename: 'extension/background.js' });
  const api = context.__api;
  api.setHooks({
    enrichOne: async () => api.fetchWithTimeout(stageUrl, {}, { timeoutMs: 100 }),
    getActiveThrottleConfig: () => ({ profile: 'test', perRequestMinMs: 0, perRequestJitterMs: 0, batchSize: 99, batchPauseMs: 0, rateLimitCooldownMs: 60_000 }),
  });
  return { api, messages, writes, getFetchCount: () => fetchCount };
}

describe.each(stages)('central LinkedIn response protection: %s', (_name, url, status) => {
  it(`aborts the batch on HTTP ${status} and does not request the next person`, async () => {
    const harness = loadHarness(url, status);
    await harness.api.runBatch('req-rate-limit', [
      { id: 'p1', name: 'First', linkedinUrl: 'https://www.linkedin.com/in/first/' },
      { id: 'p2', name: 'Second', linkedinUrl: 'https://www.linkedin.com/in/second/' },
    ], 1);

    expect(harness.getFetchCount()).toBe(1);
    expect(harness.messages.some((m) => m.type === 'REKNOWN_ENRICH_PROGRESS' && m.personId === 'p2')).toBe(false);
    const complete = harness.messages.find((m) => m.type === 'REKNOWN_ENRICH_COMPLETE');
    expect(complete).toMatchObject({ aborted: true, reason: 'rate_limited' });
    expect(complete.cooldown).toMatchObject({ retryAfterSeconds: 120, httpStatus: status, trigger: `http_${status}` });
    expect(harness.writes.some((value) => Number.isFinite(value.reknownRateLimitCooldownUntil))).toBe(true);
  });
});
