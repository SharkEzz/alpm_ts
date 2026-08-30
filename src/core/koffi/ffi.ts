import koffi from 'koffi';
import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';

// libalpm has no split runtime/dev packages on Arch (pacman ships alpm.h
// too), so /usr/lib/libalpm.so - the unversioned symlink normally reserved
// for -dev packages - is present on every Arch install. Some systems only
// ship the versioned soname, so fall back to scanning ldconfig for it.
function resolveLibalpmPath(): string {
  for (const candidate of ['/usr/lib/libalpm.so', '/usr/lib64/libalpm.so', '/lib/libalpm.so']) {
    try {
      accessSync(candidate, constants.R_OK);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  try {
    const out = execFileSync('/sbin/ldconfig', ['-p'], { encoding: 'utf8' });
    const match = out.match(/libalpm\.so\.\d+\s.*=>\s*(\S+)/);
    if (match) return match[1];
  } catch {
    // fall through to the error below
  }
  throw new Error('libalpm shared library not found (looked for libalpm.so and scanned `ldconfig -p`)');
}

const lib = koffi.load(resolveLibalpmPath());
const libc = koffi.load('libc.so.6');

// --- opaque handle types -----------------------------------------------
// alpm_handle_t/alpm_db_t/alpm_pkg_t are forward-declared-only in alpm.h -
// every real addon (native or FFI) only ever touches them through pointers
// passed to accessor functions, never by reading struct fields directly.
// Represented by koffi as BigInt pointer values.
koffi.opaque('alpm_handle_t');
koffi.opaque('alpm_db_t');
koffi.opaque('alpm_pkg_t');

// --- alpm_list_t: self-referential intrusive linked list (alpm_list.h) ---
export const AlpmList = koffi.struct('alpm_list_t', {
  data: 'void *',
  prev: 'alpm_list_t *',
  next: 'alpm_list_t *',
});

// --- value structs (alpm.h) ------------------------------------------------
export const AlpmDepend = koffi.struct('alpm_depend_t', {
  name: 'char *',
  version: 'char *',
  desc: 'char *',
  name_hash: 'unsigned long',
  mod: 'int', // alpm_depmod_t
});

// off_t/mode_t are 'long'/'unsigned int' on glibc Linux (both LP64
// x86_64 and aarch64), matching the int64_t/uint32_t casts the old native
// addon used in marshal.cc.
export const AlpmFile = koffi.struct('alpm_file_t', {
  name: 'char *',
  size: 'int64_t',
  mode: 'uint32_t',
});

export const AlpmFilelist = koffi.struct('alpm_filelist_t', {
  count: 'size_t',
  files: 'alpm_file_t *',
});

export const AlpmGroup = koffi.struct('alpm_group_t', {
  name: 'char *',
  packages: 'alpm_list_t *',
});

// --- free functions (alpm.h) ------------------------------------------------
export const alpm_version = lib.func('const char *alpm_version(void)');
export const alpm_capabilities = lib.func('int alpm_capabilities(void)');
export const alpm_pkg_vercmp = lib.func('int alpm_pkg_vercmp(const char *a, const char *b)');
export const alpm_strerror = lib.func('const char *alpm_strerror(int err)');

// --- handle lifecycle --------------------------------------------------------
export const alpm_initialize = lib.func(
  'alpm_handle_t *alpm_initialize(const char *root, const char *dbpath, _Out_ int *err)',
);
export const alpm_release = lib.func('int alpm_release(alpm_handle_t *handle)');
export const alpm_errno = lib.func('int alpm_errno(alpm_handle_t *handle)');

// --- options -------------------------------------------------------------
export const alpm_option_get_root = lib.func('const char *alpm_option_get_root(alpm_handle_t *handle)');
export const alpm_option_get_dbpath = lib.func('const char *alpm_option_get_dbpath(alpm_handle_t *handle)');
export const alpm_option_get_cachedirs = lib.func(
  'alpm_list_t *alpm_option_get_cachedirs(alpm_handle_t *handle)',
);
export const alpm_option_get_architectures = lib.func(
  'alpm_list_t *alpm_option_get_architectures(alpm_handle_t *handle)',
);
export const alpm_option_set_architectures = lib.func(
  'int alpm_option_set_architectures(alpm_handle_t *handle, alpm_list_t *arches)',
);
export const alpm_option_add_ignorepkg = lib.func(
  'void alpm_option_add_ignorepkg(alpm_handle_t *handle, const char *pkg)',
);

// --- db access ---------------------------------------------------------------
export const alpm_get_localdb = lib.func('alpm_db_t *alpm_get_localdb(alpm_handle_t *handle)');
export const alpm_get_syncdbs = lib.func('alpm_list_t *alpm_get_syncdbs(alpm_handle_t *handle)');
export const alpm_register_syncdb = lib.func(
  'alpm_db_t *alpm_register_syncdb(alpm_handle_t *handle, const char *treename, int level)',
);
export const alpm_db_set_usage = lib.func('int alpm_db_set_usage(alpm_db_t *db, int usage)');
export const alpm_db_get_name = lib.func('const char *alpm_db_get_name(alpm_db_t *db)');
export const alpm_db_get_pkg = lib.func('alpm_pkg_t *alpm_db_get_pkg(alpm_db_t *db, const char *name)');
export const alpm_db_get_pkgcache = lib.func('alpm_list_t *alpm_db_get_pkgcache(alpm_db_t *db)');
export const alpm_db_get_groupcache = lib.func('alpm_list_t *alpm_db_get_groupcache(alpm_db_t *db)');
export const alpm_db_search = lib.func(
  'int alpm_db_search(alpm_db_t *db, alpm_list_t *needles, _Out_ alpm_list_t **ret)',
);

// --- package accessors -------------------------------------------------------
export const alpm_pkg_get_name = lib.func('const char *alpm_pkg_get_name(alpm_pkg_t *pkg)');
export const alpm_pkg_get_version = lib.func('const char *alpm_pkg_get_version(alpm_pkg_t *pkg)');
export const alpm_pkg_get_desc = lib.func('const char *alpm_pkg_get_desc(alpm_pkg_t *pkg)');
export const alpm_pkg_get_url = lib.func('const char *alpm_pkg_get_url(alpm_pkg_t *pkg)');
export const alpm_pkg_get_builddate = lib.func('int64_t alpm_pkg_get_builddate(alpm_pkg_t *pkg)');
export const alpm_pkg_get_installdate = lib.func('int64_t alpm_pkg_get_installdate(alpm_pkg_t *pkg)');
export const alpm_pkg_get_packager = lib.func('const char *alpm_pkg_get_packager(alpm_pkg_t *pkg)');
export const alpm_pkg_get_isize = lib.func('int64_t alpm_pkg_get_isize(alpm_pkg_t *pkg)');
export const alpm_pkg_get_reason = lib.func('int alpm_pkg_get_reason(alpm_pkg_t *pkg)');
export const alpm_pkg_get_licenses = lib.func('alpm_list_t *alpm_pkg_get_licenses(alpm_pkg_t *pkg)');
export const alpm_pkg_get_groups = lib.func('alpm_list_t *alpm_pkg_get_groups(alpm_pkg_t *pkg)');
export const alpm_pkg_get_depends = lib.func('alpm_list_t *alpm_pkg_get_depends(alpm_pkg_t *pkg)');
export const alpm_pkg_get_optdepends = lib.func('alpm_list_t *alpm_pkg_get_optdepends(alpm_pkg_t *pkg)');
export const alpm_pkg_get_conflicts = lib.func('alpm_list_t *alpm_pkg_get_conflicts(alpm_pkg_t *pkg)');
export const alpm_pkg_get_provides = lib.func('alpm_list_t *alpm_pkg_get_provides(alpm_pkg_t *pkg)');
export const alpm_pkg_get_replaces = lib.func('alpm_list_t *alpm_pkg_get_replaces(alpm_pkg_t *pkg)');
export const alpm_pkg_get_validation = lib.func('int alpm_pkg_get_validation(alpm_pkg_t *pkg)');
export const alpm_pkg_get_files = lib.func('alpm_filelist_t *alpm_pkg_get_files(alpm_pkg_t *pkg)');
export const alpm_pkg_get_db = lib.func('alpm_db_t *alpm_pkg_get_db(alpm_pkg_t *pkg)');
export const alpm_pkg_compute_requiredby = lib.func(
  'alpm_list_t *alpm_pkg_compute_requiredby(alpm_pkg_t *pkg)',
);
export const alpm_pkg_compute_optionalfor = lib.func(
  'alpm_list_t *alpm_pkg_compute_optionalfor(alpm_pkg_t *pkg)',
);
export const alpm_sync_get_new_version = lib.func(
  'alpm_pkg_t *alpm_sync_get_new_version(alpm_pkg_t *pkg, alpm_list_t *dbs_sync)',
);
export const alpm_filelist_contains = lib.func(
  'alpm_file_t *alpm_filelist_contains(alpm_filelist_t *filelist, const char *path)',
);

// --- alpm_list_t construction/teardown (alpm_list.h) ------------------------
export const alpm_list_add = lib.func('alpm_list_t *alpm_list_add(alpm_list_t *list, void *data)');
export const alpm_list_free = lib.func('void alpm_list_free(alpm_list_t *list)');
// The FREELIST() macro (alpm_list_free_inner(p, free) + alpm_list_free(p))
// isn't callable directly since it's a macro, not an exported symbol - we
// reproduce it in marshal.ts by freeing each payload with libc free()
// ourselves before freeing the spine.
export const libc_free = libc.func('void free(void *ptr)');

// libalpm makes no ABI promise across major versions and bumps its soname on
// most pacman minors, but unlike the old native addon there is no
// compile-time link to go stale - every call here is a plain accessor
// function through an opaque pointer, so a soname bump alone can't corrupt
// anything the way a struct-layout assumption could. This is a best-effort
// heads-up, not a hard failure.
const SUPPORTED_MAJOR = 16; // `pkg-config --modversion libalpm` was 16.0.1 when this binding was written (2026-08-30)
let versionWarned = false;

export function checkVersion(): void {
  if (versionWarned) return;
  const runtime = alpm_version();
  if (typeof runtime !== 'string') {
    versionWarned = true;
    process.stderr.write('Unable to get the alpm version');
    return undefined;
  }
  const major = Number.parseInt((runtime ?? '').split('.')[0] ?? '', 10);
  if (Number.isFinite(major) && major !== SUPPORTED_MAJOR) {
    versionWarned = true;
    process.stderr.write(
      `alpm-ts: koffi backend was written against libalpm ${SUPPORTED_MAJOR}.x, runtime is ${runtime} - ` +
        'accessor-only FFI bindings should keep working across a soname bump, but flagging it in case something looks wrong.\n',
    );
  }
}

checkVersion();
