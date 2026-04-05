import { useCallback, useEffect, useRef, useState } from 'react';
import type { Person } from '../types';
import { createPerson, deletePerson, listPeople, seedPeople, updatePerson } from '../lib/storage';

export function usePeople() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const seededOnStartupRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);

    let nextPeople = await listPeople();
    if (!seededOnStartupRef.current && nextPeople.length === 0) {
      const { starterPeople } = await import('../lib/starter-people');
      await seedPeople(starterPeople.map((row) => ({ ...row, tags: [] })));
      seededOnStartupRef.current = true;
      nextPeople = await listPeople();
    }

    setPeople(nextPeople);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addPerson = useCallback(async (input: Omit<Person, 'id' | 'createdAt' | 'updatedAt'>) => {
    await createPerson(input);
    await refresh();
  }, [refresh]);

  const editPerson = useCallback(async (id: string, updates: Partial<Omit<Person, 'id' | 'createdAt'>>) => {
    await updatePerson(id, updates);
    await refresh();
  }, [refresh]);

  const removePerson = useCallback(async (id: string) => {
    await deletePerson(id);
    await refresh();
  }, [refresh]);

  return { people, loading, refresh, addPerson, editPerson, removePerson };
}
