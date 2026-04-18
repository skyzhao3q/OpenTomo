/**
 * Build the Electron preload script with esbuild.
 */
import { build } from 'esbuild';
import { resolve } from 'path';

const projectRoot = resolve(import.meta.dir, '..');
const electronDir = resolve(projectRoot, 'apps/electron');

await build({
  entryPoints: [resolve(electronDir, 'src/preload/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: resolve(electronDir, 'dist/preload.cjs'),
  external: ['electron'],
  sourcemap: true,
  target: 'node22',
  absWorkingDir: electronDir,
});

console.log('✓ Preload built');
