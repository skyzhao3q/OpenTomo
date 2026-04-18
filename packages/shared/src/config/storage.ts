import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, unlinkSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { getCredentialManager } from '../credentials/index.ts';
import { getOrCreateLatestSession, type SessionConfig } from '../sessions/index.ts';
import {
  discoverWorkspacesInDefaultLocation,
  loadWorkspaceConfig,
  createWorkspaceAtPath,
  isValidWorkspace,
  ensureWorkspaceDirStructure,
} from '../workspaces/storage.ts';
import { findIconFile } from '../utils/icon.ts';
import { expandPath, toPortablePath, getBundledAssetsDir } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';
import { CONFIG_DIR } from './paths.ts';
import { initializeDocs } from '../docs/index.ts';
import type { StoredAttachment, StoredMessage } from '@opentomo/core/types';
import type { Plan } from '../agent/plan-types.ts';
import type { PermissionMode } from '../agent/mode-manager.ts';
import { DEFAULT_MODEL, PROVIDERS } from './models.ts';
import { BUNDLED_CONFIG_DEFAULTS, type ConfigDefaults } from './config-defaults-schema.ts';

// Re-export CONFIG_DIR for convenience (centralized in paths.ts)
export { CONFIG_DIR } from './paths.ts';

// Re-export base types from core (single source of truth)
export type {
  Workspace,
  McpAuthType,
  AuthType,
  OAuthCredentials,
} from '@opentomo/core/types';

// Import for local use
import type { Workspace, AuthType } from '@opentomo/core/types';

// Config stored in JSON file (credentials stored in encrypted file, not here)
export interface StoredConfig {
  provider?: string;              // Selected AI provider ('anthropic', 'custom')
  authType?: AuthType;
  anthropicBaseUrl?: string;  // Custom Anthropic API base URL (for third-party compatible APIs)
  customModel?: string;  // Custom model ID override (for third-party APIs like OpenRouter, Ollama)
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeSessionId: string | null;  // Currently active session (primary scope)
  model?: string;
  // Notifications
  notificationsEnabled?: boolean;  // Desktop notifications for task completion (default: true)
  // Appearance
  colorTheme?: string;  // ID of selected preset theme (e.g., 'dracula', 'nord'). Default: 'default'
  // Auto-update
  dismissedUpdateVersion?: string;  // Version that user dismissed (skip notifications for this version)
  // Input settings
  autoCapitalisation?: boolean;  // Auto-capitalize first letter when typing (default: true)
  sendMessageKey?: 'enter' | 'cmd-enter';  // Key to send messages (default: 'enter')
  spellCheck?: boolean;  // Enable spell check in input (default: false)
  // Provider Connections (multi-connection support)
  activeConnectionId?: string | null;  // ID of active ProviderConnection, null = use OpenTomo proxy
  // Cached OAuth tier models (fetched from Anthropic API on Claude Subscription activation)
  oauthTierModels?: { best?: string; balanced?: string; fast?: string }
  // Media / Image Generation provider config
  mediaProvider?: {
    provider: string;          // 'gemini'
    model: string;             // default: 'gemini-3.1-flash-image-preview'
    batchConcurrency?: number; // default 2
    batchMaxRetries?: number;  // default 3
  };
  // Generative UI — inline widget rendering via show-widget code fences (default: true)
  generativeUiEnabled?: boolean;
  // Default permission mode for new chat sessions (default: 'ask')
  defaultChatMode?: PermissionMode;
}

const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const CONFIG_DEFAULTS_FILE = join(CONFIG_DIR, 'config-defaults.json');
const CONFIG_MODELS_FILE = join(CONFIG_DIR, 'config-models.json');

/**
 * Load config defaults from file, or use bundled defaults as fallback.
 */
export function loadConfigDefaults(): ConfigDefaults {
  try {
    if (existsSync(CONFIG_DEFAULTS_FILE)) {
      const content = readFileSync(CONFIG_DEFAULTS_FILE, 'utf-8');
      return JSON.parse(content) as ConfigDefaults;
    }
  } catch {
    // Fall through to bundled defaults
  }
  return BUNDLED_CONFIG_DEFAULTS;
}

/**
 * Ensure config-defaults.json exists.
 * Writes from the BUNDLED_CONFIG_DEFAULTS constant (single source of truth).
 */
export function ensureConfigDefaults(): void {
  if (existsSync(CONFIG_DEFAULTS_FILE)) {
    return; // Already exists, don't overwrite
  }

  writeFileSync(
    CONFIG_DEFAULTS_FILE,
    JSON.stringify(BUNDLED_CONFIG_DEFAULTS, null, 2),
    'utf-8'
  );
}

/**
 * Load config models from file, or use bundled models as fallback.
 * Models can be customized by editing ~/.opentomo/config-models.json
 */
export function loadConfigModels(): import('./models.ts').ModelDefinition[] {
  try {
    // Try user config first
    if (existsSync(CONFIG_MODELS_FILE)) {
      const content = readFileSync(CONFIG_MODELS_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed.models && Array.isArray(parsed.models)) {
        return parsed.models;
      }
    }
  } catch {
    // Fall through to bundled models
  }

  // Try bundled config-models.json (using candidate paths, not getBundledAssetsDir)
  try {
    const candidates = [
      // Dev: packages/shared/resources/config-models.json
      join(process.cwd(), 'packages', 'shared', 'resources', 'config-models.json'),
      // Dev/Production dist: dist/assets/config-models.json
      join(process.cwd(), 'dist', 'assets', 'config-models.json'),
    ];

    const bundledPath = candidates.find(p => existsSync(p));
    if (bundledPath) {
      const content = readFileSync(bundledPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed.models && Array.isArray(parsed.models)) {
        return parsed.models;
      }
    }
  } catch {
    // Fall through to empty array
  }

  return [];
}

