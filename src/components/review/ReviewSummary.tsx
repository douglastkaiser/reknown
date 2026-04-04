export function ReviewSummary({ reviewed, total }: { reviewed: number; total: number }) {
  return (
    <section className="card">
      <h3 className="text-lg font-semibold">Session complete</h3>
      <p className="mt-2 text-sm text-muted">Reviewed {reviewed} of {total} cards.</p>
    </section>
  );
}
