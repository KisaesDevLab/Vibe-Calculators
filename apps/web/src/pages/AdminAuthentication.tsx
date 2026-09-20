import { KeyRound } from "lucide-react";
import { AuthSettingsPage } from "@kisaesdevlab/vibe-auth/react";
import { BASE_PATH } from "@/lib/base-path";

/**
 * Settings → Authentication. The form and its rules (mode guards,
 * test-connection popup, role map, MFA acknowledgement) come from
 * @kisaesdevlab/vibe-auth and talk to `/auth/settings` on the API,
 * which authorises by `settings:write`; this page supplies the chrome
 * and the design-system class names. The session cookie is same-origin,
 * so the component's default fetch needs no extra headers.
 */

const INPUT =
  "block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";
const BUTTON =
  "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium shadow-sm transition-colors disabled:opacity-50";

export function AdminAuthenticationPage(): JSX.Element {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <KeyRound className="h-6 w-6" /> Authentication
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Single sign-on through the firm&apos;s identity provider. Local sign-in, magic links and
          API keys keep working unless the mode is set to single sign-on only; the emergency account
          signs in at <code className="rounded bg-muted px-1">{`${BASE_PATH}/login/local`}</code>.
        </p>
      </header>
      <AuthSettingsPage
        basePath={BASE_PATH}
        productName="Vibe Calculators"
        classNames={{
          root: "grid max-w-3xl gap-6",
          section: "grid gap-3 rounded-lg border border-border bg-card p-5 text-card-foreground",
          label: "grid gap-1 text-sm font-medium",
          input: INPUT,
          button: `${BUTTON} border border-input bg-background hover:bg-accent`,
          buttonPrimary: `${BUTTON} bg-primary text-primary-foreground`,
          buttonDanger: `${BUTTON} bg-destructive text-destructive-foreground`,
          table: "w-full border-collapse text-sm",
          note: "text-xs text-muted-foreground",
          error: "text-sm text-destructive",
        }}
      />
    </main>
  );
}
