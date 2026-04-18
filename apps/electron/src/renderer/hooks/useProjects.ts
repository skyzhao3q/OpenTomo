/**
 * useProjects Hook
 *
 * React hook to load and manage workspace projects.
 * Returns the flat project list sorted by order.
 * Auto-refreshes when workspace changes or project config changes.
 */

import { useState, useEffect, useCallback } from 'react'
import type { ProjectConfig } from '@opentomo/shared/projects'

export interface UseProjectsResult {
  /** Projects sorted by order */
  projects: ProjectConfig[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Load projects for a workspace via IPC.
 * Auto-refreshes when workspaceId changes.
 * Subscribes to live project config changes via PROJECTS_CHANGED event.
 */
export function useProjects(workspaceId: string | null): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setProjects([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const configs = await window.electronAPI.listProjects(workspaceId)
      setProjects(configs)
      setError(null)
    } catch (err) {
      console.error('[useProjects] Failed to load projects:', err)
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  // Load projects when workspace changes
  useEffect(() => {
    refresh()
  }, [refresh])

  // Subscribe to live project changes (config file changes)
  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onProjectsChanged((changedWorkspaceId) => {
      // Only refresh if this is our workspace
      if (changedWorkspaceId === workspaceId) {
        refresh()
      }
    })

    return cleanup
  }, [workspaceId, refresh])

  return {
    projects,
    isLoading,
    error,
    refresh,
  }
}
