import { useState } from 'react';
import type { Person } from '../../types';
import { Button } from '../common/Button';
import { googleImageSearchUrl, urlToData } from '../../lib/image';

export function PersonCard({
  person,
  onDelete,
  onUpdate,
}: {
  person: Person;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Person>) => Promise<void> | void;
}) {
  const photo = person.photoDataUrl || person.photoUrl;
  const [pasteUrl, setPasteUrl] = useState('');
  const [saving, setSaving] = useState(false);

  async function savePhotoFromUrl() {
    if (!pasteUrl.trim() || !onUpdate) return;
    setSaving(true);
    try {
      const data = await urlToData(pasteUrl.trim());
      // urlToData returns a data URL on success or the raw URL on CORS failure.
      const updates: Partial<Person> = data.startsWith('data:')
        ? { photoDataUrl: data }
        : { photoUrl: data };
      await onUpdate(person.id, updates);
      setPasteUrl('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="card">
      <div className="flex items-start gap-3">
        {photo ? (
          <img
            src={photo}
            alt={person.name}
            className="h-14 w-14 rounded-full object-cover"
            style={{ objectPosition: 'center 25%' }}
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-xs text-muted">
            ?
          </div>
        )}
        <div className="flex-1">
          <h3 className="font-semibold">{person.name}</h3>
          <p className="text-sm text-muted">{person.headline || 'No headline'}</p>
          <p className="text-xs text-muted">{person.company || 'No company'}</p>
        </div>
        <Button className="bg-red-400/20" onClick={() => onDelete(person.id)}>Delete</Button>
      </div>

      {!photo && onUpdate ? (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-bg/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">Missing photo</span>
            <a
              href={googleImageSearchUrl(person.name, person.company)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent hover:underline"
            >
              Find photo on Google Images →
            </a>
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="Paste image URL"
              value={pasteUrl}
              onChange={(e) => setPasteUrl(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text placeholder:text-muted/50 focus:border-accent focus:outline-none"
            />
            <Button
              type="button"
              disabled={!pasteUrl.trim() || saving}
              onClick={() => void savePhotoFromUrl()}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
          <p className="text-[10px] text-muted">
            Tip: open the search, right-click the right photo, "Copy image address", paste here.
          </p>
        </div>
      ) : null}
    </article>
  );
}
