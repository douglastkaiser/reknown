import { useEffect, useState } from 'react';
import type { EnrichMethod } from '../../types';
import { Button } from '../common/Button';

export function NewCategoryDialog({
  open,
  onCancel,
  onCreate,
}: {
  open: boolean;
  onCancel: () => void;
  onCreate: (input: { name: string; enrichMethod: EnrichMethod }) => Promise<void> | void;
}) {
  const [name, setName] = useState('');
  const [method, setMethod] = useState<EnrichMethod>('linkedin');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setMethod('linkedin');
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCreate({ name: name.trim(), enrichMethod: method });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Create section"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-bg p-5 shadow-xl"
      >
        <h3 className="text-lg font-semibold text-text">New section</h3>

        <div className="space-y-1">
          <label className="text-xs text-muted">Name</label>
          <input
            autoFocus
            className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm"
            placeholder="e.g. LinkedIn, Patriots"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted">Introduction / enrich method</label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-white/5 p-3 text-sm">
            <input
              type="radio"
              name="enrichMethod"
              checked={method === 'linkedin'}
              onChange={() => setMethod('linkedin')}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-text">LinkedIn</span>
              <span className="block text-xs text-muted">
                Import a LinkedIn CSV export and enrich photos via the reknown browser extension.
              </span>
            </span>
          </label>
          <label className="flex cursor-not-allowed items-start gap-2 rounded-lg border border-border bg-white/5 p-3 text-sm opacity-60">
            <input
              type="radio"
              name="enrichMethod"
              checked={method === 'roster_url'}
              onChange={() => setMethod('roster_url')}
              disabled
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-text">
                Roster URL <span className="text-xs text-muted">(coming soon)</span>
              </span>
              <span className="block text-xs text-muted">
                Paste a URL like https://www.patriots.com/team/players-roster/ and we'll import the
                listed people.
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" className="bg-white/5" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </div>
  );
}
