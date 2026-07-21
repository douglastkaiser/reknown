import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import {
  clearScope,
  createCategory,
  listPeople,
  migrateGuestScope,
  seedPeople,
  setActiveScope,
} from '../lib/storage';
import { startSync, stopSync } from '../lib/sync';

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
  // Tracks whether a sign-in is mid-handshake (guest migration + initial sync).
  // Children must not render authenticated views until the handshake finishes,
  // otherwise their effects would read storage before the scope and cloud
  // data are in place.
  const [handshaking, setHandshaking] = useState(false);

  const scope = user ? `u:${user.uid}` : isGuest ? 'guest' : null;
  // Keep the storage layer's active scope in sync synchronously so that
  // child effects (e.g. usePeople's refresh) observe the correct scope on
  // the same render — a useEffect here would fire after child effects and
  // cause listPeople/createPerson to run with a null scope.
  setActiveScope(scope);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setHandshaking(true);
        try {
          // Carry any work the user did in guest mode into their account
          // before sync starts, so the reconciliation pass treats it as
          // local data to push rather than discarding it.
          await migrateGuestScope(firebaseUser.uid);
          setActiveScope(`u:${firebaseUser.uid}`);
          await startSync(firebaseUser.uid);
        } catch (err) {
          console.warn('[auth] sign-in handshake failed', err);
        } finally {
          setIsGuest(false);
          setUser(firebaseUser);
          setHandshaking(false);
          setLoading(false);
        }
      } else {
        stopSync();
        setUser(null);
        setLoading(false);
      }
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
      const defaultCategory = await createCategory({
        name: 'LinkedIn',
        enrichMethod: 'linkedin',
      });
      await seedPeople(starterPeople, defaultCategory.id);
    }
    setIsGuest(true);
  }

  async function signOut() {
    const uid = user?.uid ?? auth.currentUser?.uid ?? null;
    stopSync();
    await firebaseSignOut(auth);
    setIsGuest(false);

    if (uid) {
      // Wipe this account's local data so names, faces, lists and review
      // history don't survive for the next person on a shared device. Cloud
      // data is untouched; the next sign-in reconciles it back. Guest data is
      // left alone — it has no cloud backup to restore from.
      try {
        await clearScope(`u:${uid}`);
      } catch (err) {
        console.warn('[auth] local data wipe on sign-out failed', err);
      }
      setUser(null);
      setActiveScope(null);
      // Ask the next boot to purge Firestore's own offline cache, then hard
      // reload to drop all in-memory state.
      try {
        window.localStorage.setItem('reknown:clear-fs-cache', '1');
      } catch {
        // Non-fatal: private-mode or storage-disabled browsers just skip the
        // Firestore-cache purge; our own IndexedDB wipe above still ran.
      }
      window.location.reload();
      return;
    }

    setUser(null);
    setActiveScope(null);
  }

  const authenticated = Boolean(user) || isGuest;

  return (
    <AuthContext.Provider
      value={{
        user,
        isGuest,
        scope,
        loading: (loading && !authenticated) || handshaking,
        signInWithGoogle,
        continueAsGuest,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
