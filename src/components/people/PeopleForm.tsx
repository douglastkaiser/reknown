import { type FormEvent, useState } from 'react';
import type { Person } from '../../types';
import { Button } from '../common/Button';
import { PhotoUpload } from './PhotoUpload';
import { capitalizeName, parseNicknames } from '../../lib/text';
import { detectPhotoFocus } from '../../lib/face-focus';
import { inferPersonRegion } from '../../lib/regions';

export function PeopleForm({
  categoryId,
  onSave,
}: {
  categoryId: string;
  onSave: (input: Omit<Person, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [nicknames, setNicknames] = useState('');
  const [headline, setHeadline] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [region, setRegion] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const normalizedPhotoDataUrl = photoDataUrl || undefined;
    const normalizedPhotoUrl = photoUrl.trim() || undefined;
    const photoFocus = await detectPhotoFocus(normalizedPhotoDataUrl ?? normalizedPhotoUrl);
    const normalizedRegion = inferPersonRegion({ company, location, region });
    await onSave({
      name: capitalizeName(name),
      categoryId,
      nicknames: parseNicknames(nicknames),
      headline,
      company,
      location: location.trim() || undefined,
      region: normalizedRegion,
      photoDataUrl: normalizedPhotoDataUrl,
      photoUrl: normalizedPhotoUrl,
      photoFocus,
      linkedinUrl: linkedinUrl.trim() || undefined,
    });
    setName('');
    setNicknames('');
    setHeadline('');
    setCompany('');
    setLocation('');
    setRegion('');
    setPhotoDataUrl('');
    setPhotoUrl('');
    setLinkedinUrl('');
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Nicknames (comma separated)" value={nicknames} onChange={(e) => setNicknames(e.target.value)} />
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Headline" value={headline} onChange={(e) => setHeadline(e.target.value)} />
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Current location (city or source text)" value={location} onChange={(e) => setLocation(e.target.value)} />
      <input className="w-full rounded-lg bg-bg px-3 py-2" placeholder="Current region (e.g. SoCal)" value={region} onChange={(e) => setRegion(e.target.value)} />
      <input
        type="url"
        className="w-full rounded-lg bg-bg px-3 py-2"
        placeholder="Photo URL (link to an image)"
        value={photoUrl}
        onChange={(e) => setPhotoUrl(e.target.value)}
      />
      <input
        type="url"
        className="w-full rounded-lg bg-bg px-3 py-2"
        placeholder="LinkedIn URL (e.g. https://www.linkedin.com/in/…)"
        value={linkedinUrl}
        onChange={(e) => setLinkedinUrl(e.target.value)}
      />
      <PhotoUpload value={photoDataUrl} onChange={setPhotoDataUrl} />
      <Button type="submit">Add person</Button>
    </form>
  );
}
