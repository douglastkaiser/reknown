import type { PropsWithChildren } from 'react';
import { BottomNav } from './BottomNav';

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell pb-24">
      <header className="sticky top-0 z-10 -mx-4 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur">
        <h1 className="text-xl font-semibold">Reknown</h1>
      </header>
      <main className="mt-4 flex-1">{children}</main>
      <BottomNav />
    </div>
  );
}
