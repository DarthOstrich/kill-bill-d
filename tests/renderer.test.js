import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSize, renderGcRow } from '../src/renderer.js';

test('formatSize: formats bytes', () => {
  assert.equal(formatSize(500), '500 B');
});

test('formatSize: formats kilobytes', () => {
  assert.equal(formatSize(1500), '1.5 KB');
});

test('formatSize: formats megabytes', () => {
  assert.equal(formatSize(4_200_000), '4.2 MB');
});

test('formatSize: formats gigabytes', () => {
  assert.equal(formatSize(1_500_000_000), '1.5 GB');
});


test('renderGcRow: pending shows [git gc] label and size', () => {
  const entry = { absolutePath: '/tmp/repo/.git', size: 150_000_000, status: 'pending' };
  const row = renderGcRow(entry, '~/repo/.git', false);
  assert.ok(row.includes('[git gc]'), `expected [git gc], got: ${row}`);
  assert.ok(row.includes('150.0 MB'), `expected size, got: ${row}`);
});

test('renderGcRow: running shows [~] and running gc suffix', () => {
  const entry = { absolutePath: '/tmp/repo/.git', size: 150_000_000, status: 'running' };
  const row = renderGcRow(entry, '~/repo/.git', false);
  assert.ok(row.includes('[~]'), `expected [~], got: ${row}`);
  assert.ok(row.includes('running gc'), `expected running gc text, got: ${row}`);
});

test('renderGcRow: done shows [✓]', () => {
  const entry = { absolutePath: '/tmp/repo/.git', size: 150_000_000, status: 'done' };
  const row = renderGcRow(entry, '~/repo/.git', false);
  assert.ok(row.includes('[✓]'), `expected checkmark, got: ${row}`);
});

test('renderGcRow: error shows [!] and error message', () => {
  const entry = { absolutePath: '/tmp/repo/.git', size: 150_000_000, status: 'error', errorMsg: 'not a git repo' };
  const row = renderGcRow(entry, '~/repo/.git', false);
  assert.ok(row.includes('[!]'), `expected [!], got: ${row}`);
  assert.ok(row.includes('not a git repo'), `expected error message, got: ${row}`);
});

test('renderGcRow: selected pending row shows ▶ cursor', () => {
  const entry = { absolutePath: '/tmp/repo/.git', size: 150_000_000, status: 'pending' };
  const row = renderGcRow(entry, '~/repo/.git', true);
  assert.ok(row.includes('▶'), `expected cursor, got: ${row}`);
});
