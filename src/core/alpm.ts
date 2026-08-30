import { parsePacmanConfig, type PacmanConfig } from "./config.ts";
import { resolveSigLevel, resolveUsage } from "./siglevel.ts";
import { type Backend, type RawOptions } from "./backend.ts";
import { KoffiBackend } from "./koffi/backend.ts";
import { mapPackage, type Package, type Group, type Dependency, type FileEntry } from "./types.ts";
import { AlpmError, isNativeAlpmError } from "./errors.ts";
import { FIELDS_SUMMARY, FIELDS_FULL, FIELD_FILES, FIELD_GROUPS } from "./fields.ts";

export interface OpenOptions {
  configPath?: string;
  root?: string;
  dbPath?: string;
}

export interface ListOptions {
  /** Sync repo name, or "local" (default) for installed packages. */
  repo?: string;
  fields?: number;
}

export interface InfoOptions {
  /** Look in sync dbs instead of the local db. */
  sync?: boolean;
  /** Restrict a sync lookup to one repo; otherwise every registered repo is tried in order. */
  repo?: string;
}

export interface SearchOptions {
  repo?: string;
  local?: boolean;
}

export interface DepsOptions {
  reverse?: boolean;
  optional?: boolean;
}

export interface OutdatedEntry {
  name: string;
  currentVersion: string;
  newVersion: string;
  db: string;
}

async function wrap<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    throw isNativeAlpmError(err) ? AlpmError.fromNative(err) : err;
  }
}

export class Alpm {
  readonly config: PacmanConfig;
  private readonly backend: Backend;
  private readonly syncRepoNames: string[];

  private constructor(backend: Backend, config: PacmanConfig) {
    this.backend = backend;
    this.config = config;
    this.syncRepoNames = config.repos.map((r) => r.name);
  }

  /**
   * Parses pacman.conf, opens the libalpm handle, and registers every sync
   * repo in config order (constraint 4: root/dbpath are fixed for the
   * handle's lifetime, so CLI overrides must be resolved before open()).
   */
  static async open(opts: OpenOptions = {}): Promise<Alpm> {
    const config = parsePacmanConfig(opts.configPath ?? "/etc/pacman.conf");
    const root = opts.root ?? config.options.rootDir;
    const dbPath = opts.dbPath ?? config.options.dbPath;

    const backend = new KoffiBackend();
    await wrap(backend.open(root, dbPath));

    try {
      await wrap(backend.setArchitectures(config.options.architectures));
      for (const pkg of config.options.ignorePkgs) {
        await wrap(backend.addIgnorePkg(pkg));
      }
      // Sequential, not Promise.all: registration order is pacman's
      // resolution priority and alpm_get_syncdbs preserves call order.
      for (const repo of config.repos) {
        const sigLevel = resolveSigLevel([...config.options.sigLevel, ...repo.sigLevel]);
        const usage = resolveUsage(repo.usage);
        await wrap(backend.registerSyncDb(repo.name, sigLevel, usage));
      }
    } catch (err) {
      await backend.close().catch(() => {});
      throw err;
    }

    return new Alpm(backend, config);
  }

  async close(): Promise<void> {
    await wrap(this.backend.close());
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  async options(): Promise<RawOptions> {
    return wrap(this.backend.options());
  }

  private resolveRepoNames(repo?: string): string[] {
    if (repo === undefined) return this.syncRepoNames;
    if (!this.syncRepoNames.includes(repo)) {
      throw new Error(`no such repo: ${repo} (registered: ${this.syncRepoNames.join(", ")})`);
    }
    return [repo];
  }

  async list(opts: ListOptions = {}): Promise<Package[]> {
    const raws = await wrap(this.backend.listPackages(opts.repo ?? "local", opts.fields ?? FIELDS_SUMMARY));
    return raws.map(mapPackage);
  }

  async info(name: string, opts: InfoOptions = {}): Promise<Package | null> {
    if (!opts.sync) {
      const raw = await wrap(this.backend.getPackage(name, "local", FIELDS_FULL));
      return raw ? mapPackage(raw) : null;
    }
    for (const repoName of this.resolveRepoNames(opts.repo)) {
      const raw = await wrap(this.backend.getPackage(name, repoName, FIELDS_FULL));
      if (raw) return mapPackage(raw);
    }
    return null;
  }

  /**
   * alpm_db_search takes exactly one db per call - this merges results
   * across every requested repo (in registration/priority order),
   * deduping by package name so a package present in multiple repos is
   * reported once, from the highest-priority repo that has it.
   */
  async search(needles: string[], opts: SearchOptions = {}): Promise<Package[]> {
    if (opts.local) {
      return (await wrap(this.backend.search(needles, "local", FIELDS_SUMMARY))).map(mapPackage);
    }
    const seen = new Set<string>();
    const results: Package[] = [];
    for (const repoName of this.resolveRepoNames(opts.repo)) {
      for (const raw of await wrap(this.backend.search(needles, repoName, FIELDS_SUMMARY))) {
        const name = raw.name ?? "";
        if (seen.has(name)) continue;
        seen.add(name);
        results.push(mapPackage(raw));
      }
    }
    return results;
  }

  async owners(path: string): Promise<Package[]> {
    return (await wrap(this.backend.owners(path, FIELDS_SUMMARY))).map(mapPackage);
  }

  async files(name: string): Promise<FileEntry[] | null> {
    const raw = await wrap(this.backend.getPackage(name, "local", FIELD_FILES));
    return raw ? (raw.files ?? []) : null;
  }

  /** Forward deps (from the package's own manifest) or reverse deps (who needs it). */
  async deps(name: string, opts: DepsOptions = {}): Promise<Dependency[] | string[]> {
    if (opts.reverse) {
      return opts.optional
        ? wrap(this.backend.optionalFor(name, "local"))
        : wrap(this.backend.requiredBy(name, "local"));
    }
    const raw = await wrap(this.backend.getPackage(name, "local", FIELDS_FULL));
    if (!raw) throw new Error(`package not found: ${name}`);
    return (opts.optional ? raw.optdepends : raw.depends) ?? [];
  }

  async groups(name?: string, opts: { repo?: string } = {}): Promise<Group[]> {
    const groups = await wrap(this.backend.groups(opts.repo ?? "local"));
    return name ? groups.filter((g) => g.name === name) : groups;
  }

  /**
   * Local vs sync version comparison (`pacman -Qu` without a prior -Sy).
   * The IgnorePkg/IgnoreGroup check mirrors alpm_pkg_should_ignore, done in
   * TS against the already-parsed config rather than an extra libalpm
   * round-trip per package.
   */
  async outdated(): Promise<OutdatedEntry[]> {
    const installed = await wrap(this.backend.listPackages("local", FIELDS_SUMMARY | FIELD_GROUPS));
    const results: OutdatedEntry[] = [];
    for (const raw of installed) {
      const name = raw.name ?? "";
      if (this.config.options.ignorePkgs.includes(name)) continue;
      if (raw.groups?.some((g) => this.config.options.ignoreGroups.includes(g))) continue;

      const newer = await wrap(this.backend.newVersion(name, FIELDS_SUMMARY));
      if (newer) {
        results.push({ name, currentVersion: raw.version ?? "", newVersion: newer.version ?? "", db: newer.db ?? "" });
      }
    }
    return results;
  }
}
