import { Link, NavLink, Outlet } from "react-router-dom";
import { useTheme, type ThemePreference } from "./lib/theme";

export function App() {
  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <header className="border-b border-border bg-bg-elev/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
          <Link to="/" className="text-sm font-semibold tracking-tight text-text">
            claude-session-kit
          </Link>
          <nav className="flex gap-4 text-sm">
            <NavItem to="/">Home</NavItem>
            <NavItem to="/search">Search</NavItem>
            <NavItem to="/analyze">Analyze</NavItem>
            <NavItem to="/patterns">Patterns</NavItem>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-faint hidden sm:inline">read-only · localhost</span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `transition-colors ${isActive ? "text-text" : "text-faint hover:text-dim"}`
      }
    >
      {children}
    </NavLink>
  );
}

const LABELS: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function ThemeToggle() {
  const { preference, resolved, cycle } = useTheme();
  const icon = resolved === "dark" ? "☾" : "☀";
  const title = `Theme: ${LABELS[preference]}${preference === "system" ? ` (→ ${resolved})` : ""}. Click to cycle.`;
  return (
    <button
      onClick={cycle}
      title={title}
      aria-label={title}
      className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-dim hover:text-text hover:border-border-strong transition-colors"
    >
      <span aria-hidden className="text-sm leading-none">{icon}</span>
      <span>{LABELS[preference]}</span>
    </button>
  );
}
