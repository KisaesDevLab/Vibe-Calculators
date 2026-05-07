import { useState, useEffect, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, FlaskConical, Loader2, Mail, Save, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Email provider configuration UI. Mirrors AdminAi.tsx — DB-backed
 * config that takes precedence over .env. Three blocks (one per
 * provider) plus a test-send panel.
 */

type Provider = "smtp" | "postmark" | "emailit";

interface EmailSettings {
  activeProvider: Provider | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassPrefix: string | null;
  smtpSecure: boolean;
  smtpFrom: string | null;
  postmarkTokenPrefix: string | null;
  postmarkFrom: string | null;
  postmarkStream: string | null;
  emailitKeyPrefix: string | null;
  emailitFrom: string | null;
  emailitEndpoint: string | null;
  updatedAt: string;
}

interface EmailSettingsResponse {
  settings: EmailSettings;
  envFallback: {
    provider: string | null;
    smtpHostSet: boolean;
    smtpPassSet: boolean;
    postmarkTokenSet: boolean;
    emailitKeySet: boolean;
  };
}

async function fetchSettings(): Promise<EmailSettingsResponse> {
  const r = await fetch("/api/v1/admin/email/settings", { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as EmailSettingsResponse;
}

async function putSettings(body: Record<string, unknown>): Promise<void> {
  const r = await fetch("/api/v1/admin/email/settings", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { detail?: string };
    throw new Error(j.detail ?? `HTTP ${r.status}`);
  }
}

interface TestResult {
  ok: boolean;
  provider: string;
  source: "db" | "env";
  messageId: string;
  elapsedMs: number;
}

async function sendTest(input: {
  to: string;
  subject?: string;
  body?: string;
}): Promise<TestResult> {
  const r = await fetch("/api/v1/admin/email/test", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { detail?: string };
    throw new Error(j.detail ?? `HTTP ${r.status}`);
  }
  return (await r.json()) as TestResult;
}

export function AdminEmailPage(): JSX.Element {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["admin", "email", "settings"],
    queryFn: fetchSettings,
  });

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Mail className="h-6 w-6" /> Email provider
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure outbound email delivery. Magic-link sign-in, password reset, scheduled recompute
          notifications, and email-this-PDF all use the configured provider. Settings here override
          the matching <code>.env</code> block.
        </p>
      </header>

      {settingsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : settingsQuery.data ? (
        <SettingsForm
          data={settingsQuery.data}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ["admin", "email", "settings"] });
          }}
        />
      ) : (
        <p className="text-sm text-destructive">Failed to load settings.</p>
      )}

      <TestPanel />
    </main>
  );
}

