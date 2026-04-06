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
          on each person's card after importing.
        </p>
      </section>
    </div>
  );
}
