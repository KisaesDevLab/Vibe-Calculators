import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface VersionInfo {
  version: string;
  gitSha: string;
}

let cached: VersionInfo | undefined;

/**
 * Returns version + git SHA for the running API.
 *
 * Resolution order:
 *   - GIT_SHA env var (set by Docker build / CI release pipeline)
 *   - .git/HEAD walk (dev workflow)
 *   - "unknown" if neither resolves
 *
 * Result is cached for the process lifetime; SHA is fixed at boot.
 */
export function getVersionInfo(): VersionInfo {
  if (cached) return cached;

  const version = readPackageVersion();
  const gitSha = process.env.GIT_SHA ?? readGitSha() ?? "unknown";
  cached = { version, gitSha };
  return cached;
}

function readPackageVersion(): string {
  // The compiled binary lives at dist/lib/version.js, sources at
  // src/lib/version.ts. In both cases package.json is two levels up.
  const candidates = [
    join(__dirname, "..", "..", "package.json"),
    join(__dirname, "..", "..", "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, "utf8");
      const parsed = JSON.parse(raw) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      // Try the next candidate.
    }
  }
  return "0.0.0";
}

function readGitSha(): string | undefined {
  // Walk up from cwd looking for .git
  const start = process.cwd();
  for (let dir = start, depth = 0; depth < 8; depth++) {
    try {
      const head = readFileSync(join(dir, ".git", "HEAD"), "utf8").trim();
      if (head.startsWith("ref: ")) {
        const ref = head.slice(5);
        const refPath = join(dir, ".git", ref);
        return readFileSync(refPath, "utf8").trim().slice(0, 7);
      }
      return head.slice(0, 7);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  }
  return undefined;
}

/** Test-only escape hatch — clears the memoized info so tests can re-resolve. */
export function _resetVersionCacheForTests(): void {
  cached = undefined;
}
