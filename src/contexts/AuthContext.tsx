import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { clearScope, listPeople, seedPeople, setActiveScope } from '../lib/storage';

interface AuthState {
  user: User | null;
  isGuest: boolean;
  loading: boolean;
  scope: string | null;
  signInWithGoogle: () => Promise<void>;
  continueAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);

  const scope = user ? `u:${user.uid}` : isGuest ? 'guest' : null;
  // Keep the storage layer's active scope in sync synchronously so that
  // child effects (e.g. usePeople's refresh) observe the correct scope on
  // the same render — a useEffect here would fire after child effects and
  // cause listPeople/createPerson to run with a null scope.
  setActiveScope(scope);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setIsGuest(false);
        // Signing in over a guest session: discard guest data so it does not
        // leak between sessions.
        void clearScope('guest');
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  async function signInWithGoogle() {
    await signInWithPopup(auth, googleProvider);
  }

  async function continueAsGuest() {
    // Seed BEFORE flipping React state so the storage layer's scope cannot
    // be clobbered by an interleaved render and any failure surfaces here
    // instead of being swallowed by usePeople's fire-and-forget refresh.
    setActiveScope('guest');
    const existing = await listPeople();
    if (existing.length === 0) {
      const { starterPeople } = await import('../lib/starter-people');
      await seedPeople(starterPeople.map((row) => ({ ...row, tags: [] })));
    }
    setIsGuest(true);
  }

  async function signOut() {
    await firebaseSignOut(auth);
    setUser(null);
    setIsGuest(false);
    setActiveScope(null);
  }

  const authenticated = Boolean(user) || isGuest;

  return (
    <AuthContext.Provider value={{ user, isGuest, scope, loading: loading && !authenticated, signInWithGoogle, continueAsGuest, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
