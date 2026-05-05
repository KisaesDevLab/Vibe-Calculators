import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Phase 25.3 — first-run setup wizard.
 *
 * Visible only when the appliance has zero users. Three steps:
 *   1. Admin: paste bootstrap token, create the first admin user.
 *   2. Firm: name, address, EIN, phone, brand color, optional logo.
 *   3. Done: a "next steps" panel pointing at SMTP / AI / deploy-mode
 *      configuration, all of which live in .env (not the UI) for
 *      security reasons.
 *
 * Each step persists immediately. If the operator quits after step 1,
 * the firm-info + brand fields can still be filled in later via
 * Admin → Firm settings.
 */

interface SetupStatus {
  open: boolean;
}

export function SetupWizardPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/setup/status", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<unknown>;
      })
      .then((raw) => {
        if (cancelled) return;
        if (
          raw &&
          typeof raw === "object" &&
          typeof (raw as { open?: unknown }).open === "boolean"
        ) {
          const j = raw as SetupStatus;
          setStatus(j);
          if (!j.open) navigate("/login", { replace: true });
        } else {
          navigate("/login", { replace: true });
        }
      })
      .catch(() => {
        if (!cancelled) navigate("/login", { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (!status) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl space-y-4">
        <ProgressBar step={step} />
        {step === 1 && <Step1Admin onNext={() => setStep(2)} queryClient={queryClient} />}
        {step === 2 && <Step2Firm onNext={() => setStep(3)} />}
        {step === 3 && <Step3Done onFinish={() => navigate("/calculators", { replace: true })} />}
      </div>
    </main>
  );
}

function ProgressBar({ step }: { step: 1 | 2 | 3 }): JSX.Element {
  const labels = ["Admin user", "Firm info", "Done"];
  return (
    <ol className="flex items-center gap-2 text-xs">
      {labels.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const active = n === step;
        const done = n < step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={
                "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold " +
                (active
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground")
              }
            >
              {done ? "✓" : n}
            </span>
            <span
              className={
                active
                  ? "font-medium"
                  : done
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-muted-foreground"
              }
            >
              {label}
            </span>
            {n < 3 && <span className="text-muted-foreground">·</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Step1Admin({
  onNext,
  queryClient,
}: {
  onNext: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}): JSX.Element {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/setup", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, name, password }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { detail?: string };
        throw new Error(j.detail ?? `HTTP ${res.status}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      await queryClient.refetchQueries({ queryKey: ["auth", "me"] });
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create the first admin user</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste the bootstrap token from{" "}
          <code className="rounded bg-muted px-1">just bootstrap</code> and create your admin login.
          You'll be signed in immediately and can finish firm setup in the next step.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Bootstrap token">
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              autoFocus
              placeholder="vibe_setup_…"
              autoComplete="off"
            />
          </Field>
          <Field label="Admin email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </Field>
          <Field label="Admin name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              ≥ 12 characters; common-list words rejected.
            </p>
          </Field>
          {error && (
            <p className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting || !token || !email || !name || !password}>
            {submitting ? "Creating…" : "Create admin & continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Step2Firm({ onNext }: { onNext: () => void }): JSX.Element {
  const [firmName, setFirmName] = useState("");
  const [firmEin, setFirmEin] = useState("");
  const [firmAddress, setFirmAddress] = useState("");
  const [firmPhone, setFirmPhone] = useState("");
  const [brandColor, setBrandColor] = useState("#2563eb");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        firmName,
        firmEin: firmEin || null,
        firmAddress: firmAddress || null,
        firmPhone: firmPhone || null,
        brandColor,
      };
      if (logoFile) {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error("file read failed"));
          reader.readAsDataURL(logoFile);
        });
        body.logoDataUrl = dataUrl;
      }
      const res = await fetch("/api/v1/admin/firm-settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json()) as { detail?: string };
        throw new Error(j.detail ?? `HTTP ${res.status}`);
      }
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Firm details & branding</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Set your firm identity. The name appears in PDF headers and email signatures; the brand
          color tints the app shell. You can change any of this later in{" "}
          <strong>Admin → Firm settings</strong>.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Firm name">
            <Input
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              required
              placeholder="Acme & Associates, CPAs"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="EIN (optional)">
              <Input
                value={firmEin}
                onChange={(e) => setFirmEin(e.target.value)}
                placeholder="12-3456789"
              />
            </Field>
            <Field label="Phone (optional)">
              <Input
                value={firmPhone}
                onChange={(e) => setFirmPhone(e.target.value)}
                placeholder="(555) 555-1212"
              />
            </Field>
          </div>
          <Field label="Address (optional)">
            <Input
              value={firmAddress}
              onChange={(e) => setFirmAddress(e.target.value)}
              placeholder="100 Main St, Springfield, IL 62701"
            />
          </Field>
          <Field label="Brand color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-md border border-input"
              />
              <Input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                pattern="#[0-9a-fA-F]{6}"
                className="font-mono text-sm"
              />
            </div>
          </Field>
          <Field label="Logo (optional · PNG/JPEG/WebP, ≤ 1 MB)">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm"
            />
          </Field>
          {error && (
            <p className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting || !firmName}>
              {submitting ? "Saving…" : "Save & continue"}
            </Button>
            <Button type="button" variant="ghost" onClick={onNext} disabled={submitting}>
              Skip
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Step3Done({ onFinish }: { onFinish: () => void }): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" /> You're set up
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          The appliance is ready. A few optional things you can configure when you have time:
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3 text-sm">
          <li>
            <strong>Email delivery (SMTP / Postmark / EmailIt)</strong> — magic-link, password
            reset, scheduled-recompute, comment-mention emails. Set{" "}
            <code className="rounded bg-muted px-1 text-xs">SMTP_*</code> or{" "}
            <code className="rounded bg-muted px-1 text-xs">POSTMARK_SERVER_TOKEN</code> in
            <code className="rounded bg-muted px-1 text-xs">.env</code> and restart the server
            container.
          </li>
          <li>
            <strong>AI extraction (Phase 23)</strong> — Anthropic + local Qwen3-8B providers. Set{" "}
            <code className="rounded bg-muted px-1 text-xs">ANTHROPIC_API_KEY</code> or{" "}
            <code className="rounded bg-muted px-1 text-xs">VIBE_LLM_LOCAL_URL</code> in
            <code className="rounded bg-muted px-1 text-xs">.env</code>. Configure prompts under{" "}
            <strong>Admin → AI prompts</strong>.
          </li>
          <li>
            <strong>Encrypted backups</strong> — set{" "}
            <code className="rounded bg-muted px-1 text-xs">VIBE_BACKUP_PASSPHRASE</code> in
            <code className="rounded bg-muted px-1 text-xs">.env</code>, then run{" "}
            <code className="rounded bg-muted px-1 text-xs">vibecalc-installer backup</code> on a
            daily cron. The restore wizard at <strong>Admin → Backups</strong> walks you through
            recovery.
          </li>
          <li>
            <strong>Deploy mode</strong> — by default the appliance binds to <code>:80</code> (LAN).
            For domain mode set{" "}
            <code className="rounded bg-muted px-1 text-xs">VIBE_DEPLOY_MODE=domain</code> +{" "}
            <code className="rounded bg-muted px-1 text-xs">VIBE_DOMAIN</code> +{" "}
            <code className="rounded bg-muted px-1 text-xs">VIBE_TLS_EMAIL</code>; for Tailscale,{" "}
            <code className="rounded bg-muted px-1 text-xs">VIBE_DEPLOY_MODE=tailscale</code>.
          </li>
        </ul>
        <Button className="mt-6" onClick={onFinish}>
          Open the workspace
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
