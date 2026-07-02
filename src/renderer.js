import readline from 'node:readline';
import chalk from 'chalk';

export function formatSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}


export function renderGcRow(entry, pathStr, isSelected) {
  let checkbox = '[ ]';
  let statusStr = ' [git gc]';
  if (entry.status === 'running') {
    checkbox = '[~]';
    statusStr = ' [running gc...]';
  } else if (entry.status === 'done') {
    checkbox = '[✓]';
    const saved = entry.sizeAfter != null ? entry.size - entry.sizeAfter : 0;
    statusStr = ' [done]' + (saved > 0 ? ` -${formatSize(saved)}` : '');
  } else if (entry.status === 'error') {
    checkbox = '[!]';
    statusStr = ` [${entry.errorMsg}]`;
  }
  const displaySize = entry.status === 'done' && entry.sizeAfter != null ? entry.sizeAfter : entry.size;
  const sizeStr = formatSize(displaySize).padStart(9);
  let content = `${checkbox} ${pathStr}${statusStr}  ${sizeStr}`;
  if (entry.status === 'running') content = chalk.yellow(content);
  else if (entry.status === 'done') content = chalk.green(content);
  else if (entry.status === 'error') content = chalk.red(content);
  else if (isSelected) content = chalk.bold(content);
  const prefix = isSelected ? chalk.bold.green('▶ ') : '  ';
  return prefix + content;
}

// figlet "Standard" font — kill / bill / d combined
const BANNER = [
  ' _    _ _ _      _     _ _ _       _',
  '| | _(_) | |    | |__ (_) | |    __| |',
  "| |/ / | | |    | '_ \\| | | |   / _` |",
  '|   <| | | |    | |_) | | | |_ | (_| |',
  '|_|\\_\\_|_|_|    |_.__/|_|_|_____\\__,_|',
];
const BANNER_WIDTH = 42; // visual width to pad banner lines before stats column
const HEADER_LINES = BANNER.length + 2; // 5 banner rows + subtitle + blank
const FOOTER_LINES = 1;

export default class Renderer {
  #entries = [];
  #selectedIndex = 0;
  #startIdx = 0;
  #scanning = true;
  #searchingDots = 0;
  #searchTimer = null;
  #scanElapsed = '';
  #bytesFreed = 0;
  #onDelete;
  #onGc;
  #gcEntries = [];
  #scanStart = Date.now();

  constructor(onDelete, onGc) {
    this.#onDelete = onDelete;
    this.#onGc = onGc;
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on('keypress', (_, key) => this.#handleKey(key));
    process.on('SIGWINCH', () => this.#draw());
    process.stdout.write('\x1B[?25l');
    this.#searchTimer = setInterval(() => {
      this.#searchingDots = (this.#searchingDots + 1) % 3;
      this.#draw();
    }, 400);
    this.#draw();
  }

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

