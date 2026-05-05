# License Audit — Vibe Calculators

**Date:** 2026-05-04
**Scope:** All workspace dependencies (production + dev) resolved by `pnpm install`.
**Method:** `pnpm licenses list --json` against the locked dep graph; manual triage of every non-MIT/non-ISC entry.
**Distribution model:** self-hosted Docker appliance, deployed inside a single CPA firm. **Not** redistributed publicly, **not** SaaS-hosted to third parties, **not** sold under a commercial license. This shapes the analysis throughout — copyleft obligations that would bite an SaaS or commercial vendor are largely inert here.

---

## Verdict

**No blocking findings.** The dependency graph is overwhelmingly permissive (≈99.5% MIT/ISC/Apache-2.0/BSD). Three items warrant a note in the report; none require action before deploy:

| Severity | Item                                                      | Why it's noted                                                                                                               |
| -------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Low      | `buffers@0.1.1` declares no `license` field               | Transitive (5 hops deep) under `exceljs`. Substack-era package; effectively unmaintained. Mitigation below.                  |
| Info     | `jszip@3.10.1` is dual-licensed `MIT OR GPL-3.0-or-later` | Dual-license: we elect MIT. No copyleft obligation.                                                                          |
| Info     | Workspace `package.json` files don't declare a `license`  | All marked `private: true`, so npm/pnpm don't enforce it. Cosmetic gap; recommend setting `"license": "UNLICENSED"` on each. |

The codebase contains **zero** GPL/AGPL/LGPL/MPL/EPL packages, **zero** "no commercial use" licenses, **zero** Creative Commons in production, and **zero** runtime dependencies on Chromium or other heavyweight redistributables that would carry their own license tail.

---

## Inventory

### Production-only (391 packages)

| Count | License                      | OSI | Permissive | Copyleft |
| ----: | ---------------------------- | :-: | :--------: | :------: |
|   328 | MIT                          | ✔  |     ✔     |    —     |
|    40 | ISC                          | ✔  |     ✔     |    —     |
|     8 | Apache-2.0                   | ✔  |     ✔     |    —     |
|     5 | BSD-3-Clause                 | ✔  |     ✔     |    —     |
|     2 | MIT/X11                      | ✔  |     ✔     |    —     |
|     1 | Unlicense (public domain)    | ✔  |     ✔     |    —     |
|     1 | MIT-0                        | ✔  |     ✔     |    —     |
|     1 | (MIT AND Zlib)               | ✔  |     ✔     |    —     |
|     1 | MIT AND ISC                  | ✔  |     ✔     |    —     |
|     1 | (MIT OR GPL-3.0-or-later)    | ✔  |    ✔\*    |    —     |
|     1 | BlueOak-1.0.0                | ✔  |     ✔     |    —     |
|     1 | 0BSD                         | ✔  |     ✔     |    —     |
|     1 | Unknown (no `license` field) |  —  |     —      |    —     |

\* dual-licensed; MIT is the elected branch — see jszip note below.

### Production + dev combined (883 packages)

Adds, beyond prod: 33 more Apache-2.0 (mostly `@eslint/*`, `@humanfs/*`, `@balena/dockerignore`, `typescript`, `bare-*` runtime), 8 BSD-2-Clause, 1 Python-2.0 (`argparse@2.0.1` — permissive), 1 CC-BY-4.0 (`caniuse-lite` — see below), and a handful of additional BlueOak-1.0.0 / Unlicense / 0BSD / MIT-0 entries. **No new license families.**

---

## Notes on each non-MIT/non-ISC license family

### Apache-2.0 (8 prod / 41 total)

OSI-approved, permissive. Requires preserving the LICENSE and NOTICE files when redistributing. Notable: `drizzle-orm`, `@electric-sql/pglite`, `class-variance-authority`, `crc-32`, `typescript` (dev), every `@eslint/*` plugin (dev). Apache-2.0 includes an explicit patent grant — net positive for us.

**Action:** none required for internal deployment. If we ever ship binaries publicly, bundle a NOTICE aggregating these.

### BSD-2-Clause / BSD-3-Clause (8 / 11)

OSI-approved, permissive. Requires keeping the copyright notice. Examples: `d3-ease`, `ieee754`, `qs`, `react-transition-group`, `bcrypt-pbkdf` (dev only), `tough-cookie` (dev only), `source-map` (dev only).

**Action:** none required.

### BlueOak-1.0.0 (1 prod / 5 total)

