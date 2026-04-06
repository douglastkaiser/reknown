import { NavLink } from 'react-router-dom';

const tabs = [
  { label: 'Review', path: '/review' },
  { label: 'People', path: '/people' },
  { label: 'Stats', path: '/stats' },
  { label: 'About', path: '/about' },
];

export function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 mx-auto grid w-full max-w-2xl grid-cols-4 gap-2 border-t border-border bg-bg p-3"
    >
      {tabs.map((tab) => (
        <NavLink key={tab.path} to={tab.path} className={({ isActive }) => `nav-link text-center ${isActive ? 'nav-link-active' : ''}`}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
