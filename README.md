# alpm-ts

A TypeScript CLI that queries the Arch package database directly through
**libalpm** (the C library behind pacman), rather than by scraping `pacman`
output. Read-only queries only — `list`, `info`, `search`, `files`, `owns`,
`deps`, `outdated`, `groups`, `repos`, `config` — no root required.

## Prerequisites

- Arch Linux (or an Arch derivative) with pacman/libalpm installed
- `libalpm.so` and its headers (`alpm.h`, `alpm_list.h`) — normally already
  present alongside `pacman`; on some distros they ship in a `pacman-libalpm`
  or `libalpm-dev`-style package
- `pkg-config`
- A C++17 toolchain (gcc/g++ or clang) and `make`, for building the native
  addon
- Node.js **>= 23.6** (the CLI runs `.ts` sources directly via Node's native
  type-stripping — no separate compile step) and npm

## Install

```bash
npm install   # also runs node-gyp rebuild --directory=native
```

The native addon is built from source against whatever `libalpm` version is
installed — there are no prebuilt binaries, since libalpm makes no ABI
promise across versions (it bumps its soname roughly every pacman minor). If
you upgrade pacman/libalpm to a new major version, rebuild with
`npm rebuild alpm-ts`; the addon checks the libalpm major version at load
time and throws a clear error if it doesn't match what it was built against.

## Usage

```bash
./src/cli/index.ts repos                      # registered sync repos, in resolution order
./src/cli/index.ts list                       # installed packages
./src/cli/index.ts list --explicit            # only explicitly installed
./src/cli/index.ts list --unrequired          # orphans (matches `pacman -Qdt`)
./src/cli/index.ts info pacman                # full details for an installed package
./src/cli/index.ts info firefox --sync        # look up in sync repos instead
./src/cli/index.ts search '^rust-' --repo extra
./src/cli/index.ts files which                # files owned by an installed package
./src/cli/index.ts owns /usr/bin/which        # which package owns a file
./src/cli/index.ts deps pacman                # forward dependencies
./src/cli/index.ts deps pacman --reverse      # what depends on it
./src/cli/index.ts deps pacman --tree         # recursive dependency tree
./src/cli/index.ts outdated                   # local vs sync version comparison
./src/cli/index.ts groups                     # package groups
./src/cli/index.ts config                     # effective configuration
```

Every command supports `--json` for structured output, and `--root`/
`--dbpath`/`--config` to point at an alternate root, pacman database, or
`pacman.conf` (useful for inspecting a chroot or container without entering
it). `--no-color` (or the `NO_COLOR` env var) disables colored table output.

Exit codes: `0` success, `1` not found, `2` usage error, `3` alpm error (the
real `alpm_errno_t` code is included in `--json` error output).

If you install this package globally or link it, the `alpm` bin resolves to
`src/cli/index.ts` directly (see `bin` in `package.json`) — no build step is
involved.

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

libalpm does not parse `pacman.conf` itself (that's a pacman-frontend
concern) — `src/core/config.ts` is a from-scratch parser, including
`Include =` with glob expansion. See `PLAN.md` for the full design rationale
and the constraints that shaped it.

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

## Out of scope for v1

Transactions, package installation/removal, `alpm_db_update` (syncing repo
databases), and AUR support are deliberately left out — the architecture
(a `Backend` interface between the CLI/domain layer and the native addon)
is shaped so a privileged helper process could add them later without
reworking the read-only query layers.
