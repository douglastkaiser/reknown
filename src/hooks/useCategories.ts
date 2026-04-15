import { useCallback, useEffect, useState } from 'react';
import type { Category } from '../types';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../lib/storage';
import { useAuth } from '../contexts/AuthContext';

export function useCategories() {
  const { scope } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!scope) {
      setCategories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const next = await listCategories();
    setCategories(next);
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addCategory = useCallback(
    async (input: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) => {
      const created = await createCategory(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const editCategory = useCallback(
    async (id: string, updates: Partial<Omit<Category, 'id' | 'createdAt'>>) => {
      await updateCategory(id, updates);
      await refresh();
    },
    [refresh],
  );

  const removeCategory = useCallback(
    async (id: string) => {
      await deleteCategory(id);
      await refresh();
    },
    [refresh],
  );

  return { categories, loading, refresh, addCategory, editCategory, removeCategory };
}
