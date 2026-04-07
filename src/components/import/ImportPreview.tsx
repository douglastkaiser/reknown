import type { CsvPersonRow } from '../../types';
import { Button } from '../common/Button';

export function ImportPreview({
  rows,
  onConfirm,
  importing = false,
  progress,
  error,
}: {
  rows: CsvPersonRow[];
  onConfirm: () => void;
  importing?: boolean;
  progress?: { done: number; total: number };
  error?: string | null;
}) {
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <section className="card space-y-2">
      <h3 className="font-semibold">Preview ({rows.length})</h3>
      <div className="max-h-52 space-y-1 overflow-auto text-sm">
        {rows.slice(0, 10).map((row, idx) => <p key={`${row.name}-${idx}`}>{row.name} — {row.company || 'N/A'}</p>)}
      </div>
      <Button onClick={onConfirm} disabled={importing}>
        {importing ? 'Importing…' : 'Confirm import'}
      </Button>
      {importing && progress ? (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted">{progress.done} / {progress.total}</p>
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </section>
  );
}
