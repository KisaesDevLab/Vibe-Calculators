import { eq } from "drizzle-orm";
import { firmSettings, FIRM_SETTINGS_ID, type Database, type FirmSettingsRow } from "@vibe-calc/db";

/**
 * Phase 13.3 — read the firm-settings singleton for branding the PDF /
 * XLSX / DOCX exports. Cached for the request lifetime so the same
 * row isn't fetched twice for back-to-back exports.
 *
 * Returns null when the singleton row is somehow missing (the
 * 0013 migration seeds it; this guard is defense-in-depth).
 */
export async function loadFirmSettings(db: Database): Promise<FirmSettingsRow | null> {
  const [row] = await db
    .select()
    .from(firmSettings)
    .where(eq(firmSettings.id, FIRM_SETTINGS_ID))
    .limit(1);
  return row ?? null;
}

/** Compose the canonical PDF footer line from the firm row + any operator override. */
export function composeBrandedFooter(
  firm: FirmSettingsRow | null,
  override: string | undefined,
): string | undefined {
  if (override) return override;
  if (!firm) return undefined;
  const parts: string[] = [];
  if (firm.firmName) parts.push(firm.firmName);
  if (firm.firmPhone) parts.push(firm.firmPhone);
  if (firm.pdfFooter) parts.push(firm.pdfFooter);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
