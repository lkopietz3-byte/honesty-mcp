// Reads the installed version of a wrapped kit, so a tool can offer an input
// or word its description only when the kit that is actually installed
// supports it. This server accepts more than one release line of some kits
// (see "Kit versions" in the README), and a kit that does not know an option
// ignores it silently, so passing a new option to an old kit would look like it
// worked. Tools check here first and refuse instead.
//
// The version comes from the kit's own package.json, found by walking up from
// the file Node resolves for the kit's name. (Reading `<kit>/package.json`
// directly is not possible: the kits' `exports` maps do not list it.)

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const requireFromHere = createRequire(import.meta.url);
const cache = new Map<string, string | null>();

/** The installed version string of `kit` (for example "0.3.0"), or null if it cannot be read. */
export function installedKitVersion(kit: string): string | null {
  const hit = cache.get(kit);
  if (hit !== undefined) return hit;
  let version: string | null = null;
  try {
    let dir = dirname(requireFromHere.resolve(kit));
    // The entry file sits at most a few directories below the package root.
    for (let depth = 0; depth < 6; depth += 1) {
      try {
        const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
        if (parsed.name === kit && typeof parsed.version === "string") {
          version = parsed.version;
          break;
        }
      } catch {
        // No package.json in this directory (or not readable); keep walking up.
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    version = null;
  }
  cache.set(kit, version);
  return version;
}

/** Parses "major.minor.patch" (ignoring any pre-release or build suffix). Returns null for anything else. */
export function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `version` is at least `minimum` (both "major.minor.patch"). A pre-release suffix is ignored. */
export function versionAtLeast(version: string, minimum: string): boolean {
  const have = parseVersion(version);
  const need = parseVersion(minimum);
  if (!have || !need) return false;
  for (let i = 0; i < 3; i += 1) {
    if (have[i]! !== need[i]!) return have[i]! > need[i]!;
  }
  return true;
}

/**
 * True when the installed `kit` is at least `minimum`. An unreadable version
 * counts as "not new enough": the safe direction is to offer less.
 */
export function kitAtLeast(kit: string, minimum: string): boolean {
  const version = installedKitVersion(kit);
  return version !== null && versionAtLeast(version, minimum);
}
