# alpm_ts — a TypeScript CLI over libalpm

## Context

`/home/tristan/DEV/alpm_ts` is empty; this is greenfield. The goal is a TypeScript CLI
that queries the Arch package database directly through **libalpm**, the C library
behind pacman, rather than by scraping `pacman` output.

Feasibility is confirmed on this machine:

- pacman 7.1.0 / **libalpm 16.0.1**, `/usr/lib/libalpm.so.16`
- `/usr/include/alpm.h` (3050 lines) + `/usr/include/alpm_list.h` installed
- `pkg-config --cflags --libs libalpm` → `-D_FILE_OFFSET_BITS=64 -DWITH_GZFILEOP -lalpm`
- node v24.20.0, npm 11.19.0, gcc/g++/make/python3 present
- `/var/lib/pacman/{local,sync}` are `0755 root` → **read-only queries need no root**
  (1345 local packages, 8 sync dbs on this system)

Decisions taken with the user:

| Decision | Choice |
|---|---|
| Binding | Native **N-API addon** (`node-addon-api` + `node-gyp`), `#include <alpm.h>` |
| v1 scope | **Read-only queries** — no transactions, no lock, no root |
| Privileges (later) | Unprivileged main process + **privileged helper** over JSON-RPC |
| Deliverable | **CLI tool**, modern subcommands (`alpm info firefox`), `--json` everywhere |

Intended outcome: `alpm list/info/search/files/deps/outdated` returning structured data
straight from libalpm, with the architecture already shaped so that `install`/`remove`/
`upgrade` can be added later behind a root helper without reworking layers 1–3.

---

## Three constraints that drive the design

These are the non-obvious facts that shape everything below. Confirmed against the
installed header, not assumed.

**1. libalpm does not parse `pacman.conf`.** Grepping `alpm.h` for `parse_config`,
`pacman.conf`, `alpm_config` returns nothing — config parsing lives in the pacman
*frontend*, not the library. `alpm_initialize()` takes only `root` and `dbpath`; every
sync repo must then be registered by hand with `alpm_register_syncdb(handle, name,
siglevel)`. **So we must write a `pacman.conf` parser in TypeScript.** It is a real,
required chunk of work, not an optional nicety — and on this machine it must handle
`Include =` with globs, since `/etc/pacman.conf` defines all 8 repos through
`Include = /etc/pacman.d/*-mirrorlist`.

**2. `alpm_handle_t` is not thread-safe.** `Napi::AsyncWorker` runs on the libuv
threadpool (4 threads by default), so two concurrent JS calls would race inside the same
handle. Every libalpm call must hold a per-handle `std::mutex`.

**3. `alpm_pkg_t*` from a db cache is owned by the db** and is freed by
`alpm_release()`. Handing raw pointers to JS invites use-after-free the moment a handle
is closed. We marshal to plain JS objects at the boundary instead (see Layer 1).

---

## Architecture

Four layers, each independently testable. The `Backend` interface at the layer 2/3 seam
is what makes the future privileged helper a drop-in.

```
src/cli/          commander subcommands, table + --json renderers
     │  calls
src/core/         Alpm class, pacman.conf parser, domain types (no N-API types leak)
     │  Backend interface  ◄── future: HelperBackend (JSON-RPC → root helper)
native/           C++ N-API addon: mutex-guarded AsyncWorkers over libalpm
     │  -lalpm
/usr/lib/libalpm.so.16
```

### Layer 1 — `native/` (C++ addon)

`binding.gyp` gets flags from pkg-config so an ABI bump only needs a rebuild:

```python
'cflags': ['<!@(pkg-config --cflags libalpm)'],
'libraries': ['<!@(pkg-config --libs libalpm)'],
'defines': ['ALPM_BUILD_VERSION="<!@(pkg-config --modversion libalpm)"'],
```

