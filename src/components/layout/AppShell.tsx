import type { PropsWithChildren } from 'react';
import { BottomNav } from './BottomNav';
import { useAuth } from '../../contexts/AuthContext';

export function AppShell({ children }: PropsWithChildren) {
  const { user, isGuest, signOut } = useAuth();

  return (
    <div className="app-shell pb-24">
      <header className="sticky top-0 z-10 -mx-4 border-b border-border bg-bg px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Reknown</h1>
          <div className="flex items-center gap-2">
            {isGuest ? (
              <span className="text-xs text-muted">Guest</span>
            ) : user ? (
              <span className="text-xs text-muted">{user.displayName || user.email}</span>
            ) : null}
            <button onClick={signOut} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-white/5 hover:text-text">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mt-4 flex-1">{children}</main>
      <BottomNav />
    </div>
  );
}
