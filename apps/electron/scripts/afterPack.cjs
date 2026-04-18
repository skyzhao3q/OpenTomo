/**
 * electron-builder afterPack hook
 *
 * Copies the pre-compiled macOS 26+ Liquid Glass icon (Assets.car) into the
 * app bundle. The Assets.car file is compiled locally using actool with the
 * macOS 26 SDK (not available in CI), then committed to the repo.
 *
 * To regenerate Assets.car after icon changes:
 *   cd apps/electron
 *   xcrun actool "resources/icon.icon" --compile "resources" \
 *     --app-icon AppIcon --minimum-deployment-target 26.0 \
 *     --platform macosx --output-partial-info-plist /dev/null
 *
 * For older macOS versions, the app falls back to icon.icns which is
 * included separately by electron-builder.
 */

const path = require('path');
const fs = require('fs');

module.exports = async function afterPack(context) {
  // Only process macOS builds
  if (context.electronPlatformName !== 'darwin') {
    console.log('Skipping Liquid Glass icon (not macOS)');
    return;
  }

  const appPath = context.appOutDir;
  const resourcesDir = path.join(appPath, 'opentomo.app', 'Contents', 'Resources');

  // Check for libvk_swiftshader.dylib — if missing, remove the referencing ICD JSON
  // to prevent codesign --verify --deep --strict from failing with "file not found".
  // This can happen when: (a) Electron cache is corrupted, or (b) the arm64 Electron
  // distribution intentionally omits the dylib (Apple Silicon has native Metal GPU).
  const frameworkRoot = path.join(
    appPath,
    'opentomo.app',
    'Contents',
    'Frameworks',
    'Electron Framework.framework'
  );
  const versionsDir = path.join(frameworkRoot, 'Versions');
  const currentLink = path.join(versionsDir, 'Current');
  const frameworkLibDir = path.join(versionsDir, 'A', 'Libraries');
  const swiftshaderDylibA = path.join(frameworkLibDir, 'libvk_swiftshader.dylib');

  // Ensure Versions/Current -> A symlink exists; some copy tools may strip symlinks.
  try {
    let needsSymlinkFix = false;
    if (!fs.existsSync(currentLink)) {
      needsSymlinkFix = true;
    } else {
      const stat = fs.lstatSync(currentLink);
      if (!stat.isSymbolicLink()) {
        // Unexpected: Current exists but is not a symlink
        fs.rmSync(currentLink, { recursive: true, force: true });
        needsSymlinkFix = true;
      } else {
        const target = fs.readlinkSync(currentLink);
        if (target !== 'A') {
          // Point symlink to A for deterministic sealing paths
          fs.unlinkSync(currentLink);
          needsSymlinkFix = true;
        }
      }
    }
    if (needsSymlinkFix) {
      if (!fs.existsSync(versionsDir)) fs.mkdirSync(versionsDir, { recursive: true });
      fs.symlinkSync('A', currentLink);
      console.log('afterPack: Recreated Versions/Current -> A symlink');
    }
  } catch (e) {
    console.warn(`afterPack: Could not ensure Versions/Current symlink: ${e.message}`);
  }

  // Validate SwiftShader presence. If missing here, fail early so the artifact never ships sealed
  // with a reference to a non-existent dylib.
  if (!fs.existsSync(swiftshaderDylibA)) {
    const hint = [
      'libvk_swiftshader.dylib not found in Electron Framework. This can occur with a stale or partial Electron cache.',
      'Build script already clears the default cache, but if you override ELECTRON_CACHE ensure it is clean.',
      'Try removing ~/Library/Caches/electron, then rebuild.',
    ].join(' ');
    throw new Error(`afterPack: Missing SwiftShader dylib at ${swiftshaderDylibA}. ${hint}`);
  } else {
    console.log('afterPack: libvk_swiftshader.dylib present under Versions/A/Libraries');
  }
  const precompiledAssets = path.join(context.packager.projectDir, 'resources', 'Assets.car');

  console.log(`afterPack: projectDir=${context.packager.projectDir}`);
  // Check if pre-compiled Assets.car exists
  if (!fs.existsSync(precompiledAssets)) {
    // Fail fast: We declare CFBundleIconName in electron-builder.yml for macOS 26+
    // If Assets.car is missing, the bundle resources may not match expectations,
    // which risks a sealed resource or Gatekeeper assessment failure.
    throw new Error(
      'afterPack: Pre-compiled Assets.car not found in resources/. ' +
      'Regenerate it with:\n' +
      '  xcrun actool "resources/icon.icon" --compile "resources" \\n' +
      '    --app-icon AppIcon --minimum-deployment-target 26.0 \\n' +
      '    --platform macosx --output-partial-info-plist /dev/null' 
    );
  }

  // Copy pre-compiled Assets.car to the app bundle
  const destAssetsCar = path.join(resourcesDir, 'Assets.car');
  try {
    fs.copyFileSync(precompiledAssets, destAssetsCar);
    console.log(`Liquid Glass icon copied: ${destAssetsCar}`);
  } catch (err) {
    // Fail fast to ensure bundle resources are deterministic for sealing.
    throw new Error(`afterPack: Could not copy Assets.car into app bundle: ${err.message}`);
  }

  // Debug: log appOutDir contents right before signing.
  // If asar:true causes "Application could not be found" at signing, this reveals the state.
  try {
    const appOutDirEntries = fs.readdirSync(appPath);
    console.log(`afterPack: appOutDir (${appPath}) contains: [${appOutDirEntries.join(', ')}]`);
    const appBundlePath = path.join(appPath, 'opentomo.app');
    const stat = fs.lstatSync(appBundlePath);
    console.log(`afterPack: opentomo.app isDirectory=${stat.isDirectory()} isSymlink=${stat.isSymbolicLink()}`);
  } catch (e) {
    console.warn(`afterPack: debug check failed: ${e.message}`);
  }
};
