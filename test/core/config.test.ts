import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePacmanConfig } from "../../src/core/config.ts";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "alpm-ts-conf-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("parsePacmanConfig: recovers the real /etc/pacman.conf's repos with no duplicates", () => {
  const cfg = parsePacmanConfig("/etc/pacman.conf");
  assert.ok(cfg.repos.length > 0, "expected at least one repo on this machine");
  const names = cfg.repos.map((r) => r.name);
  assert.deepEqual(names, [...new Set(names)], "repo list should have no duplicate names");
  assert.ok(cfg.options.architectures.length > 0);
  assert.ok(cfg.options.rootDir.length > 0);
  assert.ok(cfg.options.dbPath.length > 0);
});

test("parsePacmanConfig: rejects a genuine Include cycle", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "a.conf"), "[options]\nInclude = b.conf\n");
    writeFileSync(join(dir, "b.conf"), "Include = a.conf\n");
    assert.throws(() => parsePacmanConfig(join(dir, "a.conf")), /cycle/);
  });
});

test("parsePacmanConfig: a diamond-shaped Include (same file from two repos) is not a false cycle", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "shared.list"), "Server = https://mirror.example/$repo\n");
    writeFileSync(
      join(dir, "pacman.conf"),
      ["[options]", "Architecture = x86_64", "", "[repoa]", "Include = shared.list", "", "[repob]", "Include = shared.list"].join(
        "\n",
      ),
    );
    const cfg = parsePacmanConfig(join(dir, "pacman.conf"));
    assert.equal(cfg.repos.length, 2);
    assert.deepEqual(
      cfg.repos.map((r) => r.servers[0]),
      ["https://mirror.example/repoa", "https://mirror.example/repob"],
    );
  });
});

test("parsePacmanConfig: Include glob expansion is sorted, and $repo/$arch are substituted", () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, "mirrors"));
    writeFileSync(join(dir, "mirrors", "1.list"), "Server = https://a.example/$repo/os/$arch\n");
    writeFileSync(join(dir, "mirrors", "2.list"), "Server = https://b.example/$repo/os/$arch\n");
    writeFileSync(
      join(dir, "pacman.conf"),
      ["[options]", "Architecture = x86_64", "", "[myrepo]", "Include = mirrors/*.list"].join("\n"),
    );
    const cfg = parsePacmanConfig(join(dir, "pacman.conf"));
    assert.equal(cfg.repos.length, 1);
    assert.deepEqual(cfg.repos[0].servers, [
      "https://a.example/myrepo/os/x86_64",
      "https://b.example/myrepo/os/x86_64",
    ]);
  });
});

test("parsePacmanConfig: raw SigLevel/Usage words are captured per-section, uninterpreted", () => {
  withTempDir((dir) => {
    writeFileSync(
      join(dir, "pacman.conf"),
      [
        "[options]",
        "Architecture = x86_64",
        "SigLevel = Required TrustedOnly",
        "",
        "[myrepo]",
        "SigLevel = Optional TrustAll",
        "Usage = Sync Search",
        "Server = https://example.com",
      ].join("\n"),
    );
    const cfg = parsePacmanConfig(join(dir, "pacman.conf"));
    assert.deepEqual(cfg.options.sigLevel, ["Required", "TrustedOnly"]);
    assert.deepEqual(cfg.repos[0].sigLevel, ["Optional", "TrustAll"]);
    assert.deepEqual(cfg.repos[0].usage, ["Sync", "Search"]);
  });
});

test("parsePacmanConfig: list options accumulate across repeated directives, valueless flags are booleans", () => {
  withTempDir((dir) => {
    writeFileSync(
      join(dir, "pacman.conf"),
      ["[options]", "Architecture = x86_64", "IgnorePkg = foo bar", "IgnorePkg = baz", "Color", "HoldPkg = pacman glibc"].join(
        "\n",
      ),
    );
    const cfg = parsePacmanConfig(join(dir, "pacman.conf"));
    assert.deepEqual(cfg.options.ignorePkgs, ["foo", "bar", "baz"]);
    assert.deepEqual(cfg.options.holdPkgs, ["pacman", "glibc"]);
    assert.equal(cfg.options.color, true);
    assert.equal(cfg.options.iLoveCandy, false);
  });
});
