// alpm_pkgreason_t (alpm.h): EXPLICIT=0, DEPEND=1, UNKNOWN=2.
export type PackageReason = "explicit" | "dependency" | "unknown";

// alpm_pkgvalidation_t is a bitmask (NONE=1, MD5SUM=2, SHA256SUM=4, SIGNATURE=8);
// 0 means unknown/unset.
export type ValidationMethod = "none" | "md5sum" | "sha256sum" | "signature";

export interface Dependency {
  name: string;
  version: string;
  desc: string;
  mod: "" | "=" | ">=" | "<=" | ">" | "<";
}

export interface FileEntry {
  name: string;
  size: number;
  mode: number;
}

export interface Package {
  name: string;
  version: string;
  db: string;
  isize: number;
  reason: PackageReason;
  desc?: string;
  url?: string;
  licenses?: string[];
  groups?: string[];
  depends?: Dependency[];
  optdepends?: Dependency[];
  provides?: string[];
  conflicts?: string[];
  replaces?: string[];
  packager?: string;
  builddate?: Date;
  installdate?: Date;
  validation?: ValidationMethod[];
  files?: FileEntry[];
}

export interface Group {
  name: string;
  packages: string[];
}

/** Raw shape returned across the N-API boundary before domain mapping. */
export interface RawPackage {
  name?: string;
  version?: string;
  db?: string;
  isize?: number;
  reason?: number;
  desc?: string;
  url?: string;
  licenses?: string[];
  groups?: string[];
  depends?: Dependency[];
  optdepends?: Dependency[];
  provides?: string[];
  conflicts?: string[];
  replaces?: string[];
  packager?: string;
  builddate?: number;
  installdate?: number;
  validation?: number;
  files?: FileEntry[];
}

const REASONS: PackageReason[] = ["explicit", "dependency", "unknown"];

function decodeReason(reason: number | undefined): PackageReason {
  return REASONS[reason ?? 2] ?? "unknown";
}

function decodeValidation(bitmask: number | undefined): ValidationMethod[] {
  if (bitmask === undefined) return [];
  const methods: ValidationMethod[] = [];
  if (bitmask === 0) return methods;
  if (bitmask & (1 << 0)) methods.push("none");
  if (bitmask & (1 << 1)) methods.push("md5sum");
  if (bitmask & (1 << 2)) methods.push("sha256sum");
  if (bitmask & (1 << 3)) methods.push("signature");
  return methods;
}

/** Epoch seconds (0 means "not set") -> Date, matching what marshal.cc emits. */
function decodeDate(epochSeconds: number | undefined): Date | undefined {
  return epochSeconds === undefined || epochSeconds === 0 ? undefined : new Date(epochSeconds * 1000);
}

export function mapPackage(raw: RawPackage): Package {
  const pkg: Package = {
    name: raw.name ?? "",
    version: raw.version ?? "",
    db: raw.db ?? "",
    isize: raw.isize ?? 0,
    reason: decodeReason(raw.reason),
  };
  if (raw.desc !== undefined) pkg.desc = raw.desc;
  if (raw.url !== undefined) pkg.url = raw.url;
  if (raw.licenses !== undefined) pkg.licenses = raw.licenses;
  if (raw.groups !== undefined) pkg.groups = raw.groups;
  if (raw.depends !== undefined) pkg.depends = raw.depends;
  if (raw.optdepends !== undefined) pkg.optdepends = raw.optdepends;
  if (raw.provides !== undefined) pkg.provides = raw.provides;
  if (raw.conflicts !== undefined) pkg.conflicts = raw.conflicts;
  if (raw.replaces !== undefined) pkg.replaces = raw.replaces;
  if (raw.packager !== undefined) pkg.packager = raw.packager;
  if (raw.builddate !== undefined) pkg.builddate = decodeDate(raw.builddate);
  if (raw.installdate !== undefined) pkg.installdate = decodeDate(raw.installdate);
  if (raw.validation !== undefined) pkg.validation = decodeValidation(raw.validation);
  if (raw.files !== undefined) pkg.files = raw.files;
  return pkg;
}
