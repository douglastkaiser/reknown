import { NavLink } from 'react-router-dom';

const tabs = [
  { label: 'Home', path: '/home' },
  { label: 'Stats', path: '/stats' },
  { label: 'People', path: '/people' },
  { label: 'Review', path: '/review' },
  { label: 'Import', path: '/import' },
];

export function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 mx-auto grid w-full max-w-2xl gap-2 border-t border-border bg-bg/95 p-3 backdrop-blur"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab) => (
        <NavLink key={tab.path} to={tab.path} className={({ isActive }) => `nav-link text-center ${isActive ? 'nav-link-active' : ''}`}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
