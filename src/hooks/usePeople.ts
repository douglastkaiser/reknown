import { useCallback, useEffect, useState } from 'react';
import type { Person } from '../types';
import { createPerson, deletePerson, listPeople, updatePerson } from '../lib/storage';

export function usePeople() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setPeople(await listPeople());
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
