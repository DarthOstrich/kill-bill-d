# Git GC Advisory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-destructive advisory that detects large `.git` folders during scanning, displays them as non-selectable yellow rows in the TUI, and prints a summary on exit.

**Architecture:** A new `scanGitDirs()` async generator in `scanner.js` runs concurrently with the existing `scan()` via `Promise.all` in the bin entry point. The renderer routes entries by `type` field — `'gc-advisory'` entries go into a separate `#gcEntries` array, rendered as non-selectable rows below build entries. On `destroy()`, flagged repos are printed to stdout.

**Tech Stack:** Node.js >= 18, ESM modules, `fast-glob`, `chalk`, `node:test` (built-in test runner)

## Global Constraints

- Node.js >= 18, ESM (`"type": "module"` in package.json) — use `import`/`export`, no `require()`
- No new dependencies — `fast-glob` and `chalk` are already installed
- Test runner: `node --test tests/*.test.js` — use `node:test` and `node:assert/strict`
- All test files live in `tests/` and follow the pattern in existing test files
- Do not modify `src/deleter.js` or `tests/deleter.test.js`

---

### Task 1: Add `scanGitDirs` to `src/scanner.js`

**Files:**
- Modify: `src/scanner.js`
- Modify: `tests/scanner.test.js`

**Interfaces:**
- Produces: `export async function* scanGitDirs(rootDir: string, thresholdBytes: number)` — yields `{ absolutePath: string, size: number, type: 'gc-advisory' }`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `tests/scanner.test.js`:

```js
import { detectOutputPaths, getDirSize, scanGitDirs } from '../src/scanner.js';

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
```

Note: the import line at the top of `tests/scanner.test.js` currently reads:
```js
import { detectOutputPaths, getDirSize } from '../src/scanner.js';
```
Update it to also import `scanGitDirs`:
```js
import { detectOutputPaths, getDirSize, scanGitDirs } from '../src/scanner.js';
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test tests/scanner.test.js
```

Expected: three new tests fail with `SyntaxError` or `is not a function` because `scanGitDirs` doesn't exist yet.

- [ ] **Step 3: Implement `scanGitDirs` in `src/scanner.js`**

Add this function at the bottom of `src/scanner.js`, after the existing `scan()` export:

```js
export async function* scanGitDirs(rootDir, thresholdBytes) {
  const dirs = await glob('**/.git', {
    cwd: rootDir,
    ignore: ['**/node_modules/**'],
    followSymbolicLinks: false,
    onlyDirectories: true,
    dot: true,
  });

  for (const rel of dirs) {
    const absolutePath = join(rootDir, rel);
    const size = await getDirSize(absolutePath);
    if (size >= thresholdBytes) {
      yield { absolutePath, size, type: 'gc-advisory' };
    }
  }
}
```

`dot: true` is required because fast-glob does not match dot-prefixed names by default. `onlyDirectories: true` ensures only directories named `.git` are matched, not files.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
node --test tests/scanner.test.js
```

Expected: all tests pass including the three new ones.

---

### Task 2: Update `bin/kill-bill-d.js` — flag parsing and fan-in

**Files:**
- Modify: `bin/kill-bill-d.js`

**Interfaces:**
- Consumes: `scanGitDirs(rootDir: string, thresholdBytes: number)` from `../src/scanner.js`
- No test file for this task — flag parsing is covered by the function being pure and testable via direct call; integration is verified by Task 3's renderer tests passing.

- [ ] **Step 1: Replace `bin/kill-bill-d.js` with the updated version**

The full new content of `bin/kill-bill-d.js`:

```js
#!/usr/bin/env node
import { scan, scanGitDirs } from '../src/scanner.js';
import Renderer from '../src/renderer.js';
import { deleteDir } from '../src/deleter.js';

function parseArgs(argv) {
  const noGcWarnings = argv.includes('--no-gc-warnings');
  const thresholdArg = argv.find(a => a.startsWith('--gc-threshold='));
  let gcThresholdMb = 100;
  if (thresholdArg) {
    const val = parseInt(thresholdArg.split('=')[1], 10);
    if (!Number.isFinite(val) || val <= 0) {
      process.stderr.write('Warning: invalid --gc-threshold value, using 100 MB default\n');
    } else {
      gcThresholdMb = val;
    }
  }
  return { noGcWarnings, gcThresholdBytes: gcThresholdMb * 1024 * 1024 };
}

const { noGcWarnings, gcThresholdBytes } = parseArgs(process.argv.slice(2));

