#!/usr/bin/env node
/**
 * Regenerate THIRD_PARTY_NOTICES.md from the locked dep graph.
 *
 * Usage:
 *   pnpm licenses list --prod --json > /tmp/lic-prod.json
 *   node scripts/regen-notices.mjs /tmp/lic-prod.json > THIRD_PARTY_NOTICES.md
 *
 * Or in one step:
 *   pnpm licenses list --prod --json | node scripts/regen-notices.mjs > THIRD_PARTY_NOTICES.md
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const inputFile = process.argv[2];
const raw = inputFile ? readFileSync(inputFile, "utf8") : await readStdin();
const prod = JSON.parse(raw);

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const LICENSE_FILENAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENSE-MIT",
  "LICENSE-MIT.txt",
  "LICENCE",
  "LICENCE.md",
  "license",
  "license.md",
  "license.txt",
];

function findLicenseText(dirs) {
  for (const dir of dirs) {
    for (const fn of LICENSE_FILENAMES) {
      const f = join(dir, fn);
      if (existsSync(f)) {
        try {
          return readFileSync(f, "utf8").trim();
        } catch {
          // fall through
        }
      }
    }
  }
  return "";
}

const rows = [];
for (const [lic, pkgs] of Object.entries(prod)) {
  for (const p of pkgs) {
    rows.push({
      name: p.name,
      version: p.versions.join(", "),
      license: lic,
      author: p.author || "",
      homepage: p.homepage || "",
      text: findLicenseText(p.paths || []),
    });
  }
}
rows.sort((a, b) => a.name.localeCompare(b.name));

const summary = Object.entries(prod)
  .map(([k, v]) => `- ${v.length} × ${k}`)
  .sort()
  .join("\n");

const today = new Date().toISOString().slice(0, 10);

let out = "";
out += "# Third-Party Notices\n\n";
out +=
  "_Vibe Calculators bundles the open-source software listed below. Each entry preserves the original copyright and license notice as required by that license. This file covers **production** dependencies only; development-only packages are inventoried in `LICENSE_AUDIT.md`._\n\n";
out += `_Last regenerated: ${today}. Regenerate via \`node scripts/regen-notices.mjs\` (see header)._\n\n`;
out += "## License elections + notes\n\n";
out +=
  "- **jszip 3.10.1** is dual-licensed `MIT OR GPL-3.0-or-later`. We elect to use it under the MIT branch. No GPL obligation flows to downstream consumers.\n";
out +=
  "- **buffers 0.1.1** does not declare a `license` field in its `package.json` and ships no LICENSE file. It reaches us as a depth-5 transitive of `exceljs` (`exceljs → unzipper → binary → buffers`). We treat it as MIT-by-author-pattern given the substack/node-buffers ecosystem convention. If a definitive grant is required for any future public redistribution, this transitive must be replaced (e.g. by upgrading `exceljs` to a version that doesn't pull in the legacy `unzipper` chain).\n\n";
out += "## License summary\n\n";
out += summary + "\n\n";
out += "---\n\n";
out += "## Per-package notices\n\n";

for (const r of rows) {
  out += `### ${r.name}@${r.version}\n\n`;
  out += `- License: **${r.license}**\n`;
  if (r.author) out += `- Author: ${r.author}\n`;
  if (r.homepage) out += `- Homepage: ${r.homepage}\n`;
  out += "\n";
  if (!r.text) {
    out += `_(No LICENSE file shipped in the package; license recorded as ${r.license} per the package metadata.)_\n\n`;
    continue;
  }
  const safe = r.text.replace(/```/g, "   ");
  out += "<details><summary>License text</summary>\n\n```\n" + safe + "\n```\n\n</details>\n\n";
}

process.stdout.write(out);
