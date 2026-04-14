#!/usr/bin/env node
/**
 * Global CLI entry: forwards argv to the pipeline script next to this package.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const binDir = dirname(fileURLToPath(import.meta.url));
const pipeline = join(binDir, '..', 'scripts', 'research-to-obsidian.mjs');

const r = spawnSync(process.execPath, [pipeline, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (r.error) {
  console.error(r.error.message || String(r.error));
  process.exit(1);
}

process.exit(r.status === null ? 1 : r.status);
