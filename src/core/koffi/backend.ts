import koffi from "koffi";
import type { Backend, RawGroup, RawOptions } from "../backend.ts";
import type { RawPackage } from "../types.ts";
import { FIELDS_FULL, FIELDS_SUMMARY } from "../fields.ts";
import {
  AlpmGroup,
  alpm_capabilities,
  alpm_db_get_groupcache,
  alpm_db_get_name,
  alpm_db_get_pkg,
  alpm_db_get_pkgcache,
  alpm_db_search,
  alpm_db_set_usage,
  alpm_errno,
  alpm_filelist_contains,
  alpm_get_localdb,
  alpm_get_syncdbs,
  alpm_initialize,
  alpm_option_add_ignorepkg,
  alpm_option_get_architectures,
  alpm_option_get_cachedirs,
  alpm_option_get_dbpath,
  alpm_option_get_root,
  alpm_option_set_architectures,
  alpm_pkg_compute_optionalfor,
  alpm_pkg_compute_requiredby,
  alpm_pkg_get_db,
  alpm_pkg_get_files,
  alpm_pkg_get_name,
  alpm_pkg_vercmp,
  alpm_register_syncdb,
  alpm_release,
  alpm_strerror,
  alpm_sync_get_new_version,
  alpm_version,
} from "./ffi.ts";
import {
  buildStringList,
  copyStringList,
  freeListSpineAndPayload,
  freeListSpineOnly,
  freeStringList,
  marshalPackage,
  orEmpty,
  resolveDb,
  walkList,
  type Ptr,
} from "./marshal.ts";

function nonNullPtrs(head: Ptr): bigint[] {
  return walkList(head).filter((ptr): ptr is bigint => ptr != null);
}

// alpm_errno_t values (alpm.h's _alpm_errno_t enum - see src/core/errors.ts's
// ERRNO_NAMES for the full ordered table these indices come from).
const ALPM_ERR_DB_NOT_FOUND = 15;
const ALPM_ERR_PKG_NOT_FOUND = 33;

function makeAlpmError(code: number): Error & { code: number } {
  const err = new Error(orEmpty(alpm_strerror(code) as string | null)) as Error & { code: number };
  err.code = code;
  return err;
}

export function koffiVersion(): string {
  return orEmpty(alpm_version() as string | null);
}

export function koffiCapabilities(): { nls: boolean; downloader: boolean; signatures: boolean } {
  const caps = alpm_capabilities() as number;
  return {
    nls: (caps & (1 << 0)) !== 0,
    downloader: (caps & (1 << 1)) !== 0,
    signatures: (caps & (1 << 2)) !== 0,
  };
}

export function koffiVercmp(a: string, b: string): number {
  return alpm_pkg_vercmp(a, b) as number;
}

/**
 * FFI equivalent of native/src/handle.cc + workers.cc's Handle, via koffi
 * instead of a compiled N-API addon. Every call is a synchronous FFI burst
 * on the main thread (not koffi's .async, which runs on a worker thread) -
 * these are in-memory pointer-chasing accessor calls with no syscalls after
 * open()'s alpm_initialize, so blocking briefly is cheap even for a full
 * package listing. `run()` below exists only to preserve call *ordering*
 * (e.g. a concurrently-issued close() must not null out the handle in the
 * middle of a query queued before it) - since calls are synchronous there is
 * no real OS-thread data race to guard against, unlike the mutex in the old
 * native addon's handle.h which serialized genuinely concurrent
 * AsyncWorker::Execute() calls on the libuv threadpool.
 */
export class KoffiBackend implements Backend {
  private handle: bigint | null = null;
  private lock: Promise<void> = Promise.resolve();

