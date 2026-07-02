import { readFile, access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname } from 'node:path';
import glob from 'fast-glob';

const IGNORE_PATTERNS = ['**/node_modules/**', '**/.git/**'];

const COMMON_OUTPUT_NAMES = ['build', 'www', 'dist', '.next'];
const CACHE_DIR_NAMES = ['.angular', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache'];
const NEXT_CONFIGS = ['next.config.js', 'next.config.mjs', 'next.config.ts'];
const VITE_CONFIGS = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'];

async function pathExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

export async function getDirSize(dirPath) {
  let total = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await getDirSize(full);
      } else if (entry.isFile()) {
        const s = await stat(full);
        total += s.size;
      }
    }
  } catch {}
  return total;
}

export async function detectOutputPaths(projectDir) {
  const candidates = [];

  // angular.json
  try {
    const raw = await readFile(join(projectDir, 'angular.json'), 'utf8');
    const cfg = JSON.parse(raw);
    for (const proj of Object.values(cfg.projects ?? {})) {
      const out = proj?.architect?.build?.options?.outputPath;
      if (out) candidates.push(join(projectDir, out));
    }
  } catch {}

  // vite.config.{js,ts,mjs}
  for (const name of VITE_CONFIGS) {
    try {
      const content = await readFile(join(projectDir, name), 'utf8');
      const match = content.match(/outDir\s*:\s*['"`]([^'"`]+)['"`]/);
      if (match) { candidates.push(join(projectDir, match[1])); break; }
    } catch {}
  }

  // next.config.* → always .next
  for (const name of NEXT_CONFIGS) {
    if (await pathExists(join(projectDir, name))) {
      candidates.push(join(projectDir, '.next'));
      break;
    }
  }

  // package.json build script heuristic (only if no framework config found)
  if (candidates.length === 0) {
    try {
      const raw = await readFile(join(projectDir, 'package.json'), 'utf8');
      const pkg = JSON.parse(raw);
      const buildScript = pkg?.scripts?.build ?? '';
      const match = buildScript.match(/(?:--outDir|--out-dir|--dest)\s+(\S+)/);
      if (match) candidates.push(join(projectDir, match[1]));
    } catch {}
  }

  // fallback: common output directory names
  if (candidates.length === 0) {
    for (const name of COMMON_OUTPUT_NAMES) {
      candidates.push(join(projectDir, name));
    }
  }

  // always check for framework cache directories
  for (const name of CACHE_DIR_NAMES) {
    candidates.push(join(projectDir, name));
  }

  // filter to paths that exist on disk and deduplicate
  const existing = [];
  const seen = new Set();
  for (const p of candidates) {
    if (!seen.has(p) && await pathExists(p)) {
      seen.add(p);
      existing.push(p);
    }
  }
  return existing;
}

export async function* scan(rootDir) {
  const stream = glob.stream(
    [
      '**/package.json',
      '**/angular.json',
      '**/next.config.{js,ts,mjs}',
      '**/vite.config.{js,ts,mjs}',
    ],
    {
      cwd: rootDir,
      ignore: IGNORE_PATTERNS,
      followSymbolicLinks: false,
      onlyFiles: true,
    }
  );

  const seenDirs = new Set();

  for await (const file of stream) {
    const projectDir = join(rootDir, dirname(String(file)));
    if (seenDirs.has(projectDir)) continue;
    seenDirs.add(projectDir);

    const outputPaths = await detectOutputPaths(projectDir);
    for (const absolutePath of outputPaths) {
      const size = await getDirSize(absolutePath);
      yield { absolutePath, size };
    }
  }
}
