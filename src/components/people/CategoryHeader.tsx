import { useState } from 'react';
import type { Category } from '../../types';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';

const METHOD_LABEL: Record<Category['enrichMethod'], string> = {
  linkedin: 'LinkedIn',
  roster_url: 'Roster URL',
};

export function CategoryHeader({
  category,
  peopleCount,
  onDelete,
}: {
  category: Category;
  peopleCount: number;
  onDelete: (id: string) => Promise<void> | void;
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

  return (
    <>
      <div className="card flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text">{category.name}</h2>
          <p className="text-xs text-muted">
            <span className="rounded-full border border-border px-2 py-0.5">
              {METHOD_LABEL[category.enrichMethod]}
            </span>{' '}
            · {peopleCount} {peopleCount === 1 ? 'person' : 'people'}
          </p>
        </div>
        <Button
          type="button"
          className="bg-red-400/20 hover:bg-red-400/30"
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
        >
          Delete section
        </Button>
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
