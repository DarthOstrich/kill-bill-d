# Git GC Advisory Feature — Design Spec

**Date:** 2026-07-01
**Status:** Approved

## Summary

Add a non-destructive advisory feature that detects large `.git` folders during scanning and surfaces them in the TUI as informational, non-selectable rows. On exit, the list of affected repos is printed to stdout with a prompt to run `git gc`.

## Goals

- Surface large `.git` folders (≥ 100 MB by default) without offering deletion
- Integrate seamlessly into the existing TUI as advisory-only rows
- Provide exit-time summary of all flagged repos
- Allow threshold tuning and full suppression via CLI flags

## Non-Goals

- Deleting or modifying `.git` folders
- Running `git gc` automatically
- Detecting specific causes of `.git` bloat (large files, unreachable objects, etc.)

---

## Architecture

### Scanner (`src/scanner.js`)

A new exported async generator `scanGitDirs(rootDir, thresholdBytes)`:

- Uses `fast-glob` to find all `.git` directories under `rootDir`, ignoring `node_modules`
- Measures each with the existing `getDirSize()` helper
- Yields entries above `thresholdBytes` with shape:
  ```js
  { absolutePath: string, size: number, type: 'gc-advisory' }
  ```
- The existing `scan()` generator is unchanged and continues yielding `{ absolutePath, size }` (implicitly `type: 'build'`)

### Entry point (`bin/kill-bill-d.js`)

Two new CLI flags:

| Flag | Default | Behavior |
|------|---------|----------|
| `--gc-threshold=<MB>` | `100` | Minimum `.git` size in MB to trigger an advisory |
| `--no-gc-warnings` | off | Skips `.git` scanning entirely; no advisory rows shown |

Parsing rules:
- `--gc-threshold` value must be a positive integer; invalid values fall back to 100 MB with a stderr warning
- If `--no-gc-warnings` is present, `scanGitDirs` is never called

Both `scan()` and `scanGitDirs()` run concurrently via a fan-in loop. Entries from both generators are passed to `renderer.addEntry()` as they stream in.

### Renderer (`src/renderer.js`)

`addEntry(entry)` branches on `entry.type`:

- `'build'` (or undefined) — existing behavior, selectable and deletable
- `'gc-advisory'` — stored in a separate internal list; rendered as non-selectable rows

**Row rendering for `gc-advisory` entries:**
- Rendered below all build entries; the cursor never reaches them (build entries only)
- In place of `[ ]` checkbox: yellow `[git gc]` label
- Size rendered in yellow
- `space` and `d` keypresses are no-ops when a gc-advisory row is focused

**Exit output (`destroy()`):**

After the existing "Space released" line, if any gc-advisory entries exist:

```
Repos with large .git folders (consider running git gc):
  ~/Dev/my-app       420.3 MB
  ~/Dev/old-project  213.1 MB
```

Paths are home-shortened (`~`). List is sorted largest-first.

---

## Data Flow

```
rootDir
  ├── scan()           → { absolutePath, size, type:'build' }      ─┐
  └── scanGitDirs()    → { absolutePath, size, type:'gc-advisory' } ─┤→ renderer.addEntry()
                                                                      │
                                                               TUI renders both
                                                               gc-advisory = non-selectable yellow row
                                                               build = existing selectable row
                                                                      │
                                                               on destroy():
                                                               print gc-advisory list to stdout
```

---

## Error Handling

- `getDirSize` already swallows `readdir`/`stat` errors silently — `.git` measurement inherits this
- If `.git` exists but is unreadable (permissions), it simply won't exceed the threshold and won't appear
- Invalid `--gc-threshold` value: stderr warning, fall back to 100 MB

---

## Testing

- Unit test for `scanGitDirs`: mock filesystem with a `.git` dir above and below threshold; assert correct entries yielded
- Unit test for renderer: gc-advisory entries render as non-selectable; cursor skips them; `space`/`d` no-ops
- Unit test for `destroy()` output: gc-advisory entries appear in exit summary; none present → no section printed
- CLI flag parsing: `--gc-threshold=250` sets threshold; `--no-gc-warnings` skips scan; invalid value warns and defaults
