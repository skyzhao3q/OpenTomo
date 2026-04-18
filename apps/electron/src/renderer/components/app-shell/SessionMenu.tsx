/**
 * SessionMenu - Shared menu content for session actions
 *
 * Used by:
 * - SessionList (dropdown via "..." button, context menu via right-click)
 * - ChatPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 *
 * Provides consistent session actions:
 * - Share / Shared submenu
 * - Status submenu
 * - Mark as Unread
 * - Rename
 * - Open in New Window
 * - View in Finder
 * - Delete
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Trash2,
  Pencil,
  MailOpen,
  FolderOpen,
  RefreshCw,
  Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { useMenuComponents, type MenuComponents } from '@/components/ui/menu-context'
import type { ProjectConfig } from '@opentomo/shared/projects'

export interface SessionMenuProps {
  /** Session ID */
  sessionId: string
  /** Session name for rename dialog */
  sessionName: string
  /** Whether session has messages */
  hasMessages: boolean
  /** Whether session has unread messages */
  hasUnreadMessages: boolean
  /** Current project ID for this session */
  sessionProjectId?: string | null
  /** Available project configs for "Move to Project" submenu */
  projects?: ProjectConfig[]
  /** Callback when project is changed */
  onProjectChange?: (projectId: string | null) => void
  /** Callbacks */
  onRename: () => void
  onMarkUnread: () => void
  onOpenInNewWindow: () => void
  onDelete: () => void
}

/**
 * SessionMenu - Renders the menu items for session actions
 * This is the content only, not wrapped in a DropdownMenu
 */
export function SessionMenu({
  sessionId,
  sessionName,
  hasMessages,
  hasUnreadMessages,
  sessionProjectId,
  projects = [],
  onProjectChange,
  onRename,
  onMarkUnread,
  onOpenInNewWindow,
  onDelete,
}: SessionMenuProps) {
  const { t } = useTranslation()

  const handleShowInFinder = () => {
    window.electronAPI.sessionCommand(sessionId, { type: 'showInFinder' })
  }

  const handleCopyPath = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'copyPath' }) as { success: boolean; path?: string } | undefined
    if (result?.success && result.path) {
      await navigator.clipboard.writeText(result.path)
      toast.success(t('sessionMenu.pathCopied'))
    }
  }

  const handleRefreshTitle = async () => {
    const result = await window.electronAPI.sessionCommand(sessionId, { type: 'refreshTitle' }) as { success: boolean; title?: string; error?: string } | undefined
    if (result?.success) {
      toast.success(t('sessionMenu.titleRefreshed'), { description: result.title })
    } else {
      toast.error(t('sessionMenu.failedToRefreshTitle'), { description: result?.error || t('sessionMenu.unknownError') })
    }
  }

  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = useMenuComponents()

  return (
    <>

      {/* Move to Project submenu */}
      {projects.length > 0 && onProjectChange && (
        <Sub>
          <SubTrigger className="pr-2">
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="flex-1">{t('sessionMenu.moveToProject')}</span>
          </SubTrigger>
          <SubContent>
            {/* Uncategorized option */}
            <MenuItem
              onClick={() => onProjectChange(null)}
              className={!sessionProjectId ? 'bg-foreground/5' : ''}
            >
              <span className="flex-1">{t('sessionMenu.uncategorized')}</span>
              <span className="w-3.5 ml-4">
                {!sessionProjectId && <Check className="h-3.5 w-3.5 text-foreground" />}
              </span>
            </MenuItem>
            {projects.length > 0 && <Separator />}
            {/* Project options */}
            {projects.map((project) => (
              <MenuItem
                key={project.id}
                onClick={() => onProjectChange(project.id)}
                className={sessionProjectId === project.id ? 'bg-foreground/5' : ''}
              >
                <span className="flex-1">
                  {project.icon ? `${project.icon} ` : ''}{project.name}
                </span>
                <span className="w-3.5 ml-4">
                  {sessionProjectId === project.id && <Check className="h-3.5 w-3.5 text-foreground" />}
                </span>
              </MenuItem>
            ))}
          </SubContent>
        </Sub>
      )}

      {/* Mark as Unread - only show if session has been read */}
      {!hasUnreadMessages && hasMessages && (
        <MenuItem onClick={onMarkUnread}>
          <MailOpen className="h-3.5 w-3.5" />
          <span className="flex-1">{t('sessionMenu.markAsUnread')}</span>
        </MenuItem>
      )}

      <Separator />

      {/* Rename */}
      <MenuItem onClick={onRename}>
        <Pencil className="h-3.5 w-3.5" />
        <span className="flex-1">{t('sessionMenu.rename')}</span>
      </MenuItem>

      {/* Regenerate Title - AI-generate based on recent messages */}
      <MenuItem onClick={handleRefreshTitle}>
        <RefreshCw className="h-3.5 w-3.5" />
        <span className="flex-1">{t('sessionMenu.regenerateTitle')}</span>
      </MenuItem>

      <Separator />

      {/* Delete */}
      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">{t('sessionMenu.delete')}</span>
      </MenuItem>
    </>
  )
}
