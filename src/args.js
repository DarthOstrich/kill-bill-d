export function parseArgs(argv) {
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