/**
 * Ensure config-models.json exists in user config directory.
 * Copies from bundled config-models.json if not present.
 */
export function ensureConfigModels(): void {
  if (existsSync(CONFIG_MODELS_FILE)) {
    return; // Already exists, don't overwrite
  }

  try {
    // Config files are in assets root (like config-defaults.json)
    const candidates = [
      // Dev: packages/shared/resources/config-models.json
      join(process.cwd(), 'packages', 'shared', 'resources', 'config-models.json'),
      // Dev/Production dist: dist/assets/config-models.json
      join(process.cwd(), 'dist', 'assets', 'config-models.json'),
    ];

    const bundledPath = candidates.find(p => existsSync(p));
    if (bundledPath) {
      const content = readFileSync(bundledPath, 'utf-8');
      writeFileSync(CONFIG_MODELS_FILE, content, 'utf-8');
    }
  } catch (error) {
    console.error('Failed to ensure config-models.json:', error);
  }
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Initialize docs directory with bundled documentation
  initializeDocs();

  // Initialize config defaults
  ensureConfigDefaults();

  // Initialize config models
  ensureConfigModels();

  // Initialize tool icons (CLI tool icons for turn card display)
  ensureToolIcons();
}

export function loadStoredConfig(): StoredConfig | null {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return null;
    }
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content) as StoredConfig;

    // Must have workspaces array
    if (!Array.isArray(config.workspaces)) {
      return null;
    }

    // Expand path variables (~ and ${HOME}) for portability
    for (const workspace of config.workspaces) {
      workspace.rootPath = expandPath(workspace.rootPath);
    }

    // Validate active workspace exists
    const activeWorkspace = config.workspaces.find(w => w.id === config.activeWorkspaceId);
    if (!activeWorkspace) {
      // Default to first workspace
      config.activeWorkspaceId = config.workspaces[0]?.id || null;
    }

    // Ensure workspace folder structure exists for all workspaces
    for (const workspace of config.workspaces) {
      try {
        if (!isValidWorkspace(workspace.rootPath)) {
          // config.json missing → full workspace recreation
          createWorkspaceAtPath(workspace.rootPath, workspace.name);
        } else {
          // config.json exists → ensure subdirectories haven't been deleted
          ensureWorkspaceDirStructure(workspace.rootPath);
        }
      } catch (e) {
        // Don't let one broken workspace crash the entire config load
        console.error('[Config] Failed to repair workspace folder:', workspace.rootPath, e);
      }
    }

    // MIGRATION: Infer provider from authType if not set
    let needsSave = false;
    if (!config.provider) {
      if (config.authType === 'api_key' || config.authType === 'oauth_token') {
        config.provider = 'anthropic';
        needsSave = true;
      } else if (config.anthropicBaseUrl || config.customModel) {
        // Custom API detected
        config.authType = 'custom_api';
        config.provider = 'custom';
        needsSave = true;
      } else {
        // Fallback to default provider
        config.provider = 'anthropic';
        needsSave = true;
      }
    }

    // Save config if migration was applied
    if (needsSave) {
      saveConfig(config);
    }

    return config;
  } catch {
    return null;
  }
}

/**
 * Ensure config.json exists with at least the minimum required fields.
 * Used for recovery when the user has credentials/connections but config.json is missing.
 * Does NOT overwrite an existing config.
 */
export function ensureConfigExists(): StoredConfig {
  const existing = loadStoredConfig();
  if (existing) return existing;

  const minimal: StoredConfig = {
    workspaces: [],
    activeWorkspaceId: null,
    activeSessionId: null,
  };
  saveConfig(minimal);
  return minimal;
}

/**
 * Get the Anthropic API key from credential store
 */
export async function getAnthropicApiKey(): Promise<string | null> {
  const manager = getCredentialManager();
  return manager.getApiKey();
}

/**
 * Get the Claude OAuth token from credential store
 */
export async function getClaudeOAuthToken(): Promise<string | null> {
  const manager = getCredentialManager();
  return manager.getClaudeOAuth();
}



export function saveConfig(config: StoredConfig): void {
  ensureConfigDir();

  // Convert paths to portable form (~ prefix) for cross-machine compatibility
  const storageConfig: StoredConfig = {
    ...config,
    workspaces: config.workspaces.map(ws => ({
      ...ws,
      rootPath: toPortablePath(ws.rootPath),
    })),
  };

  // Atomic write: write to .tmp then rename, to prevent config.json corruption
  // if the process is killed mid-write (Windows is especially vulnerable to this).
  const content = JSON.stringify(storageConfig, null, 2);
  const tmpFile = CONFIG_FILE + '.tmp';
  writeFileSync(tmpFile, content, 'utf-8');
  // On Windows, rename fails if target exists — delete first.
  try { unlinkSync(CONFIG_FILE); } catch { /* ignore if doesn't exist */ }
  renameSync(tmpFile, CONFIG_FILE);
}

export async function updateApiKey(newApiKey: string): Promise<boolean> {
  const config = loadStoredConfig();
  if (!config) return false;

  // Save API key to credential store
  const manager = getCredentialManager();
  await manager.setApiKey(newApiKey);

  // Update auth type in config (but not the key itself)
  config.authType = 'api_key';
  saveConfig(config);
  return true;
}

