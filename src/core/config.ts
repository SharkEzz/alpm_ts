import { readFileSync, realpathSync, globSync } from 'node:fs';
import { machine } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

export interface ParsedRepo {
  name: string;
  /** Server URLs with $repo/$arch already substituted, in config order. */
  servers: string[];
  /** Raw SigLevel words for this repo section only (not yet merged with [options]). */
  sigLevel: string[];
  /** Raw Usage words for this repo section. */
  usage: string[];
}

export interface PacmanOptions extends Record<string, unknown> {
  rootDir: string;
  dbPath: string;
  cacheDirs: string[];
  hookDirs: string[];
  gpgDir: string;
  logFile: string;
  /** Resolved architectures - 'auto' has already been replaced by os.machine(). */
  architectures: string[];
  ignorePkgs: string[];
  ignoreGroups: string[];
  holdPkgs: string[];
  noUpgrade: string[];
  noExtract: string[];
  /** Raw SigLevel words from [options] - the default for repos with none of their own. */
  sigLevel: string[];
  color: boolean;
  iLoveCandy: boolean;
  verbosePkgLists: boolean;
}

export interface PacmanConfig {
  options: PacmanOptions;
  repos: ParsedRepo[];
}

const MAX_INCLUDE_DEPTH = 20;

// const LIST_OPTION_KEYS = new Set([
//   'CacheDir',
//   'HookDir',
//   'Architecture',
//   'IgnorePkg',
//   'IgnoreGroup',
//   'HoldPkg',
//   'NoUpgrade',
//   'NoExtract',
// ]);

const VALUELESS_OPTION_KEYS: Record<string, keyof PacmanOptions> = {
  Color: 'color',
  ILoveCandy: 'iLoveCandy',
  VerbosePkgLists: 'verbosePkgLists',
};

function defaultOptions(): PacmanOptions {
  return {
    rootDir: '/',
    dbPath: '/var/lib/pacman/',
    cacheDirs: [],
    hookDirs: [],
    gpgDir: '/etc/pacman.d/gnupg/',
    logFile: '/var/log/pacman.log',
    architectures: [],
    ignorePkgs: [],
    ignoreGroups: [],
    holdPkgs: [],
    noUpgrade: [],
    noExtract: [],
    sigLevel: [],
    color: false,
    iLoveCandy: false,
    verbosePkgLists: false,
  };
}

function stripComment(line: string): string {
  const hash = line.indexOf('#');
  return hash === -1 ? line : line.slice(0, hash);
}

function splitWords(value: string): string[] {
  return value.split(/\s+/).filter((w) => w.length > 0);
}

class Parser {
  readonly options = defaultOptions();
  readonly repos: ParsedRepo[] = [];
  private readonly reposByName = new Map<string, ParsedRepo>();
  private currentSection = 'options';

  private getOrCreateRepo(name: string): ParsedRepo {
    let repo = this.reposByName.get(name);
    if (!repo) {
      repo = { name, servers: [], sigLevel: [], usage: [] };
      this.reposByName.set(name, repo);
      this.repos.push(repo);
    }
    return repo;
  }

  private applyList(target: string[], value: string): void {
    target.push(...splitWords(value));
  }

  private applyOptionDirective(key: string, value: string | undefined): void {
    if (value === undefined) {
      const flagField = VALUELESS_OPTION_KEYS[key];
      if (flagField && flagField in this.options) {
        this.options[flagField] = true;
      }
      return;
    }
    switch (key) {
      case 'RootDir':
        this.options.rootDir = value;
        break;
      case 'DBPath':
        this.options.dbPath = value;
        break;
      case 'GPGDir':
        this.options.gpgDir = value;
        break;
      case 'LogFile':
        this.options.logFile = value;
        break;
      case 'CacheDir':
        this.applyList(this.options.cacheDirs, value);
        break;
      case 'HookDir':
        this.applyList(this.options.hookDirs, value);
        break;
      case 'Architecture':
        this.applyList(this.options.architectures, value);
        break;
      case 'IgnorePkg':
        this.applyList(this.options.ignorePkgs, value);
        break;
      case 'IgnoreGroup':
        this.applyList(this.options.ignoreGroups, value);
        break;
      case 'HoldPkg':
        this.applyList(this.options.holdPkgs, value);
        break;
      case 'NoUpgrade':
        this.applyList(this.options.noUpgrade, value);
        break;
      case 'NoExtract':
        this.applyList(this.options.noExtract, value);
        break;
      case 'SigLevel':
        this.applyList(this.options.sigLevel, value);
        break;
      default:
        // Unrecognized [options] directives (XferCommand, CleanMethod, ...)
        // are out of v1 scope - ignored rather than rejected, so future
        // pacman.conf additions don't break the parser.
        break;
    }
  }

