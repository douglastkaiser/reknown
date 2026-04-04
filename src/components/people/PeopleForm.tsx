import { type FormEvent, useState } from 'react';
import type { Person } from '../../types';
import { Button } from '../common/Button';
import { PhotoUpload } from './PhotoUpload';

export function PeopleForm({ onSave }: { onSave: (input: Omit<Person, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void> }) {
  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [company, setCompany] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onSave({ name: name.trim(), headline, company, photoDataUrl, tags: [] });
    setName('');
    setHeadline('');
    setCompany('');
    setPhotoDataUrl('');
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Headline" value={headline} onChange={(e) => setHeadline(e.target.value)} />
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
      <PhotoUpload value={photoDataUrl} onChange={setPhotoDataUrl} />
      <Button type="submit">Add person</Button>
    </form>
  );
}
