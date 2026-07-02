import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSize } from '../src/renderer.js';

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
