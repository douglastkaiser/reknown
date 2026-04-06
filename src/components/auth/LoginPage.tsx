import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

export function LoginPage() {
  const { signInWithGoogle, continueAsGuest } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  async function handleGoogleSignIn() {
    setError(null);
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-text">Reknown</h1>
          <p className="text-muted">Learn names and faces with spaced repetition</p>
          <p className="text-sm text-muted/80">
            Add the people you meet — colleagues, classmates, friends of friends — and Reknown
            quizzes you on their faces and names with spaced repetition so you actually remember.
            Your data stays tied to your account on this device.
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleGoogleSignIn}
            disabled={signingIn}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-sm font-medium text-gray-800 transition hover:bg-gray-100 disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            {signingIn ? 'Signing in...' : 'Sign in with Google'}
          </button>

          <button
            onClick={continueAsGuest}
            className="w-full rounded-xl border border-border bg-surface/80 px-4 py-3 text-sm font-medium text-muted transition hover:bg-surface hover:text-text"
          >
            Continue as Guest
          </button>
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <p className="text-xs text-muted/60">
          Guest mode uses sample celebrity data. Sign in to save your own people.
        </p>
      </div>
    </div>
  );
}
