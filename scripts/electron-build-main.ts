/**
 * Build the Electron main process with esbuild.
 * Bundles all dependencies except Electron itself and native modules.
 */
import { build } from 'esbuild';
import { resolve } from 'path';

const projectRoot = resolve(import.meta.dir, '..');
const electronDir = resolve(projectRoot, 'apps/electron');

await build({
  entryPoints: [resolve(electronDir, 'src/main/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: resolve(electronDir, 'dist/main.cjs'),
  external: ['electron', 'node-pty', 'electron-log', 'electron-updater', '@aws-sdk/client-s3'],
  sourcemap: true,
  target: 'node22',
  absWorkingDir: electronDir,
});

console.log('✓ Main process built');
