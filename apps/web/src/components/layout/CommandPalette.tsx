import { Command } from "cmdk";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useUiStore } from "@/store/ui";
import { useAuth } from "@/auth/AuthContext";
import "./command-palette.css";

/**
 * Phase 4.5 — cmd-K command palette.
 *
 * Acceptance: "cmd-K palette navigates to a stub for every top-level
 * area." The palette also wires Phase 4.5's "G then C" / "/" sequences.
 *
 * Areas are gated by permission so a readonly user can't navigate to
 * Admin via the palette.
 */

interface PaletteAction {
  id: string;
  title: string;
  hint?: string;
  permission?: string;
  run: (nav: ReturnType<typeof useNavigate>) => void;
}

const ACTIONS: PaletteAction[] = [
  { id: "go.health", title: "Go: Health", hint: "/health", run: (n) => n("/health") },
  {
    id: "go.calculators",
    title: "Go: Calculators",
    hint: "/calculators",
    run: (n) => n("/calculators"),
  },
  {
    id: "go.clients",
    title: "Go: Clients",
    hint: "/clients",
    permission: "client:read",
    run: (n) => n("/clients"),
  },
  {
    id: "go.engagements",
    title: "Go: Engagements",
    hint: "/engagements",
    permission: "engagement:read",
    run: (n) => n("/engagements"),
  },
  {
    id: "go.reports",
    title: "Go: Reports",
    hint: "/reports",
    permission: "export:download",
    run: (n) => n("/reports"),
  },
  {
    id: "go.admin",
    title: "Go: Admin Users",
    hint: "/admin/users",
    permission: "user:list",
    run: (n) => n("/admin/users"),
  },
  { id: "go.profile", title: "Go: Your Profile", hint: "/me", run: (n) => n("/me") },
];

export function CommandPalette(): JSX.Element {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const closePalette = useUiStore((s) => s.closeCommandPalette);
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  const visible = ACTIONS.filter((a) => !a.permission || hasPermission(a.permission as never));

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        useUiStore.getState().toggleCommandPalette();
      } else if (e.key === "Escape" && open) {
        closePalette();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closePalette]);

  if (!open) return <></>;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-32"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={closePalette}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
      >
        <Command className="vibecalc-cmdk">
          <Command.Input
            autoFocus
            placeholder="Search or jump…"
            className="h-12 w-full border-b border-border bg-transparent px-4 text-sm focus:outline-none"
          />
          <Command.List className="max-h-80 overflow-auto p-2">
            <Command.Empty className="px-4 py-6 text-center text-sm text-muted-foreground">
              No matches.
            </Command.Empty>
            <Command.Group heading="Navigate">
              {visible.map((a) => (
                <Command.Item
                  key={a.id}
                  value={`${a.title} ${a.hint ?? ""}`}
                  onSelect={() => {
                    a.run(navigate);
                    closePalette();
                  }}
                  className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <span>{a.title}</span>
                  {a.hint && (
                    <span className="font-mono text-xs text-muted-foreground">{a.hint}</span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

/**
 * Phase 4.5 — additional shortcuts: "/" focuses the search input on
 * the page (if any), "G then C" navigates to /calculators, etc.
 *
 * The palette itself owns Cmd/Ctrl-K. This hook wires the rest.
 */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  useEffect(() => {
    let prefix: "g" | null = null;
    let prefixTimer: number | null = null;
    function clearPrefix(): void {
      prefix = null;
      if (prefixTimer) {
        window.clearTimeout(prefixTimer);
        prefixTimer = null;
      }
    }
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (e.key === "/" && !inField) {
        const search = document.querySelector<HTMLInputElement>('[data-shortcut="search"]');
        if (search) {
          e.preventDefault();
          search.focus();
          return;
        }
      }
      if (inField) return;
      if (prefix === "g") {
        const map: Record<string, string> = {
          c: "/calculators",
          l: "/clients", // L for cLient
          e: "/engagements",
          r: "/reports",
          a: "/admin/users",
          h: "/health",
        };
        const dest = map[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          navigate(dest);
        }
        clearPrefix();
        return;
      }
      if ((e.key === "g" || e.key === "G") && !e.ctrlKey && !e.metaKey) {
        prefix = "g";
        prefixTimer = window.setTimeout(clearPrefix, 1000);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearPrefix();
    };
  }, [navigate]);
}
