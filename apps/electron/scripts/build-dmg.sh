#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$ELECTRON_DIR")")"

# Helper function to check required file/directory exists
require_path() {
    local path="$1"
    local description="$2"
    local hint="$3"

    if [ ! -e "$path" ]; then
        echo "ERROR: $description not found at $path"
        [ -n "$hint" ] && echo "$hint"
        exit 1
    fi
}

# Sync secrets from 1Password if CLI is available
if command -v op &> /dev/null; then
    echo "1Password CLI detected, syncing secrets..."
    cd "$ROOT_DIR"
    if bun run sync-secrets 2>/dev/null; then
        echo "Secrets synced from 1Password"
    else
        echo "Warning: Failed to sync secrets from 1Password (continuing with existing .env if present)"
    fi
fi

# Load environment variables from .env
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    source "$ROOT_DIR/.env"
    set +a
fi

# Parse arguments
ARCH="arm64"
UPLOAD=false
UPLOAD_LATEST=false
UPLOAD_SCRIPT=false

show_help() {
    cat << EOF
Usage: build-dmg.sh [arm64|x64] [--upload] [--latest] [--script]

Arguments:
  arm64|x64    Target architecture (default: arm64)
  --upload     Upload DMG to S3 after building
  --latest     Also update electron/latest (requires --upload)
  --script     Also upload install-app.sh (requires --upload)

Environment variables (from .env or environment):
  APPLE_SIGNING_IDENTITY    - Code signing identity
  APPLE_ID                  - Apple ID for notarization
  APPLE_TEAM_ID             - Apple Team ID
  APPLE_APP_SPECIFIC_PASSWORD - App-specific password
  S3_VERSIONS_BUCKET_*      - S3 credentials (for --upload)
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        arm64|x64)     ARCH="$1"; shift ;;
        --upload)      UPLOAD=true; shift ;;
        --latest)      UPLOAD_LATEST=true; shift ;;
        --script)      UPLOAD_SCRIPT=true; shift ;;
        -h|--help)     show_help ;;
        *)
            echo "Unknown option: $1"
            echo "Run with --help for usage"
            exit 1
            ;;
    esac
done

# Configuration
BUN_VERSION="bun-v1.3.5"  # Pinned version for reproducible builds
NODE_VERSION="v20.18.0"   # Node.js LTS — pinned for reproducible builds

echo "=== Building OpenTomo DMG (${ARCH}) using electron-builder ==="
if [ "$UPLOAD" = true ]; then
    echo "Will upload to S3 after build"
fi

# 1. Clean previous build artifacts
echo "Cleaning previous builds..."
rm -rf "$ELECTRON_DIR/vendor"
rm -rf "$ELECTRON_DIR/node_modules/@anthropic-ai"
rm -rf "$ELECTRON_DIR/packages"
rm -rf "$ELECTRON_DIR/release"
rm -rf "$ELECTRON_DIR/.sdk-deps"

# Clear Electron download cache to ensure a complete, uncorrupted Electron Framework.
# A partial cache can cause libvk_swiftshader.dylib to be missing from the bundle,
# which breaks codesign --verify --deep --strict and Gatekeeper acceptance.
ELECTRON_CACHE_DIR="${ELECTRON_CACHE:-$HOME/Library/Caches/electron}"
echo "Clearing Electron download cache: $ELECTRON_CACHE_DIR"
rm -rf "$ELECTRON_CACHE_DIR"

# 2. Install dependencies
echo "Installing dependencies..."
cd "$ROOT_DIR"
bun install

# 3. Download Bun binary with checksum verification
echo "Downloading Bun ${BUN_VERSION} for darwin-${ARCH}..."
mkdir -p "$ELECTRON_DIR/vendor/bun"
BUN_DOWNLOAD="bun-darwin-$([ "$ARCH" = "arm64" ] && echo "aarch64" || echo "x64")"

# Create temp directory to avoid race conditions
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Download binary and checksums
curl -fSL "https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/${BUN_DOWNLOAD}.zip" -o "$TEMP_DIR/${BUN_DOWNLOAD}.zip"
curl -fSL "https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/SHASUMS256.txt" -o "$TEMP_DIR/SHASUMS256.txt"

# Verify checksum
echo "Verifying checksum..."
cd "$TEMP_DIR"
grep "${BUN_DOWNLOAD}.zip" SHASUMS256.txt | shasum -a 256 -c -
cd - > /dev/null

