# Interactive Git GC Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make git gc advisory rows selectable and actionable — pressing Space on one runs `git gc` for that repo in the background with live status feedback.

**Architecture:** gc entries gain a `status` field (`'pending'`|`'running'`|`'done'`|`'error'`). A new exported `renderGcRow(entry, pathStr, isSelected)` pure function handles per-status row rendering. The renderer constructor takes a second `onGc` callback; `#handleKey` extends the cursor upper bound to cover gc rows and routes Space to `#onGc`. The bin wires `execFile('git', ['-C', repoDir, 'gc'])` as the `onGc` callback.

**Tech Stack:** Node.js >= 18 ESM, `chalk`, `node:child_process` execFile, `node:util` promisify, `node:test`

## Global Constraints

- Node.js >= 18, ESM (`import`/`export` only — no `require`)
- No new npm dependencies — `chalk`, `fast-glob` already installed
- Test runner: `node --test tests/*.test.js` using `node:test` and `node:assert/strict`
- gc entry statuses: exactly `'pending'` | `'running'` | `'done'` | `'error'`
- `renderGcRow(entry, pathStr, isSelected)` — named export from `src/renderer.js`
- `markGcRunning(absolutePath)` / `markGcDone(absolutePath)` / `markGcError(absolutePath, message)` — public methods on `Renderer`
- Constructor signature: `new Renderer(onDelete, onGc)`
- Cursor upper bound: `Math.max(0, #entries.length + #gcVisible - 1)` where `#gcVisible = Math.min(#gcEntries.length, GC_MAX_VISIBLE)`
- `onGc` is fire-and-forget at call site (not awaited) — TUI stays responsive

---

## File Structure

| File | Change |
|------|--------|
| `src/renderer.js` | Add `renderGcRow` export; add `#findGc`, `markGcRunning/Done/Error`; update `addEntry`, `#handleKey`, `#draw()`, constructor |
| `bin/kill-bill-d.js` | Add `execFile`/`promisify`/`dirname` imports; pass `onGc` callback as second arg to `Renderer` |
| `tests/renderer.test.js` | Add 5 `renderGcRow` tests |

---

### Task 1: gc entry status management + `renderGcRow` export

**Files:**
- Modify: `src/renderer.js`
- Modify: `tests/renderer.test.js`

**Interfaces:**
- Produces:
  - `export function renderGcRow(entry: {absolutePath, size, status, errorMsg?}, pathStr: string, isSelected: boolean): string`
  - `Renderer#markGcRunning(absolutePath: string): void`
  - `Renderer#markGcDone(absolutePath: string): void`
  - `Renderer#markGcError(absolutePath: string, message: string): void`

- [ ] **Step 1: Write the failing tests**

Add to `tests/renderer.test.js` (after the existing `formatGcSummary` tests):

```js
import { formatSize, formatGcSummary, renderGcRow } from '../src/renderer.js';

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
```

Note: the import line at the top of `tests/renderer.test.js` currently reads:
```js
import { formatSize, formatGcSummary } from '../src/renderer.js';
```
Update it to:
```js
import { formatSize, formatGcSummary, renderGcRow } from '../src/renderer.js';
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test tests/renderer.test.js
```

Expected: 5 new tests fail with `renderGcRow is not a function`.

- [ ] **Step 3: Add `renderGcRow` export to `src/renderer.js`**

Add this function directly after `formatGcSummary` (before the `BANNER` const):

```js
export function renderGcRow(entry, pathStr, isSelected) {
  let checkbox = chalk.yellow('[git gc]');
  let statusStr = '';
  if (entry.status === 'running') {
    checkbox = '[~]';
    statusStr = chalk.yellow(' [running gc...]');
  } else if (entry.status === 'done') {
    checkbox = chalk.green('[✓]');
    statusStr = chalk.strikethrough(chalk.gray(' [done]'));
  } else if (entry.status === 'error') {
    checkbox = chalk.red('[!]');
    statusStr = chalk.red(` [${entry.errorMsg}]`);
  }
  const sizeStr = chalk.yellow(formatSize(entry.size).padStart(9));
  const prefix = isSelected ? chalk.bold.green('▶ ') : '  ';
  let row = `${prefix}${checkbox} ${pathStr}${statusStr}  ${sizeStr}`;
  if (isSelected && entry.status === 'pending') row = chalk.bold(row);
  return row;
}
```

- [ ] **Step 4: Run tests to confirm `renderGcRow` tests pass**

```bash
node --test tests/renderer.test.js
```

Expected: all 13 tests pass (8 existing + 5 new).

- [ ] **Step 5: Update `addEntry` to initialise gc status, add `#findGc` and `markGc*` methods**

In `src/renderer.js`, replace the `addEntry` gc branch:

```js
  addEntry(entry) {
    if (entry.type === 'gc-advisory') {
      this.#gcEntries.push({ ...entry, status: 'pending' });
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

Add `#findGc` private method after the existing `#find` method:

```js
  #findGc(absolutePath) {
    return this.#gcEntries.find(e => e.absolutePath === absolutePath);
  }
```

