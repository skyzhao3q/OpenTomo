/**
 * Session-Scoped Tools
 *
 * Tools that are scoped to a specific session. Each session gets its own
 * instance of these tools with session-specific callbacks and state.
 *
 * Tools included:
 * - SubmitPlan: Submit a plan file for user review/display
 * - config_validate: Validate configuration files
 * - skill_validate: Validate skill SKILL.md files
 * - source_test: Validate schema, download icons, test local paths
 * - source_credential_prompt: Prompt user for credentials (retained for future use)
 *
 * Source and Skill CRUD is done via standard file editing tools (Read/Write/Edit).
 * See ~/.opentomo/docs/ for config format documentation.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { getSessionPlansPath } from '../sessions/storage.ts';
import { debug } from '../utils/debug.ts';
import {
  validateConfig,
  validateSource,
  validateAllSources,
  validatePreferences,
  validateAll,
  validateSkill,
  validateAllSkills,
  validateWorkspacePermissions,
  validateAllPermissions,
  validateToolIcons,
  formatValidationResult,
} from '../config/validators.ts';
import { PERMISSION_MODE_CONFIG } from './mode-types.ts';
import { createLLMTool } from './llm-tool.ts';

// ============================================================
// Session-Scoped Tool Callbacks
// ============================================================

/**
 * Credential input modes for different auth types
 */
export type CredentialInputMode = 'bearer' | 'basic' | 'header' | 'query' | 'multi-header';

/**
 * Auth request types (limited to credential for local sources)
 */
export type AuthRequestType = 'credential';

/**
 * Base auth request fields
 */
interface BaseAuthRequest {
  requestId: string;
  sessionId: string;
  sourceSlug: string;
  sourceName: string;
}

/**
 * Credential auth request - prompts for API key, bearer token, etc.
 * (Retained for potential future use with authenticated local sources)
 */
export interface CredentialAuthRequest extends BaseAuthRequest {
  type: 'credential';
  mode: CredentialInputMode;
  labels?: {
    credential?: string;
    username?: string;
    password?: string;
  };
  description?: string;
  hint?: string;
  headerName?: string;
  /** Header names for multi-header auth (e.g., ["DD-API-KEY", "DD-APPLICATION-KEY"]) */
  headerNames?: string[];
  /** Source URL/domain for password manager credential matching (1Password, etc.) */
  sourceUrl?: string;
  /** For basic auth: whether password is required. Default true for backward compatibility. */
  passwordRequired?: boolean;
}

/**
 * Union of all auth request types (only credential for local sources)
 */
export type AuthRequest = CredentialAuthRequest;

/**
 * Auth result - sent back to agent after auth completes
 */
export interface AuthResult {
  requestId: string;
  sourceSlug: string;
  success: boolean;
  cancelled?: boolean;
  error?: string;
  // Additional info for successful auth
  email?: string;      // For Google OAuth
  workspace?: string;  // Reserved for workspace-based OAuth providers
}

// ============================================================
// Helper Functions (exported for testing)
// ============================================================
// (Removed credential mode helpers - no longer needed for local sources only)

/**
 * Callbacks for session-scoped tool operations.
 * These are registered per-session and invoked by tools.
 */
export interface SessionScopedToolCallbacks {
  /** Called when a plan is submitted - triggers plan message display in UI */
  onPlanSubmitted?: (planPath: string) => void;
  /**
   * Called when authentication is requested - triggers auth UI and forceAbort.
   * This follows the SubmitPlan pattern:
   * 1. Tool calls onAuthRequest
   * 2. Session manager creates auth-request message and calls forceAbort
   * 3. User completes auth in UI
   * 4. Auth result is sent as a "faked user message"
   * 5. Agent resumes and processes the result
   */
  onAuthRequest?: (request: AuthRequest) => void;
}

/**
 * Registry mapping session IDs to their callbacks.
 */
const sessionScopedToolCallbackRegistry = new Map<string, SessionScopedToolCallbacks>();

/**
 * Register callbacks for a session's tools.
 * Called by OpenTomoAgent when initializing.
 */
export function registerSessionScopedToolCallbacks(
  sessionId: string,
  callbacks: SessionScopedToolCallbacks
): void {
  sessionScopedToolCallbackRegistry.set(sessionId, callbacks);
  debug(`[SessionScopedTools] Registered callbacks for session ${sessionId}`);
}

/**
 * Unregister callbacks for a session.
 * Called by OpenTomoAgent on dispose.
 */
export function unregisterSessionScopedToolCallbacks(sessionId: string): void {
  sessionScopedToolCallbackRegistry.delete(sessionId);
  debug(`[SessionScopedTools] Unregistered callbacks for session ${sessionId}`);
}

/**
 * Get callbacks for a session.
 */
function getSessionScopedToolCallbacks(sessionId: string): SessionScopedToolCallbacks | undefined {
  return sessionScopedToolCallbackRegistry.get(sessionId);
}

// ============================================================
// Plan File State (per session)
// ============================================================

/**
 * Track the last submitted plan file per session
 */
const sessionPlanFiles = new Map<string, string>();

