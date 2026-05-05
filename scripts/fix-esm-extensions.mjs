#!/usr/bin/env node
/**
 * Post-build fixer for native ESM in dist/ output.
 *
 * tsconfig.base.json uses `moduleResolution: Bundler`, which permits
 * extensionless relative imports during typecheck. TypeScript emits
 * those imports verbatim — `import { x } from "./foo"` — and native
 * Node ESM (which runs the distroless production image) refuses to
 * resolve them: ERR_MODULE_NOT_FOUND.
 *
 * Vitest and tsx use esbuild-based loose resolvers, so unit tests and
 * `tsx watch` masked the breakage until we tried to run the actual
 * compiled artifact in Docker.
 *
 * This script walks every workspace dist/ and rewrites:
 *   import ... from "./foo"        →  import ... from "./foo.js"
 *   export ... from "../bar"       →  export ... from "../bar.js"
 *   import("./baz")                →  import("./baz.js")
 *
 * Skips:
 *   - bare specifiers (no leading "./" or "../")
 *   - already-extensioned imports ("./foo.js", "./foo.json", ...)
 *   - directory imports — rewritten to "/index.js" if the directory
 *     resolves and contains index.js
 *
 * Idempotent: re-running on already-fixed dist/ is a no-op.
 *
 * Usage:
 *   node scripts/fix-esm-extensions.mjs
 *
 * Optional: pass one or more dist roots as args to scope the run.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const ROOTS =
  process.argv.length > 2
    ? process.argv.slice(2).map((p) => resolve(p))
    : [
        ...readdirSync(join(REPO, "packages"), { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => join(REPO, "packages", d.name, "dist")),
        ...readdirSync(join(REPO, "apps"), { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => join(REPO, "apps", d.name, "dist")),
      ].filter(existsSync);

let filesScanned = 0;
let filesEdited = 0;
let importsFixed = 0;

const IMPORT_FROM = /(\bfrom\s+)(['"])(\.\.?\/[^'"]*?)\2/g;
const DYNAMIC_IMPORT = /(\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]*?)\2(\s*\))/g;

function walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && (full.endsWith(".js") || full.endsWith(".mjs"))) processFile(full);
  }
}

function fixSpecifier(spec, fileDir) {
  // Already has an extension we recognize — leave it.
  if (/\.(m?js|json|cjs|node)$/i.test(spec)) return spec;
  const target = resolve(fileDir, spec);
  // File neighbor: "./foo" → "./foo.js" if foo.js exists.
  if (existsSync(target + ".js")) return spec + ".js";
  if (existsSync(target + ".mjs")) return spec + ".mjs";
  // Directory: "./foo" → "./foo/index.js" if that file exists.
  if (existsSync(target) && statSync(target).isDirectory()) {
    if (existsSync(join(target, "index.js"))) return spec.replace(/\/?$/, "/index.js");
    if (existsSync(join(target, "index.mjs"))) return spec.replace(/\/?$/, "/index.mjs");
  }
  return spec;
}

function processFile(file) {
  filesScanned++;
  const orig = readFileSync(file, "utf8");
  const dir = dirname(file);
  let local = 0;
  const replaced = orig
    .replace(IMPORT_FROM, (m, head, q, spec) => {
      const fixed = fixSpecifier(spec, dir);
      if (fixed === spec) return m;
      local++;
      return `${head}${q}${fixed}${q}`;
    })
    .replace(DYNAMIC_IMPORT, (m, head, q, spec, tail) => {
      const fixed = fixSpecifier(spec, dir);
      if (fixed === spec) return m;
      local++;
      return `${head}${q}${fixed}${q}${tail}`;
    });
  if (local > 0) {
    writeFileSync(file, replaced);
    filesEdited++;
    importsFixed += local;
  }
}

for (const root of ROOTS) walk(root);

console.log(
  `fix-esm-extensions: scanned ${filesScanned} files across ${ROOTS.length} dist roots, edited ${filesEdited}, rewrote ${importsFixed} imports`,
);
