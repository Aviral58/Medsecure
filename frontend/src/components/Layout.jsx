import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth.jsx";
import { ROLE_LABELS, initials, shorten } from "../lib/format.js";
import { currentTheme, saveTheme } from "../lib/theme.js";
import Icon from "./Icon.jsx";

export function Brand() {
  return (
    <span className="brand">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" />
        <path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" />
      </svg>
      MedSecure
    </span>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="rail-button"
      onClick={() => {
        saveTheme(next);
        setTheme(next);
      }}
    >
      <Icon name={next === "dark" ? "moon" : "sun"} size={18} />
      {next === "dark" ? "Dark colours" : "Light colours"}
    </button>
  );
}

/**
 * The frame around every page after login: the menu down the side (a slide-in
 * menu on a phone), who is logged in, and the page itself.
 * `nav` is [{ to, label, icon, badge? }].
 */
export default function Layout({ nav, children }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Choosing a page closes the phone menu and starts the new page at the top.
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const context = [ROLE_LABELS[user.role], user.hospitalName].filter((part) => part && part !== user.name).join(", ");

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to the page
      </a>

      <header className="mobile-bar">
        <button type="button" className="icon-button" onClick={() => setMenuOpen(true)} aria-label="Open the menu" aria-expanded={menuOpen}>
          <Icon name="menu" size={24} />
        </button>
        <Brand />
      </header>

      {menuOpen && <div className="rail-scrim" onClick={() => setMenuOpen(false)} />}
      <aside className={menuOpen ? "rail rail-open" : "rail"}>
        <div className="rail-top">
          <Brand />
          <button type="button" className="icon-button rail-close" onClick={() => setMenuOpen(false)} aria-label="Close the menu">
            <Icon name="close" />
          </button>
        </div>

        <nav className="rail-nav" aria-label="Pages">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => (isActive ? "rail-link rail-link-active" : "rail-link")}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.badge > 0 && (
                <span className={item.badgeTone === "alert" ? "rail-badge rail-badge-alert" : "rail-badge"}>{item.badge}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="rail-foot">
          <div className="rail-user">
            <span className="avatar" aria-hidden="true">
              {initials(user.name)}
            </span>
            <div>
              <strong>{user.name}</strong>
              <span>{context}</span>
            </div>
          </div>
          <p className="rail-fact" title={`Your blockchain address: ${user.address}`}>
            <Icon name="chain" size={16} />
            <span className="mono">{shorten(user.address, 8, 6)}</span>
          </p>
          <p className="rail-fact">
            <Icon name="lock" size={16} />
            Locks after {user.sessionIdleMinutes || 15} minutes without activity
          </p>
          <div className="rail-actions">
            <ThemeToggle />
            <button type="button" className="rail-button" onClick={logout}>
              <Icon name="logout" size={18} />
              Log out
            </button>
          </div>
        </div>
      </aside>

      <main id="main" className="page" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
