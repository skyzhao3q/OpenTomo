import { useEffect, useState } from "react"
import { isMac } from "@/lib/platform"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
  DropdownMenuSub,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from "@/components/ui/styled-dropdown"
import * as Icons from "lucide-react"
import { OpenTomoSymbol } from "./icons/OpenTomoSymbol"
import { useAtomValue } from 'jotai'
import { agentNameAtom } from '@/atoms/agent-name'
import { SquarePenRounded } from "./icons/SquarePenRounded"
import { TopBarButton } from "./ui/TopBarButton"
import {
  EDIT_MENU,
  VIEW_MENU,
  WINDOW_MENU,
  SETTINGS_ITEMS,
  getShortcutDisplay,
} from "../../shared/menu-schema"
import type { MenuItem, MenuSection, SettingsMenuItem } from "../../shared/menu-schema"
import { SETTINGS_ICONS } from "./icons/SettingsIcons"

// Map of action handlers for menu items that need custom behavior
type MenuActionHandlers = {
  toggleFocusMode?: () => void
  toggleSidebar?: () => void
}

// Map of IPC handlers for role-based menu items
const roleHandlers: Record<string, () => void> = {
  undo: () => window.electronAPI.menuUndo(),
  redo: () => window.electronAPI.menuRedo(),
  cut: () => window.electronAPI.menuCut(),
  copy: () => window.electronAPI.menuCopy(),
  paste: () => window.electronAPI.menuPaste(),
  selectAll: () => window.electronAPI.menuSelectAll(),
  zoomIn: () => window.electronAPI.menuZoomIn(),
  zoomOut: () => window.electronAPI.menuZoomOut(),
  resetZoom: () => window.electronAPI.menuZoomReset(),
  minimize: () => window.electronAPI.menuMinimize(),
  zoom: () => window.electronAPI.menuMaximize(),
}

/**
 * Get the Lucide icon component by name
 */
function getIcon(name: string): React.ComponentType<{ className?: string }> | null {
  const IconComponent = Icons[name as keyof typeof Icons] as React.ComponentType<{ className?: string }> | undefined
  return IconComponent ?? null
}

/**
 * Renders a single menu item from the schema
 */
function renderMenuItem(
  item: MenuItem,
  index: number,
  actionHandlers: MenuActionHandlers
): React.ReactNode {
  if (item.type === 'separator') {
    return <StyledDropdownMenuSeparator key={`sep-${index}`} />
  }

  const Icon = getIcon(item.icon)
  const shortcut = getShortcutDisplay(item, isMac)

  if (item.type === 'role') {
    const handler = roleHandlers[item.role]
    // Gracefully handle missing role handlers with console warning
    const safeHandler = handler ?? (() => {
      console.warn(`[AppMenu] No handler registered for role: ${item.role}`)
    })
    return (
      <StyledDropdownMenuItem key={item.role} onClick={safeHandler}>
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {item.label}
        {shortcut && <DropdownMenuShortcut className="pl-6">{shortcut}</DropdownMenuShortcut>}
      </StyledDropdownMenuItem>
    )
  }

  if (item.type === 'action') {
    // Map action IDs to handlers
    const handler = item.id === 'toggleFocusMode'
      ? actionHandlers.toggleFocusMode
      : item.id === 'toggleSidebar'
        ? actionHandlers.toggleSidebar
        : undefined
    return (
      <StyledDropdownMenuItem key={item.id} onClick={handler}>
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {item.label}
        {shortcut && <DropdownMenuShortcut className="pl-6">{shortcut}</DropdownMenuShortcut>}
      </StyledDropdownMenuItem>
    )
  }

  return null
}

/**
 * Renders a menu section as a submenu
 */
function renderMenuSection(
  section: MenuSection,
  actionHandlers: MenuActionHandlers
): React.ReactNode {
  const Icon = getIcon(section.icon)
  return (
    <DropdownMenuSub key={section.id}>
      <StyledDropdownMenuSubTrigger>
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {section.label}
      </StyledDropdownMenuSubTrigger>
      <StyledDropdownMenuSubContent>
        {section.items.map((item, index) => renderMenuItem(item, index, actionHandlers))}
      </StyledDropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

interface AppMenuProps {
  onNewChat: () => void
  onNewWindow?: () => void
  onOpenSettings: () => void
  /** Navigate to a specific settings subpage */
  onOpenSettingsSubpage: (subpage: SettingsMenuItem['id']) => void
  onOpenKeyboardShortcuts: () => void
  onToggleSidebar?: () => void
  onToggleFocusMode?: () => void
}

/**
 * AppMenu - Main application dropdown menu and top bar navigation
 *
 * Contains the OpenTomo logo dropdown with all menu functionality:
 * - File actions (New Chat, New Window)
 * - Edit submenu (Undo, Redo, Cut, Copy, Paste, Select All)
 * - View submenu (Zoom In/Out, Reset)
 * - Window submenu (Minimize, Maximize)
 * - Settings submenu (Settings, Stored User Preferences)
 * - Help submenu (Documentation, Keyboard Shortcuts)
 * - Debug submenu (dev only)
 * - Quit
 *
 * On Windows/Linux, this is the only menu (native menu is hidden).
 * On macOS, this mirrors the native menu for consistency.
 */
export function AppMenu({
  onNewChat,
  onNewWindow,
  onOpenSettings,
  onOpenSettingsSubpage,
  onOpenKeyboardShortcuts,
  onToggleSidebar,
  onToggleFocusMode,
}: AppMenuProps) {
  const [isDebugMode, setIsDebugMode] = useState(false)
  const modKey = isMac ? '⌘' : 'Ctrl+'
  const agentName = useAtomValue(agentNameAtom)

  useEffect(() => {
    window.electronAPI.isDebugMode().then(setIsDebugMode)
  }, [])

  // Action handlers for schema-driven menu items
  const actionHandlers: MenuActionHandlers = {
    toggleFocusMode: onToggleFocusMode,
    toggleSidebar: onToggleSidebar,
  }

  return null
}