  markDeleting(absolutePath) {
    const e = this.#find(absolutePath);
    if (e) { e.status = 'deleting'; this.#draw(); }
  }

  markDeleted(absolutePath, bytesFreed) {
    const e = this.#find(absolutePath);
    if (e) { e.status = 'deleted'; this.#bytesFreed += bytesFreed; this.#draw(); }
  }

  markError(absolutePath, message) {
    const e = this.#find(absolutePath);
    if (e) { e.status = 'error'; e.errorMsg = message; this.#draw(); }
  }

  markGcRunning(absolutePath) {
    const e = this.#findGc(absolutePath);
    if (e) { e.status = 'running'; this.#draw(); }
  }

  markGcDone(absolutePath, sizeAfter) {
    const e = this.#findGc(absolutePath);
    if (e) { e.status = 'done'; e.sizeAfter = sizeAfter; this.#draw(); }
  }

  markGcError(absolutePath, message) {
    const e = this.#findGc(absolutePath);
    if (e) { e.status = 'error'; e.errorMsg = message; this.#draw(); }
  }

  setScanComplete() {
    this.#scanning = false;
    this.#scanElapsed = ((Date.now() - this.#scanStart) / 1000).toFixed(2);
    clearInterval(this.#searchTimer);
    this.#draw();
  }

  destroy() {
    clearInterval(this.#searchTimer);
    process.stdout.write('\x1B[H\x1B[2J'); // clear screen
    process.stdout.write('\x1B[?25h');      // show cursor
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    const gcDone = this.#gcEntries.filter(e => e.status === 'done');
    const gcStillRunning = this.#gcEntries.filter(e => e.status === 'running').length;
    const gcSaved = gcDone
      .filter(e => e.sizeAfter != null)
      .reduce((sum, e) => sum + Math.max(0, e.size - e.sizeAfter), 0);
    process.stdout.write(`Space released: ${chalk.bold(formatSize(this.#bytesFreed))}\n`);
    if (gcDone.length > 0) process.stdout.write(`GC space saved: ${chalk.bold(formatSize(gcSaved))}\n`);
    if (gcStillRunning > 0) process.stdout.write(chalk.yellow(`GC still running: ${gcStillRunning} repo(s) — let it finish for full savings\n`));
    process.stdout.write(chalk.green('Thanks for using kill-bill-d!\n'));
  }

  #find(absolutePath) {
    return this.#entries.find(e => e.absolutePath === absolutePath);
  }

  #findGc(absolutePath) {
    return this.#gcEntries.find(e => e.absolutePath === absolutePath);
  }

  get #gcVisible() {
    return this.#gcEntries.length;
  }

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

  #formatPath(absolutePath, maxLen) {
    const home = process.env.HOME || '';
    const p = home ? absolutePath.replace(home, '~') : absolutePath;
    if (p.length <= maxLen) return p;
    const keepEnd = Math.floor(maxLen * 0.55);
    const keepStart = maxLen - keepEnd - 1;
    return p.slice(0, keepStart) + '…' + p.slice(p.length - keepEnd);
  }

  #draw() {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const maxVisible = Math.max(1, rows - HEADER_LINES - FOOTER_LINES - 1);

    // Build flat row list: build section, then gc section
    const allRows = [];
    allRows.push({ kind: 'build-header' });
    if (this.#entries.length === 0) {
      if (!this.#scanning) allRows.push({ kind: 'build-empty' });
    } else {
      for (let i = 0; i < this.#entries.length; i++) {
        allRows.push({ kind: 'entry', entry: this.#entries[i], entryIdx: i });
      }
    }
    if (this.#gcEntries.length > 0) {
      allRows.push({ kind: 'gc-header' });
      for (let i = 0; i < this.#gcEntries.length; i++) {
        allRows.push({ kind: 'gc-entry', entry: this.#gcEntries[i], gcIdx: i });
      }
    }

    // Find row index of selected item by scanning allRows
    let selectedRowIdx = 0;
    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      if (r.kind === 'entry' && r.entryIdx === this.#selectedIndex) { selectedRowIdx = i; break; }
      if (r.kind === 'gc-entry' && this.#selectedIndex === this.#entries.length + r.gcIdx) { selectedRowIdx = i; break; }
    }

    if (selectedRowIdx < this.#startIdx) this.#startIdx = selectedRowIdx;
    if (selectedRowIdx >= this.#startIdx + maxVisible) {
      this.#startIdx = selectedRowIdx - maxVisible + 1;
    }

    const visibleRows = allRows.slice(this.#startIdx, this.#startIdx + maxVisible);

    const lines = [];

    // Stats for right column
    const releasable = this.#entries
      .filter(e => e.status !== 'deleted')
      .reduce((s, e) => s + e.size, 0);
    const searchStatus = this.#scanning
      ? chalk.dim('Searching' + '.'.repeat(this.#searchingDots + 1))
      : chalk.green(`Search completed ${this.#scanElapsed}s`);
    const buildActionsUnderway = this.#entries.some(e => e.status !== 'pending');
    const pendingCount = this.#entries.filter(e => e.status === 'pending').length;
    const gcRunningCount = this.#gcEntries.filter(e => e.status === 'running').length;
    const gcDoneCount = this.#gcEntries.filter(e => e.status === 'done').length;
    const gcSaved = this.#gcEntries
      .filter(e => e.status === 'done' && e.sizeAfter != null)
      .reduce((sum, e) => sum + Math.max(0, e.size - e.sizeAfter), 0);
    const statsCol = [
      `Releasable space: ${chalk.white(formatSize(releasable))}`,
      `Space saved:      ${chalk.green(formatSize(this.#bytesFreed))}`,
      searchStatus,
      ...(buildActionsUnderway && pendingCount > 0 ? [`Pending:          ${chalk.white(pendingCount)}`] : []),
      ...(gcRunningCount > 0 ? [`Running GC:       ${chalk.yellow(gcRunningCount)}`] : []),
      ...(gcDoneCount > 0 ? [`GC space saved:   ${chalk.green(formatSize(gcSaved))}`] : []),
    ];

    // Header: ASCII banner (left) + stats (right)
    for (let i = 0; i < BANNER.length; i++) {
      const art = chalk.red(BANNER[i].padEnd(BANNER_WIDTH));
      const stat = statsCol[i] !== undefined ? '    ' + statsCol[i] : '';
      lines.push(art + stat);
    }
    lines.push(chalk.dim('                              kill-bill-d'));
    lines.push('');

    // Unified scrollable rows
    for (const row of visibleRows) {
      if (row.kind === 'build-header') {
        lines.push(chalk.dim('  ── build output folders ──'));
      } else if (row.kind === 'build-empty') {
        lines.push(chalk.dim('  nothing found'));
      } else if (row.kind === 'gc-header') {
        lines.push(chalk.dim('  ── large .git folders — SPACE to run git gc (git\'s garbage collection) ──'));
      } else if (row.kind === 'gc-entry') {
        const pathStr = this.#formatPath(row.entry.absolutePath, Math.floor(cols * 0.65));
        const isSelected = this.#selectedIndex === this.#entries.length + row.gcIdx;
        lines.push(renderGcRow(row.entry, pathStr, isSelected));
      } else {
        const entry = row.entry;
        const isSelected = row.entryIdx === this.#selectedIndex;

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
        let rowStr = `${prefix}${checkbox} ${pathStr}${statusStr}  ${sizeStr}`;
        if (isSelected && entry.status === 'pending') rowStr = chalk.bold(rowStr);
        lines.push(rowStr);
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
}
