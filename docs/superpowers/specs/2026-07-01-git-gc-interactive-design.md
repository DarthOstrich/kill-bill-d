# Interactive Git GC Rows — Design Spec

**Date:** 2026-07-01
**Status:** Approved

## Summary

Make git gc advisory rows selectable and actionable in the TUI. Pressing Space on a gc row runs `git gc` for that repo in the background, with live status feedback on the row — mirroring the existing build-entry delete flow.

## Goals

- Allow users to run `git gc` directly from the TUI without quitting
- Show live running/done/error status on the row
- Keep the TUI fully responsive while gc runs (non-blocking)
- Match the visual and interaction patterns of the existing delete flow

## Non-Goals

- Running multiple gc operations serially/queued (each fires independently)
- Showing git gc output/progress beyond pass/fail
- Changing the exit summary behavior

---

## Architecture

### Cursor (`src/renderer.js`)

`#selectedIndex` range expands from `0..#entries.length-1` to `0..#entries.length+gcVisible-1`:

- `index < #entries.length` → build entry (existing behavior unchanged)
- `index >= #entries.length` → gc row at `gcIndex = index - #entries.length`

`↑`/`↓`/`j`/`k` scroll continuously across both lists. The `▶` cursor renders on gc rows the same as build rows. The `+N more` overflow line is never selectable — the upper bound of `#selectedIndex` is `#entries.length + gcVisible - 1`, not `#entries.length + #gcEntries.length - 1`.

### Keyboard (`src/renderer.js`)

Space on a gc row with `status === 'pending'` calls `this.#onGc(absolutePath)`. Space on any other gc status (`'running'`, `'done'`, `'error'`) is a no-op. The existing Space behavior for build entries is unchanged.

### gc Entry Status (`src/renderer.js`)

gc entries gain a `status` field, set to `'pending'` when added via `addEntry`. New renderer methods mirror the build entry pattern:

- `markGcRunning(absolutePath)` — sets status to `'running'`, redraws
- `markGcDone(absolutePath)` — sets status to `'done'`, redraws
- `markGcError(absolutePath, message)` — sets status to `'error'`, stores message, redraws

### Row Rendering (`src/renderer.js`)

| Status | Checkbox | Extra |
|--------|----------|-------|
| `pending` | `[ ]` | yellow `[git gc]` label, yellow size |
| `running` | `[~]` | yellow `[running gc...]` suffix |
| `done` | `[✓]` (green) | dim strikethrough path |
| `error` | `[!]` (red) | red error message suffix |

Selected gc rows show the `▶` prefix and bold text (same as pending build entries).

### Constructor signature (`src/renderer.js`)

```js
constructor(onDelete, onGc)
```

`#onGc` is stored as a private field alongside `#onDelete`.

### Bin wiring (`bin/kill-bill-d.js`)

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';

const execFileAsync = promisify(execFile);

const renderer = new Renderer(
  async (absolutePath, size) => { /* existing delete handler */ },
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
```

The `onGc` callback is fire-and-forget at the call site — the TUI remains responsive. stdout/stderr from `git gc` are captured and discarded; only the exit code matters.

---

## Data Flow

```
User presses Space on pending gc row
  → #onGc(absolutePath) called
  → renderer.markGcRunning(absolutePath)   [row shows [~] running gc...]
  → execFileAsync('git', ['-C', repoDir, 'gc'])  [runs in background]
  → on success: renderer.markGcDone()      [row shows [✓] strikethrough]
  → on failure: renderer.markGcError()     [row shows [!] error message]
```

---

## Error Handling

- `git` not on PATH → `execFile` throws; `err.message` shown in row
- `git gc` exits non-zero → caught; `err.message` shown in row
- Multiple Space presses: second press on a `'running'` row is a no-op

---

## Testing

- `markGcRunning` / `markGcDone` / `markGcError` update status correctly
- Cursor extends to gc rows: `#selectedIndex` can reach `#entries.length`
- Space on pending gc row calls `onGc`; Space on running/done/error is no-op
- gc row rendering per status: correct checkbox, suffix, color
- `addEntry` with `type: 'gc-advisory'` initialises `status: 'pending'`
