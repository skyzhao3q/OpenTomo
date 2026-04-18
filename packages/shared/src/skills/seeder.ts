/**
 * Skill Seeder
 *
 * Handles copying builtin skills from the app bundle to workspace directories.
 * Skills are seeded on workspace load/creation, with version-based updates
 * on app upgrades.
 *
 * Seeding strategy:
 * - Skill doesn't exist in workspace -> copy from bundle
 * - Skill exists but bundled version is newer -> overwrite
 * - Skill exists with same/newer version -> skip
 *
 * A `.builtin` marker file is placed in each seeded skill directory to
 * identify it as a builtin skill (used by UI to prevent deletion and
 * distinguish source).
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
} from 'fs';
import { join } from 'path';
import { createLogger } from '../utils/debug.ts';
import { getBundledSkillsDir } from '../utils/paths.ts';

const log = createLogger('skill-seeder');

/** Format of the .builtin marker file */
interface BuiltinMarker {
  version: string;
  seedDate: string;
}

/** Manifest entry for a single skill */
interface SkillManifestEntry {
  version: string;
  runtime: string;
  /** Optional category. "system" skills are loaded from bundle, not seeded. */
  category?: string;
}

/** Format of the skills manifest.json */
interface SkillsManifest {
  version: string;
  skills: Record<string, SkillManifestEntry>;
}

/**
 * Read the .builtin marker from a skill directory.
 * Returns null if the marker doesn't exist or is invalid.
 */
function readBuiltinMarker(skillDir: string): BuiltinMarker | null {
  const markerPath = join(skillDir, '.builtin');
  if (!existsSync(markerPath)) return null;

  try {
    return JSON.parse(readFileSync(markerPath, 'utf-8')) as BuiltinMarker;
  } catch {
    return null;
  }
}

/**
 * Write the .builtin marker to a skill directory.
 */
function writeBuiltinMarker(skillDir: string, version: string): void {
  const marker: BuiltinMarker = {
    version,
    seedDate: new Date().toISOString(),
  };
  writeFileSync(join(skillDir, '.builtin'), JSON.stringify(marker, null, 2));
}

/**
 * Simple semver comparison: returns true if versionA > versionB.
 * Handles basic "X.Y.Z" format.
 */
function isNewerVersion(versionA: string, versionB: string): boolean {
  const partsA = versionA.split('.').map(Number);
  const partsB = versionB.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const a = partsA[i] ?? 0;
    const b = partsB[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

/**
 * Load the bundled skills manifest.
 * Returns null if the manifest doesn't exist or is invalid.
 */
function loadBundledManifest(bundledSkillsDir: string): SkillsManifest | null {
  // The manifest is one level up from the builtin skills dir
  // bundledSkillsDir = .../skills/builtin, manifest = .../skills/manifest.json
  const manifestPath = join(bundledSkillsDir, '..', 'manifest.json');
  if (!existsSync(manifestPath)) return null;

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as SkillsManifest;
  } catch {
    log.error('Failed to parse skills manifest');
    return null;
  }
}

/**
 * Seed built-in skills from the app bundle into the workspace skills directory.
 * Skills are identified as built-in via a `.builtin` marker file, which prevents
 * them from appearing in the editable skills list in the UI.
 *
 * Seeding strategy:
 * - Skill doesn't exist in workspace → copy from bundle
 * - Skill exists but bundled version is newer → overwrite
 * - Skill exists with same/newer version → skip
 *
 * @param workspaceRootPath - Absolute path to the workspace root
 */
export function seedBuiltinSkills(workspaceRootPath: string): void {
  const bundledSkillsDir = getBundledSkillsDir();
  if (!bundledSkillsDir) {
    log.debug('[seeder] No bundled skills directory found, skipping');
    return;
  }

  const manifest = loadBundledManifest(bundledSkillsDir);
  if (!manifest) {
    log.debug('[seeder] No manifest found, skipping');
    return;
  }

  const skillsDir = join(workspaceRootPath, 'skills');
  mkdirSync(skillsDir, { recursive: true });

  for (const [slug, entry] of Object.entries(manifest.skills)) {
    const bundledSkillDir = join(bundledSkillsDir, slug);
    const workspaceSkillDir = join(skillsDir, slug);

    if (!existsSync(bundledSkillDir)) continue;

    const existingMarker = readBuiltinMarker(workspaceSkillDir);
    if (existingMarker && !isNewerVersion(entry.version, existingMarker.version)) {
      log.debug(`[seeder] ${slug} v${existingMarker.version} is up to date`);
      continue;
    }

    cpSync(bundledSkillDir, workspaceSkillDir, { recursive: true, force: true });
    writeBuiltinMarker(workspaceSkillDir, entry.version);
    log.debug(`[seeder] Seeded ${slug} v${entry.version}`);
  }
}

/**
 * Check if a skill directory has a .builtin marker.
 * Used by the UI to identify builtin skills and prevent deletion.
 */
export function isBuiltinSkill(skillDir: string): boolean {
  return existsSync(join(skillDir, '.builtin'));
}

/**
 * Get the builtin marker info for a skill, or null if not a builtin skill.
 */
export function getBuiltinMarker(skillDir: string): BuiltinMarker | null {
  return readBuiltinMarker(skillDir);
}