Modern permissive license written by the OSS Working Group, OSI-approved (2023). Functionally equivalent to MIT for our purposes. `sax@1.6.0` (prod, transitive of `exceljs` → `xlsx` chain), plus `jackspeak`, `minipass`, `package-json-from-dist`, `path-scurry` in dev.

**Action:** none required.

### 0BSD / MIT-0 / Unlicense (3 prod / 6 total)

All public-domain-equivalent: zero-clause BSD (`tslib` from Microsoft), MIT-without-attribution (`nodemailer`, `@csstools/color-helpers`), and the Unlicense (`big-integer`, `tweetnacl`). Most permissive licenses possible — explicitly waive attribution.

**Action:** none required.

### Python-2.0 (dev only, 1 package)

`argparse@2.0.1`. Permissive (PSF License, inherited from the Python stdlib `argparse` port). Compatible with everything else here.

**Action:** none required.

### CC-BY-4.0 (dev only, 1 package)

`caniuse-lite@1.0.30001791`. This is a **data** license (not a software license) on the browser-feature dataset shipped with the package. CC-BY requires attribution. The package is consumed at build time by Browserslist / Vite to compute target browser sets; the data is never redistributed in our shipped artifact.

**Action:** none required for self-hosted deployment. If we ever publish the bundled web app to a public CDN, include a one-line credit in `apps/web/README.md`.

### MIT/X11 (2 prod)

Synonym for MIT (`chainsaw@0.1.0`, `traverse@0.3.9` — both substack-era transitives of `exceljs` → `unzipper` → `binary`).

**Action:** none required.

### Dual: (MIT OR GPL-3.0-or-later) — `jszip@3.10.1`

Dual-licensed at the user's option (a common pattern for projects that want broad compatibility while letting the author dual-publish). Per OSI dual-license convention, downstream users elect **one** branch and need only honor that branch's terms. **We elect MIT.** No GPL obligation flows.

`jszip` is a transitive of `exceljs` (used in `packages/pdf` for `.xlsx` export). We do not modify it; we ship its compiled artifact unchanged.

**Action:** none required. Document the MIT election in the third-party notices file.

### Compound: (MIT AND Zlib) — `pako@1.0.11`

Both MIT and Zlib are permissive. Zlib license (yes, the actual one) requires that altered versions be marked as such and that the source not be misrepresented as the original — neither of which we do. Used as a transitive zlib implementation in JS; bundled with several compression packages.

**Action:** none required.

### Compound: (MIT AND ISC) — `victory-vendor@36.9.2`

Both permissive. Vendored d3 sub-packages from the Victory chart library, pulled in as a transitive of `recharts`.

**Action:** none required.

### Unknown: `buffers@0.1.1` ⚠ low-severity finding