  private run<T>(fn: () => T): Promise<T> {
    const result = this.lock.then(fn);
    this.lock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private requireHandle(): bigint {
    if (this.handle === null) throw new Error("handle is closed");
    return this.handle;
  }

  open(root: string, dbpath: string): Promise<void> {
    return this.run(() => {
      if (this.handle !== null) throw new Error("handle is already open");
      const errOut: number[] = [0];
      const handle = alpm_initialize(root, dbpath, errOut) as Ptr;
      if (!handle) throw makeAlpmError(errOut[0]);
      this.handle = handle;
    });
  }

  close(): Promise<void> {
    return this.run(() => {
      if (this.handle === null) return; // idempotent
      const handle = this.handle;
      const rc = alpm_release(handle) as number;
      this.handle = null;
      if (rc !== 0) throw new Error("alpm_release failed");
    });
  }

  options(): Promise<RawOptions> {
    return this.run(() => {
      const handle = this.requireHandle();
      return {
        root: orEmpty(alpm_option_get_root(handle) as string | null),
        dbpath: orEmpty(alpm_option_get_dbpath(handle) as string | null),
        cachedirs: copyStringList(alpm_option_get_cachedirs(handle) as Ptr),
        architectures: copyStringList(alpm_option_get_architectures(handle) as Ptr),
      };
    });
  }

  listPackages(dbName?: string, fields?: number): Promise<RawPackage[]> {
    return this.run(() => {
      const handle = this.requireHandle();
      const db = resolveDb(handle, dbName ?? "local");
      if (!db) throw makeAlpmError(ALPM_ERR_DB_NOT_FOUND);
      const resolvedName = orEmpty(alpm_db_get_name(db) as string | null);
      const f = fields ?? FIELDS_SUMMARY;
      const packages: RawPackage[] = [];
      for (const ptr of nonNullPtrs(alpm_db_get_pkgcache(db) as Ptr)) packages.push(marshalPackage(ptr, f, resolvedName));
      return packages;
    });
  }

  getPackage(name: string, dbName?: string, fields?: number): Promise<RawPackage | null> {
    return this.run(() => {
      const handle = this.requireHandle();
      const db = resolveDb(handle, dbName ?? "local");
      if (!db) throw makeAlpmError(ALPM_ERR_DB_NOT_FOUND);
      const pkg = alpm_db_get_pkg(db, name) as Ptr;
      if (!pkg) return null;
      return marshalPackage(pkg, fields ?? FIELDS_FULL, orEmpty(alpm_db_get_name(db) as string | null));
    });
  }

  search(needles: string[], dbName?: string, fields?: number): Promise<RawPackage[]> {
    return this.run(() => {
      const handle = this.requireHandle();
      const db = resolveDb(handle, dbName ?? "local");
      if (!db) throw makeAlpmError(ALPM_ERR_DB_NOT_FOUND);

      const needleList = buildStringList(needles);
      try {
        const retOut: Ptr[] = [null];
        const rc = alpm_db_search(db, needleList.head, retOut) as number;
        if (rc !== 0) throw makeAlpmError(alpm_errno(handle) as number);
        const retHead = retOut[0];
        try {
          const resolvedName = orEmpty(alpm_db_get_name(db) as string | null);
          const f = fields ?? FIELDS_SUMMARY;
          const packages: RawPackage[] = [];
          for (const ptr of nonNullPtrs(retHead)) packages.push(marshalPackage(ptr, f, resolvedName));
          return packages;
        } finally {
          freeListSpineOnly(retHead);
        }
      } finally {
        freeStringList(needleList);
      }
    });
  }

  registerSyncDb(name: string, sigLevel: number, usage?: number): Promise<void> {
    return this.run(() => {
      const handle = this.requireHandle();
      const db = alpm_register_syncdb(handle, name, sigLevel) as Ptr;
      if (!db) throw makeAlpmError(alpm_errno(handle) as number);
      alpm_db_set_usage(db, usage ?? 0xf);
    });
  }

  setArchitectures(architectures: string[]): Promise<void> {
    return this.run(() => {
      const handle = this.requireHandle();
      const list = buildStringList(architectures);
      try {
        alpm_option_set_architectures(handle, list.head);
      } finally {
        freeStringList(list);
      }
    });
  }

  addIgnorePkg(pkg: string): Promise<void> {
    return this.run(() => {
      const handle = this.requireHandle();
      alpm_option_add_ignorepkg(handle, pkg);
    });
  }

  owners(path: string, fields?: number): Promise<RawPackage[]> {
    return this.run(() => {
      const handle = this.requireHandle();
      const cleanPath = path.startsWith("/") ? path.slice(1) : path;
      const db = alpm_get_localdb(handle) as Ptr;
      const f = fields ?? FIELDS_SUMMARY;
      const result: RawPackage[] = [];
      if (!db) return result;
      for (const pkg of nonNullPtrs(alpm_db_get_pkgcache(db) as Ptr)) {
        const filelist = alpm_pkg_get_files(pkg) as Ptr;
        if (!filelist) continue;
        if (alpm_filelist_contains(filelist, cleanPath) as Ptr) {
          result.push(marshalPackage(pkg, f, "local"));
        }
      }
      return result;
    });
  }

  private computeRelated(name: string, dbName: string | undefined, optional: boolean): Promise<string[]> {
    return this.run(() => {
      const handle = this.requireHandle();
      const db = resolveDb(handle, dbName ?? "local");
      if (!db) throw makeAlpmError(ALPM_ERR_DB_NOT_FOUND);
      const pkg = alpm_db_get_pkg(db, name) as Ptr;
      if (!pkg) throw makeAlpmError(ALPM_ERR_PKG_NOT_FOUND);
      // Both return a newly allocated list of package names (char*) that the
      // header explicitly says the caller must free -> SpineAndPayload.
      const list = (optional ? alpm_pkg_compute_optionalfor(pkg) : alpm_pkg_compute_requiredby(pkg)) as Ptr;
      try {
        return copyStringList(list);
      } finally {
        freeListSpineAndPayload(list);
      }
    });
  }

  requiredBy(name: string, dbName?: string): Promise<string[]> {
    return this.computeRelated(name, dbName, false);
  }

  optionalFor(name: string, dbName?: string): Promise<string[]> {
    return this.computeRelated(name, dbName, true);
  }

  groups(dbName?: string): Promise<RawGroup[]> {
    return this.run(() => {
      const handle = this.requireHandle();
      const db = resolveDb(handle, dbName ?? "local");
      if (!db) throw makeAlpmError(ALPM_ERR_DB_NOT_FOUND);
      const groups: RawGroup[] = [];
      for (const groupPtr of nonNullPtrs(alpm_db_get_groupcache(db) as Ptr)) {
        const group = koffi.decode(groupPtr, AlpmGroup) as { name: string | null; packages: Ptr };
        const packages: string[] = [];
        for (const pkg of nonNullPtrs(group.packages)) packages.push(orEmpty(alpm_pkg_get_name(pkg) as string | null));
        groups.push({ name: orEmpty(group.name), packages });
      }
      return groups;
    });
  }

  newVersion(name: string, fields?: number): Promise<RawPackage | null> {
    return this.run(() => {
      const handle = this.requireHandle();
      const localdb = alpm_get_localdb(handle) as Ptr;
      const local = localdb ? (alpm_db_get_pkg(localdb, name) as Ptr) : null;
      if (!local) throw makeAlpmError(ALPM_ERR_PKG_NOT_FOUND);
      const newer = alpm_sync_get_new_version(local, alpm_get_syncdbs(handle) as Ptr) as Ptr;
      if (!newer) return null;
      const db = alpm_pkg_get_db(newer) as Ptr;
      const dbName = db ? orEmpty(alpm_db_get_name(db) as string | null) : "";
      return marshalPackage(newer, fields ?? FIELDS_SUMMARY, dbName);
    });
  }
}
