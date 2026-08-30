import { createRequire } from "node:module";
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
const native = require("../../native/build/Release/alpm.node") as NativeModule;

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
