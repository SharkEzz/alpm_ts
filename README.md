# alpm-ts

**A TypeScript CLI that queries the Arch package database straight through libalpm.**

No `pacman` output-scraping, no root, no writes. `alpm-ts` talks to the same
C library pacman itself is built on (`libalpm`), via [koffi](https://koffi.dev)
FFI bindings straight into `libalpm.so`, and gives you structured,
scriptable, `--json`-able access to the same data `pacman -Q`/`-Ss`/`-Qi`/etc.
show you.

## Table of contents

- [Requirements](#requirements)
- [Install and run](#install-and-run)
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

| Requirement                        | Why                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arch Linux (or an Arch derivative) | `pacman`/`libalpm` need to actually be installed                                                                                                                                      |
| `libalpm.so`                       | koffi loads it directly at runtime (`dlopen`) — no headers needed. `alpm.h` is only used by the optional `pnpm check-alpm-coverage` maintenance script, not at runtime                |
| Node.js **>= 24.0** + pnpm         | koffi ships a prebuilt binary per platform, so `pnpm install` needs no compiler. The CLI also runs `.ts` sources directly via Node's native type-stripping — no compile step anywhere |

## Install and run

```bash
pnpm install
./src/cli/index.ts repos
```

No compiler, no build step — `pnpm install` just pulls dependencies (koffi's
own native glue ships prebuilt), and Node runs the `.ts` sources directly
(see [Architecture](#architecture)).

### libalpm version drift

libalpm makes no ABI promise and bumps its soname roughly every pacman minor
release. Since the koffi bindings only ever touch `alpm_handle_t`/`alpm_db_t`/
`alpm_pkg_t` as opaque pointers through accessor functions (never by reading
struct fields directly), a soname bump can't silently corrupt anything the
way a stale compiled struct-layout assumption could — there's simply no
compiled artifact to go stale, since `libalpm.so` is loaded at runtime every
time. As a heads-up rather than a hard requirement, `src/core/koffi/ffi.ts`
checks the runtime `alpm_version()` against the major version this binding
was written against, and prints a one-line stderr notice (once per process)
if they differ — informational only, not a failure.

## Usage

### Commands

| Command                | Description                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `list`                 | List installed packages. `--explicit`, `--deps`, `--unrequired` (orphans, matches `pacman -Qdt`), `--foreign`, `--repo <name>` |
| `info <packages...>`   | Full package details. `--sync` to look in sync repos instead of local, `--repo <name>` to restrict which one                   |
| `search <patterns...>` | Regex search across sync repos (or `--local` for the local db). `--repo <name>` to restrict to one repo                        |
| `files <package>`      | List the files owned by an installed package                                                                                   |
| `owns <path>`          | Find which installed package owns a file path                                                                                  |
| `deps <package>`       | Forward dependencies. `--reverse` (what depends on it), `--optional`, `--tree` (recursive graph)                               |
| `outdated`             | Installed packages with a newer version in a registered sync repo                                                              |
| `groups [name]`        | List package groups, or the members of one. `--repo <name>`                                                                    |
| `repos`                | List registered sync repos, in resolution priority order                                                                       |
| `config`               | Show the effective configuration (parsed `pacman.conf` merged with libalpm handle state)                                       |

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

| Option            | Effect                                                                           |
| ----------------- | -------------------------------------------------------------------------------- |
| `--json`          | Structured JSON instead of a table (one stable envelope shape for every command) |
| `--root <dir>`    | Alternate root directory                                                         |
| `--dbpath <dir>`  | Alternate pacman database path                                                   |
| `--config <file>` | Alternate `pacman.conf` path                                                     |
| `--no-color`      | Disable colored table output (also respects `NO_COLOR`)                          |

`--root`/`--dbpath`/`--config` make it free to inspect a chroot or container
without entering it.

### Exit codes

| Code | Meaning                                                                           |
| ---- | --------------------------------------------------------------------------------- |
| `0`  | Success                                                                           |
| `1`  | Not found (package, path, or group)                                               |
| `2`  | Usage error                                                                       |
| `3`  | libalpm error — the real `alpm_errno_t` code is included in `--json` error output |

## Architecture

```
src/cli/          commander subcommands, table + --json renderers
     |  calls
src/core/         Alpm class, pacman.conf parser, domain types
     |  Backend interface
src/core/koffi/   koffi FFI bindings over libalpm - no build step
     |  dlopen
libalpm.so
```

A detail worth knowing if you're reading the source: **libalpm does not
parse `pacman.conf`** — that's a pacman-frontend concern, not the library's.
`src/core/config.ts` is a from-scratch parser (including `Include =` with
glob expansion), and `src/core/alpm.ts` registers each sync repo by hand
against the libalpm handle.

## Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # oxlint
pnpm fmt         # oxfmt --check
pnpm test        # config parser, siglevel tables, fixture-root queries, real-system smoke tests
```

Tests run directly against the real system's `/etc/pacman.conf` and
`/var/lib/pacman` (read-only, asserting only invariants — never exact
counts or versions, since those vary by machine) plus a synthetic fixture
local db (`test/fixtures/build-root.ts`) for exact, deterministic
assertions independent of the host's package state.

### Maintenance: tracking libalpm's API surface

libalpm exports far more than this read-only tool wraps (207 functions vs.
49 today — the rest is transactions, callbacks, and write operations this
CLI deliberately doesn't do). After a pacman upgrade that bumps libalpm's
minor/patch version enough to introduce new functions, run:

```bash
pnpm check-alpm-coverage
```

It diffs the installed `alpm.h` against a checked-in baseline
(`scripts/alpm-coverage-baseline.json`) and `src/core/koffi/*.ts`'s actual
usage, and prints what's genuinely new since the baseline was last taken,
separately from the (much longer, mostly-intentionally-skipped) full
unwrapped list. **It reports, it doesn't generate anything** — wiring up a
new libalpm call correctly means a human deciding its handle-serialization
story and `alpm_list_t` ownership (`alpm_list_free` vs. free-each-payload-
then-`alpm_list_free`, see `src/core/koffi/marshal.ts`'s
`freeListSpineOnly`/`freeListSpineAndPayload`), which can't be inferred from
a C signature. After reviewing a diff, run
`pnpm check-alpm-coverage -- --update-baseline` to reset it.

## Roadmap / out of scope

Transactions, package installation/removal, `alpm_db_update` (syncing repo
databases), and AUR support are deliberately left out of this read-only
tool — the architecture (a `Backend` interface between the CLI/domain layer
and the koffi backend) is shaped so a privileged helper process could add
them later without reworking the read-only query layers.

## License

MIT
