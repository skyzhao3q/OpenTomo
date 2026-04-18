/**
 * Build the Electron renderer process with Vite.
 */
import { spawnSync } from 'child_process';
import { resolve } from 'path';

const projectRoot = resolve(import.meta.dir, '..');
const electronDir = resolve(projectRoot, 'apps/electron');

const result = spawnSync('bun', ['run', 'build:renderer'], {
  cwd: electronDir,
  stdio: 'inherit',
  env: { ...process.env },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('✓ Renderer built');
