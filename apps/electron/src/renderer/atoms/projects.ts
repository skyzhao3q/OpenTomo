/**
 * Projects State Management
 *
 * Workspace-scoped project configurations for session organization.
 * Updated via IPC broadcast (PROJECTS_CHANGED event).
 */

import { atom } from 'jotai'
import type { ProjectConfig } from '@opentomo/shared/projects'

/**
 * All projects for current workspace (sorted by order)
 */
export const projectsAtom = atom<ProjectConfig[]>([])