export function getAuthType(): AuthType {
  const config = loadStoredConfig();
  if (config?.authType !== undefined) {
    return config.authType;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.authType;
}

export function setAuthType(authType: AuthType): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.authType = authType;
  saveConfig(config);
}

export function getProvider(): string | null {
  const config = loadStoredConfig();
  if (config?.provider !== undefined) {
    return config.provider;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.provider;
}

export function setProvider(provider: string): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.provider = provider;
  saveConfig(config);
}

// ============================================================
// Provider Connections (multi-connection support)
// ============================================================

/** Get the currently active connection ID. null means OpenTomo proxy is used. */
export function getActiveConnectionId(): string | null {
  const config = loadStoredConfig();
  return config?.activeConnectionId ?? null;
}

/**
 * Set the active provider connection and sync its settings into the
 * existing authType / anthropicBaseUrl / customModel fields so that
 * all existing session-creation code continues to work without changes.
 *
 * Pass null to revert to the OpenTomo proxy (default behaviour).
 */
export async function setActiveConnection(connectionId: string | null): Promise<void> {
  const config = loadStoredConfig();
  if (!config) return;

  if (connectionId === null) {
    // Reset to default auth
    config.activeConnectionId = null;
    config.provider = 'anthropic';
    config.authType = 'api_key';
    delete config.anthropicBaseUrl;
    delete config.customModel;
    saveConfig(config);
    return;
  }

  // Lazy-import to avoid circular dependency
  const { findProviderConnection } = await import('./connections.ts');
  const { getCredentialManager } = await import('../credentials/index.ts');

  const connection = findProviderConnection(connectionId);
  if (!connection) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  // Read the connection's API key and write it to the main CredentialManager
  const cm = getCredentialManager();
  const apiKey = await cm.getConnectionApiKey(connectionId);
  if (apiKey) {
    await cm.setApiKey(apiKey);
  }

  // Sync connection settings into the legacy config fields
  config.activeConnectionId = connectionId;
  config.provider = 'custom';
  config.authType = 'custom_api';
  config.anthropicBaseUrl = connection.endpoint;
  // Use the "balanced" tier as the default model (falls back to best/fast)
  const defaultModel = connection.models.balanced || connection.models.best || connection.models.fast;
  if (defaultModel) {
    config.customModel = defaultModel;
  } else {
    delete config.customModel;
  }
  saveConfig(config);
}

export function setAnthropicBaseUrl(baseUrl: string | null): void {
  const config = loadStoredConfig();
  if (!config) return;

  if (baseUrl) {
    const trimmed = baseUrl.trim();
    // URL validation deferred to Test Connection button
    config.anthropicBaseUrl = trimmed;
  } else {
    delete config.anthropicBaseUrl;
  }
  saveConfig(config);
}

export function getAnthropicBaseUrl(): string | null {
  const config = loadStoredConfig();
  return config?.anthropicBaseUrl ?? null;
}

export function getModel(): string | null {
  const config = loadStoredConfig();
  return config?.model ?? null;
}

export function setModel(model: string): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.model = model;
  saveConfig(config);
}

export function getDefaultChatMode(): PermissionMode {
  const config = loadStoredConfig();
  return config?.defaultChatMode ?? 'ask';
}

export function setDefaultChatMode(mode: PermissionMode): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.defaultChatMode = mode;
  saveConfig(config);
}


/**
 * Get whether desktop notifications are enabled.
 * Defaults to true if not set.
 */
