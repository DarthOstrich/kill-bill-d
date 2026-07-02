import { rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { getDirSize } from './scanner.js';

export async function deleteDir(absolutePath, knownSize) {
  try {
    // Check if path exists
    await access(absolutePath, constants.F_OK);
  } catch (err) {
    return { bytesFreed: 0, error: err.code ?? err.message };
  }

  const bytesFreed = knownSize ?? await getDirSize(absolutePath);
  try {
    await rm(absolutePath, { recursive: true, force: true });
    return { bytesFreed, error: null };
  } catch (err) {
    return { bytesFreed: 0, error: err.code ?? err.message };
  }
}
