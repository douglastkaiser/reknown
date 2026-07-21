import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = path.resolve(__dirname, '../../..');
const backgroundPath = path.join(repoRoot, 'extension/background.js');

// Load background.js in an isolated context and expose the pure company
// extractor, mirroring extract-photo-url.test.ts's harness.
function loadExtractor(): (html: string) => string[] {
  const source = fs.readFileSync(backgroundPath, 'utf8');
  const context: Record<string, unknown> = {
    console,
    URL,
    navigator: { userAgent: 'vitest' },
    setTimeout,
    clearTimeout,
    fetch: async () => ({ status: 200, ok: true, headers: { get: () => 'text/html' }, text: async () => '' }),
    DOMParser: class {
      parseFromString() {
        return { querySelectorAll: () => [] };
      }
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
    `${source}\n;globalThis.__companyTestApi = { extractProfileCompanies };`,
    context,
    { filename: 'extension/background.js' },
  );
  return (context.__companyTestApi as { extractProfileCompanies: (html: string) => string[] })
    .extractProfileCompanies;
}

const extractProfileCompanies = loadExtractor();

describe('extractProfileCompanies', () => {
  it('pulls the full work history from Voyager companyName fields', () => {
    const html = `<!doctype html><html><body>
      <script type="application/json">
      {"included":[
        {"$type":"com.linkedin.voyager.identity.profile.Position","companyName":"Acme Corp","title":"Staff Engineer"},
        {"$type":"com.linkedin.voyager.identity.profile.Position","companyName":"Globex","title":"Engineer"},
        {"$type":"com.linkedin.voyager.identity.profile.Position","companyName":"Initech","title":"Intern"}
      ]}
      </script></body></html>`;
    expect(extractProfileCompanies(html)).toEqual(['Acme Corp', 'Globex', 'Initech']);
  });

  it('dedupes case-insensitively, keeping first-seen casing and order', () => {
    const html = `<script type="application/json">{"included":[
      {"companyName":"Acme"},{"companyName":"acme"},{"companyName":"Globex"},{"companyName":"ACME"}
    ]}</script>`;
    expect(extractProfileCompanies(html)).toEqual(['Acme', 'Globex']);
  });

  it('decodes escaped and entity-encoded company names', () => {
    const html = `<script type="application/json">{"included":[
      {"companyName":"Ben \\u0026 Jerry\\u0027s"},
      {"companyName":"AT&amp;T"},
      {"companyName":"O\\u2019Reilly Media"}
    ]}</script>`;
    expect(extractProfileCompanies(html)).toEqual(["Ben & Jerry's", 'AT&T', 'O’Reilly Media']);
  });

  it('falls back to schema.org worksFor when there are no positions', () => {
    const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"Person","name":"Jane Doe","worksFor":[{"@type":"Organization","name":"Wayne Enterprises"}]},
      {"@type":"Organization","name":"Wayne Enterprises"}
    ]}
    </script>`;
    expect(extractProfileCompanies(html)).toEqual(['Wayne Enterprises']);
  });

  it('does not treat schools in alumniOf as employers', () => {
    const html = `<script type="application/ld+json">
    {"@type":"Person","name":"Jane","worksFor":{"@type":"Organization","name":"Stark Industries"},
     "alumniOf":[{"@type":"EducationalOrganization","name":"MIT"}]}
    </script>`;
    expect(extractProfileCompanies(html)).toEqual(['Stark Industries']);
  });

  it('merges Voyager positions with schema.org worksFor without duplicating', () => {
    const html = `
      <script type="application/json">{"included":[{"companyName":"Acme"},{"companyName":"Globex"}]}</script>
      <script type="application/ld+json">{"@type":"Person","worksFor":[{"@type":"Organization","name":"acme"},{"@type":"Organization","name":"Umbrella"}]}</script>`;
    expect(extractProfileCompanies(html)).toEqual(['Acme', 'Globex', 'Umbrella']);
  });

  it('returns an empty array for junk, empty, or non-string input', () => {
    expect(extractProfileCompanies('')).toEqual([]);
    expect(extractProfileCompanies('<html>no data here</html>')).toEqual([]);
    // @ts-expect-error exercising the defensive guard
    expect(extractProfileCompanies(null)).toEqual([]);
    expect(extractProfileCompanies('<script type="application/ld+json">{not json</script>')).toEqual([]);
  });

  it('skips absurdly long values and caps the count', () => {
    const long = 'X'.repeat(200);
    const many = Array.from({ length: 40 }, (_, i) => `{"companyName":"Co ${i}"}`).join(',');
    const html = `<script type="application/json">{"included":[{"companyName":"${long}"},${many}]}</script>`;
    const result = extractProfileCompanies(html);
    expect(result).not.toContain(long);
    expect(result.length).toBeLessThanOrEqual(25);
    expect(result[0]).toBe('Co 0');
  });
});