export function getNotificationsEnabled(): boolean {
  const config = loadStoredConfig();
  if (config?.notificationsEnabled !== undefined) {
    return config.notificationsEnabled;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.notificationsEnabled;
}

/**
 * Set whether desktop notifications are enabled.
 */
export function setNotificationsEnabled(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.notificationsEnabled = enabled;
  saveConfig(config);
}

/**
 * Get whether auto-capitalisation is enabled.
 * Defaults to true if not set.
 */
export function getAutoCapitalisation(): boolean {
  const config = loadStoredConfig();
  if (config?.autoCapitalisation !== undefined) {
    return config.autoCapitalisation;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.autoCapitalisation;
}

/**
 * Set whether auto-capitalisation is enabled.
 */
export function setAutoCapitalisation(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.autoCapitalisation = enabled;
  saveConfig(config);
}

/**
 * Get the key combination used to send messages.
 * Defaults to 'enter' if not set.
 */
export function getSendMessageKey(): 'enter' | 'cmd-enter' {
  const config = loadStoredConfig();
  if (config?.sendMessageKey !== undefined) {
    return config.sendMessageKey;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.sendMessageKey;
}

/**
 * Set the key combination used to send messages.
 */
export function setSendMessageKey(key: 'enter' | 'cmd-enter'): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.sendMessageKey = key;
  saveConfig(config);
}

/**
 * Get whether spell check is enabled in the input.
 */
export function getSpellCheck(): boolean {
  const config = loadStoredConfig();
  if (config?.spellCheck !== undefined) {
    return config.spellCheck;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.spellCheck;
}

/**
 * Set whether spell check is enabled in the input.
 */
export function setSpellCheck(enabled: boolean): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.spellCheck = enabled;
  saveConfig(config);
}

/**
 * Get the list of available models from config-models.json.
 * Falls back to bundled config-models.json if user config doesn't exist.
 * Users can customize available models by editing ~/.opentomo/config-models.json
 */
export function getAvailableModels(): import('./models.ts').ModelDefinition[] {
  return loadConfigModels();
}

/**
 * Get models for a specific provider.
 * Filters all available models by provider ID.
 */
export function getModelsForProvider(providerId: string): import('./models.ts').ModelDefinition[] {
  const allModels = getAvailableModels();
  return allModels.filter(m => m.provider === providerId);
}

/**
 * Get authentication types supported by a provider.
 * Returns empty array if provider not found.
 */
export function getAuthTypesForProvider(providerId: string): import('@opentomo/core/types').AuthType[] {
  const provider = PROVIDERS.find((p: any) => p.id === providerId);
  return provider?.supportedAuthTypes || [];
}

/**
 * Get provider definition by ID.
 * Returns undefined if provider not found.
 */
export function getProviderById(providerId: string): import('./models.ts').ProviderDefinition | undefined {
  return PROVIDERS.find((p: any) => p.id === providerId);
}

/** Get display name for a model ID (full name with version) */
export function getModelDisplayName(modelId: string): string {
  const model = getAvailableModels().find(m => m.id === modelId);
  if (model) return model.name;
  // Fallback: strip prefix and date suffix
  return modelId.replace('claude-', '').replace(/-\d{8}$/, '');
}

/** Get short display name for a model ID (without version number) */
export function getModelShortName(modelId: string): string {
  const model = getAvailableModels().find(m => m.id === modelId);
  if (model) return model.shortName;
  // For provider-prefixed IDs (e.g. "openai/gpt-5"), show just the model part
  if (modelId.includes('/')) {
    return modelId.split('/').pop() || modelId;
  }
  // Fallback: strip claude- prefix and date suffix
  return modelId.replace('claude-', '').replace(/-[\d.-]+$/, '');
}

/** Get known context window size for a model ID (fallback when SDK hasn't reported usage yet) */
export function getModelContextWindow(modelId: string): number | undefined {
  return getAvailableModels().find(m => m.id === modelId)?.contextWindow;
}

// Note: getDefaultWorkingDirectory/setDefaultWorkingDirectory removed
// Working directory is now stored per-workspace in workspace config.json (defaults.workingDirectory)
// Note: getDefaultPermissionMode/getEnabledPermissionModes removed
// Permission settings are now stored per-workspace in workspace config.json (defaults.permissionMode, defaults.cyclablePermissionModes)

export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Clear all configuration and credentials (for logout).
 * Deletes config file and credentials file.
 */
export async function clearAllConfig(): Promise<void> {
  // Delete config file
  if (existsSync(CONFIG_FILE)) {
    rmSync(CONFIG_FILE);
  }

  // Delete credentials file
  const credentialsFile = join(CONFIG_DIR, 'credentials.enc');
  if (existsSync(credentialsFile)) {
    rmSync(credentialsFile);
  }

  // Optionally: Delete workspace data (conversations)
  const workspacesDir = join(CONFIG_DIR, 'workspaces');
  if (existsSync(workspacesDir)) {
    rmSync(workspacesDir, { recursive: true });
  }
}

// ============================================
// Workspace Management Functions
// ============================================

/**
 * Generate a unique workspace ID.
 * Uses a random UUID-like format.
 */
export function generateWorkspaceId(): string {
  // Generate random bytes and format as UUID-like string (8-4-4-4-12)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Find workspace icon file at workspace_root/icon.*
 * Returns absolute path to icon file if found, null otherwise
 */
export function findWorkspaceIcon(rootPath: string): string | null {
  return findIconFile(rootPath) ?? null;
}

export function getWorkspaces(): Workspace[] {
  const config = loadStoredConfig();
  const workspaces = config?.workspaces || [];

  // Resolve workspace names from folder config and local icons
  return workspaces.map(w => {
    // Read name from workspace folder config (single source of truth)
    const wsConfig = loadWorkspaceConfig(w.rootPath);
    const name = wsConfig?.name || w.rootPath.split('/').pop() || 'Untitled';

    // If workspace has a stored iconUrl that's a remote URL, use it
    // Otherwise check for local icon file
    let iconUrl = w.iconUrl;
    if (!iconUrl || (!iconUrl.startsWith('http://') && !iconUrl.startsWith('https://'))) {
      const localIcon = findWorkspaceIcon(w.rootPath);
      if (localIcon) {
        // Convert absolute path to file:// URL for Electron renderer
        // Append mtime as cache-buster so UI refreshes when icon changes
        try {
          const mtime = statSync(localIcon).mtimeMs;
          iconUrl = `file://${localIcon}?t=${mtime}`;
        } catch {
          iconUrl = `file://${localIcon}`;
        }
      }
    }

    return { ...w, name, iconUrl };
  });
}

export function getActiveWorkspace(): Workspace | null {
  const config = loadStoredConfig();
  if (!config || !config.activeWorkspaceId) {
    return config?.workspaces[0] || null;
  }
  return config.workspaces.find(w => w.id === config.activeWorkspaceId) || config.workspaces[0] || null;
}

/**
 * Find a workspace by name (case-insensitive) or ID.
 * Useful for CLI -w flag to specify workspace.
 */
export function getWorkspaceByNameOrId(nameOrId: string): Workspace | null {
  const workspaces = getWorkspaces();
  return workspaces.find(w =>
    w.id === nameOrId ||
    w.name.toLowerCase() === nameOrId.toLowerCase()
  ) || null;
}

export function setActiveWorkspace(workspaceId: string): void {
  const config = loadStoredConfig();
  if (!config) return;

  const workspace = config.workspaces.find(w => w.id === workspaceId);
  if (!workspace) return;

  config.activeWorkspaceId = workspaceId;
  saveConfig(config);
}

/**
 * Atomically switch to a workspace and load/create a session.
 * This prevents race conditions by doing both operations together.
 *
 * @param workspaceId The ID of the workspace to switch to
 * @returns The workspace and session, or null if workspace not found
 */
export async function switchWorkspaceAtomic(workspaceId: string): Promise<{ workspace: Workspace; session: SessionConfig } | null> {
  const config = loadStoredConfig();
  if (!config) return null;

  const workspace = config.workspaces.find(w => w.id === workspaceId);
  if (!workspace) return null;

  // Get or create the latest session for this workspace
  const session = await getOrCreateLatestSession(workspace.rootPath);

  // Update active workspace in config
  config.activeWorkspaceId = workspaceId;
  workspace.lastAccessedAt = Date.now();
  saveConfig(config);

  return { workspace, session };
}

/**
 * Add a workspace to the global config.
 * @param workspace - Workspace data (must include rootPath)
 */
export function addWorkspace(workspace: Omit<Workspace, 'id' | 'createdAt'>): Workspace {
  const config = loadStoredConfig();
  if (!config) {
    throw new Error('No config found');
  }

  // Check if workspace with same rootPath already exists
  const existing = config.workspaces.find(w => w.rootPath === workspace.rootPath);
  if (existing) {
    // Update existing workspace with new settings
    const updated: Workspace = {
      ...existing,
      ...workspace,
      id: existing.id,
      createdAt: existing.createdAt,
    };
    const existingIndex = config.workspaces.indexOf(existing);
    config.workspaces[existingIndex] = updated;
    saveConfig(config);
    return updated;
  }

  const newWorkspace: Workspace = {
    ...workspace,
    id: generateWorkspaceId(),
    createdAt: Date.now(),
  };

  // Create workspace folder structure if it doesn't exist
  if (!isValidWorkspace(newWorkspace.rootPath)) {
    createWorkspaceAtPath(newWorkspace.rootPath, newWorkspace.name);
  }

  config.workspaces.push(newWorkspace);

  // If this is the only workspace, make it active
  if (config.workspaces.length === 1) {
    config.activeWorkspaceId = newWorkspace.id;
  }

  saveConfig(config);
  return newWorkspace;
}

/**
 * Sync workspaces by discovering workspaces in the default location
 * that aren't already tracked in the global config.
 * Call this on app startup.
 */
export function syncWorkspaces(): void {
  const config = loadStoredConfig();
  if (!config) return;

  const discoveredPaths = discoverWorkspacesInDefaultLocation();
  const trackedPaths = new Set(config.workspaces.map(w => w.rootPath));

  let added = false;
  for (const rootPath of discoveredPaths) {
    if (trackedPaths.has(rootPath)) continue;

    // Load the workspace config to get name
    const wsConfig = loadWorkspaceConfig(rootPath);
    if (!wsConfig) continue;

    const newWorkspace: Workspace = {
      id: wsConfig.id || generateWorkspaceId(),
      name: wsConfig.name,
      rootPath,
      createdAt: wsConfig.createdAt || Date.now(),
    };

    config.workspaces.push(newWorkspace);
    added = true;
  }

  if (added) {
    // If no active workspace, set to first
    if (!config.activeWorkspaceId && config.workspaces.length > 0) {
      config.activeWorkspaceId = config.workspaces[0]!.id;
    }
    saveConfig(config);
  }
}

export async function removeWorkspace(workspaceId: string): Promise<boolean> {
  const config = loadStoredConfig();
  if (!config) return false;

  const index = config.workspaces.findIndex(w => w.id === workspaceId);
  if (index === -1) return false;

  config.workspaces.splice(index, 1);

  // If we removed the active workspace, switch to first available
  if (config.activeWorkspaceId === workspaceId) {
    config.activeWorkspaceId = config.workspaces[0]?.id || null;
  }

  saveConfig(config);

  // Clean up credential store credentials for this workspace
  const manager = getCredentialManager();
  await manager.deleteWorkspaceCredentials(workspaceId);

  return true;
}

// Note: renameWorkspace() was removed - workspace names are now stored only in folder config
// Use updateWorkspaceSetting('name', ...) to rename workspaces via the folder config

// ============================================
// Workspace Conversation Persistence
// ============================================

const WORKSPACES_DIR = join(CONFIG_DIR, 'workspaces');

function ensureWorkspaceDir(workspaceId: string): string {
  const dir = join(WORKSPACES_DIR, workspaceId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}


// Re-export types from core for convenience
export type { StoredAttachment, StoredMessage } from '@opentomo/core/types';

export interface WorkspaceConversation {
  messages: StoredMessage[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    contextTokens: number;
    costUsd: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  savedAt: number;
}

// Save workspace conversation (messages + token usage)
export function saveWorkspaceConversation(
  workspaceId: string,
  messages: StoredMessage[],
  tokenUsage: WorkspaceConversation['tokenUsage']
): void {
  const dir = ensureWorkspaceDir(workspaceId);
  const filePath = join(dir, 'conversation.json');

  const conversation: WorkspaceConversation = {
    messages,
    tokenUsage,
    savedAt: Date.now(),
  };

  try {
    writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf-8');
  } catch (e) {
    // Handle cyclic structures or other serialization errors
    console.error(`[storage] [CYCLIC STRUCTURE] Failed to save workspace conversation:`, e);
    console.error(`[storage] Message count: ${messages.length}, message types: ${messages.map(m => m.type).join(', ')}`);
    // Try to save with sanitized messages
    try {
      const sanitizedMessages = messages.map((m, i) => {
        let safeToolInput = m.toolInput;
        if (m.toolInput) {
          try {
            JSON.stringify(m.toolInput);
          } catch (inputErr) {
            console.error(`[storage] [CYCLIC STRUCTURE] in message ${i} toolInput (tool: ${m.toolName}), keys: ${Object.keys(m.toolInput).join(', ')}, error: ${inputErr}`);
            safeToolInput = { error: '[non-serializable input]' };
          }
        }
        return { ...m, toolInput: safeToolInput };
      });
      const sanitizedConversation: WorkspaceConversation = {
        messages: sanitizedMessages,
        tokenUsage,
        savedAt: Date.now(),
      };
      writeFileSync(filePath, JSON.stringify(sanitizedConversation, null, 2), 'utf-8');
      console.error(`[storage] Saved sanitized workspace conversation successfully`);
    } catch (e2) {
      console.error(`[storage] Failed to save even sanitized workspace conversation:`, e2);
    }
  }
}

// Load workspace conversation
export function loadWorkspaceConversation(workspaceId: string): WorkspaceConversation | null {
  const filePath = join(WORKSPACES_DIR, workspaceId, 'conversation.json');

  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as WorkspaceConversation;
  } catch {
    return null;
  }
}

// Get workspace data directory path
export function getWorkspaceDataPath(workspaceId: string): string {
  return join(WORKSPACES_DIR, workspaceId);
}

// Clear workspace conversation
export function clearWorkspaceConversation(workspaceId: string): void {
  const filePath = join(WORKSPACES_DIR, workspaceId, 'conversation.json');
  if (existsSync(filePath)) {
    writeFileSync(filePath, '{}', 'utf-8');
  }

  // Also clear any active plan (plans are session-scoped)
  clearWorkspacePlan(workspaceId);
}

// ============================================
// Plan Storage (Session-Scoped)
// Plans are stored per-workspace and cleared with /clear
// ============================================

/**
 * Save a plan for a workspace.
 * Plans are session-scoped - they persist during the session but are
 * cleared when the user runs /clear or starts a new session.
 */
export function saveWorkspacePlan(workspaceId: string, plan: Plan): void {
  const dir = ensureWorkspaceDir(workspaceId);
  const filePath = join(dir, 'plan.json');
  writeFileSync(filePath, JSON.stringify(plan, null, 2), 'utf-8');
}

/**
 * Load the current plan for a workspace.
 * Returns null if no plan exists.
 */
export function loadWorkspacePlan(workspaceId: string): Plan | null {
  const filePath = join(WORKSPACES_DIR, workspaceId, 'plan.json');

  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Plan;
  } catch {
    return null;
  }
}

/**
 * Clear the plan for a workspace.
 * Called when user runs /clear or cancels a plan.
 */
export function clearWorkspacePlan(workspaceId: string): void {
  const filePath = join(WORKSPACES_DIR, workspaceId, 'plan.json');
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}

// ============================================
// Session Input Drafts
// Persists input text per session across app restarts
// ============================================

const DRAFTS_FILE = join(CONFIG_DIR, 'drafts.json');

interface DraftsData {
  drafts: Record<string, string>;
  updatedAt: number;
}

/**
 * Load all drafts from disk
 */
function loadDraftsData(): DraftsData {
  try {
    if (!existsSync(DRAFTS_FILE)) {
      return { drafts: {}, updatedAt: 0 };
    }
    const content = readFileSync(DRAFTS_FILE, 'utf-8');
    return JSON.parse(content) as DraftsData;
  } catch {
    return { drafts: {}, updatedAt: 0 };
  }
}

/**
 * Save drafts to disk
 */
function saveDraftsData(data: DraftsData): void {
  ensureConfigDir();
  data.updatedAt = Date.now();
  writeFileSync(DRAFTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Get draft text for a session
 */
export function getSessionDraft(sessionId: string): string | null {
  const data = loadDraftsData();
  return data.drafts[sessionId] ?? null;
}

/**
 * Set draft text for a session
 * Pass empty string to clear the draft
 */
export function setSessionDraft(sessionId: string, text: string): void {
  const data = loadDraftsData();
  if (text) {
    data.drafts[sessionId] = text;
  } else {
    delete data.drafts[sessionId];
  }
  saveDraftsData(data);
}

/**
 * Delete draft for a session
 */
export function deleteSessionDraft(sessionId: string): void {
  const data = loadDraftsData();
  delete data.drafts[sessionId];
  saveDraftsData(data);
}

/**
 * Get all drafts as a record
 */
export function getAllSessionDrafts(): Record<string, string> {
  const data = loadDraftsData();
  return data.drafts;
}

// ============================================
// Theme Storage (App-level only)
// ============================================

import type { ThemeOverrides, ThemeFile, PresetTheme } from './theme.ts';
import { readdirSync } from 'fs';

const APP_THEME_FILE = join(CONFIG_DIR, 'theme.json');
const APP_THEMES_DIR = join(CONFIG_DIR, 'themes');

// Track if preset themes have been synced this session (prevents re-init on hot reload)
let presetsInitialized = false;

/**
 * Get the app-level themes directory.
 * Preset themes are stored at ~/.opentomo/themes/
 */
export function getAppThemesDir(): string {
  return APP_THEMES_DIR;
}

/**
 * Load app-level theme overrides
 */
export function loadAppTheme(): ThemeOverrides | null {
  try {
    if (!existsSync(APP_THEME_FILE)) {
      return null;
    }
    const content = readFileSync(APP_THEME_FILE, 'utf-8');
    return JSON.parse(content) as ThemeOverrides;
  } catch {
    return null;
  }
}

/**
 * Save app-level theme overrides
 */
export function saveAppTheme(theme: ThemeOverrides): void {
  ensureConfigDir();
  writeFileSync(APP_THEME_FILE, JSON.stringify(theme, null, 2), 'utf-8');
}

/**
 * Save a preset theme file to ~/.opentomo/themes/{id}.json
 */
export function savePresetTheme(id: string, theme: ThemeFile): void {
  ensureConfigDir();
  const themesDir = getAppThemesDir();
  if (!existsSync(themesDir)) mkdirSync(themesDir, { recursive: true });
  writeFileSync(join(themesDir, `${id}.json`), JSON.stringify(theme, null, 2), 'utf-8');
}


// ============================================
// Preset Themes (app-level)
// ============================================

/**
 * Sync bundled preset themes to disk on launch.
 * Always overwrites to ensure presets stay current with the running app version
 * (e.g., updated color tokens or new preset themes added in a new release).
 * User-created custom theme files (with non-bundled filenames) are untouched.
 * User color overrides live in theme.json (separate file) and are never touched.
 */
export function ensurePresetThemes(): void {
  // Skip if already initialized this session (prevents re-init on hot reload)
  if (presetsInitialized) {
    return;
  }

  // Resolve bundled themes directory via shared asset resolver
  // Do not set presetsInitialized until seeding succeeds so that failed
  // attempts (e.g. assets root not registered yet) can be retried.
  const bundledThemesDir = getBundledAssetsDir('themes');
  if (!bundledThemesDir) {
    return;
  }

  const themesDir = getAppThemesDir();

  // Create themes directory if it doesn't exist
  if (!existsSync(themesDir)) {
    mkdirSync(themesDir, { recursive: true });
  }

  // Always write bundled preset themes to disk on launch.
  // This ensures theme updates from new app versions are applied immediately.
  // Only bundled filenames are overwritten — user-created custom themes are untouched.
  try {
    const bundledFiles = readdirSync(bundledThemesDir).filter(f => f.endsWith('.json'));
    for (const file of bundledFiles) {
      const srcPath = join(bundledThemesDir, file);
      const destPath = join(themesDir, file);
      const content = readFileSync(srcPath, 'utf-8');
      writeFileSync(destPath, content, 'utf-8');
    }
    presetsInitialized = true;
  } catch {
    // Ignore errors - themes are optional, will retry on next call
  }
}

/**
 * Load all preset themes from app themes directory.
 * Returns array of PresetTheme objects sorted by name.
 */
export function loadPresetThemes(): PresetTheme[] {
  ensurePresetThemes();

  const themesDir = getAppThemesDir();
  if (!existsSync(themesDir)) {
    return [];
  }

  const themes: PresetTheme[] = [];

  try {
    const files = readdirSync(themesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const id = file.replace('.json', '');
      const path = join(themesDir, file);
      try {
        const content = readFileSync(path, 'utf-8');
        const theme = JSON.parse(content) as ThemeFile;
        // Resolve relative backgroundImage paths to file:// URLs
        const resolvedTheme = resolveThemeBackgroundImage(theme, path);
        themes.push({ id, path, theme: resolvedTheme });
      } catch {
        // Skip invalid theme files
      }
    }
  } catch {
    return [];
  }

  // Sort by name (default first, then alphabetically)
  return themes.sort((a, b) => {
    if (a.id === 'default') return -1;
    if (b.id === 'default') return 1;
    return (a.theme.name || a.id).localeCompare(b.theme.name || b.id);
  });
}

/**
 * Get MIME type from file extension for data URL encoding.
 */
function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

/**
 * Resolve relative backgroundImage paths to data URLs.
 * If the backgroundImage is a relative path (no protocol), resolve it relative to the theme's directory,
 * read the file, and convert it to a data URL. This is necessary because the renderer process
 * cannot access file:// URLs directly when running on localhost in dev mode.
 * @param theme - Theme object to process
 * @param themePath - Absolute path to the theme's JSON file
 */
function resolveThemeBackgroundImage(theme: ThemeFile, themePath: string): ThemeFile {
  if (!theme.backgroundImage) {
    return theme;
  }

  // Check if it's already an absolute URL (has protocol like http://, https://, data:)
  const hasProtocol = /^[a-z][a-z0-9+.-]*:/i.test(theme.backgroundImage);
  if (hasProtocol) {
    return theme;
  }

  // It's a relative path - resolve it relative to the theme's directory
  const themeDir = dirname(themePath);
  const absoluteImagePath = join(themeDir, theme.backgroundImage);

  // Read the file and convert to data URL so renderer can use it
  // (file:// URLs are blocked in renderer when running on localhost)
  try {
    if (!existsSync(absoluteImagePath)) {
      console.warn(`Theme background image not found: ${absoluteImagePath}`);
      return theme;
    }

    const imageBuffer = readFileSync(absoluteImagePath);
    const base64 = imageBuffer.toString('base64');
    const mimeType = getMimeType(absoluteImagePath);
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      ...theme,
      backgroundImage: dataUrl,
    };
  } catch (error) {
    console.warn(`Failed to read theme background image: ${absoluteImagePath}`, error);
    return theme;
  }
}

/**
 * Load a specific preset theme by ID.
 * @param id - Theme ID (filename without .json)
 */
export function loadPresetTheme(id: string): PresetTheme | null {
  const themesDir = getAppThemesDir();
  const path = join(themesDir, `${id}.json`);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = readFileSync(path, 'utf-8');
    const theme = JSON.parse(content) as ThemeFile;
    // Resolve relative backgroundImage paths to file:// URLs
    const resolvedTheme = resolveThemeBackgroundImage(theme, path);
    return { id, path, theme: resolvedTheme };
  } catch {
    return null;
  }
}

/**
 * Get the path to the app-level preset themes directory.
 */
export function getPresetThemesDir(): string {
  return getAppThemesDir();
}

/**
 * Reset a preset theme to its bundled default.
 * Copies the bundled version over the user's version.
 * Resolves bundled path automatically via getBundledAssetsDir('themes').
 * @param id - Theme ID to reset
 */
export function resetPresetTheme(id: string): boolean {
  // Resolve bundled themes directory via shared asset resolver
  const bundledThemesDir = getBundledAssetsDir('themes');
  if (!bundledThemesDir) {
    return false;
  }

  const bundledPath = join(bundledThemesDir, `${id}.json`);
  const themesDir = getAppThemesDir();
  const destPath = join(themesDir, `${id}.json`);

  if (!existsSync(bundledPath)) {
    return false;
  }

  try {
    const content = readFileSync(bundledPath, 'utf-8');
    if (!existsSync(themesDir)) {
      mkdirSync(themesDir, { recursive: true });
    }
    writeFileSync(destPath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Color Theme Selection (stored in config)
// ============================================

/**
 * Get the currently selected color theme ID.
 * Returns 'default' if not set.
 */
export function getColorTheme(): string {
  const config = loadStoredConfig();
  if (config?.colorTheme !== undefined) {
    return config.colorTheme;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.colorTheme;
}

/**
 * Set the color theme ID.
 */
export function setColorTheme(themeId: string): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.colorTheme = themeId;
  saveConfig(config);
}

// ============================================
// Auto-Update Dismissed Version
// ============================================

/**
 * Get the dismissed update version.
 * Returns null if no version is dismissed.
 */
export function getDismissedUpdateVersion(): string | null {
  const config = loadStoredConfig();
  return config?.dismissedUpdateVersion ?? null;
}

/**
 * Set the dismissed update version.
 * Pass the version string to dismiss notifications for that version.
 */
export function setDismissedUpdateVersion(version: string): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.dismissedUpdateVersion = version;
  saveConfig(config);
}

/**
 * Clear the dismissed update version.
 * Call this when a new version is released (or on successful update).
 */
export function clearDismissedUpdateVersion(): void {
  const config = loadStoredConfig();
  if (!config) return;
  delete config.dismissedUpdateVersion;
  saveConfig(config);
}

// ============================================
// Custom Model (for third-party APIs)
// ============================================

/**
 * Get custom model ID override for third-party APIs.
 * When set, this single model is used for ALL API calls (main, summarization, etc.)
 */
export function getCustomModel(): string | null {
  const config = loadStoredConfig();
  return config?.customModel?.trim() || null;
}

/**
 * Set custom model ID for third-party APIs.
 * Pass null to clear and use default Anthropic models.
 */
export function setCustomModel(model: string | null): void {
  const config = loadStoredConfig();
  if (!config) return;

  if (model?.trim()) {
    config.customModel = model.trim();
  } else {
    delete config.customModel;
  }
  saveConfig(config);
}

/**
 * Resolve model ID based on provider and model availability.
 * Priority order:
 * 1. custom_api auth type → customModel config
 * 2. Check if defaultModelId is valid for current provider
 * 3. Fall back to appropriate default model for provider
 *
 * @param defaultModelId - The requested model ID
 * @returns The resolved model ID compatible with current provider
 */
export function resolveModelId(defaultModelId: string): string {
  const authType = getAuthType();
  const provider = getProvider();

  // Custom API: always use custom model
  if (authType === 'custom_api') {
    const customModel = getCustomModel();
    return customModel || defaultModelId;
  }

  // Get models for current provider (now using local function)
  const validModels = getModelsForProvider(provider || 'opentomo');
  const isValidModel = validModels.some((m: any) => m.id === defaultModelId);

  if (isValidModel) {
    return defaultModelId;
  }

  // Fallback to standard default model
  return DEFAULT_MODEL;
}

// ============================================
// Tool Icons (CLI tool icons for turn card display)
// ============================================

import { copyFileSync } from 'fs';

const TOOL_ICONS_DIR_NAME = 'tool-icons';

/**
 * Returns the path to the tool-icons directory: ~/.opentomo/tool-icons/
 */
export function getToolIconsDir(): string {
  return join(CONFIG_DIR, TOOL_ICONS_DIR_NAME);
}

/**
 * Ensure tool-icons directory exists and has bundled defaults.
 * Resolves bundled path automatically via getBundledAssetsDir('tool-icons').
 * Copies bundled tool-icons.json and icon files on first run.
 * Only copies files that don't already exist (preserves user customizations).
 */
export function ensureToolIcons(): void {
  const toolIconsDir = getToolIconsDir();

  // Create tool-icons directory if it doesn't exist
  if (!existsSync(toolIconsDir)) {
    mkdirSync(toolIconsDir, { recursive: true });
  }

  // Resolve bundled tool-icons directory via shared asset resolver
  const bundledToolIconsDir = getBundledAssetsDir('tool-icons');
  if (!bundledToolIconsDir) {
    return;
  }

  // Copy each bundled file if it doesn't exist in the target dir
  // This includes tool-icons.json and all icon files (png, ico, svg, jpg)
  try {
    const bundledFiles = readdirSync(bundledToolIconsDir);
    for (const file of bundledFiles) {
      const destPath = join(toolIconsDir, file);
      if (!existsSync(destPath)) {
        const srcPath = join(bundledToolIconsDir, file);
        copyFileSync(srcPath, destPath);
      }
    }
  } catch {
    // Ignore errors — tool icons are optional enhancement
  }
}
