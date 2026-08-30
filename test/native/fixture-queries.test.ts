import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildFixtureRoot, type Fixture } from "../fixtures/build-root.ts";
import { FIELDS_FULL, FIELD_FILES } from "../../src/core/fields.ts";

const require = createRequire(import.meta.url);
const native = require("../../native/build/Release/alpm.node");

let fixture: Fixture;
let handle: InstanceType<typeof native.Handle>;

before(async () => {
  fixture = buildFixtureRoot();
  handle = new native.Handle();
  await handle.open(fixture.root, fixture.dbpath);
});

after(async () => {
  await handle.close();
  fixture.cleanup();
});

test("fixture root resolves independently of the host system", async () => {
  const pkgs = await handle.listPackages("local");
  assert.equal(pkgs.length, 10);
});

test("getPackage: depends/optdepends/provides marshal correctly", async () => {
  const app = await handle.getPackage("app", "local", FIELDS_FULL);
  assert.equal(app.reason, 0);
  assert.deepEqual(
    app.depends.map((d: { name: string }) => d.name),
    ["libfoo", "libbar"],
  );
  assert.equal(app.optdepends.length, 1);
  assert.equal(app.optdepends[0].name, "libbaz");
  assert.equal(app.optdepends[0].desc, "for extra features");

  const libfoo = await handle.getPackage("libfoo", "local", FIELDS_FULL);
  assert.equal(libfoo.reason, 1);
  assert.deepEqual(libfoo.provides, ["foo-provider"]);
});

test("getPackage: conflicts and replaces marshal correctly", async () => {
  const conflictA = await handle.getPackage("conflict-a", "local", FIELDS_FULL);
  assert.deepEqual(conflictA.conflicts, ["conflict-b"]);

  const successor = await handle.getPackage("successor-pkg", "local", FIELDS_FULL);
  assert.deepEqual(successor.replaces, ["predecessor-pkg"]);
});

test("getPackage: filelist uses the distinct alpm_filelist_t marshal path", async () => {
  const app = await handle.getPackage("app", "local", FIELD_FILES);
  assert.deepEqual(
    app.files.map((f: { name: string }) => f.name),
    ["usr/bin/app"],
  );
});

test("requiredBy: libbar is required by both app and libfoo", async () => {
  const reqBy = await handle.requiredBy("libbar", "local");
  assert.deepEqual([...reqBy].sort(), ["app", "libfoo"]);
});

test("optionalFor: libbaz is optionalFor app; orphan-pkg is required/optional-for nobody", async () => {
  assert.deepEqual(await handle.optionalFor("libbaz", "local"), ["app"]);
  assert.deepEqual(await handle.requiredBy("orphan-pkg", "local"), []);
  assert.deepEqual(await handle.optionalFor("orphan-pkg", "local"), []);
});

test("groups: devtools group has exactly devtools-a and devtools-b", async () => {
  const groups = await handle.groups("local");
  const devtools = groups.find((g: { name: string }) => g.name === "devtools");
  assert.ok(devtools, "expected a 'devtools' group");
  assert.deepEqual([...devtools.packages].sort(), ["devtools-a", "devtools-b"]);
});

test("owners: a fixture file path resolves to its owning package", async () => {
  const owners = await handle.owners("/usr/bin/app");
  assert.equal(owners.length, 1);
  assert.equal(owners[0].name, "app");
});

test("getPackage: nonexistent package resolves to null, not an error", async () => {
  assert.equal(await handle.getPackage("does-not-exist", "local"), null);
});
