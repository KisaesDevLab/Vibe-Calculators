import { Component, type ErrorInfo, type ReactNode } from "react";
import { toast } from "sonner";

/**
 * Phase 4.9 — top-level error boundary.
 *
 * Surfaces a "Report issue" link with the stack-trace copyable to
 * clipboard. The toast is the soft path for component-level errors
 * surfaced via `toast.error(...)`; this catches the unhandled cases.
 */

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info });
    // Soft-surface for the user.
    if (typeof window !== "undefined") {
      toast.error("Something went wrong. The error has been recorded.");
    }
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  copyTrace = async (): Promise<void> => {
    if (!this.state.error) return;
    const trace = `${this.state.error.message}\n\n${this.state.error.stack ?? ""}\n\n--- componentStack ---${this.state.info?.componentStack ?? ""}`;
    try {
      await navigator.clipboard.writeText(trace);
      toast.success("Stack trace copied to clipboard.");
    } catch {
      toast.error("Could not copy.");
    }
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">{this.state.error.message}</p>
        <div className="flex gap-2">
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Reload
          </button>
          <button
            onClick={() => void this.copyTrace()}
            className="rounded-md border border-input px-3 py-2 text-sm"
          >
            Copy stack trace
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Paste the stack trace into a support ticket so we can reproduce.
        </p>
      </main>
    );
  }
}
