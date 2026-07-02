import readline from 'node:readline';
import chalk from 'chalk';

export function formatSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
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
  #bytesFreed = 0;
  #onDelete;
  #scanStart = Date.now();

  constructor(onDelete) {
    this.#onDelete = onDelete;
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on('keypress', (_, key) => this.#handleKey(key));
    process.on('SIGWINCH', () => this.#draw());
    process.stdout.write('\x1B[?25l');
  }

  addEntry(entry) {
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

  setScanComplete() {
    this.#scanning = false;
    this.#draw();
  }

  destroy() {
    process.stdout.write('\x1B[H\x1B[2J'); // clear screen
    process.stdout.write('\x1B[?25h');      // show cursor
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(`Space released: ${chalk.bold(formatSize(this.#bytesFreed))}\n`);
    process.stdout.write(chalk.green('Thanks for using kill-bill-d!\n'));
  }

  #find(absolutePath) {
    return this.#entries.find(e => e.absolutePath === absolutePath);
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
      this.#selectedIndex = Math.min(this.#entries.length - 1, this.#selectedIndex + 1);
      this.#draw();
    }
    if (seq === ' ' || seq === 'd') {
      const entry = this.#entries[this.#selectedIndex];
      if (entry?.status === 'pending') this.#onDelete(entry.absolutePath, entry.size);
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
