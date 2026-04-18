/**
 * Workspace Module
 *
 * Re-exports types and storage functions for workspaces.
 */

// Types
export type {
  WorkspaceConfig,
  CreateWorkspaceInput,
  LoadedWorkspace,
  WorkspaceSummary,
} from './types.ts';

// Storage functions
export {
  // Path utilities
  getDefaultWorkspacesDir,
  ensureDefaultWorkspacesDir,
  getWorkspacePath,
  getWorkspaceSourcesPath,
  getWorkspaceSessionsPath,
  getWorkspaceSkillsPath,
  getWorkspaceCommandsPath,
  // Config operations
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  // Disabled custom skills
  getWorkspaceDisabledCustomSkills,
  setWorkspaceDisabledCustomSkills,
  // Load operations
  loadWorkspace,
  getWorkspaceSummary,
  // Create/Delete operations
  generateSlug,
  generateUniqueWorkspacePath,
  createWorkspaceAtPath,
  deleteWorkspaceFolder,
  isValidWorkspace,
  ensureWorkspaceDirStructure,
  renameWorkspaceFolder,
  // Auto-discovery
  discoverWorkspacesInDefaultLocation,
  // Constants
  CONFIG_DIR,
  DEFAULT_WORKSPACES_DIR,
} from './storage.ts';

// Workspace .env file management
export type { EnvVar } from './env-storage.ts';
export {
  parseEnvFile,
  serializeEnvFile,
  readWorkspaceEnvFile,
  writeWorkspaceEnvFile,
} from './env-storage.ts';
