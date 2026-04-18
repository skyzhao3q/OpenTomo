/**
 * Config File Watcher
 *
 * Watches configuration files for changes and triggers callbacks.
 * Uses recursive directory watching for simplicity and reliability.
 *
 * Watched paths:
 * - ~/.opentomo/config.json - Main app configuration
 * - ~/.opentomo/preferences.json - User preferences
 * - ~/.opentomo/theme.json - App-level theme overrides
 * - ~/.opentomo/themes/*.json - Preset theme files (app-level)
 * - ~/.opentomo/workspaces/{slug}/ - Workspace directory (recursive)
 *   - sources/{slug}/config.json, guide.md, permissions.json
 *   - skills/{slug}/SKILL.md, icon.*
 *   - sessions/{id}/session.jsonl (header metadata only)
 *   - permissions.json
 */

import { watch, existsSync, readdirSync, statSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname, basename, relative } from 'path';
import type { FSWatcher } from 'fs';
import { CONFIG_DIR } from './paths.ts';
import { debug } from '../utils/debug.ts';
import { perf } from '../utils/perf.ts';
import { loadStoredConfig, type StoredConfig } from './storage.ts';
import {
  validateConfig,
  validatePreferences,
  type ValidationResult,
} from './validators.ts';
import { permissionsConfigCache, getAppPermissionsDir } from '../agent/permissions-config.ts';
import { getWorkspacePath, getWorkspaceSkillsPath, getWorkspaceCommandsPath } from '../workspaces/storage.ts';
import type { LoadedSkill } from '../skills/types.ts';
import { loadSkill, loadWorkspaceSkills, skillNeedsIconDownload, downloadSkillIcon } from '../skills/storage.ts';
import type { LoadedCommand } from '../commands/types.ts';
import { loadCommand, loadAllCommands } from '../commands/storage.ts';
import { readSessionHeader } from '../sessions/jsonl.ts';
import type { SessionHeader } from '../sessions/types.ts';
import { loadAppTheme, loadPresetThemes, loadPresetTheme, getAppThemesDir } from './storage.ts';
import type { ThemeOverrides, PresetTheme } from './theme.ts';

// ============================================================
// Constants
// ============================================================

const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const PREFERENCES_FILE = join(CONFIG_DIR, 'preferences.json');

// Debounce delay in milliseconds
const DEBOUNCE_MS = 100;

// ============================================================
// Types
// ============================================================

/**
 * User preferences structure (mirrors UserPreferencesSchema)
 */
export interface UserPreferences {
  name?: string;
  timezone?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
  };
  language?: string;
  notes?: string;
  updatedAt?: number;
}

/**
 * Callbacks for config changes
 */
export interface ConfigWatcherCallbacks {
  /** Called when config.json changes */
  onConfigChange?: (config: StoredConfig) => void;
  /** Called when preferences.json changes */
  onPreferencesChange?: (prefs: UserPreferences) => void;

  // Skill callbacks
  /** Called when a specific skill changes (null if deleted) */
  onSkillChange?: (slug: string, skill: LoadedSkill | null) => void;
  /** Called when the skills list changes (add/remove folders) */
  onSkillsListChange?: (skills: LoadedSkill[]) => void;

  // Command callbacks
  /** Called when a specific command changes (null if deleted) */
  onCommandChange?: (slug: string, command: LoadedCommand | null) => void;
  /** Called when the commands list changes (add/remove files) */
  onCommandsListChange?: (commands: LoadedCommand[]) => void;

  // Permissions callbacks
  /** Called when app-level default permissions change (~/.opentomo/permissions/default.json) */
  onDefaultPermissionsChange?: () => void;
  /** Called when workspace permissions.json changes */
  onWorkspacePermissionsChange?: (workspaceId: string) => void;

  // Session callbacks
  /** Called when a session's JSONL header is modified externally (labels, name, flags, etc.) */
  onSessionMetadataChange?: (sessionId: string, header: SessionHeader) => void;

  // Theme callbacks (app-level only)
  /** Called when app-level theme.json changes */
  onAppThemeChange?: (theme: ThemeOverrides | null) => void;
  /** Called when a preset theme file changes (null if deleted) */
  onPresetThemeChange?: (themeId: string, theme: PresetTheme | null) => void;
  /** Called when the preset themes list changes (add/remove files) */
  onPresetThemesListChange?: (themes: PresetTheme[]) => void;

