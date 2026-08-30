# alpm-ts

**A TypeScript CLI that queries the Arch package database straight through libalpm.**

No `pacman` output-scraping, no root, no writes. `alpm-ts` talks to the same
C library pacman itself is built on (`libalpm`), via a small native addon,
and gives you structured, scriptable, `--json`-able access to the same data
`pacman -Q`/`-Ss`/`-Qi`/etc. show you.

## Table of contents

- [Requirements](#requirements)
- [Building from source](#building-from-source)
- [Usage](#usage)
  - [Commands](#commands)
  - [Global options](#global-options)
  - [Exit codes](#exit-codes)
- [Architecture](#architecture)
- [Development](#development)
  - [Maintenance: tracking libalpm's API surface](#maintenance-tracking-libalpms-api-surface)
- [Roadmap / out of scope](#roadmap--out-of-scope)
- [License](#license)

## Requirements

| Requirement | Why |
|---|---|
| Arch Linux (or an Arch derivative) | `pacman`/`libalpm` need to actually be installed |
| `libalpm.so` + headers (`alpm.h`, `alpm_list.h`) | Usually already present alongside `pacman`; some distros split them into a `libalpm-dev`/`pacman-libalpm`-style package |
| `pkg-config` | `binding.gyp` reads libalpm's cflags/libs/version from it |
| A C++17 toolchain (gcc/g++ or clang) + `make` | Builds the native addon — there is no prebuilt binary |
| Node.js **>= 23.6** + npm | The CLI runs `.ts` sources directly via Node's native type-stripping — no compile step |

## Building from source

There are no prebuilt binaries for the native addon — it's compiled from
source, on your machine, against whatever `libalpm` you actually have
installed. That's deliberate: libalpm makes no ABI promise and bumps its
soname roughly every pacman minor release, so a binary built elsewhere could
silently be wrong for your system. The target is Arch, where a C++ toolchain
is a reasonable thing to assume.

1. **Install the toolchain**, if you don't already have one:

   ```bash
   sudo pacman -S --needed base-devel pkgconf nodejs npm
   ```

2. **From the project directory, install dependencies:**

   ```bash
   npm install
   ```

   `npm install`'s `install` script runs `node-gyp rebuild --directory=native`,
   which:
   - asks `pkg-config` for libalpm's `--cflags`, `--libs`, and `--modversion`
   - compiles `native/src/*.cc` against `#include <alpm.h>` with C++17
   - links the result into `native/build/Release/alpm.node`

3. **Verify the build** — this should print your installed libalpm version
   (matches `pacman --version`):

   ```bash
   node -e "console.log(require('./native/build/Release/alpm.node').version())"
   ```

4. **Run it:**

   ```bash
   ./src/cli/index.ts repos
   ```

   No separate compile step for the TypeScript — Node runs `.ts` files
   directly (see [Architecture](#architecture)).

### Rebuilding after a pacman/libalpm upgrade — automatic

The addon checks the compiled-against libalpm major version against the
runtime one every time it loads. If they differ (a soname bump) — or the
addon simply hasn't been built yet — any `alpm` command self-heals: it
prints a one-line notice to stderr, rebuilds via `node-gyp`, and re-runs
itself so the original command still completes:

```
alpm-ts: libalpm changed (built against 16.0.1, now 17.0.0) - rebuilding native addon...
<build output>
<your command's normal output>
```

This costs one slightly slower run right after an upgrade; every run after
that is unaffected. Set `ALPM_TS_NO_AUTO_REBUILD=1` to disable it and get
the old fail-with-a-message behavior instead (useful in CI, sandboxes
without a C++ toolchain, or a read-only filesystem) — you'd then run
`npm rebuild alpm-ts` yourself.

## Usage

### Commands

| Command | Description |
|---|---|
| `list` | List installed packages. `--explicit`, `--deps`, `--unrequired` (orphans, matches `pacman -Qdt`), `--foreign`, `--repo <name>` |
| `info <packages...>` | Full package details. `--sync` to look in sync repos instead of local, `--repo <name>` to restrict which one |
| `search <patterns...>` | Regex search across sync repos (or `--local` for the local db). `--repo <name>` to restrict to one repo |
| `files <package>` | List the files owned by an installed package |
| `owns <path>` | Find which installed package owns a file path |
| `deps <package>` | Forward dependencies. `--reverse` (what depends on it), `--optional`, `--tree` (recursive graph) |
| `outdated` | Installed packages with a newer version in a registered sync repo |
| `groups [name]` | List package groups, or the members of one. `--repo <name>` |
| `repos` | List registered sync repos, in resolution priority order |
| `config` | Show the effective configuration (parsed `pacman.conf` merged with native handle state) |

```bash
./src/cli/index.ts repos
./src/cli/index.ts list --explicit
./src/cli/index.ts list --unrequired
./src/cli/index.ts info pacman
./src/cli/index.ts info firefox --sync
./src/cli/index.ts search '^rust-' --repo extra
./src/cli/index.ts files which
./src/cli/index.ts owns /usr/bin/which
./src/cli/index.ts deps pacman --reverse
./src/cli/index.ts deps pacman --tree
./src/cli/index.ts outdated
./src/cli/index.ts groups
./src/cli/index.ts config
```

If you install this package globally or link it, the `alpm` bin resolves to
`src/cli/index.ts` directly (see `bin` in `package.json`) — still no build
step involved.

### Global options

| Option | Effect |
|---|---|
| `--json` | Structured JSON instead of a table (one stable envelope shape for every command) |
| `--root <dir>` | Alternate root directory |
| `--dbpath <dir>` | Alternate pacman database path |
| `--config <file>` | Alternate `pacman.conf` path |
| `--no-color` | Disable colored table output (also respects `NO_COLOR`) |

`--root`/`--dbpath`/`--config` make it free to inspect a chroot or container
without entering it.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Not found (package, path, or group) |
| `2` | Usage error |
| `3` | libalpm error — the real `alpm_errno_t` code is included in `--json` error output |

## Architecture

```
src/cli/          commander subcommands, table + --json renderers
     |  calls
src/core/         Alpm class, pacman.conf parser, domain types
     |  Backend interface
native/           C++ N-API addon: mutex-guarded AsyncWorkers over libalpm
     |  -lalpm
libalpm.so
```

A detail worth knowing if you're reading the source: **libalpm does not
parse `pacman.conf`** — that's a pacman-frontend concern, not the library's.
`src/core/config.ts` is a from-scratch parser (including `Include =` with
glob expansion), and `src/core/alpm.ts` registers each sync repo by hand
against the native handle.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # config parser, siglevel tables, fixture-root queries, real-system smoke tests
```

Tests run directly against the real system's `/etc/pacman.conf` and
`/var/lib/pacman` (read-only, asserting only invariants — never exact
counts or versions, since those vary by machine) plus a synthetic fixture
local db (`test/fixtures/build-root.ts`) for exact, deterministic
assertions independent of the host's package state.

### Maintenance: tracking libalpm's API surface

libalpm exports far more than this read-only tool wraps (~225 functions vs.
46 today — the rest is transactions, callbacks, and write operations this
CLI deliberately doesn't do). After a pacman upgrade that bumps libalpm's
minor/patch version enough to introduce new functions, run:

```bash
npm run check-alpm-coverage
```

It diffs the installed `alpm.h` against a checked-in baseline
(`scripts/alpm-coverage-baseline.json`) and `native/src/*.cc`'s actual
usage, and prints what's genuinely new since the baseline was last taken,
separately from the (much longer, mostly-intentionally-skipped) full
unwrapped list. **It reports, it doesn't generate anything** — wiring up a
new libalpm call correctly means a human deciding its mutex/thread-safety
story and `alpm_list_t` ownership (`alpm_list_free` vs. `FREELIST`, see
`native/src/marshal.h`'s `AlpmListGuard`), which can't be inferred from a C
signature. After reviewing a diff, run
`npm run check-alpm-coverage -- --update-baseline` to reset it.

## Roadmap / out of scope

Transactions, package installation/removal, `alpm_db_update` (syncing repo
databases), and AUR support are deliberately left out of this read-only
tool — the architecture (a `Backend` interface between the CLI/domain layer
and the native addon) is shaped so a privileged helper process could add
them later without reworking the read-only query layers.

## License

MIT
