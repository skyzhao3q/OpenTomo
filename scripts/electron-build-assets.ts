/**
 * Copy bundled config assets to dist/assets/.
 * Delegates to the app-level copy-assets.ts script.
 */
import { spawnSync } from 'child_process';
import { resolve } from 'path';

const projectRoot = resolve(import.meta.dir, '..');
const electronDir = resolve(projectRoot, 'apps/electron');

const result = spawnSync('bun', ['run', 'build:copy'], {
  cwd: electronDir,
  stdio: 'inherit',
  env: { ...process.env },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('✓ Assets copied');
