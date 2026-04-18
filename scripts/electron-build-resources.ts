/**
 * Copy Electron resources (icons, DMG backgrounds) to dist/resources/.
 */
import { cpSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const projectRoot = resolve(import.meta.dir, '..');
const electronDir = resolve(projectRoot, 'apps/electron');

mkdirSync(resolve(electronDir, 'dist/resources'), { recursive: true });

cpSync(resolve(electronDir, 'resources'), resolve(electronDir, 'dist/resources'), {
  recursive: true,
  filter: (src: string) => {
    const base = src.split('/').pop()!;
    return !['Assets.car', 'icon.icns', 'icon.ico', 'icon.png', 'icon.svg', 'icon.icon'].includes(base);
  },
});

console.log('✓ Resources copied');
