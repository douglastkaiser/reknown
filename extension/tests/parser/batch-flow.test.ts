import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

type Person = { id: string; name: string; linkedinUrl: string };
type EnrichResult = {
  status: 'success' | 'error';
  error?: unknown;
  photoDataUrl?: string;
  photoUrl?: string;
  progressMeta?: {
    photoSha256Prefix?: string | null;
    photoDataUrlLen?: number;
    selectedUrlFingerprint?: string | null;
  };
};

const repoRoot = path.resolve(__dirname, '../../..');
const backgroundPath = path.join(repoRoot, 'extension/background.js');

function loadBatchHarness() {
  const source = fs.readFileSync(backgroundPath, 'utf8');
  const context: Record<string, unknown> = {
    console,
    URL,
    navigator: { userAgent: 'vitest' },
    setTimeout,
    clearTimeout,
    fetch: async () => {
      throw new Error('fetch should not be called in batch-flow regression test');
    },
    chrome: {
      runtime: {
        id: 'test-extension',
        getManifest: () => ({ version: 'test' }),
        onConnect: { addListener: () => undefined },
        onMessage: { addListener: () => undefined },
        lastError: null,
      },
      storage: {
        local: {
          get: (_keys: unknown, cb: (value: Record<string, unknown>) => void) => cb({}),
          set: (_payload: unknown, cb: () => void) => cb(),
        },
      },
      tabs: { sendMessage: (_tabId: number, _message: unknown, cb?: () => void) => cb?.() },
    },
  };
  context.globalThis = context;

  vm.runInNewContext(
    `${source}
;globalThis.__batchTestApi = {
  runBatch,
  setHooks(hooks) {
    if (hooks.enrichOne) enrichOne = hooks.enrichOne;
    if (hooks.sendToTab) sendToTab = hooks.sendToTab;
    if (hooks.getActiveThrottleConfig) getActiveThrottleConfig = hooks.getActiveThrottleConfig;
    if (hooks.ensureThrottleConfigReady) ensureThrottleConfigReady = hooks.ensureThrottleConfigReady;
    if (hooks.ensureDebugConfigReady) ensureDebugConfigReady = hooks.ensureDebugConfigReady;
    if (hooks.ensureStartupHealthProbe) ensureStartupHealthProbe = hooks.ensureStartupHealthProbe;
    if (hooks.sleepCancellable) sleepCancellable = hooks.sleepCancellable;
  }
};`,
    context,
    { filename: 'extension/background.js' },
  );

  return context.__batchTestApi as {
    runBatch: (requestId: string, people: Person[], tabId: number) => Promise<void>;
    setHooks: (hooks: Record<string, unknown>) => void;
  };
}

describe('runBatch progress metadata isolation', () => {
  it('does not carry selected fingerprint/hash metadata into the next person', async () => {
    const api = loadBatchHarness();
    const progressMessages: Array<Record<string, unknown>> = [];

    const responses: EnrichResult[] = [
      {
        status: 'success',
        photoDataUrl: 'data:image/png;base64,AAAA',
        photoUrl: 'https://media.licdn.com/photo-a',
        progressMeta: {
          photoSha256Prefix: 'sha-first',
          photoDataUrlLen: 26,
          selectedUrlFingerprint: 'fingerprint-first',
        },
      },
      {
        status: 'error',
        error: { code: 'no_photo_found' },
      },
    ];

    api.setHooks({
      enrichOne: async () => responses.shift(),
      sendToTab: (_tabId: number, message: Record<string, unknown>) => {
        if (message.type === 'REKNOWN_ENRICH_PROGRESS') progressMessages.push(message);
      },
      getActiveThrottleConfig: () => ({
        profile: 'test',
        perRequestMinMs: 0,
        perRequestJitterMs: 0,
        batchSize: 99,
        batchPauseMs: 0,
      }),
      ensureThrottleConfigReady: async () => undefined,
      ensureDebugConfigReady: async () => undefined,
      ensureStartupHealthProbe: () => undefined,
      sleepCancellable: async () => undefined,
    });

    await api.runBatch(
      'req-1',
      [
        { id: 'p1', name: 'Person One', linkedinUrl: 'https://www.linkedin.com/in/person-one/' },
        { id: 'p2', name: 'Person Two', linkedinUrl: 'https://www.linkedin.com/in/person-two/' },
      ],
      101,
    );

    const startedSecond = progressMessages.find((msg) => msg.status === 'started' && msg.personId === 'p2');
    const erroredSecond = progressMessages.find((msg) => msg.status === 'error' && msg.personId === 'p2');

    expect(startedSecond).toBeTruthy();
    expect(startedSecond?.photoSha256Prefix).toBeNull();
    expect(startedSecond?.photoDataUrlLen).toBe(0);
    expect(startedSecond?.selectedUrlFingerprint).toBeNull();

    expect(erroredSecond).toBeTruthy();
    expect(erroredSecond?.photoSha256Prefix).toBeNull();
    expect(erroredSecond?.photoDataUrlLen).toBe(0);
    expect(erroredSecond?.selectedUrlFingerprint).toBeNull();
  });
});