function SettingsForm({
  data,
  onSaved,
}: {
  data: EmailSettingsResponse;
  onSaved: () => void;
}): JSX.Element {
  const s = data.settings;
  const [activeProvider, setActiveProvider] = useState<Provider | "none">(
    s.activeProvider ?? "none",
  );
  // SMTP fields
  const [smtpHost, setSmtpHost] = useState(s.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState<string>(s.smtpPort != null ? String(s.smtpPort) : "587");
  const [smtpUser, setSmtpUser] = useState(s.smtpUser ?? "");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(s.smtpSecure);
  const [smtpFrom, setSmtpFrom] = useState(s.smtpFrom ?? "");
  // Postmark
  const [postmarkToken, setPostmarkToken] = useState("");
  const [postmarkFrom, setPostmarkFrom] = useState(s.postmarkFrom ?? "");
  const [postmarkStream, setPostmarkStream] = useState(s.postmarkStream ?? "outbound");
  // EmailIt
  const [emailitKey, setEmailitKey] = useState("");
  const [emailitFrom, setEmailitFrom] = useState(s.emailitFrom ?? "");
  const [emailitEndpoint, setEmailitEndpoint] = useState(s.emailitEndpoint ?? "");

  // Re-sync local state when data refreshes (e.g. after save).
  useEffect(() => {
    setActiveProvider(s.activeProvider ?? "none");
    setSmtpHost(s.smtpHost ?? "");
    setSmtpPort(s.smtpPort != null ? String(s.smtpPort) : "587");
    setSmtpUser(s.smtpUser ?? "");
    setSmtpSecure(s.smtpSecure);
    setSmtpFrom(s.smtpFrom ?? "");
    setPostmarkFrom(s.postmarkFrom ?? "");
    setPostmarkStream(s.postmarkStream ?? "outbound");
    setEmailitFrom(s.emailitFrom ?? "");
    setEmailitEndpoint(s.emailitEndpoint ?? "");
  }, [s]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        activeProvider: activeProvider === "none" ? null : activeProvider,
      };
      // Only include the section that's actually being edited so a
      // user toggling provider doesn't wipe the other blocks.
      if (activeProvider === "smtp" || s.activeProvider === "smtp") {
        body.smtpHost = smtpHost.trim() || null;
        body.smtpPort = smtpPort ? Number(smtpPort) : null;
        body.smtpUser = smtpUser.trim() || null;
        body.smtpSecure = smtpSecure;
        body.smtpFrom = smtpFrom.trim() || null;
        if (smtpPass.length > 0) body.smtpPass = smtpPass;
      }
      if (activeProvider === "postmark" || s.activeProvider === "postmark") {
        body.postmarkFrom = postmarkFrom.trim() || null;
        body.postmarkStream = postmarkStream.trim() || null;
        if (postmarkToken.length > 0) body.postmarkToken = postmarkToken;
      }
      if (activeProvider === "emailit" || s.activeProvider === "emailit") {
        body.emailitFrom = emailitFrom.trim() || null;
        body.emailitEndpoint = emailitEndpoint.trim() || null;
        if (emailitKey.length > 0) body.emailitKey = emailitKey;
      }
      await putSettings(body);
    },
    onSuccess: () => {
      toast.success("Email settings saved");
      setSmtpPass("");
      setPostmarkToken("");
      setEmailitKey("");
      onSaved();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Save failed");
    },
  });

  const clearSecret = useMutation({
    mutationFn: async (which: "smtpPass" | "postmarkToken" | "emailitKey") => {
      const body: Record<string, unknown> = {
        activeProvider: activeProvider === "none" ? null : activeProvider,
      };
      if (which === "smtpPass") body.clearSmtpPass = true;
      if (which === "postmarkToken") body.clearPostmarkToken = true;
      if (which === "emailitKey") body.clearEmailitKey = true;
      await putSettings(body);
    },
    onSuccess: () => {
      toast.success("Secret cleared");
      onSaved();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Clear failed");
    },
  });

  function submit(e: FormEvent): void {
    e.preventDefault();
    saveMutation.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider settings</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Last updated {new Date(s.updatedAt).toLocaleString()}.{" "}
          {data.envFallback.provider ? (
            <>
              <code className="rounded bg-muted px-1">.env</code> fallback:{" "}
              <code>{data.envFallback.provider}</code>
              {data.envFallback.smtpPassSet ||
              data.envFallback.postmarkTokenSet ||
              data.envFallback.emailitKeySet
                ? " (secret set)"
                : " (no secret set)"}
              .
            </>
          ) : (
            "No .env fallback configured."
          )}
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <Field label="Active provider">
            <select
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
              value={activeProvider}
              onChange={(e) => setActiveProvider(e.target.value as Provider | "none")}
            >
              <option value="none">None — fall back to .env (or log-only)</option>
              <option value="smtp">SMTP (Postmark/SendGrid/Mailgun/SES via SMTP)</option>
              <option value="postmark">Postmark (native API)</option>
              <option value="emailit">EmailIt</option>
            </select>
          </Field>

          {activeProvider === "smtp" && (
            <fieldset className="space-y-3 rounded-md border border-border p-4">
              <legend className="px-1 text-xs font-medium uppercase text-muted-foreground">
                SMTP
              </legend>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Host" className="col-span-2">
                  <Input
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.postmarkapp.com"
                    required
                  />
                </Field>
                <Field label="Port">
                  <Input
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    required
                  />
                </Field>
              </div>
              <Field label="Username">
                <Input
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  required
                  autoComplete="off"
                />
              </Field>
              <Field
                label={s.smtpPassPrefix ? `Password (current: ${s.smtpPassPrefix})` : "Password"}
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    placeholder={s.smtpPassPrefix ? "Leave blank to keep current" : ""}
                    autoComplete="new-password"
                  />
                  {s.smtpPassPrefix && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => clearSecret.mutate("smtpPass")}
                      disabled={clearSecret.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="From address">
                <Input
                  type="email"
                  value={smtpFrom}
                  onChange={(e) => setSmtpFrom(e.target.value)}
                  placeholder="noreply@firm.test"
                  required
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={smtpSecure}
                  onChange={(e) => setSmtpSecure(e.target.checked)}
                />
                Use TLS (port 465 / implicit TLS). Leave off for STARTTLS on 587.
              </label>
            </fieldset>
          )}

          {activeProvider === "postmark" && (
            <fieldset className="space-y-3 rounded-md border border-border p-4">
              <legend className="px-1 text-xs font-medium uppercase text-muted-foreground">
                Postmark
              </legend>
              <Field
                label={
                  s.postmarkTokenPrefix
                    ? `Server token (current: ${s.postmarkTokenPrefix})`
                    : "Server token"
                }
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    value={postmarkToken}
                    onChange={(e) => setPostmarkToken(e.target.value)}
                    placeholder={s.postmarkTokenPrefix ? "Leave blank to keep current" : ""}
                    autoComplete="off"
                  />
                  {s.postmarkTokenPrefix && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => clearSecret.mutate("postmarkToken")}
                      disabled={clearSecret.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="From address">
                <Input
                  type="email"
                  value={postmarkFrom}
                  onChange={(e) => setPostmarkFrom(e.target.value)}
                  placeholder="noreply@firm.test"
                  required
                />
              </Field>
              <Field label="Message stream (optional)">
                <Input
                  value={postmarkStream}
                  onChange={(e) => setPostmarkStream(e.target.value)}
                  placeholder="outbound"
                />
              </Field>
            </fieldset>
          )}

          {activeProvider === "emailit" && (
            <fieldset className="space-y-3 rounded-md border border-border p-4">
              <legend className="px-1 text-xs font-medium uppercase text-muted-foreground">
                EmailIt
              </legend>
              <Field
                label={s.emailitKeyPrefix ? `API key (current: ${s.emailitKeyPrefix})` : "API key"}
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    value={emailitKey}
                    onChange={(e) => setEmailitKey(e.target.value)}
                    placeholder={s.emailitKeyPrefix ? "Leave blank to keep current" : ""}
                    autoComplete="off"
                  />
                  {s.emailitKeyPrefix && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => clearSecret.mutate("emailitKey")}
                      disabled={clearSecret.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </Field>
              <Field label="From address">
                <Input
                  type="email"
                  value={emailitFrom}
                  onChange={(e) => setEmailitFrom(e.target.value)}
                  placeholder="noreply@firm.test"
                  required
                />
              </Field>
              <Field label="Endpoint (optional override)">
                <Input
                  value={emailitEndpoint}
                  onChange={(e) => setEmailitEndpoint(e.target.value)}
                  placeholder="https://api.emailit.com/v1/send"
                />
              </Field>
            </fieldset>
          )}

          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Save className="mr-1.5 h-4 w-4" /> Save
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TestPanel(): JSX.Element {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("Vibe Calculators — test email");
  const [body, setBody] = useState(
    "This is a test email from Vibe Calculators. If you can read it, delivery works.",
  );
  const [result, setResult] = useState<TestResult | null>(null);

  const testMutation = useMutation({
    mutationFn: () => sendTest({ to, subject, body }),
    onSuccess: (r) => {
      setResult(r);
      toast.success(`Test sent via ${r.provider} (${r.source})`);
    },
    onError: (err) => {
      setResult(null);
      toast.error(err instanceof Error ? err.message : "Send failed");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5" /> Send a test email
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Resolves the current provider (DB, then .env) and sends a probe message. Use this after
          saving credentials to confirm delivery before relying on it for sign-in.
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            testMutation.mutate();
          }}
        >
          <Field label="Recipient">
            <Input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="you@firm.test"
              required
            />
          </Field>
          <Field label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Body">
            <textarea
              className="block min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={testMutation.isPending || !to}>
            {testMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <FlaskConical className="mr-1.5 h-4 w-4" /> Send test
              </>
            )}
          </Button>
          {result && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4" />
              <div>
                Sent via <strong>{result.provider}</strong> ({result.source}) in {result.elapsedMs}
                ms. Message ID: <code>{result.messageId}</code>
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className={"block " + (className ?? "")}>
      <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