Add three public methods after `markError`:

```js
  markGcRunning(absolutePath) {
    const e = this.#findGc(absolutePath);
    if (e) { e.status = 'running'; this.#draw(); }
  }

  markGcDone(absolutePath) {
    const e = this.#findGc(absolutePath);
    if (e) { e.status = 'done'; this.#draw(); }
  }

  markGcError(absolutePath, message) {
    const e = this.#findGc(absolutePath);
    if (e) { e.status = 'error'; e.errorMsg = message; this.#draw(); }
  }
```

- [ ] **Step 6: Run full test suite to confirm nothing regressed**

```bash
node --test tests/*.test.js
```

Expected: all 28 tests pass (no regressions).

---

### Task 2: Cursor extension, Space key routing, `#draw()` gc cursor, bin wiring

**Files:**
- Modify: `src/renderer.js`
- Modify: `bin/kill-bill-d.js`

**Interfaces:**
- Consumes: `renderGcRow(entry, pathStr, isSelected)` from Task 1
- Consumes: `markGcRunning/Done/Error` from Task 1

- [ ] **Step 1: Add `#onGc` field, `#gcVisible` getter, update constructor**

In the `Renderer` class private fields block, add `#onGc` after `#onDelete`:

```js
  #onDelete;
  #onGc;
```

Replace the constructor:

```js
  constructor(onDelete, onGc) {
    this.#onDelete = onDelete;
    this.#onGc = onGc;
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on('keypress', (_, key) => this.#handleKey(key));
    process.on('SIGWINCH', () => this.#draw());
    process.stdout.write('\x1B[?25l');
  }
```

Add a private getter after `#findGc`:

```js
  get #gcVisible() {
    return Math.min(this.#gcEntries.length, GC_MAX_VISIBLE);
  }
```

- [ ] **Step 2: Update `#handleKey` — extend cursor bounds and route Space**

Replace the entire `#handleKey` method:

```js
  #handleKey(key) {
    if (!key) return;
    const seq = key.sequence;
    if (seq === 'q' || seq === '\x03') { this.destroy(); process.exit(0); }
    if (seq === '\x1B[A' || seq === 'k') {
      this.#selectedIndex = Math.max(0, this.#selectedIndex - 1);
      this.#draw();
    }
    if (seq === '\x1B[B' || seq === 'j') {
      const maxIdx = Math.max(0, this.#entries.length + this.#gcVisible - 1);
      this.#selectedIndex = Math.min(maxIdx, this.#selectedIndex + 1);
      this.#draw();
    }
    if (seq === ' ' || seq === 'd') {
      if (this.#selectedIndex < this.#entries.length) {
        const entry = this.#entries[this.#selectedIndex];
        if (entry?.status === 'pending') this.#onDelete(entry.absolutePath, entry.size);
      } else {
        const gcIdx = this.#selectedIndex - this.#entries.length;
        const gcEntry = this.#gcEntries[gcIdx];
        if (gcEntry?.status === 'pending') this.#onGc(gcEntry.absolutePath);
      }
    }
  }
```

- [ ] **Step 3: Update `#draw()` — use `#gcVisible` getter and render gc rows with cursor**

In `#draw()`, replace:

```js
    const gcVisible = Math.min(this.#gcEntries.length, GC_MAX_VISIBLE);
    const gcRowCount = this.#gcEntries.length === 0 ? 0
      : gcVisible + 1 + (this.#gcEntries.length > GC_MAX_VISIBLE ? 1 : 0);
```

with:

```js
    const gcVisible = this.#gcVisible;
    const gcRowCount = this.#gcEntries.length === 0 ? 0
      : gcVisible + 1 + (this.#gcEntries.length > GC_MAX_VISIBLE ? 1 : 0);
```

Replace the gc advisory rows rendering block:

```js
    // GC advisory rows (capped at GC_MAX_VISIBLE)
    if (this.#gcEntries.length > 0) {
      lines.push(chalk.dim('  ── large .git folders ──'));
      for (let i = 0; i < gcVisible; i++) {
        const entry = this.#gcEntries[i];
        const pathStr = this.#formatPath(entry.absolutePath, Math.floor(cols * 0.65));
        const isSelected = this.#selectedIndex === this.#entries.length + i;
        lines.push(renderGcRow(entry, pathStr, isSelected));
      }
      if (this.#gcEntries.length > GC_MAX_VISIBLE) {
        const extra = this.#gcEntries.length - GC_MAX_VISIBLE;
        lines.push(chalk.dim(`  +${extra} more — see exit summary`));
      }
    }
```

- [ ] **Step 4: Run the full test suite to confirm renderer changes pass**

```bash
node --test tests/*.test.js
```

Expected: all 28 tests pass.

- [ ] **Step 5: Update `bin/kill-bill-d.js` with `onGc` callback**

Replace the full contents of `bin/kill-bill-d.js`:

```js
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
      renderer.markGcDone(absolutePath);
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
```

- [ ] **Step 6: Run full test suite**

```bash
node --test tests/*.test.js
```

Expected: all 28 tests pass.
