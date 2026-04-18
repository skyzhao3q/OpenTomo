/**
 * Cross-platform asset copy script.
 *
 * Replaces the 4 platform-specific shell scripts (build:resources, build:resources:win,
 * build:assets, build:assets:win) with a single script using Node's fs.cpSync.
 *
 * Copies two categories of files into dist/:
 * 1. Electron-specific resources (icons, DMG backgrounds) → dist/resources/
 * 2. Bundled config assets (docs, tool-icons, themes, permissions, config-defaults) → dist/assets/
 *
 * The dist/assets/ directory is the canonical location for all bundled assets.
 * At Electron startup, setBundledAssetsRoot(__dirname) is called, and then
 * getBundledAssetsDir('docs') resolves to <__dirname>/assets/docs/, etc.
 *
 * Run: bun scripts/copy-assets.ts
 */

import { cpSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

// ============================================================
// 1. Electron-specific resources (icons, DMG backgrounds, etc.)
// ============================================================
// Exclude icon payloads that are bundled via macOS Assets.car or platform-specific icon files.
// We keep the canonical icon only in the app bundle (Contents/Resources/Assets.car or icon.icns),
// not duplicated inside dist/resources to avoid unintended mutations and duplicated payloads.
cpSync('resources', 'dist/resources', {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src);
    // Skip macOS compiled asset catalog and common icon file types
    if (base === 'Assets.car') return false;
    if (base === 'icon.icns') return false;
    if (base === 'icon.ico') return false;
    if (base === 'icon.png') return false;
    if (base === 'icon.svg') return false;
    // Skip the icon.icon asset catalog source folder (compiled separately)
    if (base === 'icon.icon') return false;
    return true;
  },
});

// ============================================================
// 2. Shared config assets → dist/assets/
//    These are resolved at runtime via getBundledAssetsDir(subfolder)
// ============================================================
mkdirSync('dist/assets', { recursive: true });

// Shared assets from packages/shared/assets/
const sharedAssetsRoot = '../../packages/shared/assets';
for (const dir of ['docs', 'tool-icons']) {
  const src = `${sharedAssetsRoot}/${dir}`;
  if (existsSync(src)) {
    cpSync(src, `dist/assets/${dir}`, { recursive: true });
  }
}

// Config assets from resources/ → also copy to dist/assets/
// (themes and permissions currently live under resources/ alongside Electron icons)
for (const dir of ['themes', 'permissions']) {
  const src = `resources/${dir}`;
  if (existsSync(src)) {
    cpSync(src, `dist/assets/${dir}`, { recursive: true });
  }
}

// Config defaults file (single JSON, not a directory)
// Check for custom config via environment variable (for build-time customization)
const customConfigPath = process.env.CUSTOM_MODELS_CONFIG;
const defaultConfigPath = '../../packages/shared/resources/config-defaults.json';

let configSource = defaultConfigPath;
if (customConfigPath) {
  if (existsSync(customConfigPath)) {
    configSource = customConfigPath;
    console.log(`[copy-assets] Using custom config: ${customConfigPath}`);
  } else {
    console.warn(`[copy-assets] Custom config not found: ${customConfigPath}, using default`);
  }
}

if (existsSync(configSource)) {
  cpSync(configSource, 'dist/assets/config-defaults.json');
  console.log(`[copy-assets] Copied config from: ${configSource}`);
} else {
  console.error(`[copy-assets] Config file not found: ${configSource}`);
}

// Config models file (similar to config-defaults.json)
const configModelsPath = '../../packages/shared/resources/config-models.json';
if (existsSync(configModelsPath)) {
  cpSync(configModelsPath, 'dist/assets/config-models.json');
  console.log('[copy-assets] Copied config-models.json');
} else {
  console.error('[copy-assets] config-models.json not found');
}

// Note: PDF.js worker is handled by Vite via ?url import in PDFPreviewOverlay.tsx