const renderer = new Renderer(async (absolutePath, size) => {
  renderer.markDeleting(absolutePath);
  const { bytesFreed, error } = await deleteDir(absolutePath, size);
  if (error) {
    renderer.markError(absolutePath, error);
  } else {
    renderer.markDeleted(absolutePath, bytesFreed);
  }
});

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
```

- [ ] **Step 2: Smoke-test the entry point parses without errors**

```bash
node --check bin/kill-bill-d.js
```

Expected: no output (syntax is valid).

---

### Task 3: Update `src/renderer.js` — gc-advisory rows and exit summary

**Files:**
- Modify: `src/renderer.js`
- Modify: `tests/renderer.test.js`

**Interfaces:**
- Consumes: `entry.type === 'gc-advisory'` — entries with this type are routed to `#gcEntries`
- Produces: `export function formatGcSummary(gcEntries: Array<{absolutePath: string, size: number}>): string[]` — returns formatted lines for the exit summary, or `[]` if no entries

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/renderer.test.js` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSize, formatGcSummary } from '../src/renderer.js';

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

test('formatGcSummary: returns empty array when no entries', () => {
  assert.deepEqual(formatGcSummary([]), []);
});

test('formatGcSummary: returns header line plus one line per entry', () => {
  const entries = [
    { absolutePath: '/tmp/small-repo/.git', size: 50_000_000 },
  ];
  const lines = formatGcSummary(entries);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'Repos with large .git folders (consider running git gc):');
  assert.ok(lines[1].includes('small-repo'), `path missing, got: ${lines[1]}`);
  assert.ok(lines[1].includes('50.0 MB'), `size missing, got: ${lines[1]}`);
});

test('formatGcSummary: sorts entries largest-first', () => {
  const entries = [
    { absolutePath: '/tmp/small-repo/.git', size: 50_000_000 },
    { absolutePath: '/tmp/big-repo/.git', size: 200_000_000 },
  ];
  const lines = formatGcSummary(entries);
  assert.ok(lines[1].includes('big-repo'), `expected big-repo first, got: ${lines[1]}`);
  assert.ok(lines[2].includes('small-repo'), `expected small-repo second, got: ${lines[2]}`);
});

test('formatGcSummary: replaces HOME with ~', () => {
  const origHome = process.env.HOME;
  process.env.HOME = '/home/user';
  try {
    const entries = [{ absolutePath: '/home/user/myrepo/.git', size: 100_000_000 }];
    const lines = formatGcSummary(entries);
    assert.ok(lines[1].includes('~/myrepo/.git'), `expected ~ shortening, got: ${lines[1]}`);
  } finally {
    process.env.HOME = origHome;
  }
});
```

- [ ] **Step 2: Run tests to confirm new ones fail**

```bash
node --test tests/renderer.test.js
```

Expected: existing `formatSize` tests pass; new `formatGcSummary` tests fail with `is not a function`.

- [ ] **Step 3: Add `#gcEntries` field and update `addEntry` in `src/renderer.js`**

In the `Renderer` class, add a new private field after `#onDelete`:

```js
  #gcEntries = [];
```

Replace the existing `addEntry` method:

```js
  addEntry(entry) {
    if (entry.type === 'gc-advisory') {
      this.#gcEntries.push(entry);
      this.#gcEntries.sort((a, b) => b.size - a.size);
      this.#draw();
      return;
    }
    this.#entries.push({ ...entry, status: 'pending' });
    this.#entries.sort((a, b) => b.size - a.size);
    this.#selectedIndex = 0;
    this.#draw();
  }
```

- [ ] **Step 4: Add `formatGcSummary` as a named export in `src/renderer.js`**

Add this function directly after the existing `formatSize` function (before the `BANNER` const):

```js
export function formatGcSummary(gcEntries) {
  if (gcEntries.length === 0) return [];
  const sorted = [...gcEntries].sort((a, b) => b.size - a.size);
  const home = process.env.HOME || '';
  const paths = sorted.map(e => home ? e.absolutePath.replace(home, '~') : e.absolutePath);
  const maxLen = Math.max(...paths.map(p => p.length));
  return [
    'Repos with large .git folders (consider running git gc):',
    ...sorted.map((e, i) => `  ${paths[i].padEnd(maxLen + 2)}${formatSize(e.size)}`),
  ];
}
```

- [ ] **Step 5: Run renderer tests to confirm `formatGcSummary` tests pass**

