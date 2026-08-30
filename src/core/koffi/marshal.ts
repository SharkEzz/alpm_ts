import koffi from "koffi";
import {
  AlpmDepend,
  AlpmFile,
  AlpmFilelist,
  AlpmList,
  alpm_db_get_name,
  alpm_get_localdb,
  alpm_get_syncdbs,
  alpm_list_add,
  alpm_list_free,
  alpm_pkg_get_builddate,
  alpm_pkg_get_conflicts,
  alpm_pkg_get_depends,
  alpm_pkg_get_desc,
  alpm_pkg_get_files,
  alpm_pkg_get_groups,
  alpm_pkg_get_installdate,
  alpm_pkg_get_isize,
  alpm_pkg_get_licenses,
  alpm_pkg_get_name,
  alpm_pkg_get_optdepends,
  alpm_pkg_get_packager,
  alpm_pkg_get_provides,
  alpm_pkg_get_reason,
  alpm_pkg_get_replaces,
  alpm_pkg_get_url,
  alpm_pkg_get_validation,
  alpm_pkg_get_version,
  libc_free,
} from "./ffi.ts";
import {
  FIELD_CONFLICTS,
  FIELD_DATES,
  FIELD_DB,
  FIELD_DEPENDS,
  FIELD_DESC,
  FIELD_FILES,
  FIELD_GROUPS,
  FIELD_ISIZE,
  FIELD_LICENSES,
  FIELD_NAME,
  FIELD_OPTDEPENDS,
  FIELD_PACKAGER,
  FIELD_PROVIDES,
  FIELD_REASON,
  FIELD_REPLACES,
  FIELD_URL,
  FIELD_VALIDATION,
  FIELD_VERSION,
} from "../fields.ts";
import type { RawPackage } from "../types.ts";

// A koffi pointer value: BigInt, or null/undefined for C NULL.
export type Ptr = bigint | null | undefined;

export function orEmpty(s: string | null | undefined): string {
  return s ?? "";
}

// --- alpm_list_t traversal ---------------------------------------------------

interface AlpmListNode {
  data: Ptr;
  next: Ptr;
}

/** Walks a borrowed alpm_list_t*, returning each node's raw `data` payload (never frees `head`). */
export function walkList(head: Ptr): Ptr[] {
  const out: Ptr[] = [];
  let node = head;
  while (node) {
    const rec = koffi.decode(node, AlpmList) as AlpmListNode;
    out.push(rec.data);
    node = rec.next;
  }
  return out;
}

/** Deep-copies a borrowed alpm_list_t of char* payloads into JS strings. Does not free `head`. */
export function copyStringList(head: Ptr): string[] {
  return walkList(head).map((ptr) => (ptr ? (koffi.decode.string(ptr) as string) : ""));
}

// --- alpm_list_t free discipline --------------------------------------------
//
// Mirrors native/src/marshal.h's AlpmListGuard: two distinct free operations
// exist and mixing them up is the likeliest leak/double-free bug in this
// layer too.
//  - SpineOnly (freeListSpineOnly): the spine is caller-owned but the void*
//    payload at each node is not (alpm_db_get_pkgcache, alpm_db_search's
//    `ret`) - or was built locally against a payload this module separately
//    owns and frees itself (buildStringList's koffi.alloc'd buffers).
//  - SpineAndPayload (freeListSpineAndPayload): both the spine and the
//    malloc'd char* payload at each node are caller-owned
//    (alpm_pkg_compute_requiredby/_optionalfor) - reproduces the FREELIST()
//    macro, which isn't itself an exported symbol we can call.

export function freeListSpineOnly(head: Ptr): void {
  if (head) alpm_list_free(head);
}

export function freeListSpineAndPayload(head: Ptr): void {
  for (const ptr of walkList(head)) {
    if (ptr) libc_free(ptr);
  }
  if (head) alpm_list_free(head);
}

// --- building a spine-only alpm_list_t<char*> from JS strings ---------------
//
// alpm_list_add only stores the pointer value, it doesn't copy the bytes
// behind it, and the resulting list is used *after* this call returns (by
// alpm_db_search / alpm_option_set_architectures) - so each string needs a
// stable (non-transient) allocation via koffi.alloc, not a plain Buffer.

export interface CStringList {
  head: Ptr;
  buffers: bigint[];
}

export function buildStringList(values: string[]): CStringList {
  let head: Ptr = null;
  const buffers: bigint[] = [];
  for (const value of values) {
    const encoded = Buffer.from(`${value}\0`, "utf8");
    const ptr = koffi.alloc("char", encoded.length) as bigint;
    new Uint8Array(koffi.view(ptr, encoded.length)).set(encoded);
    buffers.push(ptr);
    head = alpm_list_add(head, ptr) as Ptr;
  }
  return { head, buffers };
}

export function freeStringList(list: CStringList): void {
  if (list.head) alpm_list_free(list.head);
  for (const ptr of list.buffers) koffi.free(ptr);
}

// --- db resolution -----------------------------------------------------------

