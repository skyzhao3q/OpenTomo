/**
 * SidebarMenu - Shared menu content for sidebar navigation items
 *
 * Used by:
 * - LeftSidebar (context menu via right-click on nav items)
 * - AppShell (context menu for New Chat button)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 *
 * Provides actions based on the sidebar item type:
 * - "Configure Statuses" (for allChats items) - triggers EditPopover callback
 * - "Add Skill" (for skills) - triggers EditPopover callback
 * - "Open in New Window" (for newChat only) - uses deep link
 */

import { useTranslation } from 'react-i18next'
import {
  Settings2,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'

export type SidebarMenuType = 'allChats' | 'skills' | 'labels' | 'views' | 'newChat'

export interface SidebarMenuProps {
  /** Type of sidebar item (determines available menu items) */
  type: SidebarMenuType
  /** Label ID — when set, this is an individual label item (enables Delete Label) */
  labelId?: string
  /** Handler for "Configure Labels" action - receives labelId when triggered from a specific label */
  onConfigureLabels?: (labelId?: string) => void
  /** Handler for "Add New Label" action - creates a label (parentId = labelId if set) */
  onAddLabel?: (parentId?: string) => void
  /** Handler for "Delete Label" action - deletes the label identified by labelId */
  onDeleteLabel?: (labelId: string) => void
  /** Handler for "Add Skill" action - only for skills type */
  onAddSkill?: () => void
  /** Handler for "Edit Views" action - for views type */
  onConfigureViews?: () => void
  /** View ID — when set, this is an individual view (enables Delete) */
  viewId?: string
  /** Handler for "Delete View" action */
  onDeleteView?: (id: string) => void
}

/**
 * SidebarMenu - Renders the menu items for sidebar navigation actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function SidebarMenu({
  type,
  labelId,
  onConfigureLabels,
  onAddLabel,
  onDeleteLabel,
  onAddSkill,
  onConfigureViews,
  viewId,
  onDeleteView,
}: SidebarMenuProps) {
  const { t } = useTranslation()
  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator } = useMenuComponents()

  // New Chat: no context menu items
  if (type === 'newChat') {
    return null
  }


  // Labels: show context-appropriate actions
  // - Header ("Labels" parent): Configure Labels + Add New Label
  // - Individual label items: Add New Label (as child) + Delete Label
  if (type === 'labels') {
    return (
      <>
        {onAddLabel && (
          <MenuItem onClick={() => onAddLabel(labelId)}>
            <Plus className="h-3.5 w-3.5" />
            <span className="flex-1">{t('sidebarMenu.addNewLabel')}</span>
          </MenuItem>
        )}
        {onConfigureLabels && (
          <MenuItem onClick={() => onConfigureLabels(labelId)}>
            <Settings2 className="h-3.5 w-3.5" />
            <span className="flex-1">{t('sidebarMenu.editLabels')}</span>
          </MenuItem>
        )}
        {labelId && onDeleteLabel && (
          <>
            <Separator />
            <MenuItem onClick={() => onDeleteLabel(labelId)}>
              <Trash2 className="h-3.5 w-3.5" />
              <span className="flex-1">{t('sidebarMenu.deleteLabel')}</span>
            </MenuItem>
          </>
        )}
      </>
    )
  }

  // Views: show "Edit Views" and optionally "Delete View"
  if (type === 'views') {
    return (
      <>
        {onConfigureViews && (
          <MenuItem onClick={onConfigureViews}>
            <Settings2 className="h-3.5 w-3.5" />
            <span className="flex-1">{t('sidebarMenu.editViews')}</span>
          </MenuItem>
        )}
        {viewId && onDeleteView && (
          <>
            <Separator />
            <MenuItem onClick={() => onDeleteView(viewId)}>
              <Trash2 className="h-3.5 w-3.5" />
              <span className="flex-1">{t('sidebarMenu.deleteView')}</span>
            </MenuItem>
          </>
        )}
      </>
    )
  }

  // Skills: show "Add Skill"
  if (type === 'skills' && onAddSkill) {
    return (
      <MenuItem onClick={onAddSkill}>
        <Plus className="h-3.5 w-3.5" />
        <span className="flex-1">{t('sidebarMenu.addSkill')}</span>
      </MenuItem>
    )
  }

  // Fallback: return null if no handler provided (shouldn't happen)
  return null
}
