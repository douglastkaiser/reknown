import type { CsvPersonRow } from '../../types';
import { Button } from '../common/Button';

export function ImportPreview({ rows, onConfirm }: { rows: CsvPersonRow[]; onConfirm: () => void }) {
  return (
    <section className="card space-y-2">
      <h3 className="font-semibold">Preview ({rows.length})</h3>
      <div className="max-h-52 space-y-1 overflow-auto text-sm">
        {rows.slice(0, 10).map((row, idx) => <p key={`${row.name}-${idx}`}>{row.name} — {row.company || 'N/A'}</p>)}
      </div>
      <Button onClick={onConfirm}>Confirm import</Button>
    </section>
  );
}
