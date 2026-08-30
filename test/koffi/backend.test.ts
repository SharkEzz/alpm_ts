import { test } from "node:test";
import assert from "node:assert/strict";
import { KoffiBackend, koffiCapabilities, koffiVercmp, koffiVersion } from "../../src/core/koffi/backend.ts";

test("koffiVersion() matches the runtime libalpm major.minor.patch shape", () => {
  assert.match(koffiVersion(), /^\d+\.\d+\.\d+/);
});

test("koffiCapabilities() reports booleans", () => {
  const caps = koffiCapabilities();
  assert.equal(typeof caps.nls, "boolean");
  assert.equal(typeof caps.downloader, "boolean");
  assert.equal(typeof caps.signatures, "boolean");
});

test("koffiVercmp() matches alpm_pkg_vercmp's ordering", () => {
  assert.ok(koffiVercmp("1.0-2", "1.0-1") > 0);
  assert.ok(koffiVercmp("1.0-1", "1.0-2") < 0);
  assert.equal(koffiVercmp("1.0-1", "1.0-1"), 0);
});

test("KoffiBackend: open/close is idempotent, double-open and query-after-close reject", async () => {
  const backend = new KoffiBackend();
  await backend.open("/", "/var/lib/pacman");
  await assert.rejects(() => backend.open("/", "/var/lib/pacman"), /already open/);

  await backend.close();
  await backend.close(); // idempotent

  await assert.rejects(() => backend.options(), /closed/);
});

test("KoffiBackend: a nonexistent root/dbpath rejects with ALPM_ERR_NOT_A_DIR (5)", async () => {
  const backend = new KoffiBackend();
  await assert.rejects(
    () => backend.open("/nonexistent-root-xyz", "/nonexistent-dbpath-xyz"),
    (err: Error & { code?: number }) => err.code === 5,
  );
});
