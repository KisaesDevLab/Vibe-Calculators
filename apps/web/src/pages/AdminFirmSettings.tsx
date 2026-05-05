import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Save, Image as ImageIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Phase 25.4 / 13.3 — firm-wide settings admin form.
 *
 * Edits the singleton firm_settings row. Logo is captured as a
 * base64 data URL via FileReader (≤1 MB enforced both client-side
 * here and server-side in the route's Zod refine).
 */

interface FirmSettingsRow {
  id: string;
  firmName: string;
  firmEin: string | null;
  firmAddress: string | null;
  firmPhone: string | null;
  pdfFooter: string | null;
  brandColor: string | null;
  logoDataUrl: string | null;
  timezone: string;
  updatedAt: string;
  updatedBy: string | null;
}

const MAX_LOGO_BYTES = 1_048_576;

async function call<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    let detail: string;
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
    } catch {
      detail = text || res.statusText;
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export function AdminFirmSettingsPage(): JSX.Element {
  const query = useQuery({
    queryKey: ["admin", "firm-settings"],
    queryFn: () => call<{ firmSettings: FirmSettingsRow }>("/api/v1/admin/firm-settings"),
  });

  const [draft, setDraft] = useState<Partial<FirmSettingsRow>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (query.data) setDraft(query.data.firmSettings);
  }, [query.data]);

  function set<K extends keyof FirmSettingsRow>(key: K, value: FirmSettingsRow[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_LOGO_BYTES) {
      toast.error(`Logo must be ≤ 1 MB (got ${(f.size / 1024).toFixed(0)} KB).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        set("logoDataUrl", reader.result);
        toast.success("Logo loaded — click Save to apply.");
      }
    };
    reader.readAsDataURL(f);
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      // Send only fields the operator may have edited. Drop id/updatedAt/updatedBy.
      const { id, updatedAt, updatedBy, ...rest } = draft;
      void id;
      void updatedAt;
      void updatedBy;
      const r = await call<{ firmSettings: FirmSettingsRow }>("/api/v1/admin/firm-settings", {
        method: "PUT",
        body: JSON.stringify(rest),
      });
      setDraft(r.firmSettings);
      toast.success("Saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (query.isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10 text-sm text-muted-foreground">Loading…</main>
    );
  }
  if (query.isError) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm text-destructive">{String((query.error as Error).message)}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Building2 className="h-5 w-5 text-primary" /> Firm settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Surfaced in PDF/DOCX export headers and footers, and as the firm's display name across the
          appliance. Single shared row — every admin edits the same record.
        </p>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Firm name">
            <Input value={draft.firmName ?? ""} onChange={(e) => set("firmName", e.target.value)} />
          </Field>
          <Field label="EIN">
            <Input
              value={draft.firmEin ?? ""}
              onChange={(e) => set("firmEin", e.target.value)}
              placeholder="00-0000000"
            />
          </Field>
          <Field label="Address">
            <Input
              value={draft.firmAddress ?? ""}
              onChange={(e) => set("firmAddress", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={draft.firmPhone ?? ""}
              onChange={(e) => set("firmPhone", e.target.value)}
            />
          </Field>
          <Field label="Time zone (IANA)">
            <Input
              value={draft.timezone ?? "America/Chicago"}
              onChange={(e) => set("timezone", e.target.value)}
              placeholder="America/Chicago"
            />
          </Field>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Brand</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Brand color (hex)">
            <Input
              value={draft.brandColor ?? ""}
              onChange={(e) => set("brandColor", e.target.value)}
              placeholder="#2563eb"
              pattern="#[0-9a-fA-F]{6}"
            />
          </Field>
          <Field label="PDF footer disclaimer (≤500 chars)">
            <Input
              value={draft.pdfFooter ?? ""}
              onChange={(e) => set("pdfFooter", e.target.value)}
              placeholder="For internal advisory use only — not a tax opinion."
            />
          </Field>
          <div className="md:col-span-2">
            <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Logo (≤ 1 MB)
            </span>
            <div className="flex items-center gap-3">
              {draft.logoDataUrl ? (
                <img
                  src={draft.logoDataUrl}
                  alt="Firm logo"
                  className="h-12 max-w-[200px] rounded border border-input object-contain"
                />
              ) : (
                <span className="inline-flex h-12 w-12 items-center justify-center rounded border border-dashed border-input">
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </span>
              )}
              <input type="file" accept="image/*" onChange={onLogoFile} />
              {draft.logoDataUrl && (
                <Button variant="ghost" size="sm" onClick={() => set("logoDataUrl", null)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Last updated{" "}
          {draft.updatedAt
            ? new Date(draft.updatedAt).toISOString().slice(0, 19).replace("T", " ")
            : "—"}
          {draft.updatedBy ? ` by ${draft.updatedBy.slice(0, 8)}…` : ""}
        </p>
        <Button onClick={() => void save()} disabled={saving}>
          <Save className="mr-1 h-4 w-4" />
          {saving ? "Saving…" : "Save firm settings"}
        </Button>
      </div>
    </main>
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
