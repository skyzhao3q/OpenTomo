/**
 * Project CRUD Operations
 *
 * Create, Read, Update, Delete, Reorder operations for projects.
 * Delete cascade strips the projectId from all sessions.
 */

import { loadProjectConfig, saveProjectConfig } from './storage.ts';
import type { ProjectConfig, CreateProjectInput, UpdateProjectInput } from './types.ts';

/**
 * Generate URL-safe slug from name
 */
function generateProjectSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
}

/**
 * Create a new project.
 * Generates a globally unique slug from the name.
 */
export function createProject(
  workspaceRootPath: string,
  input: CreateProjectInput
): ProjectConfig {
  const config = loadProjectConfig(workspaceRootPath);

  // Generate unique ID
  const existingIds = new Set(config.projects.map(p => p.id));
  let id = generateProjectSlug(input.name);
  if (!id) id = 'project'; // fallback for names with no alphanumeric chars
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${generateProjectSlug(input.name) || 'project'}-${suffix}`;
    suffix++;
  }

  const maxOrder = config.projects.length > 0
    ? Math.max(...config.projects.map(p => p.order))
    : -1;

  const project: ProjectConfig = {
    id,
    name: input.name,
    color: input.color,
    icon: input.icon,
    order: maxOrder + 1,
    createdAt: Date.now(),
  };

  config.projects.push(project);
  saveProjectConfig(workspaceRootPath, config);

  return project;
}

/**
 * Update an existing project (name, color, icon).
 * Cannot change the ID.
 * @throws Error if project not found
 */
export function updateProject(
  workspaceRootPath: string,
  projectId: string,
  updates: UpdateProjectInput
): ProjectConfig {
  const config = loadProjectConfig(workspaceRootPath);
  const project = config.projects.find(p => p.id === projectId);

  if (!project) {
    throw new Error(`Project '${projectId}' not found`);
  }

  if (updates.name !== undefined) project.name = updates.name;
  if (updates.color !== undefined) project.color = updates.color;
  if (updates.icon !== undefined) project.icon = updates.icon;

  saveProjectConfig(workspaceRootPath, config);
  return project;
}

/**
 * Delete a project.
 * Strips projectId from all sessions that reference it.
 * @returns Number of sessions that had projectId stripped
 */
export function deleteProject(
  workspaceRootPath: string,
  projectId: string
): { stripped: number } {
  const config = loadProjectConfig(workspaceRootPath);
  const projectIndex = config.projects.findIndex(p => p.id === projectId);

  if (projectIndex === -1) {
    throw new Error(`Project '${projectId}' not found`);
  }

  // Remove from config
  config.projects.splice(projectIndex, 1);
  saveProjectConfig(workspaceRootPath, config);

  // Strip projectId from all sessions
  const stripped = stripProjectFromSessions(workspaceRootPath, projectId);

  return { stripped };
}

/**
 * Reorder projects by providing the full ordered list of project IDs.
 * Updates order field based on array position.
 */
export function reorderProjects(
  workspaceRootPath: string,
  orderedIds: string[]
): void {
  const config = loadProjectConfig(workspaceRootPath);

  // Validate all IDs exist
  const validIds = new Set(config.projects.map(p => p.id));
  for (const id of orderedIds) {
    if (!validIds.has(id)) {
      throw new Error(`Invalid project ID for reorder: '${id}'`);
    }
  }

  // Update order based on array position
  for (let i = 0; i < orderedIds.length; i++) {
    const project = config.projects.find(p => p.id === orderedIds[i]);
    if (project) {
      project.order = i;
    }
  }

  saveProjectConfig(workspaceRootPath, config);
}

/**
 * Ensure the "Uncategorized" default project exists for this workspace.
 * Creates it with a fixed id of 'uncategorized' and the 📥 icon.
 * Safe to call at any time — no-op if the project already exists.
 * Returns the project and whether it was just created (for migration).
 */
export function ensureUncategorizedProject(
  workspaceRootPath: string,
): { project: ProjectConfig; isNew: boolean } {
  const config = loadProjectConfig(workspaceRootPath);
  const existing = config.projects.find(p => p.id === 'uncategorized');
  if (existing) return { project: existing, isNew: false };

  const minOrder = config.projects.length > 0
    ? Math.min(...config.projects.map(p => p.order))
    : 1;

  const uncategorized: ProjectConfig = {
    id: 'uncategorized',
    name: 'Uncategorized',
    icon: '📥',
    order: minOrder - 1,
    createdAt: Date.now(),
  };

  config.projects.push(uncategorized);
  saveProjectConfig(workspaceRootPath, config);

  return { project: uncategorized, isNew: true };
}

/**
 * Ensure the "Archived" default project exists for this workspace.
 * Creates it with a fixed id of 'archived' and the 📦 icon.
 * Safe to call at any time — no-op if the project already exists.
 */
export function ensureArchivedProject(workspaceRootPath: string): ProjectConfig {
  const config = loadProjectConfig(workspaceRootPath);
  const existing = config.projects.find(p => p.id === 'archived');
  if (existing) return existing;

  const maxOrder = config.projects.length > 0
    ? Math.max(...config.projects.map(p => p.order))
    : -1;

  const archived: ProjectConfig = {
    id: 'archived',
    name: 'Archived',
    icon: '📦',
    order: maxOrder + 1,
    createdAt: Date.now(),
  };

  config.projects.push(archived);
  saveProjectConfig(workspaceRootPath, config);

  return archived;
}

/**
 * Strip projectId from all sessions that reference the deleted project.
 * Uses dynamic import to avoid circular dependency with sessions module.
 */
function stripProjectFromSessions(
  workspaceRootPath: string,
  deletedProjectId: string
): number {
  const { listSessions, updateSessionMetadata } = require('../sessions/storage.ts');

  const sessions = listSessions(workspaceRootPath);
  let strippedCount = 0;

  for (const session of sessions) {
    if (session.projectId === deletedProjectId) {
      updateSessionMetadata(workspaceRootPath, session.id, { projectId: null });
      strippedCount++;
    }
  }

  return strippedCount;
}
