import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Alpm } from '../src/core/alpm.ts';

// Invariants only, never exact counts/versions - this suite runs against
// whatever the real system's package state happens to be.

test('smoke: Alpm.open() against the real system db, non-root, no lock file', async () => {
  assert.notEqual(process.getuid?.(), 0, 'this suite must not run as root');

  await using alpm = await Alpm.open();
  assert.ok(alpm.config.repos.length > 0, 'expected at least one registered sync repo');

  const installed = await alpm.list();
  assert.ok(installed.length > 0, 'expected at least one installed package');

  const pacman = await alpm.info('pacman');
  assert.ok(pacman !== null, 'expected pacman itself to be installed');
  assert.match(pacman.version, /^\d/);

  assert.equal(
    existsSync('/var/lib/pacman/db.lck'),
    false,
    'read-only queries must never create a lock file',
  );
});

test('smoke: search and owners return well-formed results without throwing', async () => {
  await using alpm = await Alpm.open();
  const results = await alpm.search(['^pacman$'], { repo: 'core' });
  assert.ok(Array.isArray(results));

  const owners = await alpm.owners('/usr/bin/pacman');
  assert.ok(Array.isArray(owners));
});
