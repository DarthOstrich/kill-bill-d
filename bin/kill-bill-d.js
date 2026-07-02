#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
import { scan, scanGitDirs } from '../src/scanner.js';
import Renderer from '../src/renderer.js';
import { deleteDir } from '../src/deleter.js';
import { parseArgs } from '../src/args.js';

const execFileAsync = promisify(execFile);
const { noGcWarnings, gcThresholdBytes } = parseArgs(process.argv.slice(2));

const renderer = new Renderer(
  async (absolutePath, size) => {
    renderer.markDeleting(absolutePath);
    const { bytesFreed, error } = await deleteDir(absolutePath, size);
    if (error) {
      renderer.markError(absolutePath, error);
    } else {
      renderer.markDeleted(absolutePath, bytesFreed);
    }
  },
  async (absolutePath) => {
    renderer.markGcRunning(absolutePath);
    const repoDir = dirname(absolutePath);
    try {
      await execFileAsync('git', ['-C', repoDir, 'gc']);
      const { stdout } = await execFileAsync('du', ['-sk', absolutePath]);
      const sizeAfter = parseInt(stdout.split('\t')[0], 10) * 1024;
      renderer.markGcDone(absolutePath, sizeAfter);
    } catch (err) {
      renderer.markGcError(absolutePath, err.message ?? 'git gc failed');
    }
  }
);

try {
  const buildScan = (async () => {
    for await (const entry of scan(process.cwd())) {
      renderer.addEntry(entry);
    }
  })();

  const gcScan = noGcWarnings
    ? Promise.resolve()
    : (async () => {
        for await (const entry of scanGitDirs(process.cwd(), gcThresholdBytes)) {
          renderer.addEntry(entry);
        }
      })();

  await Promise.all([buildScan, gcScan]);
  renderer.setScanComplete();
} catch (err) {
  renderer.destroy();
  console.error(err);
  process.exit(1);
}
