import { Link, NavLink, Outlet } from "react-router-dom";

export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
          <Link to="/" className="text-sm font-semibold tracking-tight text-neutral-100">
            claude-session-kit
          </Link>
          <nav className="flex gap-4 text-sm">
            <NavItem to="/">Home</NavItem>
            <NavItem to="/search">Search</NavItem>
            <NavItem to="/analyze">Analyze</NavItem>
          </nav>
          <div className="ml-auto text-xs text-neutral-500">read-only · localhost</div>
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
        `transition-colors ${isActive ? "text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`
      }
    >
      {children}
    </NavLink>
  );
}
