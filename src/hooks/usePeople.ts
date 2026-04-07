import { useCallback, useEffect, useState } from 'react';
import type { Person } from '../types';
import { createPerson, deletePerson, listPeople, updatePerson } from '../lib/storage';
import { useAuth } from '../contexts/AuthContext';

export function usePeople() {
  const { scope } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!scope) {
      setPeople([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    const nextPeople = await listPeople();

    setPeople(nextPeople);
    setLoading(false);
  }, [scope]);

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