```bash
node --test tests/renderer.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Update `destroy()` to print the gc summary**

Replace the existing `destroy()` method in `src/renderer.js`:

```js
  destroy() {
    process.stdout.write('\x1B[H\x1B[2J'); // clear screen
    process.stdout.write('\x1B[?25h');      // show cursor
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(`Space released: ${chalk.bold(formatSize(this.#bytesFreed))}\n`);
    process.stdout.write(chalk.green('Thanks for using kill-bill-d!\n'));
    const summaryLines = formatGcSummary(this.#gcEntries);
    if (summaryLines.length > 0) {
      process.stdout.write('\n' + summaryLines.join('\n') + '\n');
    }
  }
```

- [ ] **Step 7: Update `#draw()` to render gc rows below build entries**

In `#draw()`, replace:

```js
    const maxVisible = Math.max(1, rows - HEADER_LINES - FOOTER_LINES - 1);
```

with:

```js
    const gcRowCount = this.#gcEntries.length > 0 ? this.#gcEntries.length + 1 : 0; // +1 for separator
    const maxVisible = Math.max(1, rows - HEADER_LINES - FOOTER_LINES - 1 - gcRowCount);
```

Then, between the entry rows loop and the padding `while` loop, add:

```js
    // GC advisory rows
    if (this.#gcEntries.length > 0) {
      lines.push(chalk.dim('  ── large .git folders ──'));
      for (const entry of this.#gcEntries) {
        const sizeStr = chalk.yellow(formatSize(entry.size).padStart(9));
        const pathStr = this.#formatPath(entry.absolutePath, Math.floor(cols * 0.65));
        lines.push(`  ${chalk.yellow('[git gc]')} ${pathStr}  ${sizeStr}`);
      }
    }
```

The full `#draw()` method after changes:

```js
  #draw() {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const gcRowCount = this.#gcEntries.length > 0 ? this.#gcEntries.length + 1 : 0;
    const maxVisible = Math.max(1, rows - HEADER_LINES - FOOTER_LINES - 1 - gcRowCount);

    if (this.#selectedIndex < this.#startIdx) {
      this.#startIdx = this.#selectedIndex;
    }
    if (this.#selectedIndex >= this.#startIdx + maxVisible) {
      this.#startIdx = this.#selectedIndex - maxVisible + 1;
    }
    const startIdx = this.#startIdx;
    const visible = this.#entries.slice(startIdx, startIdx + maxVisible);

    const lines = [];

    // Stats for right column
    const releasable = this.#entries
      .filter(e => e.status !== 'deleted')
      .reduce((s, e) => s + e.size, 0);
    const elapsed = ((Date.now() - this.#scanStart) / 1000).toFixed(2);
    const searchStatus = this.#scanning
      ? chalk.dim('Searching...')
      : chalk.green(`Search completed ${elapsed}s`);
    const statsCol = [
      `Releasable space: ${chalk.white(formatSize(releasable))}`,
      `Space saved:      ${chalk.green(formatSize(this.#bytesFreed))}`,
      searchStatus,
    ];

    // Header: ASCII banner (left) + stats (right)
    for (let i = 0; i < BANNER.length; i++) {
      const art = chalk.red(BANNER[i].padEnd(BANNER_WIDTH));
      const stat = statsCol[i] !== undefined ? '    ' + statsCol[i] : '';
      lines.push(art + stat);
    }
    lines.push(chalk.dim('                              kill-bill-d'));
    lines.push('');

    // Entry rows
    for (let i = 0; i < visible.length; i++) {
      const entry = visible[i];
      const isSelected = (startIdx + i) === this.#selectedIndex;

      let checkbox = '[ ]';
      let statusStr = '';
      if (entry.status === 'deleting') {
        checkbox = '[~]';
        statusStr = chalk.yellow(' [deleting...]');
      } else if (entry.status === 'deleted') {
        checkbox = chalk.green('[✓]');
        statusStr = chalk.strikethrough(chalk.gray(' [deleted]'));
      } else if (entry.status === 'error') {
        checkbox = chalk.red('[!]');
        statusStr = chalk.red(` [${entry.errorMsg}]`);
      }

      const sizeStr = chalk.cyan(formatSize(entry.size).padStart(9));
      const pathStr = this.#formatPath(entry.absolutePath, Math.floor(cols * 0.65));
      const prefix = isSelected ? chalk.bold.green('▶ ') : '  ';
      let row = `${prefix}${checkbox} ${pathStr}${statusStr}  ${sizeStr}`;
      if (isSelected && entry.status === 'pending') row = chalk.bold(row);
      lines.push(row);
    }

    // GC advisory rows
    if (this.#gcEntries.length > 0) {
      lines.push(chalk.dim('  ── large .git folders ──'));
      for (const entry of this.#gcEntries) {
        const sizeStr = chalk.yellow(formatSize(entry.size).padStart(9));
        const pathStr = this.#formatPath(entry.absolutePath, Math.floor(cols * 0.65));
        lines.push(`  ${chalk.yellow('[git gc]')} ${pathStr}  ${sizeStr}`);
      }
    }

    // Padding
    while (lines.length < rows - FOOTER_LINES) lines.push('');

    // Amber status bar
    const leftHint = ' ↑↓/jk for select  ─  SPACE to delete  ─  Q to quit';
    const rightHint = 'Size ';
    const gap = Math.max(1, cols - leftHint.length - rightHint.length);
    lines.push(chalk.bgYellow.black(leftHint + ' '.repeat(gap) + rightHint));

    process.stdout.write('\x1B[H\x1B[2J');
    process.stdout.write(lines.join('\n'));
  }
```

- [ ] **Step 8: Run the full test suite**

```bash
node --test tests/*.test.js
```

Expected: all tests pass with no failures.