  private applyRepoDirective(repo: ParsedRepo, key: string, value: string | undefined): void {
    if (value === undefined) return;
    switch (key) {
      case 'Server':
        repo.servers.push(value.replaceAll('$repo', repo.name));
        break;
      case 'SigLevel':
        this.applyList(repo.sigLevel, value);
        break;
      case 'Usage':
        this.applyList(repo.usage, value);
        break;
      default:
        break;
    }
  }

  processFile(filePath: string, visited: Set<string>, depth: number): void {
    if (depth > MAX_INCLUDE_DEPTH) {
      throw new Error(
        `pacman.conf: Include depth exceeded ${MAX_INCLUDE_DEPTH} at ${filePath} (possible cycle)`,
      );
    }
    const real = realpathSync(filePath);
    if (visited.has(real)) {
      throw new Error(`pacman.conf: Include cycle detected at ${filePath}`);
    }
    visited.add(real);
    try {
      const text = readFileSync(filePath, 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = stripComment(rawLine).trim();
        if (line.length === 0) continue;

        const sectionMatch = /^\[(.+)\]$/.exec(line);
        if (sectionMatch) {
          this.currentSection = sectionMatch[1];
          if (this.currentSection !== 'options') {
            this.getOrCreateRepo(this.currentSection);
          }
          continue;
        }

        const eq = line.indexOf('=');
        const key = (eq === -1 ? line : line.slice(0, eq)).trim();
        const value = eq === -1 ? undefined : line.slice(eq + 1).trim();

        if (key === 'Include') {
          if (value === undefined) continue;
          const pattern = isAbsolute(value) ? value : join(dirname(filePath), value);
          const matches = /[*?[]/.test(pattern) ? [...globSync(pattern)].sort() : [pattern];
          for (const match of matches) {
            this.processFile(match, visited, depth + 1);
          }
          continue;
        }

        if (this.currentSection === 'options') {
          this.applyOptionDirective(key, value);
        } else {
          this.applyRepoDirective(this.getOrCreateRepo(this.currentSection), key, value);
        }
      }
    } finally {
      // Only guards against a real cycle (a file transitively including
      // itself) - removing on the way back up lets the same mirrorlist be
      // Included from multiple sibling repo sections, which is how this
      // machine's real /etc/pacman.conf uses /etc/pacman.d/mirrorlist.
      visited.delete(real);
    }
  }
}

function resolveArchitectures(archs: string[]): string[] {
  const resolved = archs.length === 0 ? [machine()] : archs.map((a) => (a === 'auto' ? machine() : a));
  return [...new Set(resolved)];
}

export function parsePacmanConfig(configPath: string): PacmanConfig {
  const parser = new Parser();
  parser.processFile(configPath, new Set(), 0);

  parser.options.architectures = resolveArchitectures(parser.options.architectures);
  if (parser.options.cacheDirs.length === 0) {
    parser.options.cacheDirs = ['/var/cache/pacman/pkg/'];
  }
  if (parser.options.hookDirs.length === 0) {
    parser.options.hookDirs = ['/etc/pacman.d/hooks/'];
  }

  const arch = parser.options.architectures[0];
  for (const repo of parser.repos) {
    repo.servers = repo.servers.map((s) => s.replaceAll('$arch', arch));
  }

  return { options: parser.options, repos: parser.repos };
}
