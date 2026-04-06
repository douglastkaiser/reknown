import { type FormEvent, useState } from 'react';
import type { Person } from '../../types';
import { Button } from '../common/Button';
import { PhotoUpload } from './PhotoUpload';
import { capitalizeName, parseNicknames } from '../../lib/text';

export function PeopleForm({ onSave }: { onSave: (input: Omit<Person, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void> }) {
  const [name, setName] = useState('');
  const [nicknames, setNicknames] = useState('');
  const [headline, setHeadline] = useState('');
  const [company, setCompany] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onSave({
      name: capitalizeName(name),
      nicknames: parseNicknames(nicknames),
      headline,
      company,
      photoDataUrl: photoDataUrl || undefined,
      photoUrl: photoUrl.trim() || undefined,
      tags: [],
    });
    setName('');
    setNicknames('');
    setHeadline('');
    setCompany('');
    setPhotoDataUrl('');
    setPhotoUrl('');
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Nicknames (comma separated)" value={nicknames} onChange={(e) => setNicknames(e.target.value)} />
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Headline" value={headline} onChange={(e) => setHeadline(e.target.value)} />
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
      <input
        type="url"
        className="w-full rounded-lg bg-bg px-3 py-2"
        placeholder="Photo URL (link to an image)"
        value={photoUrl}
        onChange={(e) => setPhotoUrl(e.target.value)}
      />
      <PhotoUpload value={photoDataUrl} onChange={setPhotoDataUrl} />
      <Button type="submit">Add person</Button>
    </form>
  );
}
