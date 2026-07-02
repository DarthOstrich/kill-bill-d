# kill-bill-d

An interactive CLI for finding and deleting build output directories — like [npkill](https://github.com/voidcosmos/npkill) but for `dist`, `build`, `www`, `.next`, and other framework output folders.

## Install

```bash
npm install -g kill-bill-d
```

Or clone and link locally:

```bash
git clone <repo>
cd kill-bill-d
npm link
```

## Usage

Run from any directory to scan it recursively for build output:

```bash
kill-bill-d
```

The TUI will stream results as they're found, sorted largest-first.

## Controls

| Key | Action |
|-----|--------|
| `↑` / `k` | Move up |
| `↓` / `j` | Move down |
| `Space` / `d` | Delete selected directory |
| `q` / `Ctrl-C` | Quit |

## How it finds build directories

Rather than scanning for hardcoded folder names, `kill-bill-d` reads your project config files to find the actual output path:

| Config file | Field read | Example output |
|---|---|---|
| `angular.json` | `projects[*].architect.build.options.outputPath` | `dist/my-app` |
| `vite.config.js/ts` | `build.outDir` | `dist` |
| `next.config.js` | — | `.next` |
| `package.json` | build script (`--outDir`, `--out-dir`, `--dest`) | varies |
| *(fallback)* | common names | `build`, `www`, `dist`, `.next` |

Framework cache directories are also always checked alongside build output:

| Directory | Framework |
|---|---|
| `.angular` | Angular CLI |
| `.nuxt` | Nuxt.js |
| `.svelte-kit` | SvelteKit |
| `.turbo` | Turborepo |
| `.parcel-cache` | Parcel |

## Requirements

Node.js >= 18
