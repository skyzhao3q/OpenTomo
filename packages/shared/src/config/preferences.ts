/**
 * Preferences — Diff Viewer Settings
 *
 * Legacy preferences.json now only stores diff viewer display settings.
 * User info (name, timezone, etc.) has moved to USER.md.
 * Agent identity (agentName, personality) has moved to SOUL.md.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ensureConfigDir } from './storage.ts';
import { CONFIG_DIR } from './paths.ts';

/**
 * Diff viewer display preferences
 * Persisted to preferences.json as a user-level setting
 */
export interface DiffViewerPreferences {
  /** Diff layout: 'unified' (stacked) or 'split' (side-by-side) */
  diffStyle?: 'unified' | 'split';
  /** Whether to disable background highlighting on changed lines */
  disableBackground?: boolean;
}

export interface StoredPreferences {
  // Diff viewer display preferences
  diffViewer?: DiffViewerPreferences;
  // When the preferences were last updated
  updatedAt?: number;
  // Legacy fields preserved for migration (read-only)
  [key: string]: unknown;
}

const PREFERENCES_FILE = join(CONFIG_DIR, 'preferences.json');

export function loadPreferences(): StoredPreferences {
  try {
    if (!existsSync(PREFERENCES_FILE)) {
      return {};
    }
    const content = readFileSync(PREFERENCES_FILE, 'utf-8');
    return JSON.parse(content) as StoredPreferences;
  } catch {
    return {};
  }
}

export function savePreferences(prefs: StoredPreferences): void {
  ensureConfigDir();
  prefs.updatedAt = Date.now();
  writeFileSync(PREFERENCES_FILE, JSON.stringify(prefs, null, 2), 'utf-8');
}

export function getPreferencesPath(): string {
  return PREFERENCES_FILE;
}
