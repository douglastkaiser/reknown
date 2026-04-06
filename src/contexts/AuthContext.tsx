import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';

interface AuthState {
  user: User | null;
  isGuest: boolean;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  continueAsGuest: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setIsGuest(false);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  async function signInWithGoogle() {
    await signInWithPopup(auth, googleProvider);
  }

  function continueAsGuest() {
    setIsGuest(true);
  }

  async function signOut() {
    await firebaseSignOut(auth);
    setUser(null);
    setIsGuest(false);
  }

  const authenticated = Boolean(user) || isGuest;

  return (
    <AuthContext.Provider value={{ user, isGuest, loading: loading && !authenticated, signInWithGoogle, continueAsGuest, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
