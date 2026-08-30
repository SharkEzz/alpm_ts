import type { RawPackage } from './types.ts';
import { koffiCapabilities, koffiVercmp, koffiVersion } from './koffi/backend.ts';

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
 * Mirrors the libalpm handle's query surface one call at a time - this is
 * the seam a future privileged-helper backend (JSON-RPC to a root process)
 * drops in behind, without Alpm or the CLI needing to change. KoffiBackend
 * (./koffi/backend.ts) is the only implementation today.
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

export const version = koffiVersion;
export const capabilities = koffiCapabilities;
export const vercmp = koffiVercmp;
