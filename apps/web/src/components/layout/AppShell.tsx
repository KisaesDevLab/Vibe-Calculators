import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  Calculator,
  Users,
  FolderOpen,
  FileText,
  Settings,
  Search,
  Sun,
  Moon,
  Monitor,
  Inbox,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useTheme } from "@/theme/ThemeProvider";
import { useUiStore } from "@/store/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Phase 4.1 — application shell.
 *
 * Left rail (Calculators / Clients / Engagements / Reports / Admin),
 * top bar (firm logo placeholder + global search trigger + theme
 * toggle + user menu), and main content area for the matched route.
 *
 * The visible sections are gated by the user's permissions — readonly
 * users don't see Admin in the rail, etc.
 */

interface NavItem {
  to: string;
  label: string;
  icon: typeof Calculator;
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/queue", label: "My queue", icon: Inbox, permission: "engagement:read" },
  { to: "/calculators", label: "Calculators", icon: Calculator },
  { to: "/clients", label: "Clients", icon: Users, permission: "client:read" },
  { to: "/engagements", label: "Engagements", icon: FolderOpen, permission: "engagement:read" },
  { to: "/reports", label: "Reports", icon: FileText, permission: "export:download" },
  { to: "/admin/users", label: "Admin", icon: Settings, permission: "user:list" },
];

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { user, hasPermission } = useAuth();
  const openCommandPalette = useUiStore((s) => s.openCommandPalette);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  const visible = NAV_ITEMS.filter((i) => !i.permission || hasPermission(i.permission as never));

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={cn(
          "flex flex-col border-r border-border transition-all duration-150",
          sidebarCollapsed ? "w-14" : "w-56",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-3">
          {!sidebarCollapsed && (
            <span className="text-sm font-semibold tracking-tight">Vibe Calculators</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
          </Button>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {visible.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border px-4">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={openCommandPalette}
            aria-label="Open command palette"
          >
            <Search className="h-4 w-4" />
            <span className="text-muted-foreground">Search…</span>
            <kbd className="ml-2 hidden rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground sm:inline">
              ⌘K
            </kbd>
          </Button>
          <div className="flex-1" />
          <ThemeToggle />
          <UserMenu name={user?.name ?? "—"} />
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function ThemeToggle(): JSX.Element {
  const { mode, setMode } = useTheme();
  const Icon = mode === "dark" ? Moon : mode === "light" ? Sun : Monitor;
  function cycle(): void {
    const next = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
    setMode(next);
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={`Theme: ${mode}. Click to cycle.`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

function UserMenu({ name }: { name: string }): JSX.Element {
  return (
    <NavLink
      to="/me"
      className="flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
    >
      {name}
    </NavLink>
  );
}