# Extract and install
unzip -o "$TEMP_DIR/${BUN_DOWNLOAD}.zip" -d "$TEMP_DIR"
cp "$TEMP_DIR/${BUN_DOWNLOAD}/bun" "$ELECTRON_DIR/vendor/bun/"
chmod +x "$ELECTRON_DIR/vendor/bun/bun"

# 4. Download Node.js LTS binary
echo "Downloading Node.js ${NODE_VERSION} for darwin-${ARCH}..."
mkdir -p "$ELECTRON_DIR/vendor/node"
NODE_ARCH=$([ "$ARCH" = "arm64" ] && echo "arm64" || echo "x64")
NODE_TARBALL="node-${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
curl -fSL "https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}" -o "$TEMP_DIR/${NODE_TARBALL}"
tar -xzf "$TEMP_DIR/${NODE_TARBALL}" -C "$TEMP_DIR"
cp "$TEMP_DIR/node-${NODE_VERSION}-darwin-${NODE_ARCH}/bin/node" "$ELECTRON_DIR/vendor/node/node"
chmod +x "$ELECTRON_DIR/vendor/node/node"
echo "Node.js downloaded: $(file "$ELECTRON_DIR/vendor/node/node")"

# 5. Copy SDK from root node_modules (monorepo hoisting)
# Note: The SDK is hoisted to root node_modules by the package manager.
# We copy it here because electron-builder only sees apps/electron/.
SDK_SOURCE="$ROOT_DIR/node_modules/@anthropic-ai/claude-agent-sdk"
require_path "$SDK_SOURCE" "SDK" "Run 'bun install' from the repository root first."
echo "Copying SDK..."
mkdir -p "$ELECTRON_DIR/node_modules/@anthropic-ai"
cp -r "$SDK_SOURCE" "$ELECTRON_DIR/node_modules/@anthropic-ai/"

# 6. Copy interceptor
INTERCEPTOR_SOURCE="$ROOT_DIR/packages/shared/src/network-interceptor.ts"
require_path "$INTERCEPTOR_SOURCE" "Interceptor" "Ensure packages/shared/src/network-interceptor.ts exists."
echo "Copying interceptor..."
mkdir -p "$ELECTRON_DIR/packages/shared/src"
cp "$INTERCEPTOR_SOURCE" "$ELECTRON_DIR/packages/shared/src/"

# 7. Register builtin skills and build Electron app
echo "Registering builtin skills..."
cd "$ROOT_DIR"
bun scripts/register-skills.ts

echo "Building Electron app..."
NODE_ENV=production bun run electron:build

# 8. Package with electron-builder
echo "Packaging app with electron-builder..."
cd "$ELECTRON_DIR"

# Build electron-builder arguments
# Use zip target only — dmgbuild (used by electron-builder for DMG) is unreliable and
# causes "No space left on device" errors that corrupt the DMG (missing libvk_swiftshader.dylib).
# The DMG is created manually below using hdiutil + ditto instead.
BUILDER_ARGS="--mac zip --${ARCH}"

# Resolve signing identity: use APPLE_SIGNING_IDENTITY from .env, or auto-discover from keychain.
# This ensures vendor binary pre-signing always works when a valid certificate is installed.
SIGN_IDENTITY=""
if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
    SIGN_IDENTITY="$APPLE_SIGNING_IDENTITY"
else
    # Auto-discover: find the first "Developer ID Application" identity in the keychain
    DISCOVERED=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)"/\1/')
    if [ -n "$DISCOVERED" ]; then
        SIGN_IDENTITY="$DISCOVERED"
        echo "Auto-discovered signing identity: $SIGN_IDENTITY"
    fi
fi

if [ -n "$SIGN_IDENTITY" ]; then
    # Strip "Developer ID Application: " prefix if present (electron-builder adds it automatically)
    CSC_NAME_CLEAN="${SIGN_IDENTITY#Developer ID Application: }"
    echo "Using signing identity: $CSC_NAME_CLEAN"
    export CSC_NAME="$CSC_NAME_CLEAN"
    export CSC_IDENTITY_AUTO_DISCOVERY=false
else
    echo "Warning: No signing identity found. Build will not be signed."
    export CSC_IDENTITY_AUTO_DISCOVERY=true
fi

