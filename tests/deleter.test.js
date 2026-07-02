import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteDir } from '../src/deleter.js';

test('deleteDir: removes the directory and reports freed bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kbd-'));
  try {
    const target = join(dir, 'build');
    await mkdir(target);
    await writeFile(join(target, 'main.js'), 'console.log("hi")'); // 17 bytes

    const result = await deleteDir(target);

    assert.equal(result.error, null);
    assert.equal(result.bytesFreed, 17);

    // directory should no longer exist
    await assert.rejects(
      () => access(target, constants.F_OK),
      { code: 'ENOENT' }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deleteDir: returns error string when path does not exist', async () => {
  const result = await deleteDir('/tmp/kbd-nonexistent-dir-xyz');
  assert.ok(result.error !== null);
  assert.equal(result.bytesFreed, 0);
});
