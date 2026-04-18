/**
 * USER.md — User Context & Information
 *
 * Manages the USER.md file which stores user information for system prompt injection.
 * Uses YAML front matter for structured fields and markdown body for free-form notes.
 *
 * File path: ~/.opentomo/USER.md (global only — no workspace override)
 *
 * YAML front matter fields:
 * - name: User's display name
 * - timezone: e.g., "America/New_York"
 * - language: Preferred response language (e.g., "en", "ja")
 * - city: User's city
 * - country: User's country
 *
 * Body: Free-form notes about the user (previously preferences.json "notes" field)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { join, dirname } from 'path';
import { CONFIG_DIR } from '../config/paths.ts';
import { parseFrontmatter, serializeFrontmatter, type ParsedFrontmatter } from './frontmatter.ts';

// ============================================================
// Constants
// ============================================================

/** Maximum character count for USER.md content in system prompt */
const MAX_USER_SIZE = 2_000;

const USER_FILENAME = 'USER.md';

/**
 * Maps locale codes to human-readable language names for System Prompt injection.
 * Includes native script for clarity to the LLM.
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese (日本語)',
  zh: 'Chinese (中文)',
  ko: 'Korean (한국어)',
  es: 'Spanish (Español)',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
};

// ============================================================
// Types
// ============================================================

export interface UserData {
  name?: string;
  timezone?: string;
  language?: string;
  city?: string;
  country?: string;
}

// ============================================================
// Path Resolution
// ============================================================

/** Get the USER.md path (~/.opentomo/USER.md) */
export function getUserMdPath(): string {
  return join(CONFIG_DIR, USER_FILENAME);
}

// ============================================================
// Loading
// ============================================================

/**
 * Load USER.md and parse front matter.
 * Returns null if file doesn't exist.
 */
export function loadUserContext(): ParsedFrontmatter<UserData> | null {
  try {
    const raw = readFileSync(getUserMdPath(), 'utf-8');
    return parseFrontmatter<UserData>(raw);
  } catch {
    return null;
  }
}

/**
 * Async version of loadUserContext using fs.promises.readFile.
 * Used by formatUserContextForPrompt for non-blocking I/O.
 */
async function loadUserContextAsync(): Promise<ParsedFrontmatter<UserData> | null> {
  try {
    const raw = await fsPromises.readFile(getUserMdPath(), 'utf-8');
    return parseFrontmatter<UserData>(raw);
  } catch {
    return null;
  }
}

// ============================================================
// Prompt Generation
// ============================================================

/**
 * Format USER.md content for system prompt injection.
 *
 * Combines front matter structured fields and body notes into a readable
 * prompt section. Returns empty string if no USER.md exists or is empty.
 *
 * Output format:
 * ## User Information
 * - Name: John Doe
 * - Timezone: America/New_York
 * - Preferred language: Japanese (日本語)
 * **IMPORTANT: You MUST respond in the user's preferred language...**
 * - Location: Tokyo, Japan
 *
 * ### User Notes
 * (body content)
 */
export async function formatUserContextForPrompt(): Promise<string> {
  const user = await loadUserContextAsync();
  if (!user) return '';

  const { data, content } = user;
  const lines: string[] = [];

  if (data.name) {
    lines.push(`- Name: ${data.name}`);
  }

  if (data.timezone) {
    lines.push(`- Timezone: ${data.timezone}`);
  }

  if (data.language) {
    const langName = LANGUAGE_NAMES[data.language] || data.language;
    lines.push(`- Preferred language: ${langName}`);
    lines.push('');
    lines.push(
      "**IMPORTANT: You MUST respond in the user's preferred language above. " +
      'All responses, explanations, and conversational text must be in this language ' +
      'unless the user explicitly requests otherwise. Technical terms and code itself ' +
      'should remain in English, but all surrounding text must be in the preferred language.**'
    );
  }

  if (data.city || data.country) {
    const parts = [data.city, data.country].filter(Boolean);
    if (parts.length > 0) {
      lines.push(`- Location: ${parts.join(', ')}`);
    }
  }

  const body = content.trim();
  if (body) {
    lines.push('', '### User Notes', body);
  }

  if (lines.length === 0) return '';

  // Build the full section
  const fullSection = `\n## User Information\n\n${lines.join('\n')}\n\n`;

  // Truncate if needed
  if (fullSection.length > MAX_USER_SIZE) {
    return fullSection.slice(0, MAX_USER_SIZE) + '\n...(truncated)\n\n';
  }

  return fullSection;
}

// ============================================================
// UI Read/Write
// ============================================================

/**
 * Read the USER.md file content.
 * Returns null if file doesn't exist.
 */
export function readUserMd(): { content: string; path: string } | null {
  const path = getUserMdPath();
  try {
    const content = readFileSync(path, 'utf-8');
    return { content, path };
  } catch {
    return null;
  }
}

/**
 * Write content to the USER.md file.
 * Creates parent directories if needed.
 */
export function writeUserMd(content: string): void {
  const path = getUserMdPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

// ============================================================
// Migration from preferences.json
// ============================================================

/**
 * Migrate data from preferences.json to USER.md and SOUL.md.
 *
 * Only runs if:
 * - ~/.opentomo/preferences.json exists
 * - ~/.opentomo/USER.md does NOT exist (prevents double migration)
 *
 * Extracts:
 * - name, timezone, language, location → USER.md front matter
 * - notes → USER.md body
 * - agentName → SOUL.md front matter (via writeGlobalSoulMd)
 *
 * preferences.json is NOT deleted (left as a dead file).
 */
export function migrateFromPreferencesJson(): void {
  const prefsPath = join(CONFIG_DIR, 'preferences.json');
  const userMdPath = getUserMdPath();

  // Only migrate if preferences.json exists and USER.md doesn't
  try { readFileSync(userMdPath); return; } catch { /* USER.md doesn't exist — proceed */ }

  try {
    let raw: string;
    try { raw = readFileSync(prefsPath, 'utf-8'); } catch { return; /* preferences.json doesn't exist */ }
    const prefs = JSON.parse(raw) as Record<string, unknown>;

    // Build USER.md
    const userData: UserData = {};
    if (prefs.name && typeof prefs.name === 'string') userData.name = prefs.name;
    if (prefs.timezone && typeof prefs.timezone === 'string') userData.timezone = prefs.timezone;
    if (prefs.language && typeof prefs.language === 'string') userData.language = prefs.language;

    const location = prefs.location as Record<string, string> | undefined;
    if (location) {
      if (location.city) userData.city = location.city;
      if (location.country) userData.country = location.country;
    }

    const notes = typeof prefs.notes === 'string' ? prefs.notes.trim() : '';
    const body = notes ? `## Notes\n\n${notes}\n` : '';

    const userMdContent = serializeFrontmatter(userData, body);
    writeUserMd(userMdContent);

    // Migrate agentName to SOUL.md if present
    if (prefs.agentName && typeof prefs.agentName === 'string') {
      const soulMdPath = join(CONFIG_DIR, 'SOUL.md');
      // Only write if SOUL.md doesn't already exist
      let soulExists = false;
      try { readFileSync(soulMdPath); soulExists = true; } catch { /* doesn't exist */ }
      if (!soulExists) {
        const soulContent = serializeFrontmatter({ agentName: prefs.agentName }, '');
        mkdirSync(dirname(soulMdPath), { recursive: true });
        writeFileSync(soulMdPath, soulContent, 'utf-8');
      }
    }
  } catch {
    // Migration failure is non-fatal — user can manually migrate
  }
}
