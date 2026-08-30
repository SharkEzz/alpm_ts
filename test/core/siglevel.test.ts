import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSigLevel,
  resolveUsage,
  ALPM_SIG_PACKAGE,
  ALPM_SIG_PACKAGE_OPTIONAL,
  ALPM_SIG_PACKAGE_MARGINAL_OK,
  ALPM_SIG_PACKAGE_UNKNOWN_OK,
  ALPM_SIG_DATABASE,
  ALPM_SIG_DATABASE_OPTIONAL,
  ALPM_SIG_DATABASE_MARGINAL_OK,
  ALPM_SIG_DATABASE_UNKNOWN_OK,
  ALPM_SIG_USE_DEFAULT,
  ALPM_DB_USAGE_ALL,
  ALPM_DB_USAGE_SYNC,
  ALPM_DB_USAGE_SEARCH,
} from "../../src/core/siglevel.ts";

test("resolveSigLevel: no words means USE_DEFAULT (bit 30)", () => {
  assert.equal(resolveSigLevel([]), ALPM_SIG_USE_DEFAULT);
  assert.equal(ALPM_SIG_USE_DEFAULT, 1 << 30);
});

test("resolveSigLevel: 'Required TrustedOnly' matches pacman.conf(5)'s documented built-in default", () => {
  assert.equal(resolveSigLevel(["Required", "TrustedOnly"]), ALPM_SIG_PACKAGE | ALPM_SIG_DATABASE);
});

test("resolveSigLevel: Package-prefixed words only touch the package bits", () => {
  const level = resolveSigLevel(["Required", "TrustedOnly", "PackageOptional"]);
  assert.equal(level, ALPM_SIG_PACKAGE_OPTIONAL | ALPM_SIG_DATABASE);
});

test("resolveSigLevel: concatenating [options] words then a repo's own words implements inheritance-with-override", () => {
  const optionsWords = ["Required", "TrustedOnly"];
  const repoWords = ["Optional", "TrustAll"];
  const combined = resolveSigLevel([...optionsWords, ...repoWords]);
  assert.equal(
    combined,
    ALPM_SIG_PACKAGE_OPTIONAL |
      ALPM_SIG_DATABASE_OPTIONAL |
      ALPM_SIG_PACKAGE_MARGINAL_OK |
      ALPM_SIG_PACKAGE_UNKNOWN_OK |
      ALPM_SIG_DATABASE_MARGINAL_OK |
      ALPM_SIG_DATABASE_UNKNOWN_OK,
  );
});

test("resolveSigLevel: 'Never' clears the check bits even after 'Required'", () => {
  assert.equal(resolveSigLevel(["Required", "Never"]), 0);
});

test("resolveSigLevel: rejects an unknown word", () => {
  assert.throws(() => resolveSigLevel(["NotAWord"]), /unknown SigLevel word/);
});

test("resolveUsage: no words means ALL, per pacman.conf(5) (\"the default if not specified\")", () => {
  assert.equal(resolveUsage([]), ALPM_DB_USAGE_ALL);
  assert.equal(ALPM_DB_USAGE_ALL, (1 << 4) - 1);
});

test("resolveUsage: Sync + Search combine as a bitmask", () => {
  assert.equal(resolveUsage(["Sync", "Search"]), ALPM_DB_USAGE_SYNC | ALPM_DB_USAGE_SEARCH);
});

test("resolveUsage: rejects an unknown word", () => {
  assert.throws(() => resolveUsage(["NotAWord"]), /unknown Usage word/);
});
