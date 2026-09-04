import { Home, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';

export default function Sidebar() {
  return (
    <aside className="sidebar" role="navigation" aria-label="Main navigation">
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <rect width="28" height="28" rx="6" fill="#378ADD" />
            <path d="M8 20V8l6 4-6 4zm6-4l6 4V8l-6 4z" fill="white" />
          </svg>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">Vantage</span>
            <span className="sidebar-brand-sub">AI Development Observability</span>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
        >
          <Home size={18} />
          <span>Overview</span>
        </NavLink>
        <NavLink
          to="/users"
          className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
        >
          <Users size={18} />
          <span>Users</span>
        </NavLink>
      </nav>
    </aside>
  );
}
