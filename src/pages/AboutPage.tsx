export function AboutPage() {
  return (
    <div className="space-y-6">
      <section className="card space-y-2">
        <h1 className="text-2xl font-bold">About Reknown</h1>
        <p className="text-sm text-muted">
          Reknown helps you remember the people you meet. Add their photo and name, and the app
          quizzes you with spaced repetition so the right faces stick.
        </p>
      </section>

      <section className="card space-y-2">
        <h2 className="text-lg font-semibold">How it works</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Add people on the People tab (one at a time, or import from a CSV).</li>
          <li>Open Review to practice — type the name or pick the right face.</li>
          <li>Track your accuracy and progress on the Stats tab.</li>
        </ul>
      </section>

      <section className="card space-y-2">
        <h2 className="text-lg font-semibold">Import from LinkedIn</h2>
        <p className="text-sm text-muted">
          You can bulk-import your LinkedIn connections. LinkedIn lets you export them as a CSV
          via their data privacy tools:
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            On linkedin.com, go to <span className="text-text">Me → Settings &amp; Privacy → Data Privacy → Get a copy of your data</span>.
          </li>
          <li>
            Choose <span className="text-text">"Want something in particular?"</span> and tick
            <span className="text-text"> Connections</span>. This is faster than the full archive
            and is usually ready in a few minutes.
          </li>
          <li>Click Request archive, confirm your password, and wait for the email.</li>
          <li>Download the ZIP and extract <code>Connections.csv</code>.</li>
          <li>
            Back in Reknown, open the People tab → Import CSV → upload or paste the file.
          </li>
        </ol>
        <p className="text-sm text-muted">
          Direct link:{' '}
          <a
            href="https://www.linkedin.com/mypreferences/d/download-my-data"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            linkedin.com/mypreferences/d/download-my-data
          </a>
        </p>
        <p className="text-xs text-muted/70">
          The CSV includes name, company, and position, but not photos. You can paste a photo URL
          on each person's card after importing — or use the browser extension below to pull them
          in automatically.
        </p>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Auto-fetch LinkedIn photos (browser extension)</h2>
        <p className="text-sm text-muted">
          Reknown has an optional browser extension that fetches profile photos for your imported
          LinkedIn connections automatically. It uses <em>your own</em> logged-in LinkedIn session
          — nothing is sent to any server, no accounts, no API keys. Install it once and a new
          "Enrich Photos from LinkedIn" button appears on the People tab.
        </p>

        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-text">Step 1 — Download the extension</h3>
          <p className="text-sm text-muted">Pick whichever is easier:</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>
              <strong>Pre-built (recommended):</strong> go to{' '}
              <a
                href="https://github.com/douglastkaiser/reknown/actions/workflows/extension.yml"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                the extension build page on GitHub
              </a>
              , click the topmost green ✓ run, scroll to <span className="text-text">Artifacts</span>,
              and download either <code>reknown-extension-chrome</code> or{' '}
              <code>reknown-extension-firefox</code>. Unzip it. (You must be signed into GitHub to
              download artifacts.)
            </li>
            <li>
              <strong>Or clone the repo:</strong> download{' '}
              <a
                href="https://github.com/douglastkaiser/reknown/archive/refs/heads/main.zip"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                the full source ZIP
              </a>
              , unzip it, and look inside the <code>extension/</code> folder.
            </li>
          </ul>
        </div>

        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-text">Step 2 — Install it in your browser</h3>
          <p className="text-sm text-muted">
            <strong>Chrome, Edge, Brave, Arc (any Chromium browser):</strong>
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              Open <code>chrome://extensions</code> in a new tab (<code>edge://extensions</code> on
              Edge, etc.).
            </li>
            <li>
              Turn on <span className="text-text">Developer mode</span> (toggle, top right).
            </li>
            <li>
              Click <span className="text-text">Load unpacked</span> and select the{' '}
              <code>extension</code> folder (or the unzipped Chrome artifact folder).
            </li>
          </ol>
          <p className="text-sm text-muted">
            <strong>Firefox:</strong>
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              Easiest: drag the downloaded <code>.xpi</code> file directly onto any Firefox window
              and click <span className="text-text">Continue to installation → Add</span>.
            </li>
            <li>
              If that doesn't work, open <code>about:debugging#/runtime/this-firefox</code>, click{' '}
              <span className="text-text">Load Temporary Add-on…</span>, and select{' '}
              <code>extension/manifest.json</code>. (Temporary = disappears when you close
              Firefox.)
            </li>
          </ol>
        </div>

        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-text">Step 3 — Use it</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              Make sure you're <strong>logged into LinkedIn</strong> in the same browser — open{' '}
              <a
                href="https://www.linkedin.com/"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                linkedin.com
              </a>{' '}
              in another tab and check.
            </li>
            <li>
              Refresh this page. Go to the <span className="text-text">People</span> tab. You
              should see a new section called{' '}
              <span className="text-text">"Enrich Photos from LinkedIn"</span> at the top.
            </li>
            <li>
              Click <span className="text-text">Enrich (N)</span> and let it run. Expect roughly 3
              seconds per person, with a 30-second pause every 25 people.
            </li>
          </ol>
        </div>

        <p className="text-xs text-muted/70">
          Full troubleshooting guide and origin configuration:{' '}
          <a
            href="https://github.com/douglastkaiser/reknown/blob/main/extension/README.md"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            extension/README.md
          </a>
          .
        </p>
      </section>
    </div>
  );
}
