import { Alpm } from "../core/alpm.ts";
import type { Dependency } from "../core/types.ts";

export const EXIT_OK = 0;
export const EXIT_NOT_FOUND = 1;
export const EXIT_USAGE = 2;
export const EXIT_ALPM_ERROR = 3;

/** Thrown by a command action when the requested resource doesn't exist - maps to exit code 1. */
export class NotFoundError extends Error {}

export interface GlobalOptions {
  json?: boolean;
  root?: string;
  dbpath?: string;
  config?: string;
  color?: boolean;
}

export function openAlpm(opts: GlobalOptions): Promise<Alpm> {
  return Alpm.open({ configPath: opts.config, root: opts.root, dbPath: opts.dbpath });
}

export function formatDependency(dep: Dependency): string {
  return dep.mod ? `${dep.name}${dep.mod}${dep.version}` : dep.name;
}
