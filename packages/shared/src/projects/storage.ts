/**
 * Project Storage
 *
 * Filesystem-based storage for workspace project configurations.
 * Projects are stored at {workspaceRootPath}/projects/config.json
 *
 * Projects are flat folders (no hierarchy) for organizing sessions.
 * New workspaces start with an empty project list.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { WorkspaceProjectConfig, ProjectConfig } from './types.ts';
import { debug } from '../utils/debug.ts';

const PROJECT_CONFIG_DIR = 'projects';
const PROJECT_CONFIG_FILE = 'projects/config.json';

/**
 * Get default project configuration (empty — no starter projects).
 */
export function getDefaultProjectConfig(): WorkspaceProjectConfig {
  return {
    version: 1,
    projects: [],
  };
}

/**
 * Load workspace project configuration.
 * Returns empty config if no file exists or parsing fails.
 */
export function loadProjectConfig(workspaceRootPath: string): WorkspaceProjectConfig {
  const configPath = join(workspaceRootPath, PROJECT_CONFIG_FILE);

  if (!existsSync(configPath)) {
    return getDefaultProjectConfig();
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as WorkspaceProjectConfig;
    return config;
  } catch (error) {
    debug('[loadProjectConfig] Failed to parse config:', error);
    return getDefaultProjectConfig();
  }
}

/**
 * Save workspace project configuration to disk.
 * Creates the projects directory if missing.
 */
export function saveProjectConfig(
  workspaceRootPath: string,
  config: WorkspaceProjectConfig
): void {
  const projectDir = join(workspaceRootPath, PROJECT_CONFIG_DIR);
  const configPath = join(workspaceRootPath, PROJECT_CONFIG_FILE);

  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true });
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    debug('[saveProjectConfig] Failed to save config:', error);
    throw error;
  }
}

/**
 * List all projects sorted by order.
 */
export function listProjects(workspaceRootPath: string): ProjectConfig[] {
  const config = loadProjectConfig(workspaceRootPath);
  return [...config.projects].sort((a, b) => a.order - b.order);
}

/**
 * Get a single project by ID.
 * Returns null if not found.
 */
export function getProject(
  workspaceRootPath: string,
  projectId: string
): ProjectConfig | null {
  const config = loadProjectConfig(workspaceRootPath);
  return config.projects.find(p => p.id === projectId) || null;
}

/**
 * Check if a project ID exists in this workspace
 */
export function isValidProjectId(
  workspaceRootPath: string,
  projectId: string
): boolean {
  const config = loadProjectConfig(workspaceRootPath);
  return config.projects.some(p => p.id === projectId);
}
