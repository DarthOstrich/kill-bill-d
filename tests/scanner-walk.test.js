import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../src/scanner.js';

test('scan: yields build output dirs found via config files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kbd-'));
  try {
    // Create a fake Vite project
    const project = join(root, 'my-vite-app');
    await mkdir(project);
    await writeFile(join(project, 'vite.config.js'), `export default { build: { outDir: 'dist' } }`);
    await mkdir(join(project, 'dist'));
    await writeFile(join(project, 'dist', 'index.js'), 'x'); // 1 byte

    const results = [];
    for await (const entry of scan(root)) {
      results.push(entry);
    }

    assert.equal(results.length, 1);
    assert.equal(results[0].absolutePath, join(project, 'dist'));
    assert.equal(results[0].size, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scan: skips node_modules directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kbd-'));
  try {
    // node_modules/some-lib/package.json should NOT be treated as a project root
    const nmLib = join(root, 'node_modules', 'some-lib');
    await mkdir(nmLib, { recursive: true });
    await writeFile(join(nmLib, 'package.json'), JSON.stringify({ name: 'some-lib' }));
    await mkdir(join(nmLib, 'build'), { recursive: true });

    const results = [];
    for await (const entry of scan(root)) {
      results.push(entry);
    }

    assert.equal(results.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
