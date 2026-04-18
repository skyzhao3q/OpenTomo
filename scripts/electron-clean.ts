/**
 * Clean the Electron dist directory.
 */
import { rmSync } from 'fs';
import { resolve } from 'path';

const projectRoot = resolve(import.meta.dir, '..');
const distDir = resolve(projectRoot, 'apps/electron/dist');

rmSync(distDir, { recursive: true, force: true });
console.log('✓ dist/ cleaned');