The `package.json` for `buffers@0.1.1` (a substack package from ~2010) does not include a `license` field. The GitHub repo `substack/node-buffers` does not include a LICENSE file either. The README is also silent. By a strict reading this means the package is "all rights reserved" — but the author (James Halliday / substack) has historically released hundreds of packages under MIT/X11 and the file headers in adjacent substack packages from the same era are MIT-licensed. Industry tooling (e.g. `license-checker`, FOSSA, GitHub's dependency graph) flags this as a low-risk known-pattern: declared-no-license, intent-permissive.

**Reach:** transitive at depth 5: `@vibe-calc/pdf` → `exceljs@4.4.0` → `unzipper@0.10.14` → `binary@0.3.0` → `buffers@0.1.1`. Used only when reading `.xlsx` files (which our PDF package does for export round-trips). Could be replaced by upgrading or substituting `exceljs` for an alternative; not urgent.

**Risk profile for our use:**

- We ship only as a self-hosted appliance to a single firm. We are not public-redistributing.
- The package is 8 KB of buffer-concatenation glue; no encryption, network, or data handling.
- 15 years of unchallenged downstream use across thousands of npm packages.

**Recommendation:** accept the risk. Document it in the third-party notices file. If `exceljs` ever gets replaced for unrelated reasons (perf, maintenance), this finding goes away naturally.

### Workspace own-package licenses

All ten workspace `package.json` files (`vibe-calculators`, `apps/{api,web}`, `packages/{calc-engine,db,email,llm,pdf,shared-types,tax-engine}`) are marked `private: true`. The root sets `"license": "UNLICENSED"`; the nine workspace packages omit the field entirely. This is benign — `private: true` blocks accidental publish, and pnpm doesn't infer or warn — but if we want the repo to read consistently for future code reviewers, set `"license": "UNLICENSED"` on each subpackage.

**Recommendation:** low-priority cleanup. Add `"license": "UNLICENSED"` to nine `package.json` files. Not blocking.

---

## Risky-category packages — confirmed compliant

These are categories that often introduce license tails (Chromium, fonts, AGPL clones, "no commercial use" databases). Each was checked and is clean for our distribution:

| Category      | Choice                                                                            | License                  | Notes                                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM access    | Bare `fetch` to `api.anthropic.com/v1/messages` (`packages/llm/src/anthropic.ts`) | n/a — no SDK dep         | Avoids the question entirely. We're an HTTP client; Anthropic's terms govern the _service_, not our _code_.                                                          |
| PDF rendering | `@react-pdf/renderer@4.1.5`                                                       | MIT                      | No Chromium / Puppeteer / Playwright. The full PDFKit fork (`@react-pdf/pdfkit`) is also MIT.                                                                        |
| Excel export  | `exceljs@4.4.0`                                                                   | MIT                      | Pulls in the `buffers` finding above.                                                                                                                                |
| Word export   | `docx@9.0.3`                                                                      | MIT                      |                                                                                                                                                                      |
| Database      | Postgres (server) + `pg@8.13.1` driver                                            | PostgreSQL license + MIT | PostgreSQL license is permissive (BSD-style).                                                                                                                        |
| Cache/queue   | `ioredis@5.4.1`                                                                   | MIT                      | Redis itself is OSS (BSD or RSAL/SSPL depending on version) — irrelevant for our docker image which uses upstream `redis:7-alpine` (BSD-3-Clause through Redis 7.2). |
| ORM           | `drizzle-orm@0.36.4`                                                              | Apache-2.0               | Patent grant included.                                                                                                                                               |
| Decimal math  | `decimal.js@10.4.3`                                                               | MIT                      | Sole money/rate primitive.                                                                                                                                           |
| TOTP          | `otpauth@9.3.6`, `qrcode@1.5.4`, `@node-rs/argon2@2.0.2`                          | MIT / MIT / MIT          |                                                                                                                                                                      |
| Charts        | `recharts@2.15.0`, `victory-vendor@36.9.2`                                        | MIT / "MIT AND ISC"      |                                                                                                                                                                      |
| Fonts         | None bundled in the app — `@react-pdf/font` loads system fonts only at runtime    | MIT (the loader)         | If we ever embed a custom font (e.g. for branded PDFs), we'll need to verify _that_ font's license separately. Currently N/A.                                        |

---

## Recommendations

1. **Accept and document** the `buffers@0.1.1` "Unknown" finding. Add a one-line note in `THIRD_PARTY_NOTICES.md` (see #3) acknowledging the missing-license-field state and our basis for treating it as MIT-by-context.
2. **Elect MIT for `jszip`** in writing. One sentence in `THIRD_PARTY_NOTICES.md`: _"We elect to use jszip under the MIT branch of its dual MIT-or-GPL-3.0-or-later license."_
3. **Generate `THIRD_PARTY_NOTICES.md`** at release time. The Apache-2.0, BSD, and MIT families all require attribution in redistributed binaries; for an internal appliance the practical answer is a single aggregated NOTICE file in the repo root, regenerated via `pnpm licenses list --prod --long > THIRD_PARTY_NOTICES.md` and committed alongside each release tag. (Not required for the current internal deployment, but cheap to add and useful if scope ever expands.)
4. **Add `"license": "UNLICENSED"` to the nine workspace subpackage `package.json` files.** Cosmetic; ensures intent is explicit if these files are ever read in isolation.
5. **No code changes required.** No swap-outs, no removals, no upgrades blocked by licensing.

---

## Methodology

- Resolved deps via `pnpm install` against locked `pnpm-lock.yaml`.
- Inventory captured via `pnpm licenses list --json` (prod) and `pnpm licenses list --json` (prod + dev).
- Every license category with fewer than 100 packages was opened and the listed packages individually classified.
- The single "Unknown" finding was traced via `pnpm why -r buffers` to its full transitive path.
- Risky-category check: cross-referenced known-tricky packages (Chromium-based PDF, font embedding, AGPL databases) against the actual dependency graph — none present.
- Workspace-own-license check: enumerated `package.json` for the ten workspace projects and read each `license` field directly.

Raw inventory archived at `C:/Users/kwkcp/AppData/Local/Temp/lic-all.json` and `lic-flat.csv` (883 rows).

---

## Sign-off

Audit complete. Verdict: **clear to deploy.** No blocking issues; the three notes above are documentation/cosmetic items that can ride alongside any future release without being release-blockers.
