import { useState } from 'react';
import type { Category } from '../../types';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';

const METHOD_LABEL: Record<Category['enrichMethod'], string> = {
  linkedin: 'LinkedIn',
  espn_roster: 'ESPN',
  civic_reps: 'Local Politicians',
};

export function CategoryHeader({
  category,
  peopleCount,
  onDelete,
  onToggleHiddenFromReview,
}: {
  category: Category;
  peopleCount: number;
  onDelete: (id: string) => Promise<void> | void;
  onToggleHiddenFromReview: (id: string, hidden: boolean) => Promise<void> | void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setDeleting(true);
    try {
      await onDelete(category.id);
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  const includedInReview = !category.hiddenFromReview;

  return (
    <>
      <div className="card flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text">{category.name}</h2>
          <p className="text-xs text-muted">
            <span className="rounded-full border border-border px-2 py-0.5">
              {METHOD_LABEL[category.enrichMethod]}
            </span>{' '}
            · {peopleCount} {peopleCount === 1 ? 'person' : 'people'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label
            className="flex cursor-pointer select-none items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted hover:bg-white/5 hover:text-text"
            title="When off, people in this section are excluded from Review sessions."
          >
            <span>In review</span>
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-accent"
              checked={includedInReview}
              onChange={(e) =>
                void onToggleHiddenFromReview(category.id, !e.target.checked)
              }
              aria-label={`Include ${category.name} in review`}
            />
            <span className={includedInReview ? 'text-text' : 'text-muted'}>
              {includedInReview ? 'On' : 'Off'}
            </span>
          </label>
          <Button
            type="button"
            className="bg-red-400/20 hover:bg-red-400/30"
            onClick={() => setConfirmOpen(true)}
            disabled={deleting}
          >
            Delete section
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete "${category.name}"?`}
        body={
          <>
            <p>
              This will permanently delete the <strong>{category.name}</strong> section and all{' '}
              {peopleCount} {peopleCount === 1 ? 'person' : 'people'} in it. This cannot be undone.
            </p>
          </>
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete section'}
        destructive
        onCancel={() => (deleting ? undefined : setConfirmOpen(false))}
        onConfirm={() => void handleConfirm()}
      />
    </>
  );
}
