import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Phase 4.2 — theme provider.
 *
 * Persists preference to localStorage; defaults to 'system'. The
 * `dark` class on <html> is what Tailwind's `darkMode: 'class'`
 * config keys off of.
 */

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = "vibecalc.theme";

const ThemeContext = createContext<ThemeState | undefined>(undefined);

function readInitial(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

function resolve(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [mode, setModeState] = useState<ThemeMode>(() => readInitial());
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(readInitial()));

  const apply = useCallback((next: ThemeMode) => {
    const r = resolve(next);
    setResolved(r);
    const root = document.documentElement;
    if (r === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, []);

  useEffect(() => {
    apply(mode);
    if (mode === "system" && typeof window !== "undefined") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (): void => apply("system");
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    return undefined;
  }, [mode, apply]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