Files:
- `native/binding.gyp`
- `native/src/addon.cc` — module init, version guard
- `native/src/handle.cc/.h` — `Napi::ObjectWrap<Handle>`, owns `alpm_handle_t*` + `std::mutex`
- `native/src/marshal.cc/.h` — `alpm_pkg_t*` → `Napi::Object`, `alpm_list_t*` → `Napi::Array`
- `native/src/workers.cc` — one `AsyncWorker` per query

**Version guard.** At module load, compare the compile-time `ALPM_BUILD_VERSION` against
runtime `alpm_version()`. Differing major (soname) → throw with a "rebuild the addon"
message. This is the single most likely breakage: libalpm makes no ABI promise and bumps
soname roughly every pacman minor.

**Exposed surface (v1).** Free functions `version()`, `capabilities()`,
`vercmp(a, b)` (pure, sync). `Handle` methods, all returning Promises via
`AsyncWorker` + mutex:

| Method | libalpm calls |
|---|---|
| `open(root, dbpath)` / `close()` | `alpm_initialize` / `alpm_release` |
| `registerSyncDb(name, siglevel)` | `alpm_register_syncdb`, `alpm_db_set_usage` |
| `setArchitectures([...])` / `addIgnorePkg(x)` | `alpm_option_set_architectures`, `alpm_option_add_ignorepkg` |
| `listPackages(db, fields)` | `alpm_db_get_pkgcache` |
| `getPackage(db, name, fields)` | `alpm_db_get_pkg` |
| `search(dbs, needles[], fields)` | `alpm_db_search` (note: `int alpm_db_search(db, needles, alpm_list_t **ret)` — `ret` must start NULL, caller frees the outer list) |
| `owners(path)` | iterate localdb pkgcache × `alpm_pkg_get_files` / `alpm_filelist_t` |
| `requiredBy(name)` / `optionalFor(name)` | `alpm_pkg_compute_requiredby` / `_optionalfor` (both return caller-owned string lists — `FREELIST`) |
| `groups(db)` | `alpm_db_get_groupcache`, `alpm_group_t` |
| `newVersion(name)` | `alpm_sync_get_new_version` |
| `findSatisfier(dep)` | `alpm_find_dbs_satisfier` |
| `options()` | `alpm_option_get_root/dbpath/cachedirs/architectures/...` |

**Field selection, not lazy handles.** Marshaling all ~25 fields for 1345 packages on
every `list` is waste; lazy pointer wrappers are a dangling-pointer hazard (constraint 3).
So each query takes a `fields` bitmask. `FIELDS_SUMMARY` (name, version, db, isize,
reason) covers `list`/`search`; `FIELDS_FULL` adds desc/url/licenses/groups/depends/
optdepends/provides/conflicts/replaces/packager/dates/validation for `info`; `FIELDS_FILES`
pulls the filelist only when asked. Deps marshal as
`{name, version, desc, mod}` from `alpm_depend_t`, with `mod` mapped to a `'>='|'='|...`
string in TS.

Number care: `off_t` sizes and `alpm_time_t` exceed 2^31 — use `Napi::Number` for sizes
(safe well past any package size) and emit dates as **epoch seconds**, converting to
`Date` in TS.

### Layer 2 — `src/core/`

- **`src/core/config.ts`** — the `pacman.conf` parser (constraint 1). Recursive-descent
  over INI-ish sections; must support `Include =` with glob expansion (mirrorlists),
  `[options]` keys `RootDir`/`DBPath`/`CacheDir`/`HookDir`/`Architecture`/`IgnorePkg`/
  `IgnoreGroup`/`SigLevel`/`HoldPkg`, valueless directives (`Color`, `ILoveCandy`,
  `VerbosePkgLists`), and per-repo `Server`/`SigLevel`/`Usage`. `Architecture = auto`
  resolves via `os.machine()`. Include cycles must be bounded.
  Repo *order matters* — it is pacman's resolution priority.
  → `{options, repos: [{name, servers, sigLevel, usage}]}`
