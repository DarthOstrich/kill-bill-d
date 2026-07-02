import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/args.js';

const MB = 1024 * 1024;

test('parseArgs: defaults when no flags given', () => {
  const result = parseArgs([]);
  assert.equal(result.noGcWarnings, false);
  assert.equal(result.gcThresholdBytes, 100 * MB);
});

test('parseArgs: valid --gc-threshold sets threshold in bytes', () => {
  const result = parseArgs(['--gc-threshold=250']);
  assert.equal(result.noGcWarnings, false);
  assert.equal(result.gcThresholdBytes, 250 * MB);
});

test('parseArgs: non-numeric --gc-threshold falls back to 100 MB', () => {
  const warnings = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (msg) => { warnings.push(msg); return true; };
  try {
    const result = parseArgs(['--gc-threshold=abc']);
    assert.equal(result.gcThresholdBytes, 100 * MB);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('Warning'), `expected warning, got: ${warnings[0]}`);
  } finally {
    process.stderr.write = orig;
  }
});

test('parseArgs: zero --gc-threshold falls back to 100 MB with warning', () => {
  const warnings = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (msg) => { warnings.push(msg); return true; };
  try {
    const result = parseArgs(['--gc-threshold=0']);
    assert.equal(result.gcThresholdBytes, 100 * MB);
    assert.equal(warnings.length, 1);
  } finally {
    process.stderr.write = orig;
  }
});

test('parseArgs: negative --gc-threshold falls back to 100 MB with warning', () => {
  const warnings = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (msg) => { warnings.push(msg); return true; };
  try {
    const result = parseArgs(['--gc-threshold=-50']);
    assert.equal(result.gcThresholdBytes, 100 * MB);
    assert.equal(warnings.length, 1);
  } finally {
    process.stderr.write = orig;
  }
});

test('parseArgs: --no-gc-warnings sets flag', () => {
  const result = parseArgs(['--no-gc-warnings']);
  assert.equal(result.noGcWarnings, true);
  assert.equal(result.gcThresholdBytes, 100 * MB);
});

test('parseArgs: combined --no-gc-warnings and --gc-threshold', () => {
  const result = parseArgs(['--no-gc-warnings', '--gc-threshold=500']);
  assert.equal(result.noGcWarnings, true);
  assert.equal(result.gcThresholdBytes, 500 * MB);
});
