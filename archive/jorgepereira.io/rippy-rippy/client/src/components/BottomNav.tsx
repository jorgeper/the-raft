import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'Today' },
  { to: '/workouts', label: 'Workouts' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/settings', label: 'Settings' },
];

/** Phone-first bottom tab bar; the active tab inverts to ink. */
export default function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line"
      style={{
        background: 'rgba(250,249,245,.94)',
        backdropFilter: 'blur(10px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="mx-auto flex max-w-3xl justify-around px-2 py-1.5">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `min-w-[72px] rounded-ctl px-3 py-2 text-center text-[13px] font-[550] no-underline ` +
              (isActive ? 'bg-ink text-page' : 'text-ink2 hover:bg-surface2')
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