# Add notarization if all credentials are available (API key method or password method)
if { [ -n "$APPLE_API_KEY" ] && [ -n "$APPLE_API_KEY_ID" ] && [ -n "$APPLE_API_ISSUER" ]; } || \
   { [ -n "$APPLE_ID" ] && [ -n "$APPLE_TEAM_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ]; }; then
    echo "Notarization enabled"
    export APPLE_ID="$APPLE_ID"
    export APPLE_TEAM_ID="$APPLE_TEAM_ID"
    export APPLE_APP_SPECIFIC_PASSWORD="$APPLE_APP_SPECIFIC_PASSWORD"
fi

# Pre-sign vendor binaries before electron-builder.
# All Mach-O executables inside the bundle must be signed with Hardened Runtime
# before notarization. electron-builder signs the outer bundle, but does not
# re-sign individual vendor binaries — they must go in already signed.
if [ -n "$SIGN_IDENTITY" ]; then
    echo "Pre-signing vendor binaries with: $SIGN_IDENTITY"
    for bin in "$ELECTRON_DIR/vendor/bun/bun" "$ELECTRON_DIR/vendor/node/node"; do
        codesign --sign "$SIGN_IDENTITY" --force --timestamp --options runtime \
            --entitlements "$ELECTRON_DIR/build/entitlements.mac.inherit.plist" \
            "$bin"
        codesign --verify --verbose "$bin"
    done
    echo "Vendor binaries signed successfully"

    # Sign node-pty native addon (.node files are Mach-O dylibs, must be signed for notarization)
    echo "Pre-signing node-pty native addon..."
    for addon in \
        "$ELECTRON_DIR/node_modules/node-pty/prebuilds/darwin-${ARCH}/"*.node \
        "$ELECTRON_DIR/node_modules/node-pty/build/Release/"*.node; do
        [ -f "$addon" ] || continue
        codesign --sign "$SIGN_IDENTITY" --force --timestamp --options runtime \
            --entitlements "$ELECTRON_DIR/build/entitlements.mac.inherit.plist" \
            "$addon"
        echo "Signed: $addon"
    done
else
    echo "Warning: No signing identity set, skipping vendor binary pre-signing"
fi

# Run electron-builder
npx electron-builder $BUILDER_ARGS

# 8.1 Create DMG manually with hdiutil + ditto
# electron-builder's dmgbuild Python tool is unreliable — it creates a disk image that is
# too small, causing "No space left on device" during ditto which silently omits files like
# libvk_swiftshader.dylib. Using hdiutil with explicit size + ditto avoids this entirely.
create_dmg_manually() {
    local arch="$1"
    local app_dir="$2"
    local app_path="$ELECTRON_DIR/release/$app_dir/opentomo.app"
    local out_dmg="$ELECTRON_DIR/release/opentomo-$arch.dmg"
    local temp_dmg
    temp_dmg=$(mktemp -t "opentomo-${arch}-rw-XXXXXX").dmg

    require_path "$app_path" "Built .app ($arch)" "electron-builder must run first."

    local app_size_mb
    app_size_mb=$(du -sm "$app_path" | cut -f1)
    local dmg_size_mb=$(( app_size_mb + 200 ))

    echo "Creating writable DMG (${dmg_size_mb}MB)..."
    hdiutil create -size "${dmg_size_mb}m" -fs "HFS+" -volname "opentomo" -layout SPUD "$temp_dmg"

    # Use a fixed mount point to avoid locale-dependent parsing of diskutil output
    local mnt="/tmp/opentomo-dmg-build-${arch}"
    rm -rf "$mnt"
    mkdir -p "$mnt"
    hdiutil attach -readwrite -noverify -mountpoint "$mnt" "$temp_dmg"
    echo "Mounted at: $mnt"

    echo "Copying .app with ditto (preserving signatures)..."
    ditto "$app_path" "$mnt/opentomo.app"

    local libvk="$mnt/opentomo.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libvk_swiftshader.dylib"
    if [ ! -f "$libvk" ]; then
        hdiutil detach "$mnt" -quiet
        echo "ERROR: libvk_swiftshader.dylib missing after ditto copy. Aborting."; exit 1
    fi
    echo "libvk_swiftshader.dylib: present"

    ln -sf /Applications "$mnt/Applications"
    hdiutil detach "$mnt" -quiet

    rm -f "$out_dmg"
    echo "Converting to compressed DMG..."
    hdiutil convert "$temp_dmg" -format UDZO -imagekey zlib-level=9 -o "$out_dmg"
    rm -f "$temp_dmg"
    echo "Created: $out_dmg ($(du -sh "$out_dmg" | cut -f1))"
}

echo "Creating DMG with hdiutil (bypassing dmgbuild)..."
if [ "$ARCH" = "arm64" ]; then
    create_dmg_manually "arm64" "mac-arm64"
else
    create_dmg_manually "x64" "mac"
fi

# 8.2 Staple notarization ticket to the built .app and DMG (if notarized)
staple_artifacts() {
    local arch="$1"
    local app_dir="$2"

    local app_path="$ELECTRON_DIR/release/${app_dir}/opentomo.app"
    local dmg_path="$ELECTRON_DIR/release/opentomo-${arch}.dmg"

    if { [ -n "$APPLE_API_KEY" ] && [ -n "$APPLE_API_KEY_ID" ] && [ -n "$APPLE_API_ISSUER" ]; } || \
       { [ -n "$APPLE_ID" ] && [ -n "$APPLE_TEAM_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ]; }; then
        echo "Stapling notarization ticket to .app (${arch})..."
        if ! xcrun stapler staple -v "$app_path"; then
            echo "ERROR: Stapling failed for $app_path"; exit 1;
        fi

        # Submit DMG to notarytool — electron-builder only notarizes the .app,
        # not the DMG container. The DMG must be submitted separately so that
        # a ticket can be stapled to it.
        echo "Submitting DMG to notarytool (${arch})..."
        if [ -n "$APPLE_API_KEY" ] && [ -n "$APPLE_API_KEY_ID" ] && [ -n "$APPLE_API_ISSUER" ]; then
            xcrun notarytool submit "$dmg_path" \
                --key "$APPLE_API_KEY" \
                --key-id "$APPLE_API_KEY_ID" \
                --issuer "$APPLE_API_ISSUER" \
                --wait
        else
            xcrun notarytool submit "$dmg_path" \
                --apple-id "$APPLE_ID" \
                --team-id "$APPLE_TEAM_ID" \
                --password "$APPLE_APP_SPECIFIC_PASSWORD" \
                --wait
        fi

        echo "Stapling notarization ticket to DMG (${arch})..."
        if ! xcrun stapler staple -v "$dmg_path"; then
            echo "ERROR: Stapling failed for $dmg_path"; exit 1;
        fi
    else
        echo "Notarization credentials not set; skipping stapling."
    fi
}

# 8.2 Preserve per-arch latest-mac.yml and merge into a combined manifest when both are available
preserve_and_merge_latest_yaml() {
    local arch="$1"
    local yaml_path="$ELECTRON_DIR/release/latest-mac.yml"
    local arch_yaml="$ELECTRON_DIR/release/latest-mac.${arch}.yml"

    if [ -f "$yaml_path" ]; then
        cp "$yaml_path" "$arch_yaml"
        echo "Saved per-arch manifest: $(basename "$arch_yaml")"
    else
        echo "Warning: $yaml_path not found; skipping per-arch manifest save"
    fi

    local arm_yaml="$ELECTRON_DIR/release/latest-mac.arm64.yml"
    local x64_yaml="$ELECTRON_DIR/release/latest-mac.x64.yml"

    if [ -f "$arm_yaml" ] && [ -f "$x64_yaml" ]; then
        echo "Merging manifests into latest-mac.yml (arm64 + x64)..."
        node - "$ELECTRON_DIR/release" <<'NODE'
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

const releaseDir = process.argv[2];
const outPath = path.join(releaseDir, 'latest-mac.yml');
const armPath = path.join(releaseDir, 'latest-mac.arm64.yml');
const x64Path = path.join(releaseDir, 'latest-mac.x64.yml');

function safeLoad(p){
  try { return yaml.load(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const arm = safeLoad(armPath) || {};
const x64 = safeLoad(x64Path) || {};

const files = [];
for (const doc of [arm, x64]) {
  if (doc && Array.isArray(doc.files)) {
    for (const f of doc.files) {
      if (f && f.arch && !files.find(e => e.arch === f.arch)) files.push(f);
    }
  }
}

const version = arm.version || x64.version || '';
// Prefer the last built architecture's default path if available; fall back to any file
let pathEntry = (x64.files && x64.files[0]) || (arm.files && arm.files[0]) || null;
const out = {
  version,
  files,
  ...(pathEntry ? { path: pathEntry.url, sha512: pathEntry.sha512 } : {}),
  // Preserve releaseDate if present
  releaseDate: x64.releaseDate || arm.releaseDate
};

fs.writeFileSync(outPath, yaml.dump(out), 'utf8');
console.log('Wrote merged manifest:', outPath);
NODE
    fi
}

# 8.3 Verify the DMGs were built
verify_dmg() {
    local arch="$1"
    local app_dir="$2"
    local dmg_path="$ELECTRON_DIR/release/opentomo-${arch}.dmg"

    if [ ! -f "$dmg_path" ]; then
        echo "ERROR: Expected DMG not found at $dmg_path"
        echo "Contents of release directory:"
        ls -la "$ELECTRON_DIR/release/"
        exit 1
    fi

    echo ""
    echo "=== Verifying ${arch} build ==="
    echo "DMG: $dmg_path ($(du -h "$dmg_path" | cut -f1))"

    # Verify deep code signature on the packed app
    echo "Checking code signature (${arch})..."
    codesign --verify --deep --strict "$ELECTRON_DIR/release/${app_dir}/opentomo.app" \
        || { echo "ERROR: Code signature invalid for ${arch} app. Aborting."; exit 1; }

    # Mount DMG at a fixed mount point (avoids locale-dependent parsing of diskutil output)
    local mnt="/tmp/opentomo-dmg-verify-${arch}"
    rm -rf "$mnt"
    mkdir -p "$mnt"
    hdiutil attach "$dmg_path" -nobrowse -readonly -mountpoint "$mnt" \
        || { echo "ERROR: Could not mount ${arch} DMG. Aborting."; exit 1; }
    echo "Mounted ${arch} DMG at $mnt"

    codesign --verify --deep --strict "$mnt/opentomo.app" \
        || { hdiutil detach "$mnt" -quiet; echo "ERROR: Code signature invalid in ${arch} DMG. Aborting."; exit 1; }

    spctl -a -vv -t exec "$mnt/opentomo.app" \
        || { hdiutil detach "$mnt" -quiet; echo "ERROR: Gatekeeper rejected ${arch} app in DMG. Aborting."; exit 1; }

    # Perform install-type assessment as used in user reports
    spctl -a -vv -t install "$mnt/opentomo.app" \
        || { hdiutil detach "$mnt" -quiet; echo "ERROR: Gatekeeper (install) rejected ${arch} app in DMG. Aborting."; exit 1; }

    echo "${arch} DMG: OK (Notarized Developer ID accepted)"
    hdiutil detach "$mnt" -quiet
}

if [ "$ARCH" = "arm64" ]; then
    staple_artifacts "arm64" "mac-arm64"
    preserve_and_merge_latest_yaml "arm64"
    verify_dmg "arm64" "mac-arm64"
else
    staple_artifacts "x64" "mac"
    preserve_and_merge_latest_yaml "x64"
    verify_dmg "x64" "mac"
fi

echo ""
echo "=== Build Complete ==="

# 9. Create manifest.json for upload script
# Read version from package.json
ELECTRON_VERSION=$(cat "$ELECTRON_DIR/package.json" | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
echo "Creating manifest.json (version: $ELECTRON_VERSION)..."
mkdir -p "$ROOT_DIR/.build/upload"
echo "{\"version\": \"$ELECTRON_VERSION\"}" > "$ROOT_DIR/.build/upload/manifest.json"

# 10. Upload to S3 (if --upload flag is set)
if [ "$UPLOAD" = true ]; then
    echo ""
    echo "=== Uploading to S3 ==="

    # Check for S3 credentials
    if [ -z "$S3_VERSIONS_BUCKET_ENDPOINT" ] || [ -z "$S3_VERSIONS_BUCKET_ACCESS_KEY_ID" ] || [ -z "$S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY" ]; then
        cat << EOF
ERROR: Missing S3 credentials. Set these environment variables:
  S3_VERSIONS_BUCKET_ENDPOINT
  S3_VERSIONS_BUCKET_ACCESS_KEY_ID
  S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY

You can add them to .env or export them directly.
EOF
        exit 1
    fi

    # Build upload flags
    UPLOAD_FLAGS="--electron"
    [ "$UPLOAD_LATEST" = true ] && UPLOAD_FLAGS="$UPLOAD_FLAGS --latest"
    [ "$UPLOAD_SCRIPT" = true ] && UPLOAD_FLAGS="$UPLOAD_FLAGS --script"

    cd "$ROOT_DIR"
    bun run scripts/upload.ts $UPLOAD_FLAGS

    echo ""
    echo "=== Upload Complete ==="
fi
