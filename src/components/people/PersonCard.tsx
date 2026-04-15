import { useState } from 'react';
import type { Person } from '../../types';
import { Button } from '../common/Button';
import { googleImageSearchUrl, urlToData } from '../../lib/image';
import { capitalizeName, parseNicknames } from '../../lib/text';
import type { PersonMetric } from '../../lib/storage';

export function PersonCard({
  person,
  onDelete,
  onUpdate,
  metric,
}: {
  person: Person;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Person>) => Promise<void> | void;
  metric?: PersonMetric;
}) {
  const photo = person.photoDataUrl || person.photoUrl;
  const [pasteUrl, setPasteUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const [editName, setEditName] = useState(person.name);
  const [editNicknames, setEditNicknames] = useState((person.nicknames ?? []).join(', '));
  const [editHeadline, setEditHeadline] = useState(person.headline ?? '');
  const [editCompany, setEditCompany] = useState(person.company ?? '');
  const [editPhotoUrl, setEditPhotoUrl] = useState(person.photoUrl ?? '');
  const [editLinkedinUrl, setEditLinkedinUrl] = useState(person.linkedinUrl ?? '');

  function startEdit() {
    setEditName(person.name);
    setEditNicknames((person.nicknames ?? []).join(', '));
    setEditHeadline(person.headline ?? '');
    setEditCompany(person.company ?? '');
    setEditPhotoUrl(person.photoUrl ?? '');
    setEditLinkedinUrl(person.linkedinUrl ?? '');
    setEditing(true);
  }

  async function saveEdit() {
    if (!onUpdate || !editName.trim()) return;
    await onUpdate(person.id, {
      name: capitalizeName(editName),
      nicknames: parseNicknames(editNicknames),
      headline: editHeadline,
      company: editCompany,
      photoUrl: editPhotoUrl.trim() || undefined,
      linkedinUrl: editLinkedinUrl.trim() || undefined,
    });
    setEditing(false);
  }

  async function savePhotoFromUrl() {
    if (!pasteUrl.trim() || !onUpdate) return;
    setSaving(true);
    try {
      const trimmed = pasteUrl.trim();
      const data = await urlToData(trimmed);
      // urlToData returns a data URL on success or the raw URL on CORS failure.
      // When the fetch succeeds we still keep the original URL in photoUrl so
      // the edit form has something to display; otherwise the user sees a
      // photo but an empty Photo URL field.
      const updates: Partial<Person> = data.startsWith('data:')
        ? { photoDataUrl: data, photoUrl: trimmed }
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
          {person.nicknames?.length ? (
            <p className="text-xs text-muted/80">aka {person.nicknames.join(', ')}</p>
          ) : null}
          <p className="text-sm text-muted">{person.headline || 'No headline'}</p>
          <p className="text-xs text-muted">{person.company || 'No company'}</p>
        </div>
        <div className="flex flex-col gap-1">
          {onUpdate ? (
            <Button onClick={() => (editing ? setEditing(false) : startEdit())}>
              {editing ? 'Cancel' : 'Edit'}
            </Button>
          ) : null}
          <Button className="bg-red-400/20" onClick={() => onDelete(person.id)}>Delete</Button>
        </div>
      </div>

      {metric && (metric.faceToNameCorrect + metric.faceToNameIncorrect + metric.nameToFaceCorrect + metric.nameToFaceIncorrect) > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
          <span className="rounded-full border border-border px-2 py-0.5">
            Name misses: <span className="font-semibold text-red-400">{metric.faceToNameIncorrect}</span>
          </span>
          <span className="rounded-full border border-border px-2 py-0.5">
            Face misses: <span className="font-semibold text-red-400">{metric.nameToFaceIncorrect}</span>
          </span>
          <span className="rounded-full border border-border px-2 py-0.5">
            Name correct: <span className="font-semibold text-green-400">{metric.faceToNameCorrect}</span>
          </span>
          <span className="rounded-full border border-border px-2 py-0.5">
            Face correct: <span className="font-semibold text-green-400">{metric.nameToFaceCorrect}</span>
          </span>
        </div>
      ) : null}

      {editing && onUpdate ? (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-bg/50 p-3">
          {photo ? (
            <div className="flex items-center gap-2 text-xs text-muted">
              <img
                src={photo}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
                style={{ objectPosition: 'center 25%' }}
              />
              <span>
                Photo set ({person.photoDataUrl ? 'enriched / uploaded' : 'external URL'})
              </span>
            </div>
          ) : null}
          <input
            className="w-full rounded-lg bg-bg px-3 py-2 text-sm"
            placeholder="Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
          <input
            className="w-full rounded-lg bg-bg px-3 py-2 text-sm"
            placeholder="Nicknames (comma separated)"
            value={editNicknames}
            onChange={(e) => setEditNicknames(e.target.value)}
          />
          <input
            className="w-full rounded-lg bg-bg px-3 py-2 text-sm"
            placeholder="Headline"
            value={editHeadline}
            onChange={(e) => setEditHeadline(e.target.value)}
          />
          <input
            className="w-full rounded-lg bg-bg px-3 py-2 text-sm"
            placeholder="Company"
            value={editCompany}
            onChange={(e) => setEditCompany(e.target.value)}
          />
          <input
            type="url"
            className="w-full rounded-lg bg-bg px-3 py-2 text-sm"
            placeholder="Photo URL"
            value={editPhotoUrl}
            onChange={(e) => setEditPhotoUrl(e.target.value)}
          />
          <input
            type="url"
            className="w-full rounded-lg bg-bg px-3 py-2 text-sm"
            placeholder="LinkedIn URL"
            value={editLinkedinUrl}
            onChange={(e) => setEditLinkedinUrl(e.target.value)}
          />
          <Button type="button" onClick={() => void saveEdit()}>Save</Button>
        </div>
      ) : null}

      {!photo && onUpdate ? (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-bg/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">Missing photo</span>
            <div className="flex items-center gap-3">
              <a
                href={googleImageSearchUrl(person.name, person.company)}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline"
              >
                Find photo on Google Images →
              </a>
              {person.linkedinUrl?.trim() ? (
                <a
                  href={person.linkedinUrl.trim()}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-accent hover:underline"
                >
                  Open LinkedIn profile →
                </a>
              ) : null}
            </div>
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
