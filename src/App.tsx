import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

const tabs = [
  { label: 'Home', path: '/home' },
  { label: 'Discover', path: '/discover' },
  { label: 'Profile', path: '/profile' }
];

function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <section className="card mt-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted">{description}</p>
    </section>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <header className="sticky top-0 z-10 -mx-4 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur">
        <h1 className="text-xl font-semibold tracking-tight">Reknown</h1>
        <p className="mt-1 text-sm text-muted">Mobile-first platform shell</p>
      </header>

      <nav className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-border bg-surface/70 p-2">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) => `nav-link text-center ${isActive ? 'nav-link-active' : ''}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1">
        <Routes>
          <Route
            path="/home"
            element={
              <Placeholder
                title="Welcome"
                description="Use this shell as your integration point for upcoming product modules."
              />
            }
          />
          <Route
            path="/discover"
            element={
              <Placeholder
                title="Discover"
                description="Plug in feed, search, and recommendation modules here."
              />
            }
          />
          <Route
            path="/profile"
            element={
              <Placeholder
                title="Profile"
                description="Attach account and settings experiences in this route scope."
              />
            }
          />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>
    </div>
  );
}
