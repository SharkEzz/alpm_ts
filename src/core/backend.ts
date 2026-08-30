import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { RawPackage } from "./types.ts";

export interface RawGroup {
  name: string;
  packages: string[];
}

export interface RawOptions {
  root: string;
  dbpath: string;
  cachedirs: string[];
  architectures: string[];
}

/**
 * Mirrors the native addon's Handle surface one call at a time - this is
 * the seam a future privileged-helper backend (JSON-RPC to a root process)
 * drops in behind, without Alpm or the CLI needing to change.
 */
export interface Backend {
  open(root: string, dbpath: string): Promise<void>;
  close(): Promise<void>;
  options(): Promise<RawOptions>;
  registerSyncDb(name: string, sigLevel: number, usage?: number): Promise<void>;
  setArchitectures(architectures: string[]): Promise<void>;
  addIgnorePkg(pkg: string): Promise<void>;
  listPackages(dbName?: string, fields?: number): Promise<RawPackage[]>;
  getPackage(name: string, dbName?: string, fields?: number): Promise<RawPackage | null>;
  search(needles: string[], dbName?: string, fields?: number): Promise<RawPackage[]>;
  owners(path: string, fields?: number): Promise<RawPackage[]>;
  requiredBy(name: string, dbName?: string): Promise<string[]>;
  optionalFor(name: string, dbName?: string): Promise<string[]>;
  groups(dbName?: string): Promise<RawGroup[]>;
  newVersion(name: string, fields?: number): Promise<RawPackage | null>;
}

interface NativeModule {
  version(): string;
  capabilities(): { nls: boolean; downloader: boolean; signatures: boolean };
  vercmp(a: string, b: string): number;
  Handle: new () => Backend;
}

const require = createRequire(import.meta.url);
const ADDON_PATH = "../../native/build/Release/alpm.node";
const NATIVE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../native");

interface VersionMismatchError extends Error {
  code?: string;
  builtVersion?: string;
  runtimeVersion?: string;
}

function describeRebuildReason(err: unknown): string {
  const e = err as VersionMismatchError;
  if (e?.code === "ALPM_TS_VERSION_MISMATCH") {
    return `libalpm changed (built against ${e.builtVersion}, now ${e.runtimeVersion})`;
  }
  return "native addon missing or failed to load";
}

/**
 * Loads the native addon, self-healing a stale build: the addon's own
 * version guard (native/src/addon.cc's CheckVersion) throws with
 * `code: "ALPM_TS_VERSION_MISMATCH"` when it was compiled against a
 * different libalpm major version than what's installed now, and a missing
 * native/build/Release/alpm.node throws a plain require error - both are
 * fixed by the same remedy (rebuild).
 *
 * Once rebuilt, this process re-execs itself as a fresh child rather than
 * retrying require() in place: a native addon can't be hot-swapped within
 * a process once dlopen has mapped it - requiring the same path again
 * returns the already-loaded (stale) code even after the file on disk has
 * changed, confirmed empirically (a rebuilt-but-not-yet-reloaded addon
 * kept reporting its old baked-in version to a same-process retry, while a
 * brand new process reading the identical file got the correct one). The
 * ALPM_TS_REBUILT guard prevents a rebuild loop if the rebuild doesn't
 * actually fix things.
 *
 * Set ALPM_TS_NO_AUTO_REBUILD to disable all of this and get the old
 * fail-with-a-message behavior instead (useful in CI/sandboxes without a
 * C++ toolchain, or on a read-only filesystem).
 */
function loadNative(): NativeModule {
  try {
    return require(ADDON_PATH) as NativeModule;
  } catch (err) {
    if (process.env.ALPM_TS_NO_AUTO_REBUILD || process.env.ALPM_TS_REBUILT) throw err;
    rebuildNativeAddon(err);
    reexecSelf();
  }
}

function rebuildNativeAddon(cause: unknown): void {
  process.stderr.write(`alpm-ts: ${describeRebuildReason(cause)} - rebuilding native addon...\n`);
  // Resolved rather than shelled out to a bare `node-gyp` so this doesn't
  // depend on PATH or node_modules/.bin - works the same locally or
  // globally installed.
  const nodeGypBin = require.resolve("node-gyp/bin/node-gyp.js");
  execFileSync(process.execPath, [nodeGypBin, "rebuild"], { cwd: NATIVE_DIR, stdio: "inherit" });
}

/** Re-runs the exact same invocation as a fresh process (see loadNative's doc comment) and exits mirroring its result. */
function reexecSelf(): never {
  const result = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, ALPM_TS_REBUILT: "1" },
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const native = loadNative();

export const nativeVersion = native.version;
export const nativeCapabilities = native.capabilities;
export const vercmp = native.vercmp;

export class NativeBackend implements Backend {
  private readonly handle: Backend;

  constructor() {
    this.handle = new native.Handle();
  }

  open(root: string, dbpath: string): Promise<void> {
    return this.handle.open(root, dbpath);
  }
  close(): Promise<void> {
    return this.handle.close();
  }
  options(): Promise<RawOptions> {
    return this.handle.options();
  }
  registerSyncDb(name: string, sigLevel: number, usage?: number): Promise<void> {
    return this.handle.registerSyncDb(name, sigLevel, usage);
  }
  setArchitectures(architectures: string[]): Promise<void> {
    return this.handle.setArchitectures(architectures);
  }
  addIgnorePkg(pkg: string): Promise<void> {
    return this.handle.addIgnorePkg(pkg);
  }
  listPackages(dbName?: string, fields?: number): Promise<RawPackage[]> {
    return this.handle.listPackages(dbName, fields);
  }
  getPackage(name: string, dbName?: string, fields?: number): Promise<RawPackage | null> {
    return this.handle.getPackage(name, dbName, fields);
  }
  search(needles: string[], dbName?: string, fields?: number): Promise<RawPackage[]> {
    return this.handle.search(needles, dbName, fields);
  }
  owners(path: string, fields?: number): Promise<RawPackage[]> {
    return this.handle.owners(path, fields);
  }
  requiredBy(name: string, dbName?: string): Promise<string[]> {
    return this.handle.requiredBy(name, dbName);
  }
  optionalFor(name: string, dbName?: string): Promise<string[]> {
    return this.handle.optionalFor(name, dbName);
  }
  groups(dbName?: string): Promise<RawGroup[]> {
    return this.handle.groups(dbName);
  }
  newVersion(name: string, fields?: number): Promise<RawPackage | null> {
    return this.handle.newVersion(name, fields);
  }
}
