#!/usr/bin/env node
/**
 * Reports libalpm functions that aren't wrapped by the native addon yet -
 * informational only. It does NOT generate bindings or CLI commands: each
 * wrapped function in native/src/ required a human call about mutex/
 * thread-safety and alpm_list_t ownership (see native/src/marshal.h's
 * AlpmListGuard) that can't be derived from a C signature alone, so this
 * tool's job stops at "here's what's new, go take a look."
 *
 * Usage:
 *   npm run check-alpm-coverage                  # report
 *   npm run check-alpm-coverage -- --update-baseline
 */
import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const BASELINE_PATH = join(SCRIPT_DIR, "alpm-coverage-baseline.json");

interface Baseline {
  libalpmVersion: string;
  functions: string[];
}

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

/** Same header binding.gyp actually compiles against - pkg-config's -I if it names one, else the default this is an Arch-only tool relies on. */
function findHeaderPath(): string {
  try {
    const cflags = sh("pkg-config", ["--cflags", "libalpm"]);
    for (const m of cflags.matchAll(/-I(\S+)/g)) {
      const candidate = join(m[1], "alpm.h");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // pkg-config missing or libalpm.pc not found - fall through to the default.
  }
  return "/usr/include/alpm.h";
}

/**
 * Best-effort regex scan for `alpm_*` function declarations - not a full C
 * parser. Skips typedef lines (function-pointer typedefs like
 * `alpm_cb_log` would otherwise look like declarations) and requires the
 * name to be directly followed by `(`, which also naturally excludes a
 * function-pointer *type* used as a parameter (e.g. `alpm_cb_download cb`
 * has a space, not `(`, after the type name). Always spot-check its output
 * rather than trusting it blindly.
 */
function extractFunctionNames(headerSource: string): Set<string> {
  const names = new Set<string>();
  for (const rawLine of headerSource.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
    if (line.includes("typedef")) continue;
    const match = /\balpm_[a-z0-9_]+(?=\s*\()/.exec(line);
    if (match) names.add(match[0]);
  }
  return names;
}

function extractWrappedFunctions(): Set<string> {
  const names = new Set<string>();
  for (const file of globSync(join(REPO_ROOT, "native/src/*.cc"))) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/\balpm_[a-z0-9_]+(?=\s*\()/g)) {
      names.add(m[0]);
    }
  }
  return names;
}

function loadBaseline(): Baseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/^alpm_trans_/, "transactions (out of scope for this read-only tool)"],
  [/^alpm_(checkdeps|checkconflicts|find_satisfier|find_dbs_satisfier|find_group_pkgs)$/, "transaction-adjacent dependency resolution"],
  [/^alpm_(add|remove)_pkg$/, "transaction staging"],
  [/^alpm_db_(update|unregister|unregister_all_syncdbs)$/, "db lifecycle / network sync (write)"],
  [/^alpm_db_(add|remove|set)_(cache_)?server/, "db server management (write)"],
  [/_(get|set)_.*cb$/, "callback registration"],
  [/^alpm_cb_/, "callback type"],
  [/^alpm_(compute|decode)_(md5sum|sha256sum|signature)$|extract_keyid|checkmd5sum/, "signature/checksum verification"],
  [/^alpm_pkg_(load|free|should_ignore)$/, "package-file / transaction internals"],
  [/^alpm_option_set_/, "handle configuration (write)"],
  [/^alpm_option_get_/, "handle configuration (read) - candidate for review"],
  [/^alpm_pkg_get_/, "package accessor - candidate for review"],
  [/^alpm_db_get_/, "db accessor - candidate for review"],
];

function categorize(name: string): string {
  for (const [re, label] of CATEGORY_RULES) {
    if (re.test(name)) return label;
  }
  return "uncategorized - candidate for review";
}

function printGrouped(title: string, names: string[]): void {
  console.log(`\n${title} (${names.length})`);
  if (names.length === 0) {
    console.log("  (none)");
    return;
  }
  const byCategory = new Map<string, string[]>();
  for (const name of names.sort()) {
    const category = categorize(name);
    byCategory.set(category, [...(byCategory.get(category) ?? []), name]);
  }
  for (const [category, members] of [...byCategory.entries()].sort()) {
    console.log(`  ${category}:`);
    for (const name of members) console.log(`    ${name}`);
  }
}

function main(): void {
  const updateBaseline = process.argv.includes("--update-baseline");

  const headerPath = findHeaderPath();
  const headerSource = readFileSync(headerPath, "utf8");
  const currentFunctions = extractFunctionNames(headerSource);
  const wrappedFunctions = extractWrappedFunctions();
  const libalpmVersion = sh("pkg-config", ["--modversion", "libalpm"]);

  console.log(`Header: ${headerPath}`);
  console.log(`libalpm version: ${libalpmVersion}`);
  console.log(`Functions found in header: ${currentFunctions.size}`);
  console.log(`Wrapped by native/src/*.cc: ${wrappedFunctions.size}`);

  if (updateBaseline) {
    const baseline: Baseline = { libalpmVersion, functions: [...currentFunctions].sort() };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`\nBaseline updated: ${BASELINE_PATH}`);
    return;
  }

  const baseline = loadBaseline();
  const baselineFunctions = new Set(baseline?.functions ?? []);
  if (baseline) {
    console.log(`Baseline: ${baseline.libalpmVersion} (${baseline.functions.length} functions)`);
  } else {
    console.log("Baseline: none yet - every function below reports as new. Run with --update-baseline to set one.");
  }

  const unwrapped = [...currentFunctions].filter((f) => !wrappedFunctions.has(f));
  const newSinceBaseline = unwrapped.filter((f) => !baselineFunctions.has(f));
  const alreadyKnownUnwrapped = unwrapped.filter((f) => baselineFunctions.has(f));

  printGrouped("New since baseline (not wrapped)", newSinceBaseline);
  printGrouped("Unwrapped, already known", alreadyKnownUnwrapped);

  console.log(
    "\nThis is a report, not an action list: most of the above is deliberately out of scope\n" +
      "(transactions, callbacks, write operations) for this read-only tool. Review, then\n" +
      "wire up anything worth adding by hand in native/src/ - see marshal.h's AlpmListGuard\n" +
      "and workers.h's HandleWorker for the patterns to follow.",
  );
}

main();
