import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

type ExtractionResult = {
  url: string | null;
  source?: string | null;
  rejectReason?: string | null;
  dominantRejectReason?: string | null;
};

const repoRoot = path.resolve(__dirname, '../../..');
const fixtureDir = path.join(__dirname, 'fixtures');
const backgroundPath = path.join(repoRoot, 'extension/background.js');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(fixtureDir, name), 'utf8');
}

function createDomParserStub() {
  return class DOMParserStub {
    parseFromString(html: string) {
      const mkNode = (attrs: Record<string, string>) => ({
        getAttribute: (name: string) => attrs[name] || null,
      });
      const modalMatch = html.match(/<img[^>]*pv-member-photo-modal__content-image[^>]*>/i);
      const profileAltMatch = html.match(/<img[^>]*alt=["'][^"']*Profile photo[^"']*["'][^>]*>/i);
      const parseAttrs = (node: string | undefined | null) => {
        if (!node) return null;
        const src = node.match(/\ssrc=["']([^"']+)["']/i)?.[1] || '';
        const delayed = node.match(/\sdata-delayed-url=["']([^"']+)["']/i)?.[1] || '';
        const ghost = node.match(/\sdata-ghost-url=["']([^"']+)["']/i)?.[1] || '';
        return mkNode({ src, 'data-delayed-url': delayed, 'data-ghost-url': ghost });
      };
      const modalNode = parseAttrs(modalMatch?.[0]);
      const profileNode = parseAttrs(profileAltMatch?.[0]);
      return {
        querySelectorAll(selector: string) {
          if (selector.includes('pv-member-photo-modal__content-image')) return modalNode ? [modalNode] : [];
          if (selector.includes('img[alt^="Profile photo"]')) return profileNode ? [profileNode] : [];
          return [];
        },
      };
    }
  };
}

function loadParserHarness(overlayHtml?: string) {
  const source = fs.readFileSync(backgroundPath, 'utf8');
  const context: Record<string, unknown> = {
    console,
    URL,
    navigator: { userAgent: 'vitest' },
    setTimeout,
    clearTimeout,
    fetch: async () => ({
      status: 200,
      ok: true,
      redirected: false,
      url: 'https://www.linkedin.com/in/target-slug/overlay/photo/',
      headers: { get: () => 'text/html' },
      text: async () => overlayHtml || '',
    }),
    DOMParser: createDomParserStub(),
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
    `${source}\n;globalThis.__parserTestApi = { extractPhotoUrl, getNoPhotoRetrySignal, normalizeExplicitRejectCode, compactNoPhotoFoundBundle };`,
    context,
    { filename: 'extension/background.js' },
  );

  return (context.__parserTestApi as {
    extractPhotoUrl: (html: string, slug: string) => Promise<ExtractionResult>;
    getNoPhotoRetrySignal: (
      html: string,
      slug: string,
      extraction: unknown,
      rejectReason: string | null,
      dominantRejectReason: string | null,
    ) => { rejectionCode: string | null; htmlFingerprint: unknown; dominantOwnerIdentifier: string | null };
    normalizeExplicitRejectCode: (reason: unknown) => string | null;
    compactNoPhotoFoundBundle: (
      html: string,
      slug: string,
      extraction: unknown,
    ) => {
      pageShape: { shape: string; title: string; signals: Record<string, unknown> };
      tokenCounts: { publicIdentifier: number };
      targetPublicIdentifierHits: number;
    };
  });
}

describe('extractPhotoUrl parser fixtures', () => {
  it('rejects viewer-only vector html with owner mismatch', async () => {
    const api = loadParserHarness();
    const result = await api.extractPhotoUrl(loadFixture('viewer-photo-only.html'), 'target-slug');

    expect(result.url).toBeNull();
    expect(result.rejectReason).toBe('reject.owner_mismatch');
  });

  it('selects target vector candidate and avoids owner_mismatch regression', async () => {
    const api = loadParserHarness();
    const result = await api.extractPhotoUrl(loadFixture('target-photo-present-vector.html'), 'target-slug');

    expect(result.url).toContain('D4D03AQTARGET');
    expect(result.source).toBe('vector-image-object');
    expect(result.rejectReason).not.toBe('reject.owner_mismatch');
  });

  it('uses drift-only weak owner linking for anchor-poor vector html', async () => {
    const api = loadParserHarness();
    const result = await api.extractPhotoUrl(loadFixture('anchor-poor-vector-drift.html'), 'target-slug');

    expect(result.url).toContain('D4D03AQTARGETPOOR');
    expect(result.source).toBe('vector-image-object');
    expect(result.rejectReason).not.toBe('reject.owner_mismatch');
  });

  it('reports truncated_root_only when only root urls are present', async () => {
    const api = loadParserHarness();
    const result = await api.extractPhotoUrl(loadFixture('truncated-root-only.html'), 'target-slug');

    expect(result.url).toBeNull();
    expect(result.rejectReason).toBe('reject.truncated_root_only');
  });

  it('uses overlay modal image as winner when page html has no displayphoto artifacts', async () => {
    const overlayHtml = loadFixture('overlay-photo-modal.html');
    const api = loadParserHarness(overlayHtml);
    const result = await api.extractPhotoUrl('<html><body><div>empty profile shell</div></body></html>', 'target-slug');

    expect(result.url).toContain('D4D03AQOVERLAY');
    expect(result.source).toBe('modal-selector:src');
    expect(result.rejectReason).not.toBe('reject.owner_mismatch');
  });

  it('classifies authwall/login wall responses', async () => {
    const api = loadParserHarness();
    const result = await api.extractPhotoUrl(loadFixture('authwall-login-wall.html'), 'target-slug');

    expect(result.url).toBeNull();
    expect(result.rejectReason).toBe('authwall_like_response');
  });
});

describe('getNoPhotoRetrySignal reject-code normalization', () => {
  // Regression: normalizeExplicitRejectCode used to be a local const inside
  // extractPhotoUrl, so getNoPhotoRetrySignal (a module-scope function) threw
  // "normalizeExplicitRejectCode is not defined", failing every enrichment with
  // internal_error/reference_error.
  it('does not throw a ReferenceError when building the no-photo retry signal', () => {
    const api = loadParserHarness();
    expect(() =>
      api.getNoPhotoRetrySignal('<html></html>', 'myerscm', { url: null }, 'owner_mismatch', 'no_displayphoto_artifacts'),
    ).not.toThrow();
  });

  it('normalizes owner_mismatch reject reasons to a canonical reject.* code', () => {
    const api = loadParserHarness();
    const signal = api.getNoPhotoRetrySignal(
      '<html></html>',
      'myerscm',
      { url: null },
      'owner_mismatch',
      'no_displayphoto_artifacts',
    );
    expect(signal.rejectionCode).toBe('reject.owner_mismatch');
  });

  it('falls back to the raw reason when no canonical code matches', () => {
    const api = loadParserHarness();
    const signal = api.getNoPhotoRetrySignal(
      '<html></html>',
      'myerscm',
      { url: null },
      null,
      'no_displayphoto_artifacts',
    );
    expect(signal.rejectionCode).toBe('no_displayphoto_artifacts');
  });

  it('exposes normalizeExplicitRejectCode at module scope', () => {
    const api = loadParserHarness();
    expect(api.normalizeExplicitRejectCode('owner_mismatch')).toBe('reject.owner_mismatch');
    expect(api.normalizeExplicitRejectCode('truncated_root_only')).toBe('reject.truncated_root_only');
    expect(api.normalizeExplicitRejectCode('reject.custom')).toBe('reject.custom');
    expect(api.normalizeExplicitRejectCode('no_displayphoto_artifacts')).toBeNull();
    expect(api.normalizeExplicitRejectCode(null)).toBeNull();
  });
});

describe('compactNoPhotoFoundBundle page-shape classification', () => {
  it('always attaches a pageShape classification to the bundle', () => {
    const api = loadParserHarness();
    const bundle = api.compactNoPhotoFoundBundle('<html><body>anything</body></html>', 'target-slug', null);
    expect(bundle.pageShape).toBeTruthy();
    expect(typeof bundle.pageShape.shape).toBe('string');
    expect(bundle.pageShape.signals).toBeTruthy();
  });

  it('classifies a logged-out / authwall page (no profile payload)', () => {
    const api = loadParserHarness();
    const html =
      '<html><head><title>Sign Up | LinkedIn</title></head><body>' +
      '<div class="authwall">Join now to see target-slug on LinkedIn. New to LinkedIn? Sign in to see more.</div>' +
      '</body></html>';
    const bundle = api.compactNoPhotoFoundBundle(html, 'target-slug', null);
    expect(bundle.pageShape.shape).toBe('authwall_or_logged_out');
    expect(bundle.tokenCounts.publicIdentifier).toBe(0);
  });

  it('classifies a page that carries profile payload but not the requested slug', () => {
    const api = loadParserHarness();
    const html =
      '<html><head><title>Someone Else | LinkedIn</title></head><body>' +
      '<code>{"publicIdentifier":"someone-else","firstName":"Someone"}</code>' +
      '<div class="global-nav__me">Me</div>' +
      '</body></html>';
    const bundle = api.compactNoPhotoFoundBundle(html, 'target-slug', null);
    expect(bundle.tokenCounts.publicIdentifier).toBeGreaterThan(0);
    expect(bundle.targetPublicIdentifierHits).toBe(0);
    expect(bundle.pageShape.shape).toBe('target_slug_absent');
  });
});
