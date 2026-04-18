/**
 * Stage AI SDK dependencies into apps/electron/.sdk-deps/ for packaging.
 * These packages are included as extraResources in the electron-builder config.
 *
 * Only needed for production builds (electron:dist), not for development.
 */
import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const projectRoot = resolve(import.meta.dir, '..');
const electronDir = resolve(projectRoot, 'apps/electron');
const sdkDepsDir = resolve(electronDir, '.sdk-deps');
const rootNodeModules = resolve(projectRoot, 'node_modules');

const packages = [
  'ai',
  '@ai-sdk/google',
  '@ai-sdk/gateway',
  '@ai-sdk/provider',
  '@ai-sdk/provider-utils',
  '@opentelemetry/api',
  '@vercel/oidc',
];

for (const pkg of packages) {
  const src = resolve(rootNodeModules, pkg);
  const dest = resolve(sdkDepsDir, pkg);
  if (existsSync(src)) {
    mkdirSync(resolve(dest, '..'), { recursive: true });
    cpSync(src, dest, { recursive: true });
    console.log(`✓ Staged ${pkg}`);
  } else {
    console.warn(`⚠ Not found: ${pkg}`);
  }
}

console.log('✓ SDK deps staged');