  // Error callbacks
  /** Called when a validation error occurs */
  onValidationError?: (file: string, result: ValidationResult) => void;
  /** Called when an error occurs reading/parsing a file */
  onError?: (file: string, error: Error) => void;
}

// ============================================================
// Preferences Loading
// ============================================================

/**
 * Load preferences from file
 */
export function loadPreferences(): UserPreferences | null {
  if (!existsSync(PREFERENCES_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(PREFERENCES_FILE, 'utf-8');
    return JSON.parse(content) as UserPreferences;
  } catch (error) {
    debug('[ConfigWatcher] Error loading preferences', error);
    return null;
  }
}

// ============================================================
// ConfigWatcher Class
// ============================================================

/**
 * Watches config files and triggers callbacks on changes.
 * Uses recursive directory watching for workspace files.
 */
export class ConfigWatcher {
  private workspaceId: string;
  private callbacks: ConfigWatcherCallbacks;
  private watchers: FSWatcher[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  // Track known items for detecting adds/removes
  private knownSkills: Set<string> = new Set();
  private knownCommands: Set<string> = new Set();
  private knownThemes: Set<string> = new Set();

  // Computed paths
  private workspaceDir: string;
  private skillsDir: string;
  private commandsDir: string;

  constructor(workspaceIdOrPath: string, callbacks: ConfigWatcherCallbacks) {
    this.callbacks = callbacks;
    // Support both workspace ID and workspace root path
    // Paths contain '/' or '\\' (Windows) while IDs don't
    const isPath = workspaceIdOrPath.includes('/') || workspaceIdOrPath.includes('\\');
    if (isPath) {
      this.workspaceDir = workspaceIdOrPath;
      // Extract workspace ID from path (last segment) - handle both separators
      this.workspaceId = workspaceIdOrPath.split(/[/\\]/).pop() || workspaceIdOrPath;
    } else {
      this.workspaceId = workspaceIdOrPath;
      this.workspaceDir = getWorkspacePath(workspaceIdOrPath);
    }
    this.skillsDir = getWorkspaceSkillsPath(this.workspaceDir);
    this.commandsDir = getWorkspaceCommandsPath(this.workspaceDir);
  }

  /**
   * Get the workspace slug this watcher is scoped to
   */
  getWorkspaceSlug(): string {
    return this.workspaceId;
  }

  /**
   * Start watching config files
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    const span = perf.span('configWatcher.start', { workspaceId: this.workspaceId });

    this.isRunning = true;
    debug('[ConfigWatcher] Starting for workspace:', this.workspaceId);

    // Ensure workspace directory exists
    if (!existsSync(this.workspaceDir)) {
      mkdirSync(this.workspaceDir, { recursive: true });
    }
    span.mark('ensureDir');

    // Watch global config files
    this.watchGlobalConfigs();
    span.mark('watchGlobalConfigs');

    // Watch workspace directory recursively
    this.watchWorkspaceDir();
    span.mark('watchWorkspaceDir');

    // Watch app-level themes directory
    this.watchAppThemesDir();
    span.mark('watchAppThemesDir');

    // Watch app-level permissions directory
    this.watchAppPermissionsDir();
    span.mark('watchAppPermissionsDir');

    // Initial scan to populate known skills, commands, and themes
    this.scanSkills();
    span.mark('scanSkills');

    this.scanCommands();
    span.mark('scanCommands');

    this.scanAppThemes();
    span.mark('scanAppThemes');

    debug('[ConfigWatcher] Started watching files');
    span.end();
  }

  /**
   * Stop watching all files
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close all watchers
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    this.knownSkills.clear();
    this.knownCommands.clear();
    this.knownThemes.clear();

    debug('[ConfigWatcher] Stopped');
  }

  /**
   * Watch global config files (config.json, preferences.json)
   */
  private watchGlobalConfigs(): void {
    // Ensure config directory exists
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }

    try {
      // Watch the config directory for changes to config.json, preferences.json, and theme.json
      const watcher = watch(CONFIG_DIR, (eventType, filename) => {
        if (!filename) return;

        if (filename === 'config.json') {
          this.debounce('config.json', () => this.handleConfigChange());
        } else if (filename === 'preferences.json') {
          this.debounce('preferences.json', () => this.handlePreferencesChange());
        } else if (filename === 'theme.json') {
          this.debounce('app-theme', () => this.handleAppThemeChange());
        }
      });

      this.watchers.push(watcher);
      debug('[ConfigWatcher] Watching global configs:', CONFIG_DIR);
    } catch (error) {
      debug('[ConfigWatcher] Error watching global configs:', error);
    }
  }

  /**
   * Watch workspace directory recursively
   */
  private watchWorkspaceDir(): void {
    try {
      const watcher = watch(this.workspaceDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // Normalize path separators
        const normalizedPath = filename.replace(/\\/g, '/');
        this.handleWorkspaceFileChange(normalizedPath, eventType);
      });

      this.watchers.push(watcher);
      debug('[ConfigWatcher] Watching workspace recursively:', this.workspaceDir);
    } catch (error) {
      debug('[ConfigWatcher] Error watching workspace directory:', error);
    }
  }

  /**
   * Handle a file change within the workspace directory
   */
  private handleWorkspaceFileChange(relativePath: string, eventType: string): void {
    const parts = relativePath.split('/');

    // Workspace-level permissions.json
    if (relativePath === 'permissions.json') {
      this.debounce('workspace-permissions', () => this.handleWorkspacePermissionsChange());
      return;
    }

    // Skills changes: skills/{slug}/...
    if (parts[0] === 'skills' && parts.length >= 2) {
      const slug = parts[1]!;  // Safe: checked parts.length >= 2
      const file = parts[2];

      // Directory-level changes (new/removed skill folders)
      if (parts.length === 2) {
        this.debounce('skills-dir', () => this.handleSkillsDirChange());
        return;
      }

      // File-level changes
      if (file === 'SKILL.md') {
        this.debounce(`skill:${slug}`, () => this.handleSkillChange(slug));
      } else if (file && /^icon\.(svg|png|jpg|jpeg)$/i.test(file)) {
        // Icon file changes also trigger a skill change (to update iconPath)
        this.debounce(`skill-icon:${slug}`, () => this.handleSkillChange(slug));
      }
      return;
    }

    // Commands changes: commands/{slug}.md
    if (parts[0] === 'commands') {
      if (parts.length === 1) {
        // Directory-level change
        this.debounce('commands-dir', () => this.handleCommandsDirChange());
        return;
      }

      if (parts.length === 2) {
        const file = parts[1]!;
        if (file.endsWith('.md')) {
          const slug = file.replace(/\.md$/, '');
          this.debounce(`command:${slug}`, () => this.handleCommandFileChange(slug));
        } else {
          // Non-.md file added/removed in commands dir, check list
          this.debounce('commands-dir', () => this.handleCommandsDirChange());
        }
        return;
      }
    }

    // Session metadata changes: sessions/{id}/session.jsonl
    // Detects external modifications (other instances, scripts, manual edits).
    // Only reads line 1 (header) — lightweight even during active streaming.
    if (parts[0] === 'sessions' && parts.length >= 3) {
      const sessionId = parts[1]!;
      const file = parts[2];

      // Only watch actual session files, ignore .tmp (atomic write intermediates)
      if (file === 'session.jsonl') {
        this.debounce(`session-meta:${sessionId}`, () => this.handleSessionMetadataChange(sessionId));
      }
      return;
    }
  }

  /**
   * Debounce a handler by key
   */
  private debounce(key: string, handler: () => void): void {
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      handler();
    }, DEBOUNCE_MS);

    this.debounceTimers.set(key, timer);
  }

  // ============================================================
  // Skills Handlers
  // ============================================================

  /**
   * Scan skills directory to populate known skills
   */
  private scanSkills(): void {
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true });
      return;
    }

    try {
      const entries = readdirSync(this.skillsDir);

      for (const entry of entries) {
        const entryPath = join(this.skillsDir, entry);
        if (statSync(entryPath).isDirectory()) {
          this.knownSkills.add(entry);
        }
      }

      debug('[ConfigWatcher] Known skills:', Array.from(this.knownSkills));
    } catch (error) {
      debug('[ConfigWatcher] Error scanning skills:', error);
    }
  }

  /**
   * Handle skills directory change (add/remove folders)
   */
  private handleSkillsDirChange(): void {
    debug('[ConfigWatcher] Skills directory changed');

    if (!existsSync(this.skillsDir)) {
      // Directory was deleted
      const removed = Array.from(this.knownSkills);
      this.knownSkills.clear();

      for (const slug of removed) {
        this.callbacks.onSkillChange?.(slug, null);
      }

      this.callbacks.onSkillsListChange?.([]);
      return;
    }

    try {
      const entries = readdirSync(this.skillsDir);
      const currentFolders = new Set<string>();

      for (const entry of entries) {
        const entryPath = join(this.skillsDir, entry);
        if (statSync(entryPath).isDirectory()) {
          currentFolders.add(entry);
        }
      }

      // Find added folders
      for (const folder of currentFolders) {
        if (!this.knownSkills.has(folder)) {
          debug('[ConfigWatcher] New skill folder:', folder);
          this.knownSkills.add(folder);

          const skill = loadSkill(this.workspaceDir, folder);
          if (skill) {
            this.callbacks.onSkillChange?.(folder, skill);
          }
        }
      }

      // Find removed folders
      for (const folder of this.knownSkills) {
        if (!currentFolders.has(folder)) {
          debug('[ConfigWatcher] Removed skill folder:', folder);
          this.knownSkills.delete(folder);
          this.callbacks.onSkillChange?.(folder, null);
        }
      }

      // Notify list change
      const allSkills = loadWorkspaceSkills(this.workspaceDir);
      this.callbacks.onSkillsListChange?.(allSkills);
    } catch (error) {
      debug('[ConfigWatcher] Error handling skills dir change:', error);
      this.callbacks.onError?.('skills/', error as Error);
    }
  }

  /**
   * Handle skill SKILL.md or icon change.
   * If the skill has an icon URL in metadata but no local icon file,
   * downloads the icon and emits another change event after completion.
   */
  private handleSkillChange(slug: string): void {
    debug('[ConfigWatcher] Skill changed:', slug);

    const skill = loadSkill(this.workspaceDir, slug);
    this.callbacks.onSkillChange?.(slug, skill);

    // Check if we need to download an icon from URL
    // This happens when SKILL.md has icon: "https://..." but no local icon.* file exists
    if (skill && skillNeedsIconDownload(skill)) {
      debug('[ConfigWatcher] Skill needs icon download:', slug, skill.metadata.icon);

      // Download asynchronously - don't block the watcher
      downloadSkillIcon(skill.path, skill.metadata.icon!)
        .then((iconPath) => {
          if (iconPath) {
            // Reload the skill with the new icon and emit another change
            const updatedSkill = loadSkill(this.workspaceDir, slug);
            debug('[ConfigWatcher] Icon downloaded, emitting updated skill:', slug);
            this.callbacks.onSkillChange?.(slug, updatedSkill);
          }
        })
        .catch((error) => {
          debug('[ConfigWatcher] Icon download failed for skill:', slug, error);
        });
    }
  }

  // ============================================================
  // Commands Handlers
  // ============================================================

  /**
   * Scan commands directory to populate known commands
   */
  private scanCommands(): void {
    if (!existsSync(this.commandsDir)) {
      mkdirSync(this.commandsDir, { recursive: true });
      return;
    }

    try {
      const entries = readdirSync(this.commandsDir);

      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          this.knownCommands.add(entry.replace(/\.md$/, ''));
        }
      }

      debug('[ConfigWatcher] Known commands:', Array.from(this.knownCommands));
    } catch (error) {
      debug('[ConfigWatcher] Error scanning commands:', error);
    }
  }

  /**
   * Handle commands directory change (add/remove .md files)
   */
  private handleCommandsDirChange(): void {
    debug('[ConfigWatcher] Commands directory changed');

    if (!existsSync(this.commandsDir)) {
      // Directory was deleted
      const removed = Array.from(this.knownCommands);
      this.knownCommands.clear();

      for (const slug of removed) {
        this.callbacks.onCommandChange?.(slug, null);
      }

      this.callbacks.onCommandsListChange?.([]);
      return;
    }

    try {
      const entries = readdirSync(this.commandsDir);
      const currentFiles = new Set<string>();

      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          currentFiles.add(entry.replace(/\.md$/, ''));
        }
      }

      // Find added files
      for (const slug of currentFiles) {
        if (!this.knownCommands.has(slug)) {
          debug('[ConfigWatcher] New command file:', slug);
          this.knownCommands.add(slug);

          const command = loadCommand(this.workspaceDir, slug);
          if (command) {
            this.callbacks.onCommandChange?.(slug, command);
          }
        }
      }

      // Find removed files
      for (const slug of this.knownCommands) {
        if (!currentFiles.has(slug)) {
          debug('[ConfigWatcher] Removed command file:', slug);
          this.knownCommands.delete(slug);
          this.callbacks.onCommandChange?.(slug, null);
        }
      }

      // Notify list change
      const allCommands = loadAllCommands(this.workspaceDir);
      this.callbacks.onCommandsListChange?.(allCommands);
    } catch (error) {
      debug('[ConfigWatcher] Error handling commands dir change:', error);
      this.callbacks.onError?.('commands/', error as Error);
    }
  }

  /**
   * Handle individual command .md file change
   */
  private handleCommandFileChange(slug: string): void {
    debug('[ConfigWatcher] Command changed:', slug);

    const command = loadCommand(this.workspaceDir, slug);

    if (command) {
      if (!this.knownCommands.has(slug)) {
        this.knownCommands.add(slug);
      }
    } else {
      if (this.knownCommands.has(slug)) {
        this.knownCommands.delete(slug);
      }
    }

    this.callbacks.onCommandChange?.(slug, command);

    // Also notify list change
    const allCommands = loadAllCommands(this.workspaceDir);
    this.callbacks.onCommandsListChange?.(allCommands);
  }

  // ============================================================
  // Safe Mode & Config Handlers
  // ============================================================

  /**
   * Handle workspace permissions.json change
   */
  private handleWorkspacePermissionsChange(): void {
    debug('[ConfigWatcher] Workspace permissions.json changed:', this.workspaceId);

    // Invalidate cache
    permissionsConfigCache.invalidateWorkspace(this.workspaceDir);

    // Notify callback
    this.callbacks.onWorkspacePermissionsChange?.(this.workspaceId);
  }

  /**
   * Handle config.json change
   */
  private handleConfigChange(): void {
    debug('[ConfigWatcher] config.json changed');

    const validation = validateConfig();
    if (!validation.valid) {
      debug('[ConfigWatcher] Config validation failed:', validation.errors);
      this.callbacks.onValidationError?.('config.json', validation);
      return;
    }

    const config = loadStoredConfig();
    if (config) {
      this.callbacks.onConfigChange?.(config);
    } else {
      this.callbacks.onError?.('config.json', new Error('Failed to load config'));
    }
  }

  /**
   * Handle preferences.json change
   */
  private handlePreferencesChange(): void {
    debug('[ConfigWatcher] preferences.json changed');

    const validation = validatePreferences();
    if (!validation.valid) {
      debug('[ConfigWatcher] Preferences validation failed:', validation.errors);
      this.callbacks.onValidationError?.('preferences.json', validation);
      return;
    }

    const prefs = loadPreferences();
    if (prefs) {
      this.callbacks.onPreferencesChange?.(prefs);
    }
  }

  // ============================================================
  // Labels Handlers
  // ============================================================

  /**
   * Handle labels config.json change.
   */
  private handleLabelConfigChange(): void {
    debug('[ConfigWatcher] Labels config.json changed:', this.workspaceId);
    // Labels functionality has been removed
  }

  // ============================================================
  // Session Metadata Handlers
  // ============================================================

  /**
   * Handle session.jsonl change — reads only line 1 (header) and emits if valid.
   * This enables detection of external metadata changes (labels, name, flags)
   * made by other instances, scripts, or manual edits.
   */
  private handleSessionMetadataChange(sessionId: string): void {
    const sessionFile = join(this.workspaceDir, 'sessions', sessionId, 'session.jsonl');

    if (!existsSync(sessionFile)) {
      return;
    }

    const header = readSessionHeader(sessionFile);
    if (header) {
      this.callbacks.onSessionMetadataChange?.(sessionId, header);
    }
  }

  // ============================================================
  // Theme Handlers (App-Level)
  // ============================================================

  /**
   * Handle app-level theme.json change
   */
  private handleAppThemeChange(): void {
    debug('[ConfigWatcher] App theme.json changed');
    const theme = loadAppTheme();
    this.callbacks.onAppThemeChange?.(theme);
  }

  /**
   * Watch app-level themes directory (~/.opentomo/themes/)
   */
  private watchAppThemesDir(): void {
    const themesDir = getAppThemesDir();

    // Create themes directory if it doesn't exist
    if (!existsSync(themesDir)) {
      mkdirSync(themesDir, { recursive: true });
    }

    try {
      const watcher = watch(themesDir, (eventType, filename) => {
        if (!filename) return;

        // Only handle .json files
        if (filename.endsWith('.json')) {
          const themeId = filename.replace('.json', '');
          this.debounce(`preset-theme:${themeId}`, () => this.handlePresetThemeChange(themeId));
        }
      });

      this.watchers.push(watcher);
      debug('[ConfigWatcher] Watching app themes directory:', themesDir);
    } catch (error) {
      debug('[ConfigWatcher] Error watching app themes directory:', error);
    }
  }

  /**
   * Watch app-level permissions directory (~/.opentomo/permissions/)
   * Watches for changes to default.json which contains the default read-only patterns
   */
  private watchAppPermissionsDir(): void {
    const permissionsDir = getAppPermissionsDir();

    // Create permissions directory if it doesn't exist
    if (!existsSync(permissionsDir)) {
      mkdirSync(permissionsDir, { recursive: true });
    }

    try {
      const watcher = watch(permissionsDir, (eventType, filename) => {
        if (!filename) return;

        // Only watch default.json - this is where the default patterns live
        if (filename === 'default.json') {
          this.debounce('default-permissions', () => this.handleDefaultPermissionsChange());
        }
      });

      this.watchers.push(watcher);
      debug('[ConfigWatcher] Watching app permissions directory:', permissionsDir);
    } catch (error) {
      debug('[ConfigWatcher] Error watching app permissions directory:', error);
    }
  }

  /**
   * Handle default.json permissions change (app-level)
   */
  private handleDefaultPermissionsChange(): void {
    debug('[ConfigWatcher] Default permissions changed');

    // Invalidate the cache so next getMergedConfig() reloads from file
    permissionsConfigCache.invalidateDefaults();

    // Notify callback
    this.callbacks.onDefaultPermissionsChange?.();
  }

  /**
   * Scan app-level themes directory to populate known themes
   */
  private scanAppThemes(): void {
    const themesDir = getAppThemesDir();

    if (!existsSync(themesDir)) {
      return;
    }

    try {
      const files = readdirSync(themesDir).filter(f => f.endsWith('.json'));

      for (const file of files) {
        const themeId = file.replace('.json', '');
        this.knownThemes.add(themeId);
      }

      debug('[ConfigWatcher] Known themes:', Array.from(this.knownThemes));
    } catch (error) {
      debug('[ConfigWatcher] Error scanning themes:', error);
    }
  }

  /**
   * Handle preset theme file change (app-level)
   */
  private handlePresetThemeChange(themeId: string): void {
    debug('[ConfigWatcher] Preset theme changed:', themeId);

    const themesDir = getAppThemesDir();
    const themePath = join(themesDir, `${themeId}.json`);

    if (!existsSync(themePath)) {
      // Theme was deleted
      if (this.knownThemes.has(themeId)) {
        this.knownThemes.delete(themeId);
        this.callbacks.onPresetThemeChange?.(themeId, null);

        // Also notify list change
        const allThemes = loadPresetThemes();
        this.callbacks.onPresetThemesListChange?.(allThemes);
      }
      return;
    }

    // Theme was added or modified
    if (!this.knownThemes.has(themeId)) {
      this.knownThemes.add(themeId);
    }

    const theme = loadPresetTheme(themeId);
    this.callbacks.onPresetThemeChange?.(themeId, theme);

    // Also notify list change in case name changed (affects sorting)
    const allThemes = loadPresetThemes();
    this.callbacks.onPresetThemesListChange?.(allThemes);
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create and start a config watcher for a specific workspace.
 * Returns the watcher instance for later cleanup.
 */
export function createConfigWatcher(
  workspaceId: string,
  callbacks: ConfigWatcherCallbacks
): ConfigWatcher {
  const watcher = new ConfigWatcher(workspaceId, callbacks);
  watcher.start();
  return watcher;
}
