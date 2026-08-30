import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const native = require("../../native/build/Release/alpm.node");

test("version() matches the runtime libalpm major.minor.patch shape", () => {
  assert.match(native.version(), /^\d+\.\d+\.\d+/);
});

test("capabilities() reports booleans", () => {
  const caps = native.capabilities();
  assert.equal(typeof caps.nls, "boolean");
  assert.equal(typeof caps.downloader, "boolean");
  assert.equal(typeof caps.signatures, "boolean");
});

test("vercmp() matches alpm_pkg_vercmp's ordering", () => {
  assert.ok(native.vercmp("1.0-2", "1.0-1") > 0);
  assert.ok(native.vercmp("1.0-1", "1.0-2") < 0);
  assert.equal(native.vercmp("1.0-1", "1.0-1"), 0);
});

test("Handle: open/close is idempotent, double-open and query-after-close reject", async () => {
  const handle = new native.Handle();
  await handle.open("/", "/var/lib/pacman");
  await assert.rejects(() => handle.open("/", "/var/lib/pacman"), /already open/);

  await handle.close();
  await handle.close(); // idempotent

  await assert.rejects(() => handle.options(), /closed/);
});

test("Handle: a nonexistent root/dbpath rejects with ALPM_ERR_NOT_A_DIR (5)", async () => {
  const handle = new native.Handle();
  await assert.rejects(
    () => handle.open("/nonexistent-root-xyz", "/nonexistent-dbpath-xyz"),
    (err: Error & { code?: number }) => err.code === 5,
  );
});
