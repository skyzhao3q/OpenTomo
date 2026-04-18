/**
 * Project Types
 *
 * Types for project-based session organization (flat folders only).
 * Stored at {workspaceRootPath}/projects/config.json
 *
 * Projects are exclusive containers (one-per-session), unlike labels which are additive.
 * A session belongs to at most one project (or no project = uncategorized).
 *
 * Color format: EntityColor (system color string or custom color object)
 * - System: "accent", "foreground/50", "info/80" (uses CSS variables, auto light/dark)
 * - Custom: { light: "#EF4444", dark: "#F87171" } (explicit values)
 */

import type { EntityColor } from '../colors/types.ts'

/**
 * Project configuration (stored in projects/config.json).
 * Array position in the config determines display order.
 */
export interface ProjectConfig {
  /** Unique ID — simple slug, globally unique (e.g., 'web-redesign', 'api-design') */
  id: string;

  /** Display name */
  name: string;

  /** Optional color for visual distinction */
  color?: EntityColor;

  /** Icon: emoji string (e.g., '📁', '🚀'). Omit to use default folder icon. */
  icon?: string;

  /** Display order in SessionList (lower = first) */
  order: number;

  /** When the project was created (ms timestamp) */
  createdAt: number;
}

/**
 * Complete project configuration for a workspace
 */
export interface WorkspaceProjectConfig {
  /** Schema version for migrations (start at 1) */
  version: number;

  /** Array of project configurations (flat list, no nesting). Array position = display order. */
  projects: ProjectConfig[];
}

/**
 * Input for creating a new project
 */
export interface CreateProjectInput {
  name: string;
  color?: EntityColor;
  icon?: string;
}

/**
 * Input for updating an existing project
 */
export interface UpdateProjectInput {
  name?: string;
  color?: EntityColor;
  icon?: string;
}