/**
 * Get the last submitted plan file path for a session
 */
export function getLastPlanFilePath(sessionId: string): string | null {
  return sessionPlanFiles.get(sessionId) ?? null;
}

/**
 * Set the last submitted plan file path for a session
 */
function setLastPlanFilePath(sessionId: string, path: string): void {
  sessionPlanFiles.set(sessionId, path);
}

/**
 * Clear plan file state for a session
 */
export function clearPlanFileState(sessionId: string): void {
  sessionPlanFiles.delete(sessionId);
}

// ============================================================
// Tool Factories
// ============================================================

/**
 * Create a session-scoped SubmitPlan tool.
 * The sessionId is captured at creation time.
 *
 * This is a UNIVERSAL tool - the agent can use it anytime to submit
 * a plan for user review, regardless of Safe Mode status.
 */
export function createSubmitPlanTool(sessionId: string) {
  const exploreName = PERMISSION_MODE_CONFIG['safe'].displayName;

  return tool(
    'SubmitPlan',
    `Submit a plan for user review.

Call this after you have written your plan to a markdown file using the Write tool.
The plan will be displayed to the user in a special formatted view.

This tool can be used anytime - it's not restricted to any particular mode.
Use it whenever you want to present a structured plan to the user.

**${exploreName} Mode Workflow:** When you are in ${exploreName} mode and have completed your research/exploration,
use this tool to present your implementation plan. The plan UI includes an "Accept Plan" button
that exits ${exploreName} mode and allows you to begin implementation immediately.

**Format your plan as markdown:**
\`\`\`markdown
# Plan Title

## Summary
Brief description of what this plan accomplishes.

## Steps
1. **Step description** - Details and approach
2. **Another step** - More details
3. ...
\`\`\`

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** to present the plan to the user
- No further tool calls or text output will be processed after this tool returns
- The conversation will resume when the user responds (accept, modify, or reject the plan)
- Do NOT include any text or tool calls after SubmitPlan - they will not be executed`,
    {
      planPath: z.string().describe('Absolute path to the plan markdown file you wrote'),
    },
    async (args) => {
      debug('[SubmitPlan] Called with planPath:', args.planPath);
      debug('[SubmitPlan] sessionId (from closure):', sessionId);

      // Verify the file exists
      if (!existsSync(args.planPath)) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: Plan file not found at ${args.planPath}. Please write the plan file first using the Write tool.`,
          }],
        };
      }

      // Read the plan content to verify it's valid
      let planContent: string;
      try {
        planContent = readFileSync(args.planPath, 'utf-8');
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error reading plan file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
        };
      }

      // Store the plan file path
      setLastPlanFilePath(sessionId, args.planPath);

      // Get callbacks and notify UI
      const callbacks = getSessionScopedToolCallbacks(sessionId);
      debug('[SubmitPlan] Registry callbacks found:', !!callbacks);

      if (callbacks?.onPlanSubmitted) {
        callbacks.onPlanSubmitted(args.planPath);
        debug('[SubmitPlan] Callback completed');
      } else {
        debug('[SubmitPlan] No callback registered for session');
      }

      return {
        content: [{
          type: 'text' as const,
          text: 'Plan submitted for review. Waiting for user feedback.',
        }],
        isError: false,
      };
    }
  );
}

// ============================================================
// Config Validation Tool
// ============================================================

/**
 * Create a session-scoped config_validate tool.
 * Validates configuration files and returns structured error reports.
 */
export function createConfigValidateTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'config_validate',
    `Validate configuration files.

Use this after editing configuration files to check for errors before they take effect.
Returns structured validation results with errors, warnings, and suggestions.

**Targets:**
- \`config\`: Validates ~/.opentomo/config.json (workspaces, model, settings)
- \`sources\`: Validates all sources in ~/.opentomo/workspaces/{workspace}/sources/*/config.json
- \`preferences\`: Validates ~/.opentomo/preferences.json (user preferences)
- \`permissions\`: Validates permissions.json files (workspace, source, and app-level default)
- \`tool-icons\`: Validates ~/.opentomo/tool-icons/tool-icons.json (CLI tool icon mappings)
- \`all\`: Validates all configuration files

**For specific source validation:** Use target='sources' with sourceSlug parameter.
**For specific source permissions:** Use target='permissions' with sourceSlug parameter.

**Example workflow:**
1. Edit a config file using Write/Edit tools
2. Call config_validate to check for errors
3. If errors found, fix them and re-validate
4. Once valid, changes take effect on next reload`,
    {
      target: z.enum(['config', 'sources', 'preferences', 'permissions', 'tool-icons', 'all']).describe(
        'Which config file(s) to validate'
      ),
      sourceSlug: z.string().optional().describe(
        'Validate a specific source by slug (used with target "sources" or "permissions")'
      ),
    },
    async (args) => {
      debug('[config_validate] Validating:', args.target, 'sourceSlug:', args.sourceSlug);

      try {
        let result;

        switch (args.target) {
          case 'config':
            result = validateConfig();
            break;
          case 'sources':
            if (args.sourceSlug) {
              result = validateSource(workspaceRootPath, args.sourceSlug);
            } else {
              result = validateAllSources(workspaceRootPath);
            }
            break;
          case 'preferences':
            result = validatePreferences();
            break;
          case 'permissions':
            result = validateAllPermissions(workspaceRootPath);
            break;
          case 'tool-icons':
            result = validateToolIcons();
            break;
          case 'all':
            result = validateAll(workspaceRootPath);
            break;
        }

        const formatted = formatValidationResult(result);

        return {
          content: [{
            type: 'text' as const,
            text: formatted,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[config_validate] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error validating config: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Skill Validation Tool
// ============================================================

/**
 * Create a session-scoped skill_validate tool.
 * Validates skill SKILL.md files and returns structured error reports.
 */
export function createSkillValidateTool(sessionId: string, workspaceRoot: string) {
  return tool(
    'skill_validate',
    `Validate a skill's SKILL.md file.

Checks:
- Slug format (lowercase alphanumeric with hyphens)
- SKILL.md exists and is readable
- YAML frontmatter is valid with required fields (name, description)
- Content is non-empty after frontmatter
- Icon format if present (svg/png/jpg)

**Usage:** Call after creating or editing a skill to verify it's valid.

**Returns:** Validation status with specific errors and warnings.`,
    {
      skillSlug: z.string().describe('The slug of the skill to validate'),
    },
    async (args) => {
      debug('[skill_validate] Validating skill:', args.skillSlug);

      try {
        const result = validateSkill(workspaceRoot, args.skillSlug);
        const formatted = formatValidationResult(result);

        return {
          content: [{
            type: 'text' as const,
            text: formatted,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[skill_validate] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error validating skill: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// OAuth and Authentication Tools (Removed)
// ============================================================
// OAuth tools removed as local sources don't require authentication.

// ============================================================
// Session-Scoped Tools Provider
// ============================================================

/**
 * Cache of session-scoped tool providers, keyed by sessionId.
 */
const sessionScopedToolsCache = new Map<string, ReturnType<typeof createSdkMcpServer>>();

/**
 * Get the session-scoped tools provider for a session.
 * Creates and caches the provider if it doesn't exist.
 *
 * @param sessionId - Unique session identifier
 * @param workspaceRootPath - Absolute path to workspace folder (e.g., ~/.opentomo/workspaces/xxx)
 */
export function getSessionScopedTools(sessionId: string, workspaceRootPath: string): ReturnType<typeof createSdkMcpServer> {
  const cacheKey = `${sessionId}::${workspaceRootPath}`;
  let cached = sessionScopedToolsCache.get(cacheKey);
  if (!cached) {
    // Create session-scoped tools that capture the sessionId and workspaceRootPath in their closures
    // Note: Source CRUD is done via standard file editing tools (Read/Write/Edit).
    // See ~/.opentomo/docs/ for config format documentation.
    cached = createSdkMcpServer({
      name: 'session',
      version: '1.0.0',
      tools: [
        createSubmitPlanTool(sessionId),
        // Config validation tool
        createConfigValidateTool(sessionId, workspaceRootPath),
        // Skill validation tool
        createSkillValidateTool(sessionId, workspaceRootPath),
        // LLM tool - invoke secondary Claude calls for subtasks
        createLLMTool({ sessionId }),
      ],
    });
    sessionScopedToolsCache.set(cacheKey, cached);
    debug(`[SessionScopedTools] Created tools provider for session ${sessionId} in workspace ${workspaceRootPath}`);
  }
  return cached;
}

/**
 * Clean up session-scoped tools when a session is disposed.
 * Removes the cached provider and clears all session state.
 *
 * @param sessionId - Unique session identifier
 * @param workspaceRootPath - Optional workspace root path; if provided, only cleans up that specific workspace's cache
 */
export function cleanupSessionScopedTools(sessionId: string, workspaceRootPath?: string): void {
  if (workspaceRootPath) {
    // Clean up specific workspace cache
    const cacheKey = `${sessionId}::${workspaceRootPath}`;
    sessionScopedToolsCache.delete(cacheKey);
  } else {
    // Clean up all workspace caches for this session
    for (const key of sessionScopedToolsCache.keys()) {
      if (key.startsWith(`${sessionId}::`)) {
        sessionScopedToolsCache.delete(key);
      }
    }
  }
  sessionScopedToolCallbackRegistry.delete(sessionId);
  sessionPlanFiles.delete(sessionId);
  debug(`[SessionScopedTools] Cleaned up session ${sessionId}`);
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Get the plans directory for a session
 */
export function getSessionPlansDir(workspaceRootPath: string, sessionId: string): string {
  return getSessionPlansPath(workspaceRootPath, sessionId);
}

/**
 * Check if a file path is within the plans directory
 */
export function isPathInPlansDir(filePath: string, workspaceRootPath: string, sessionId: string): boolean {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  // Normalize paths for comparison
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPlansDir = plansDir.replace(/\\/g, '/');
  return normalizedPath.startsWith(normalizedPlansDir);
}