- **`src/core/siglevel.ts`** — the `SigLevel`/`Usage` word lists (`Required`,
  `DatabaseOptional`, `TrustAll`, …) → the `ALPM_SIG_*` / `ALPM_DB_USAGE_*` bitfields
  from `alpm.h:382` and `alpm.h:1444`. Words are cumulative and order-sensitive, and a
  repo with no `SigLevel` inherits `ALPM_SIG_USE_DEFAULT` (bit 30).
- **`src/core/backend.ts`** — `interface Backend` mirroring the addon surface. v1 ships
  `NativeBackend`; the root helper later ships `HelperBackend` behind the same interface.
- **`src/core/alpm.ts`** — `Alpm.open(configPath?)`: parse conf → `handle.open()` →
  register each repo in order → set architectures/ignores. Async-disposable
  (`Symbol.asyncDispose`) so `close()` is never missed. Domain methods
  (`list`, `info`, `search`, `owners`, `deps`, `outdated`) live here, **not** in the CLI —
  this is the reusable library.
- **`src/core/types.ts`** — `Package`, `Dependency`, `Repo`, `PacmanConfig`, enums for
  `reason` (explicit/dependency), `origin`, `validation`.
- **`src/core/errors.ts`** — map `alpm_errno_t` (the ~120-value enum at `alpm.h:206`) to
  an `AlpmError` subclass carrying `{code, name, message}` from `alpm_strerror`.

`outdated` is the one composite: for each local package call
`alpm_sync_get_new_version(pkg, syncdbs)`, skipping `alpm_pkg_should_ignore`.

### Layer 3 — `src/cli/`

`commander` for parsing; one file per command in `src/cli/commands/`:

| Command | Behavior |
|---|---|
| `list [--explicit] [--deps] [--unrequired] [--foreign] [--repo <r>]` | local db listing |
| `info <pkg...> [--sync]` | full fields; `--sync` looks in sync dbs |
| `search <regex...> [--repo <r>]` | `alpm_db_search` across sync dbs (`--local` for localdb) |
| `files <pkg>` / `owns <path>` | filelist / reverse file lookup |
| `deps <pkg> [--reverse] [--optional] [--tree]` | depends / requiredby / optionalfor |
| `outdated` | local vs sync version comparison |
| `groups [name]` / `repos` / `config` | groupcache / registered repos / effective options |

Global options: `--json`, `--root <dir>`, `--dbpath <dir>`, `--config <file>`,
`--no-color`. `--root`/`--dbpath` fall straight out of `alpm_initialize`'s signature and
make chroot/container inspection free.

- `src/cli/render/table.ts` — column layout, colorized, honors `NO_COLOR` and non-TTY
- `src/cli/render/json.ts` — one stable envelope shape for every command
- Exit codes: 0 ok, 1 not found, 2 usage error, 3 alpm error

### Layer 4 — build & test

`package.json`: `"type": "module"`, `tsc` to `dist/`, `bin: {"alpm": "dist/cli/index.js"}`,
`node-gyp rebuild` on `install`. Deps: `node-addon-api` (8.9.2), `commander`;
dev: `typescript`, `node-gyp` (13.0.2), `@types/node`. Build from source — no prebuilds;
the target is Arch, where a toolchain is a given and a soname bump *needs* a rebuild anyway.

**Fixture root for deterministic tests.** `alpm_initialize(root, dbpath)` accepts an
arbitrary root, and the local db format is trivially synthesizable — a directory per
package holding `desc`/`files`, plus an `ALPM_DB_VERSION` file containing `9` (verified
against `/var/lib/pacman/local`). `test/fixtures/build-root.ts` writes ~10 fake packages
with known deps/conflicts/groups so assertions are exact. Sync-db tests copy a real
`.db` tarball into the fixture's `sync/`.