/** "local"/empty -> alpm_get_localdb(); else looked up by name among alpm_get_syncdbs(). */
export function resolveDb(handle: bigint, dbName: string): Ptr {
  if (!dbName || dbName === "local") {
    return alpm_get_localdb(handle) as Ptr;
  }
  for (const ptr of walkList(alpm_get_syncdbs(handle) as Ptr)) {
    if (ptr && alpm_db_get_name(ptr) === dbName) return ptr;
  }
  return null;
}

// --- dependency records --------------------------------------------------

export interface DependencyRecord {
  name: string;
  version: string;
  desc: string;
  mod: "" | "=" | ">=" | "<=" | ">" | "<";
}

// alpm_depmod_t (alpm.h): ANY=1, EQ=2, GE=3, LE=4, GT=5, LT=6.
const DEP_MOD: Record<number, DependencyRecord["mod"]> = {
  1: "",
  2: "=",
  3: ">=",
  4: "<=",
  5: ">",
  6: "<",
};

interface AlpmDependStruct {
  name: string | null;
  version: string | null;
  desc: string | null;
  mod: number;
}

export function marshalDependency(ptr: Ptr): DependencyRecord {
  if (!ptr) return { name: "", version: "", desc: "", mod: "" };
  const dep = koffi.decode(ptr, AlpmDepend) as AlpmDependStruct;
  return {
    name: orEmpty(dep.name),
    version: orEmpty(dep.version),
    desc: orEmpty(dep.desc),
    mod: DEP_MOD[dep.mod] ?? "",
  };
}

function depToDisplayString(ptr: Ptr): string {
  const dep = marshalDependency(ptr);
  return dep.mod ? `${dep.name}${dep.mod}${dep.version}` : dep.name;
}

// --- file records --------------------------------------------------------

export interface FileRecord {
  name: string;
  size: number;
  mode: number;
}

interface AlpmFilelistStruct {
  count: number | bigint;
  files: Ptr;
}

interface AlpmFileStruct {
  name: string | null;
  size: number | bigint;
  mode: number;
}

export function marshalFilelist(ptr: Ptr): FileRecord[] {
  if (!ptr) return [];
  const filelist = koffi.decode(ptr, AlpmFilelist) as AlpmFilelistStruct;
  const count = Number(filelist.count);
  if (count === 0 || !filelist.files) return [];
  const files = koffi.decode(filelist.files, AlpmFile, count) as AlpmFileStruct[];
  return files.map((f) => ({ name: orEmpty(f.name), size: Number(f.size), mode: f.mode }));
}

// --- package records -----------------------------------------------------

/** Deep-copies every requested field out of a live alpm_pkg_t* into a plain RawPackage. */
export function marshalPackage(pkg: bigint, fields: number, dbName: string): RawPackage {
  const rec: RawPackage = {};

  if (fields & FIELD_NAME) rec.name = orEmpty(alpm_pkg_get_name(pkg) as string | null);
  if (fields & FIELD_VERSION) rec.version = orEmpty(alpm_pkg_get_version(pkg) as string | null);
  if (fields & FIELD_DB) rec.db = dbName;
  if (fields & FIELD_ISIZE) rec.isize = Number(alpm_pkg_get_isize(pkg));
  if (fields & FIELD_REASON) rec.reason = alpm_pkg_get_reason(pkg) as number;

  if (fields & FIELD_DESC) rec.desc = orEmpty(alpm_pkg_get_desc(pkg) as string | null);
  if (fields & FIELD_URL) rec.url = orEmpty(alpm_pkg_get_url(pkg) as string | null);
  if (fields & FIELD_LICENSES) rec.licenses = copyStringList(alpm_pkg_get_licenses(pkg) as Ptr);
  if (fields & FIELD_GROUPS) rec.groups = copyStringList(alpm_pkg_get_groups(pkg) as Ptr);

  if (fields & FIELD_DEPENDS) {
    rec.depends = walkList(alpm_pkg_get_depends(pkg) as Ptr).map(marshalDependency);
  }
  if (fields & FIELD_OPTDEPENDS) {
    rec.optdepends = walkList(alpm_pkg_get_optdepends(pkg) as Ptr).map(marshalDependency);
  }
  if (fields & FIELD_PROVIDES) {
    rec.provides = walkList(alpm_pkg_get_provides(pkg) as Ptr).map(depToDisplayString);
  }
  if (fields & FIELD_CONFLICTS) {
    rec.conflicts = walkList(alpm_pkg_get_conflicts(pkg) as Ptr).map(depToDisplayString);
  }
  if (fields & FIELD_REPLACES) {
    rec.replaces = walkList(alpm_pkg_get_replaces(pkg) as Ptr).map(depToDisplayString);
  }

  if (fields & FIELD_PACKAGER) rec.packager = orEmpty(alpm_pkg_get_packager(pkg) as string | null);
  if (fields & FIELD_DATES) {
    rec.builddate = Number(alpm_pkg_get_builddate(pkg));
    rec.installdate = Number(alpm_pkg_get_installdate(pkg));
  }
  if (fields & FIELD_VALIDATION) rec.validation = alpm_pkg_get_validation(pkg) as number;

  if (fields & FIELD_FILES) rec.files = marshalFilelist(alpm_pkg_get_files(pkg) as Ptr);

  return rec;
}
