/**
 * @opentomo/shared
 *
 * Shared business logic for OpenTomo.
 * Used by the Electron app.
 *
 * Import specific modules via subpath exports:
 *   import { OpenTomoAgent } from '@opentomo/shared/agent';
 *   import { loadStoredConfig } from '@opentomo/shared/config';
 *   import { getCredentialManager } from '@opentomo/shared/credentials';
 *   import { debug } from '@opentomo/shared/utils';
 *   import { createWorkspace, loadWorkspace } from '@opentomo/shared/workspaces';
 *
 * Available modules:
 *   - agent: OpenTomoAgent SDK wrapper, plan tools
 *   - auth: OAuth, token management, auth state
 *   - config: Storage, models, preferences
 *   - credentials: Encrypted credential storage
 *   - prompts: System prompt generation
 *   - utils: Debug logging, file handling, summarization
 *   - validation: URL validation
 *   - version: Version and installation management
 *   - workspaces: Workspace management (top-level organizational unit)
 */

// Export branding (standalone, no dependencies)
export * from './branding.ts';
