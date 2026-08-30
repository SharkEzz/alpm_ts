import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FixturePackageSpec {
  name: string;
  version: string;
  /** alpm_pkgreason_t: 0 = explicit (field omitted, matching real local db), 1 = dependency. */
  reason?: 0 | 1;
  depends?: string[];
  /** "name: description" lines, matching the real desc file's %OPTDEPENDS% format. */
  optdepends?: string[];
  provides?: string[];
  conflicts?: string[];
  replaces?: string[];
  groups?: string[];
  /** Root-relative paths, no leading slash (matches real alpm_file_t entries). */
  files?: string[];
  size?: number;
}

// Ten packages with deliberately known relationships, so every assertion in
// test/koffi/fixture-queries.test.ts is exact rather than a loose bound:
//  - app -(depends)-> libfoo, libbar; -(optdepends)-> libbaz
//  - libfoo -(depends)-> libbar; provides foo-provider
//  - libbar: required by both app and libfoo
//  - libbaz: optionalFor app, required by nobody (not a true orphan)
//  - orphan-pkg: a dependency-reason package required/optionally-used by nothing
//  - devtools-a/devtools-b: both in the "devtools" group
//  - conflict-a/conflict-b: mutually conflicting
//  - successor-pkg: replaces predecessor-pkg (which doesn't itself need to exist)
export const FIXTURE_PACKAGES: FixturePackageSpec[] = [
  {
    name: "app",
    version: "1.0-1",
    reason: 0,
    depends: ["libfoo", "libbar"],
    optdepends: ["libbaz: for extra features"],
    files: ["usr/bin/app"],
  },
  { name: "libfoo", version: "2.0-1", reason: 1, depends: ["libbar"], provides: ["foo-provider"] },
  { name: "libbar", version: "3.1-2", reason: 1 },
  { name: "libbaz", version: "0.5-1", reason: 1 },
  { name: "orphan-pkg", version: "1.2-1", reason: 1 },
  { name: "devtools-a", version: "1.0-1", reason: 0, groups: ["devtools"] },
  { name: "devtools-b", version: "1.0-1", reason: 0, groups: ["devtools"] },
  { name: "conflict-a", version: "1.0-1", reason: 0, conflicts: ["conflict-b"] },
  { name: "conflict-b", version: "1.0-1", reason: 0, conflicts: ["conflict-a"] },
  { name: "successor-pkg", version: "2.0-1", reason: 0, replaces: ["predecessor-pkg"] },
];

function descFor(pkg: FixturePackageSpec): string {
  const lines: string[] = [];
  const field = (key: string, value: string) => lines.push(`%${key}%`, value, "");
  const listField = (key: string, values: string[] | undefined) => {
    if (values && values.length > 0) lines.push(`%${key}%`, ...values, "");
  };

  field("NAME", pkg.name);
  field("VERSION", pkg.version);
  field("DESC", `Fixture package ${pkg.name}`);
  field("SIZE", String(pkg.size ?? 1024));
  if (pkg.reason) field("REASON", String(pkg.reason));
  listField("DEPENDS", pkg.depends);
  listField("OPTDEPENDS", pkg.optdepends);
  listField("PROVIDES", pkg.provides);
  listField("CONFLICTS", pkg.conflicts);
  listField("REPLACES", pkg.replaces);
  listField("GROUPS", pkg.groups);

  return lines.join("\n");
}

function filesFor(pkg: FixturePackageSpec): string {
  const files = pkg.files ?? [];
  return ["%FILES%", ...files, ""].join("\n");
}

export interface Fixture {
  root: string;
  dbpath: string;
  cleanup(): void;
}

/** Synthesizes a local db at a throwaway path - real enough for libalpm to open and query, with no dependency on the host system's actual package state. */
export function buildFixtureRoot(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "alpm-ts-fixture-"));
  const root = join(base, "root");
  const dbpath = join(base, "db");

  mkdirSync(join(dbpath, "local"), { recursive: true });
  mkdirSync(join(dbpath, "sync"), { recursive: true });
  mkdirSync(root, { recursive: true });
  // Verified against the real /var/lib/pacman/local/ALPM_DB_VERSION on this machine.
  writeFileSync(join(dbpath, "local", "ALPM_DB_VERSION"), "9\n");

  for (const pkg of FIXTURE_PACKAGES) {
    const dir = join(dbpath, "local", `${pkg.name}-${pkg.version}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "desc"), descFor(pkg));
    writeFileSync(join(dir, "files"), filesFor(pkg));
  }

  return {
    root,
    dbpath,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}
