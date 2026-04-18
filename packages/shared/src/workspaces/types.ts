/**
 * Workspace Types
 *
 * Workspaces are the top-level organizational unit. Everything (sources, sessions)
 * is scoped to a workspace.
 *
 * Directory structure:
 * ~/.opentomo/workspaces/{slug}/
 *   ├── config.json      - Workspace settings
 *   ├── sources/         - Data sources (MCP, API, local)
 *   └── sessions/        - Conversation sessions
 */

import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';

/**
 * Workspace-level agent definition (optional).
 * When set, customizes the agent's identity and behavior for all sessions in this workspace.
 * All fields are optional — omitting this entirely preserves default behavior.
 */
export interface AgentDefinition {
  /** Display name for this agent (e.g., "DevOps Assistant", "Code Reviewer") */
  name?: string;
  /** Short description of the agent's role */
  description?: string;
  /** Visual identity — emoji or URL to icon */
  icon?: string;
}

/**
 * Local MCP server configuration
 * Controls whether stdio-based (local subprocess) MCP servers can be spawned.
 */
export interface LocalMcpConfig {
  /**
   * Whether local (stdio) MCP servers are enabled for this workspace.
   * When false, only HTTP-based MCP servers will be used.
   * Default: true (can be overridden by SS_LOCAL_MCP_ENABLED env var)
   */
  enabled: boolean;
}

/**
 * Workspace configuration (stored in config.json)
 */
export interface WorkspaceConfig {
  id: string;
  name: string;
  slug: string; // Folder name (URL-safe)

  /**
   * Default settings for new sessions in this workspace
   */
  defaults?: {
    model?: string;
    enabledSourceSlugs?: string[]; // Sources to enable by default
    permissionMode?: PermissionMode; // Default permission mode ('safe', 'ask', 'allow-all')
    cyclablePermissionModes?: PermissionMode[]; // Which modes can be cycled with SHIFT+TAB (min 2, default: all 3)
    workingDirectory?: string;
    thinkingLevel?: ThinkingLevel; // Default thinking level ('off', 'think', 'max') - default: 'think'
    colorTheme?: string; // Color theme override for this workspace (preset ID). Undefined = inherit from app default.
    /**
     * @deprecated Builtin skills are now always enabled and hidden from UI.
     * This field is kept for backward compatibility but is no longer used.
     */
    disabledBuiltinSkills?: string[];
    /**
     * Custom skill slugs that are disabled for this workspace.
     * Applies to global, workspace, and project-level skills (not builtin).
     */
    disabledCustomSkills?: string[];
  };

  /**
   * Local MCP server configuration.
   * Controls whether stdio-based MCP servers can be spawned in this workspace.
   * Resolution order: ENV (SS_LOCAL_MCP_ENABLED) > workspace config > default (true)
   */
  localMcpServers?: LocalMcpConfig;

  /**
   * Optional agent definition for this workspace.
   * Defines the agent's identity (name, description, icon).
   * Custom behavioral instructions are stored in AGENT.md (separate file).
   */
  agent?: AgentDefinition;

  createdAt: number;
  updatedAt: number;
}

/**
 * Workspace creation input
 */
export interface CreateWorkspaceInput {
  name: string;
  defaults?: WorkspaceConfig['defaults'];
}

/**
 * Loaded workspace with resolved sources
 */
export interface LoadedWorkspace {
  config: WorkspaceConfig;
  sourceSlugs: string[]; // Available source slugs (not fully loaded to save memory)
  sessionCount: number; // Number of sessions
}

/**
 * Workspace summary for listing (lightweight)
 */
export interface WorkspaceSummary {
  slug: string;
  name: string;
  sourceCount: number;
  sessionCount: number;
  createdAt: number;
  updatedAt: number;
}
