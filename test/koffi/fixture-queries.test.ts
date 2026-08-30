import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildFixtureRoot, type Fixture } from "../fixtures/build-root.ts";
import { FIELDS_FULL, FIELD_FILES } from "../../src/core/fields.ts";
import { KoffiBackend } from "../../src/core/koffi/backend.ts";

let fixture: Fixture;
let backend: KoffiBackend;

before(async () => {
  fixture = buildFixtureRoot();
  backend = new KoffiBackend();
  await backend.open(fixture.root, fixture.dbpath);
});

after(async () => {
  await backend.close();
  fixture.cleanup();
});

test("fixture root resolves independently of the host system", async () => {
  const pkgs = await backend.listPackages("local");
  assert.equal(pkgs.length, 10);
});

test("getPackage: depends/optdepends/provides marshal correctly", async () => {
  const app = await backend.getPackage("app", "local", FIELDS_FULL);
  assert.equal(app?.reason, 0);
  assert.deepEqual(
    app?.depends?.map((d) => d.name),
    ["libfoo", "libbar"],
  );
  assert.equal(app?.optdepends?.length, 1);
  assert.equal(app?.optdepends?.[0]?.name, "libbaz");
  assert.equal(app?.optdepends?.[0]?.desc, "for extra features");

  const libfoo = await backend.getPackage("libfoo", "local", FIELDS_FULL);
  assert.equal(libfoo?.reason, 1);
  assert.deepEqual(libfoo?.provides, ["foo-provider"]);
});

test("getPackage: conflicts and replaces marshal correctly", async () => {
  const conflictA = await backend.getPackage("conflict-a", "local", FIELDS_FULL);
  assert.deepEqual(conflictA?.conflicts, ["conflict-b"]);

  const successor = await backend.getPackage("successor-pkg", "local", FIELDS_FULL);
  assert.deepEqual(successor?.replaces, ["predecessor-pkg"]);
});

test("getPackage: filelist uses the distinct alpm_filelist_t marshal path", async () => {
  const app = await backend.getPackage("app", "local", FIELD_FILES);
  assert.deepEqual(
    app?.files?.map((f) => f.name),
    ["usr/bin/app"],
  );
});

test("requiredBy: libbar is required by both app and libfoo", async () => {
  const reqBy = await backend.requiredBy("libbar", "local");
  assert.deepEqual([...reqBy].sort(), ["app", "libfoo"]);
});

test("optionalFor: libbaz is optionalFor app; orphan-pkg is required/optional-for nobody", async () => {
  assert.deepEqual(await backend.optionalFor("libbaz", "local"), ["app"]);
  assert.deepEqual(await backend.requiredBy("orphan-pkg", "local"), []);
  assert.deepEqual(await backend.optionalFor("orphan-pkg", "local"), []);
});

test("groups: devtools group has exactly devtools-a and devtools-b", async () => {
  const groups = await backend.groups("local");
  const devtools = groups.find((g) => g.name === "devtools");
  assert.ok(devtools, "expected a 'devtools' group");
  assert.deepEqual([...devtools.packages].sort(), ["devtools-a", "devtools-b"]);
});

test("owners: a fixture file path resolves to its owning package", async () => {
  const owners = await backend.owners("/usr/bin/app");
  assert.equal(owners.length, 1);
  assert.equal(owners[0]?.name, "app");
});

test("getPackage: nonexistent package resolves to null, not an error", async () => {
  assert.equal(await backend.getPackage("does-not-exist", "local"), null);
});
