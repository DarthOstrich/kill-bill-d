#!/usr/bin/env node
import { scan } from '../src/scanner.js';
import Renderer from '../src/renderer.js';
import { deleteDir } from '../src/deleter.js';

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
  for await (const entry of scan(process.cwd())) {
    renderer.addEntry(entry);
  }
  renderer.setScanComplete();
} catch (err) {
  renderer.destroy();
  console.error(err);
  process.exit(1);
}