Tests (`node:test`): config-parser unit tests (real `/etc/pacman.conf` + synthetic
Include-glob and cycle cases); siglevel/usage bitfield tables; native queries against the
fixture root; a smoke suite against the real system db (assert only invariants — count
> 0, `pacman` is installed — never exact versions).

---

## Build sequence

1. **Scaffold** — `package.json`, `tsconfig.json`, `.gitignore`, `git init`.
2. **Addon walking skeleton** — `binding.gyp` + `version()`/`vercmp()` only. Proves
   pkg-config, node-gyp and N-API wiring before any real complexity. Verify:
   `node -e "console.log(require('./build/Release/alpm.node').version())"` → `16.0.1`.
3. **Handle lifecycle** — `open`/`close`/`options`, ObjectWrap + mutex + finalizer +
   version guard. Verify with `--dbpath /var/lib/pacman`.
4. **`config.ts`** — pure TS, testable with zero native code. Verify it recovers all 8
   repos from the real `/etc/pacman.conf` in the right order, resolving the CachyOS
   `Include` mirrorlists.
5. **Query workers + marshaling** — `listPackages`, `getPackage`, `search`, field masks.
   Biggest single chunk; land `listPackages` end-to-end first as the template.
6. **`Alpm` domain class** — wire config → registration → queries.
7. **CLI** — `list`, `info`, `search` first, then `files`/`owns`/`deps`/`outdated`/
   `groups`/`repos`/`config`.
8. **Tests + README** — fixture root, unit + smoke suites, documented build prerequisites.

---

## Deliberately out of scope for v1

Left out, but the seams are in place: transactions (`alpm_trans_init/prepare/commit`),
the root helper, db update (`alpm_db_update`), download/event/progress/question callbacks,
AUR. The two hard problems waiting there, worth naming now so layer 2 isn't shaped wrong:

- **`alpm_cb_question` demands a synchronous answer** (`alpm.h:1114` — the callback writes
  its reply into a field of the `alpm_question_t` union and returns). JS cannot answer
  synchronously from another thread, so it needs either a blocking ThreadSafeFunction with
  a condition variable, or a declarative up-front policy object. The `Backend` interface
  should carry a `policy` argument from the start so this doesn't force a redesign.
- **Transactions want a single long-lived owner thread**, not the libuv pool, because
  event/progress/download callbacks fire throughout `alpm_trans_commit` and
  `alpm_trans_interrupt` is called cross-thread. The v1 per-handle mutex is the seam:
  swap mutex-guarded AsyncWorkers for a dedicated thread with a command queue.

---

## Verification

End-to-end, after step 7 — each checked against the real system:

```bash
npm install && npm run build          # node-gyp rebuild + tsc

node -e "const a=require('./build/Release/alpm.node');console.log(a.version())"
                                      # → 16.0.1, matches `pacman --version`

./bin/alpm repos                      # → 8 repos, cachyos-znver4 … multilib, in conf order
./bin/alpm list | wc -l               # → 1345, must equal `pacman -Q | wc -l`
./bin/alpm info pacman --json | jq .version
                                      # → 7.1.0.r9.g54d9411-4, matches `pacman -Q pacman`
./bin/alpm search '^rust-' | head     # compare against `pacman -Ss '^rust-'`
./bin/alpm owns /usr/bin/which        # → which 2.25-1.1, matches `pacman -Qo`
./bin/alpm deps pacman --reverse      # compare against `pacman -Qi pacman` Required By
./bin/alpm outdated                   # compare against `pacman -Qu` (no -Sy first)
./bin/alpm list --root /tmp/fixture --dbpath /tmp/fixture/var/lib/pacman
                                      # fixture root resolves independently of the host

npm test                              # config parser, siglevel tables, fixture queries, smoke
id -u                                 # confirm every command above ran as non-root
```

Two properties to assert explicitly, since both are silent when broken: no command
prompts for or requires root, and no `/var/lib/pacman/db.lck` is ever created
(`test ! -e /var/lib/pacman/db.lck` after the suite).
