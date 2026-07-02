import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectOutputPaths, getDirSize, scanGitDirs } from '../src/scanner.js';

test('detectOutputPaths: reads outputPath from angular.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kbd-'));
  try {
    const outputDir = join(dir, 'dist', 'my-app');
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(dir, 'angular.json'), JSON.stringify({
      projects: {
        'my-app': {
          architect: { build: { options: { outputPath: 'dist/my-app' } } }
        }
      }
    }));
    const result = await detectOutputPaths(dir);
    assert.deepEqual(result, [outputDir]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detectOutputPaths: reads outDir from vite.config.js', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kbd-'));
  try {
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'vite.config.js'), `export default { build: { outDir: 'dist' } }`);
    const result = await detectOutputPaths(dir);
    assert.deepEqual(result, [join(dir, 'dist')]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detectOutputPaths: returns .next for next.config.js projects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kbd-'));
  try {
    await mkdir(join(dir, '.next'), { recursive: true });
    await writeFile(join(dir, 'next.config.js'), 'module.exports = {}');
    const result = await detectOutputPaths(dir);
    assert.deepEqual(result, [join(dir, '.next')]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detectOutputPaths: falls back to common names when no config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kbd-'));
  try {
    await mkdir(join(dir, 'build'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    const result = await detectOutputPaths(dir);
    assert.deepEqual(result, [join(dir, 'build')]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detectOutputPaths: returns empty array when output path does not exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kbd-'));
  try {
    await writeFile(join(dir, 'angular.json'), JSON.stringify({
      projects: { app: { architect: { build: { options: { outputPath: 'dist/app' } } } } }
    }));
    const result = await detectOutputPaths(dir);
    assert.deepEqual(result, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getDirSize: sums file sizes recursively', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kbd-'));
  try {
    await writeFile(join(dir, 'a.txt'), 'hello'); // 5 bytes
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'sub', 'b.txt'), 'world'); // 5 bytes
    const size = await getDirSize(dir);
    assert.equal(size, 10);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('scanGitDirs: yields .git dirs above threshold', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kbd-'));
  try {
    const gitDir = join(root, 'myrepo', '.git');
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main');

    const results = [];
    for await (const entry of scanGitDirs(root, 1)) {
      results.push(entry);
    }

    assert.equal(results.length, 1);
    assert.equal(results[0].absolutePath, gitDir);
    assert.equal(results[0].type, 'gc-advisory');
    assert.ok(results[0].size > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanGitDirs: skips .git dirs below threshold', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kbd-'));
  try {
    const gitDir = join(root, 'myrepo', '.git');
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main');

    const results = [];
    for await (const entry of scanGitDirs(root, 1024 * 1024 * 1024)) {
      results.push(entry);
    }

    assert.equal(results.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanGitDirs: skips .git dirs inside node_modules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kbd-'));
  try {
    const nmGitDir = join(root, 'node_modules', 'some-lib', '.git');
    await mkdir(nmGitDir, { recursive: true });
    await writeFile(join(nmGitDir, 'HEAD'), 'ref: refs/heads/main');

    const results = [];
    for await (const entry of scanGitDirs(root, 1)) {
      results.push(entry);
    }

    assert.equal(results.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
