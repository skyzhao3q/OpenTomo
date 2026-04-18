import * as React from "react"
import { useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from "jotai"
import { motion, AnimatePresence } from "motion/react"
import {
  Settings,
  ChevronRight,
  ChevronDown,
  RotateCw,
  ListFilter,
  Tag,
  Check,
  X,
  Search,
  Plus,
  Trash2,
  Zap,
  Inbox,
  FolderOpen,
  Globe,
  Sparkles,
  Loader2,
} from "lucide-react"
import { PanelRightRounded } from "../icons/PanelRightRounded"
import { PanelLeftRounded } from "../icons/PanelLeftRounded"
// TodoStateIcons no longer used - icons come from dynamic todoStates
import { AppMenu } from "../AppMenu"
import { SquarePenRounded } from "../icons/SquarePenRounded"
import { cn } from "@/lib/utils"
import { isMac } from "@/lib/platform"
import { HeaderIconButton } from "@/components/ui/HeaderIconButton"
import { TopBarButton } from "@/components/ui/TopBarButton"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@opentomo/ui"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from "@/components/ui/styled-dropdown"
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from "@/components/ui/styled-context-menu"
import { ContextMenuProvider } from "@/components/ui/menu-context"
import { SidebarMenu } from "./SidebarMenu"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Collapsible,
  CollapsibleTrigger,
  AnimatedCollapsibleContent,
  springTransition as collapsibleSpring,
} from "@/components/ui/collapsible"
import { SessionList } from "./SessionList"
import { MainContentPanel } from "./MainContentPanel"
import type { ChatDisplayHandle } from "./ChatDisplay"
import { LeftSidebar } from "./LeftSidebar"
import { useSession } from "@/hooks/useSession"
import { ensureSessionMessagesLoadedAtom } from "@/atoms/sessions"
import { AppShellProvider, useSession as useSessionData, type AppShellContextType } from "@/context/AppShellContext"
import { EscapeInterruptProvider, useEscapeInterrupt } from "@/context/EscapeInterruptContext"
import { useTheme } from "@/context/ThemeContext"
import { getResizeGradientStyle } from "@/hooks/useResizeGradient"
import { useFocusZone, useGlobalShortcuts } from "@/hooks/keyboard"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import type { Session, Workspace, FileAttachment, PermissionRequest, LoadedSkill, PermissionMode } from "../../../shared/types"
import { sessionMetaMapAtom, type SessionMeta } from "@/atoms/sessions"
import { skillsAtom } from "@/atoms/skills"
import { useProjects } from "@/hooks/useProjects"
import { useViews } from "@/hooks/useViews"
import { resolveEntityColor } from "@opentomo/shared/colors"
import * as storage from "@/lib/local-storage"
import { toast } from "sonner"
import { navigate, routes } from "@/lib/navigate"
import {
  useNavigation,
  useNavigationState,
  isChatsNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  type NavigationState,
  type ChatFilter,
} from "@/contexts/NavigationContext"
import type { SettingsSubpage } from "../../../shared/types"
import { SkillsListPanel } from "./SkillsListPanel"
import { CreateSkillDialog } from "./CreateSkillDialog"
import { PanelHeader } from "./PanelHeader"
import { AIConnectionStatus } from "./AIConnectionStatus"
import { EditPopover, getEditConfig, buildEditPrompt, type EditContextKey } from "@/components/ui/EditPopover"
import SettingsNavigator from "@/pages/settings/SettingsNavigator"
import { RightSidebar } from "./RightSidebar"
import type { RichTextInputHandle } from "@/components/ui/rich-text-input"
import { hasOpenOverlay } from "@/lib/overlay-detection"
import { clearSourceIconCaches } from "@/lib/icon-cache"
import { ChatSearchDialog } from "./ChatSearchDialog"
import i18n, { LANGUAGE_OPTIONS, SUPPORTED_LOCALES } from "@/i18n"

/**
 * AppShellProps - Minimal props interface for AppShell component
 *
 * Data and callbacks come via contextValue (AppShellContextType).
 * Only UI-specific state is passed as separate props.
 *
 * Adding new features:
 * 1. Add to AppShellContextType in context/AppShellContext.tsx
 * 2. Update App.tsx to include in contextValue
 * 3. Use via useAppShellContext() hook in child components
 */
interface AppShellProps {
  /** All data and callbacks - passed directly to AppShellProvider */
  contextValue: AppShellContextType
  /** UI-specific props */
  defaultLayout?: number[]
  defaultCollapsed?: boolean
  menuNewChatTrigger?: number
  /** Focused mode - hides sidebars, shows only the chat content */
  isFocusedMode?: boolean
}

/** Filter mode for tri-state filtering: include shows only matching, exclude hides matching */
type FilterMode = 'include' | 'exclude'

/**
 * FilterModeBadge - Display-only badge showing the current filter mode.
 * Shows a checkmark for 'include' and an X for 'exclude'. Used as a visual
 * indicator inside DropdownMenuSubTrigger rows (the actual mode switching
 * happens via the sub-menu content, not this badge).
 */
function FilterModeBadge({ mode }: { mode: FilterMode }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center h-5 w-5 rounded-[4px] -mr-1",
        mode === 'include'
          ? "bg-background text-foreground shadow-minimal"
          : "bg-destructive/10 text-destructive shadow-tinted",
      )}
      style={mode === 'exclude' ? { '--shadow-color': 'var(--destructive-rgb)' } as React.CSSProperties : undefined}
    >
      {mode === 'include' ? <Check className="!h-2.5 !w-2.5" /> : <X className="!h-2.5 !w-2.5" />}
    </span>
  )
}

/**
 * FilterModeSubMenuItems - Shared sub-menu content for switching filter mode.
 * Renders Include / Exclude / Remove options using StyledDropdownMenuItem for
 * consistent styling. Used inside StyledDropdownMenuSubContent by both leaf
 * and group label items when they have an active filter mode.
 */
function FilterModeSubMenuItems({
  mode,
  onChangeMode,
  onRemove,
}: {
  mode: FilterMode
  onChangeMode: (mode: FilterMode) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onChangeMode('include') }}
        className={cn(mode === 'include' && "bg-foreground/[0.03]")}
      >
        <Check className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t('filter.include')}</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onChangeMode('exclude') }}
        className={cn(mode === 'exclude' && "bg-foreground/[0.03]")}
      >
        <X className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t('filter.exclude')}</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuSeparator />
      <StyledDropdownMenuItem
        onClick={(e) => { e.preventDefault(); onRemove() }}
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t('filter.clearFilter')}</span>
      </StyledDropdownMenuItem>
    </>
  )
}

/**
 * FilterMenuRow - Consistent layout for filter menu items.
 * Enforces: [icon 14px box] [label flex] [accessory 12px box]
 */
function FilterMenuRow({
  icon,
  label,
  accessory,
  iconClassName,
  iconStyle,
  noIconContainer,
}: {
  icon: React.ReactNode
  label: React.ReactNode
  accessory?: React.ReactNode
  /** Additional classes for icon container (e.g., for status icon scaling) */
  iconClassName?: string
  /** Style for icon container (e.g., for status icon color) */
  iconStyle?: React.CSSProperties
  /** When true, skip the icon container (for icons that have their own container) */
  noIconContainer?: boolean
}) {
  return (
    <>
      {noIconContainer ? (
        // Wrapper for color inheritance. Clone icon to add bare prop (removes EntityIcon container).
        <span style={iconStyle}>
          {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ bare?: boolean }>, { bare: true }) : icon}
        </span>
      ) : (
        <span
          className={cn("h-3.5 w-3.5 flex items-center justify-center shrink-0", iconClassName)}
          style={iconStyle}
        >
          {icon}
        </span>
      )}
      <span className="flex-1">{label}</span>
      <span className="shrink-0">{accessory}</span>
    </>
  )
}

const TITLEBAR_HEIGHT = 50 // Height of the fixed top bar (drag region + buttons)
const PANEL_WINDOW_EDGE_SPACING = 6 // Padding between panels and window edge
const PANEL_PANEL_SPACING = 5 // Gap between adjacent panels
const MIN_CENTER_WIDTH = 200 // Minimum pixels reserved for the center content panel

/**
 * AppShell - Main 3-panel layout container
 *
 * Layout: [LeftSidebar 20%] | [NavigatorPanel 32%] | [MainContentPanel 48%]
 *
 * Chat Filters:
 * - 'allChats': Shows all sessions
 */
export function AppShell(props: AppShellProps) {
  // Wrap with EscapeInterruptProvider so AppShellContent can use useEscapeInterrupt
  return (
    <EscapeInterruptProvider>
      <AppShellContent {...props} />
    </EscapeInterruptProvider>
  )
}

/**
 * AppShellContent - Inner component that contains all the AppShell logic
 * Separated to allow useEscapeInterrupt hook to work (must be inside provider)
 */
function AppShellContent({
  contextValue,
  defaultLayout = [20, 32, 48],
  defaultCollapsed = false,
  menuNewChatTrigger,
  isFocusedMode = false,
}: AppShellProps) {
  // Destructure commonly used values from context
  // Note: sessions is NOT destructured here - we use sessionMetaMapAtom instead
  // to prevent closures from retaining the full messages array
  const {
    workspaces,
    activeWorkspaceId,
    currentModel,
    sessionOptions,
    onSelectWorkspace,
    onRefreshWorkspaces,
    onCreateSession,
    onDeleteSession,
    onMarkSessionRead,
    onMarkSessionUnread,
    onRenameSession,
    onOpenSettings,
    onOpenKeyboardShortcuts,
    onReset,
    onSendMessage,
    openNewChat,
  } = contextValue

  const { t } = useTranslation()

  const [searchDialogOpen, setSearchDialogOpen] = useState(false)

  const [isSidebarVisible, setIsSidebarVisible] = React.useState(() => {
    return storage.get(storage.KEYS.sidebarVisible, !defaultCollapsed)
  })
  // Icon-only sidebar: fixed compact width, not resizable
  // 72px ensures the macOS green traffic light button (~x=60) is fully within this column
  const ICON_SIDEBAR_WIDTH = 72
  const sidebarWidth = ICON_SIDEBAR_WIDTH
  // Session list width in pixels (min 240, max dynamic)
  const [sessionListWidth, setSessionListWidth] = React.useState(() => {
    return storage.get(storage.KEYS.sessionListWidth, 300)
  })

  // Right sidebar state (min 280, max dynamic)
  const [isRightSidebarVisible, setIsRightSidebarVisible] = React.useState(() => {
    return storage.get(storage.KEYS.rightSidebarVisible, false)
  })
  const [rightSidebarWidth, setRightSidebarWidth] = React.useState(() => {
    return storage.get(storage.KEYS.rightSidebarWidth, 480)
  })
  const [skipRightSidebarAnimation, setSkipRightSidebarAnimation] = React.useState(false)

  // Focus mode state - hides both sidebars for distraction-free chat
  // Can be enabled via prop (URL param for new windows) or toggled via Cmd+.
  const [isFocusModeActive, setIsFocusModeActive] = React.useState(false)
  // Effective focus mode combines prop-based (immutable) and state-based (toggleable)
  const effectiveFocusMode = isFocusedMode || isFocusModeActive

  // Window width tracking for responsive behavior
  const [windowWidth, setWindowWidth] = React.useState(window.innerWidth)

  // Calculate overlay threshold dynamically based on actual sidebar widths
  // Formula: 600px (300px right sidebar + 300px center) + leftSidebar + sessionList
  // This ensures we switch to overlay mode when inline right sidebar would compress content
  const MIN_INLINE_SPACE = 600 // 300px for right sidebar + 300px for center content
  const leftSidebarEffectiveWidth = isSidebarVisible ? sidebarWidth : 0
  const OVERLAY_THRESHOLD = MIN_INLINE_SPACE + leftSidebarEffectiveWidth + sessionListWidth
  const shouldUseOverlay = windowWidth < OVERLAY_THRESHOLD

  const [isResizing, setIsResizing] = React.useState<'session-list' | 'right-sidebar' | null>(null)
  const [sessionListHandleY, setSessionListHandleY] = React.useState<number | null>(null)
  const [rightSidebarHandleY, setRightSidebarHandleY] = React.useState<number | null>(null)
  const sessionListHandleRef = React.useRef<HTMLDivElement>(null)
  const rightSidebarHandleRef = React.useRef<HTMLDivElement>(null)

  // AI connection status state
  const [aiConnectionId, setAiConnectionId] = React.useState<string | null>(null)
  const [aiConnections, setAiConnections] = React.useState<Array<{ id: string; name: string; type: string; endpoint: string; models: { best?: string; balanced?: string; fast?: string }; createdAt: number }>>([])
  const [aiAuthType, setAiAuthType] = React.useState<string>('api_key')
  const [aiConnectionLoading, setAiConnectionLoading] = React.useState(true)
  const [aiConnectionError, setAiConnectionError] = React.useState(false)
  const [session, setSession] = useSession()
  const { resolvedMode, isDark, setMode } = useTheme()
  const { canGoBack, canGoForward, goBack, goForward } = useNavigation()

  // Double-Esc interrupt feature: first Esc shows warning, second Esc interrupts
  const { handleEscapePress } = useEscapeInterrupt()

  // UNIFIED NAVIGATION STATE - single source of truth from NavigationContext
  // All sidebar/navigator/main panel state is derived from this
  const navState = useNavigationState()

  // Derive chat filter from navigation state (only when in chats navigator)
  const chatFilter = isChatsNavigation(navState) ? navState.filter : null

  // Per-view filter storage: each session list view (allChats, state:X, label:X, view:X)
  // has its own independent set of status and label filters.
  // Each filter entry stores a mode ('include' or 'exclude') for tri-state filtering.
  type FilterEntry = Record<string, FilterMode> // id → mode
  type ViewFiltersMap = Record<string, { labels: FilterEntry }>

  // Compute a stable key for the current chat filter view
  const chatFilterKey = useMemo(() => {
    if (!chatFilter) return null
    switch (chatFilter.kind) {
      case 'allChats': return 'allChats'
      case 'view': return `view:${chatFilter.viewId}`
      default: return 'allChats'
    }
  }, [chatFilter])

  const [viewFiltersMap, setViewFiltersMap] = React.useState<ViewFiltersMap>(() => {
    const saved = storage.get<ViewFiltersMap>(storage.KEYS.viewFilters, {})
    // Backward compat: migrate old format (arrays) into new format (Record<string, FilterMode>)
    if (saved.allChats && Array.isArray((saved.allChats as any).labels)) {
      // Old format: { labels: string[] } → new: { labels: Record }
      for (const key of Object.keys(saved)) {
        const entry = saved[key] as any
        if (Array.isArray(entry.labels)) {
          const newLabels: FilterEntry = {}
          for (const id of entry.labels) newLabels[id] = 'include'
          saved[key] = { labels: newLabels }
        }
      }
    }
    // Also migrate legacy global filters if no allChats entry exists
    if (!saved.allChats) {
      const oldLabels = storage.get<string[]>(storage.KEYS.labelFilter, [])
      if (oldLabels.length > 0) {
        const labels: FilterEntry = {}
        for (const id of oldLabels) labels[id] = 'include'
        saved.allChats = { labels }
      }
    }
    return saved
  })

  // Derive current view's label filter as a Map<string, FilterMode>
  const labelFilter = useMemo(() => {
    if (!chatFilterKey) return new Map<string, FilterMode>()
    const entry = viewFiltersMap[chatFilterKey]?.labels ?? {}
    return new Map<string, FilterMode>(Object.entries(entry) as [string, FilterMode][])
  }, [viewFiltersMap, chatFilterKey])

  // Setter for label filter — updates only the current view's entry in the map
  const setLabelFilter = useCallback((updater: Map<string, FilterMode> | ((prev: Map<string, FilterMode>) => Map<string, FilterMode>)) => {
    setViewFiltersMap(prev => {
      if (!chatFilterKey) return prev
      const current = new Map<string, FilterMode>(Object.entries(prev[chatFilterKey]?.labels ?? {}) as [string, FilterMode][])
      const next = typeof updater === 'function' ? updater(current) : updater
      return {
        ...prev,
        [chatFilterKey]: { labels: Object.fromEntries(next) }
      }
    })
  }, [chatFilterKey])
  // Search state for session list
  const [searchActive, setSearchActive] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')

  // Ref for ChatDisplay navigation (exposed via forwardRef)
  const chatDisplayRef = React.useRef<ChatDisplayHandle>(null)
  // Track match count and index from ChatDisplay (for SessionList navigation UI)
  const [chatMatchInfo, setChatMatchInfo] = React.useState<{ count: number; index: number }>({ count: 0, index: 0 })

  // Callback for immediate match info updates from ChatDisplay
  const handleChatMatchInfoChange = React.useCallback((info: { count: number; index: number }) => {
    setChatMatchInfo(info)
  }, [])

  // Reset match info when search is deactivated
  React.useEffect(() => {
    if (!searchActive || !searchQuery) {
      setChatMatchInfo({ count: 0, index: 0 })
    }
  }, [searchActive, searchQuery])

  // Filter dropdown: inline search query for filtering labels in a flat list.
  // When empty, the dropdown shows hierarchical submenus. When typing, shows a flat filtered list.
  const [filterDropdownQuery, setFilterDropdownQuery] = React.useState('')

  // Reset search only when navigator or filter changes (not when selecting sessions)
  const navFilterKey = React.useMemo(() => {
    if (isChatsNavigation(navState)) {
      const filter = navState.filter
      return `chats:${filter.kind}`
    }
    return navState.navigator
  }, [navState])

  React.useEffect(() => {
    setSearchActive(false)
    setSearchQuery('')
  }, [navFilterKey])

  // Auto-hide right sidebar when navigating away from chat sessions
  React.useEffect(() => {
    // Hide sidebar if not in chat view or no session selected
    if (!isChatsNavigation(navState) || !navState.details) {
      setSkipRightSidebarAnimation(true)
      setIsRightSidebarVisible(false)
      // Reset skip flag after state update
      setTimeout(() => setSkipRightSidebarAnimation(false), 0)
    }
  }, [navState])

  // Cmd+F to activate search
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setSearchActive(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Cmd+K to open global chat search dialog
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchDialogOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Track window width for responsive right sidebar behavior
  React.useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Unified sidebar keyboard navigation state
  // Load expanded folders from localStorage (default: all collapsed)
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(() => {
    const saved = storage.get<string[]>(storage.KEYS.expandedFolders, [])
    return new Set(saved)
  })
  const [focusedSidebarItemId, setFocusedSidebarItemId] = React.useState<string | null>(null)
  const sidebarItemRefs = React.useRef<Map<string, HTMLElement>>(new Map())
  // Track which expandable sidebar items are collapsed
  // Labels are collapsed by default; user preference is persisted once toggled
  const [collapsedItems, setCollapsedItems] = React.useState<Set<string>>(() => {
    const saved = storage.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null)
    if (saved !== null) return new Set(saved)
    return new Set(['nav:labels'])
  })
  const isExpanded = React.useCallback((id: string) => !collapsedItems.has(id), [collapsedItems])
  const toggleExpanded = React.useCallback((id: string) => {
    setCollapsedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  // Setter for session meta map (for optimistic updates in callbacks)
  const setSessionMetaMap = useSetAtom(sessionMetaMapAtom)

  // Skills state (workspace-scoped)
  const [skills, setSkills] = React.useState<LoadedSkill[]>([])
  const [disabledSkillSlugs, setDisabledSkillSlugs] = React.useState<Set<string>>(new Set())
  // Sync skills to atom for NavigationContext auto-selection
  const setSkillsAtom = useSetAtom(skillsAtom)
  React.useEffect(() => {
    setSkillsAtom(skills)
  }, [skills, setSkillsAtom])

  // Enabled permission modes for Shift+Tab cycling (min 2 modes)
  const [enabledModes, setEnabledModes] = React.useState<PermissionMode[]>(['safe', 'ask', 'allow-all'])

  // Load workspace settings (for cyclablePermissionModes) on workspace change
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getWorkspaceSettings(activeWorkspaceId).then((settings) => {
      if (settings) {
        // Load cyclablePermissionModes from workspace settings
        if (settings.cyclablePermissionModes && settings.cyclablePermissionModes.length >= 2) {
          setEnabledModes(settings.cyclablePermissionModes)
        }
      }
    }).catch((err) => {
      console.error('[Chat] Failed to load workspace settings:', err)
    })
  }, [activeWorkspaceId])

  // Reset UI state when workspace changes
  // This prevents stale search queries, focused items, and filter state from persisting
  const previousWorkspaceRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!activeWorkspaceId) return

    const previousWorkspaceId = previousWorkspaceRef.current

    // Skip on initial mount
    if (previousWorkspaceId !== null && previousWorkspaceId !== activeWorkspaceId) {
      // Clear search state
      setSearchActive(false)
      setSearchQuery('')

      // Clear filter dropdown state
      setFilterDropdownQuery('')
      setFilterDropdownSelectedIdx(0)

      // Clear focused sidebar item
      setFocusedSidebarItemId(null)

      // Load workspace-scoped filter state from new workspace
      // (viewFiltersMap, expandedFolders, collapsedItems)
      const newViewFilters = storage.get<ViewFiltersMap>(storage.KEYS.viewFilters, {}, activeWorkspaceId)
      setViewFiltersMap(newViewFilters)

      const newExpandedFolders = storage.get<string[]>(storage.KEYS.expandedFolders, [], activeWorkspaceId)
      setExpandedFolders(new Set(newExpandedFolders))

      const newCollapsedItems = storage.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null, activeWorkspaceId)
      setCollapsedItems(newCollapsedItems !== null ? new Set(newCollapsedItems) : new Set([]))
    }

    previousWorkspaceRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  // Subscribe to live skill updates (when skills are added/removed dynamically)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onSkillsChanged?.((updatedSkills) => {
      setSkills(updatedSkills || [])
    })
    return cleanup
  }, [activeWorkspaceId])

  // Subscribe to disabled skills changes (when user enables/disables a skill in Settings)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onDisabledSkillsChanged?.((slugs) => {
      setDisabledSkillSlugs(new Set(slugs))
    })
    return cleanup
  }, [activeWorkspaceId])

  // Handle session label changes (add/remove via # menu or badge X)

  const handleSessionProjectChange = React.useCallback(async (sessionId: string, projectId: string | null) => {
    // Optimistic update: immediately reflect in session list
    setSessionMetaMap(prev => {
      const existing = prev.get(sessionId)
      if (!existing) return prev
      const next = new Map(prev)
      next.set(sessionId, { ...existing, projectId })
      return next
    })

    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setProject', projectId })
    } catch (err) {
      console.error('[Chat] Failed to set session project:', err)
    }
  }, [setSessionMetaMap])

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  // Load projects for folder-style session grouping
  const { projects: projectConfigs } = useProjects(activeWorkspace?.id || null)

  // Views: compiled once on config load, evaluated per session in list/chat
  const { evaluateSession: evaluateViews, viewConfigs } = useViews(activeWorkspace?.id || null)

  // Filter dropdown keyboard navigation: tracks highlighted item index in flat search mode.
  const [filterDropdownSelectedIdx, setFilterDropdownSelectedIdx] = React.useState(0)
  const filterDropdownListRef = React.useRef<HTMLDivElement>(null)
  const filterDropdownInputRef = React.useRef<HTMLInputElement>(null)

  // Compute filtered results for the dropdown's search mode (memoized for use in both
  // the keyboard handler and the JSX render).
  const filterDropdownResults = useMemo(() => {
    // No label filtering anymore, return empty
    return { labels: [] as any[] }
  }, [filterDropdownQuery])

  // Reset selected index when query changes
  React.useEffect(() => {
    setFilterDropdownSelectedIdx(0)
  }, [filterDropdownQuery])

  // Scroll keyboard-highlighted item into view
  React.useEffect(() => {
    if (!filterDropdownListRef.current) return
    const el = filterDropdownListRef.current.querySelector('[data-filter-selected="true"]')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [filterDropdownSelectedIdx])

  // Ensure session messages are loaded when selected
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)

  // Handle selecting a skill from the list
  const handleSkillSelect = React.useCallback((skill: LoadedSkill) => {
    if (!activeWorkspaceId) return
    navigate(routes.view.skills(skill.slug))
  }, [activeWorkspaceId, navigate])

  // Focus zone management
  const { focusZone, focusNextZone, focusPreviousZone } = useFocusContext()

  // Register focus zones
  const { zoneRef: sidebarRef, isFocused: sidebarFocused } = useFocusZone({ zoneId: 'sidebar' })

  // Ref for focusing chat input (passed to ChatDisplay)
  const chatInputRef = useRef<RichTextInputHandle>(null)
  const focusChatInput = useCallback(() => {
    chatInputRef.current?.focus()
  }, [])

  // Global keyboard shortcuts
  useGlobalShortcuts({
    shortcuts: [
      // Zone navigation
      { key: '1', cmd: true, action: () => focusZone('sidebar') },
      { key: '2', cmd: true, action: () => focusZone('session-list') },
      { key: '3', cmd: true, action: () => focusZone('chat') },
      // Tab navigation between zones
      { key: 'Tab', action: focusNextZone, when: () => !document.querySelector('[role="dialog"]') },
      // Shift+Tab cycles permission mode through enabled modes (textarea handles its own, this handles when focus is elsewhere)
      { key: 'Tab', shift: true, action: () => {
        if (session.selected) {
          const currentOptions = contextValue.sessionOptions.get(session.selected)
          const currentMode = currentOptions?.permissionMode ?? 'ask'
          // Cycle through enabled permission modes
          const modes = enabledModes.length >= 2 ? enabledModes : ['safe', 'ask', 'allow-all'] as PermissionMode[]
          const currentIndex = modes.indexOf(currentMode)
          // If current mode not in enabled list, jump to first enabled mode
          const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length
          const nextMode = modes[nextIndex]
          contextValue.onSessionOptionsChange(session.selected, { permissionMode: nextMode })
        }
      }, when: () => !document.querySelector('[role="dialog"]') && document.activeElement?.tagName !== 'TEXTAREA' },
      // Sidebar toggle (CMD+B)
      { key: 'b', cmd: true, action: () => setIsSidebarVisible(v => !v) },
      // Focus mode toggle (CMD+.) - hides both sidebars
      { key: '.', cmd: true, action: () => setIsFocusModeActive(v => !v) },
      // New chat
      { key: 'n', cmd: true, action: () => handleNewChat(true) },
      // Settings
      { key: ',', cmd: true, action: onOpenSettings },
      // History navigation
      { key: '[', cmd: true, action: goBack },
      { key: ']', cmd: true, action: goForward },
      // Search match navigation (CMD+G next, CMD+SHIFT+G prev)
      { key: 'g', cmd: true, action: () => chatDisplayRef.current?.goToNextMatch(), when: () => searchActive && (chatMatchInfo.count ?? 0) > 0 },
      { key: 'g', cmd: true, shift: true, action: () => chatDisplayRef.current?.goToPrevMatch(), when: () => searchActive && (chatMatchInfo.count ?? 0) > 0 },
      // ESC to stop processing - requires double-press within 1 second
      // First press shows warning overlay, second press interrupts
      { key: 'Escape', action: () => {
        if (session.selected) {
          const meta = sessionMetaMap.get(session.selected)
          if (meta?.isProcessing) {
            // handleEscapePress returns true on second press (within timeout)
            const shouldInterrupt = handleEscapePress()
            if (shouldInterrupt) {
              window.electronAPI.cancelProcessing(session.selected, false).catch(err => {
                console.error('[AppShell] Failed to cancel processing:', err)
              })
            }
          }
        }
      }, when: () => {
        // Only active when no overlay is open and session is processing
        // Overlays (dialogs, menus, popovers, etc.) should handle their own Escape
        if (hasOpenOverlay()) return false
        if (!session.selected) return false
        const meta = sessionMetaMap.get(session.selected)
        return meta?.isProcessing ?? false
      }},
      // Theme toggle (CMD+SHIFT+A)
      { key: 'a', cmd: true, shift: true, action: () => setMode(resolvedMode === 'dark' ? 'light' : 'dark') },
    ],
  })

  // Global paste listener for file attachments
  // Fires when Cmd+V is pressed anywhere in the app (not just textarea)
  React.useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      // Skip if a dialog or menu is open
      if (document.querySelector('[role="dialog"], [role="menu"]')) {
        return
      }

      // Skip if there are no files in the clipboard
      const files = e.clipboardData?.files
      if (!files || files.length === 0) return

      // Skip if the active element is an input/textarea/contenteditable (let it handle paste directly)
      const activeElement = document.activeElement as HTMLElement | null
      if (
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.tagName === 'INPUT' ||
        activeElement?.isContentEditable
      ) {
        return
      }

      // Prevent default paste behavior
      e.preventDefault()

      // Dispatch custom event for FreeFormInput to handle
      const filesArray = Array.from(files)
      window.dispatchEvent(new CustomEvent('ss:paste-files', {
        detail: { files: filesArray }
      }))
    }

    document.addEventListener('paste', handleGlobalPaste)
    return () => document.removeEventListener('paste', handleGlobalPaste)
  }, [])

  // Fetch AI connection status on mount
  React.useEffect(() => {
    let cancelled = false
    const fetchConnection = async () => {
      try {
        const [connections, activeId, apiSetup] = await Promise.all([
          window.electronAPI.listConnections(),
          window.electronAPI.getActiveConnectionId(),
          window.electronAPI.getApiSetup(),
        ])
        if (!cancelled) {
          setAiConnections(connections ?? [])
          setAiConnectionId(activeId ?? null)
          setAiAuthType(apiSetup?.authType ?? 'api_key')
          setAiConnectionLoading(false)
          setAiConnectionError(false)
        }
      } catch {
        if (!cancelled) {
          setAiConnectionLoading(false)
          setAiConnectionError(true)
        }
      }
    }
    fetchConnection()
    return () => { cancelled = true }
  }, [])

  // Resize effect for session list and right sidebar
  React.useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing === 'session-list') {
        const offset = isSidebarVisible ? sidebarWidth : 0
        const rightActualWidth = isRightSidebarVisible ? rightSidebarWidth : 0
        const maxWidth = Math.max(
          window.innerWidth - (isSidebarVisible ? sidebarWidth : 0) - rightActualWidth - MIN_CENTER_WIDTH,
          240
        )
        const newWidth = Math.min(Math.max(e.clientX - offset, 240), maxWidth)
        setSessionListWidth(newWidth)
        if (sessionListHandleRef.current) {
          const rect = sessionListHandleRef.current.getBoundingClientRect()
          setSessionListHandleY(e.clientY - rect.top)
        }
      } else if (isResizing === 'right-sidebar') {
        // Calculate from right edge
        const sessionListActualWidth = effectiveFocusMode ? 0 : sessionListWidth
        const maxWidth = Math.max(
          window.innerWidth - (isSidebarVisible ? sidebarWidth : 0) - sessionListActualWidth - MIN_CENTER_WIDTH,
          280
        )
        const newWidth = Math.min(Math.max(window.innerWidth - e.clientX, 280), maxWidth)
        setRightSidebarWidth(newWidth)
        if (rightSidebarHandleRef.current) {
          const rect = rightSidebarHandleRef.current.getBoundingClientRect()
          setRightSidebarHandleY(e.clientY - rect.top)
        }
      }
    }

    const handleMouseUp = () => {
      if (isResizing === 'session-list') {
        storage.set(storage.KEYS.sessionListWidth, sessionListWidth)
        setSessionListHandleY(null)
      } else if (isResizing === 'right-sidebar') {
        storage.set(storage.KEYS.rightSidebarWidth, rightSidebarWidth)
        setRightSidebarHandleY(null)
      }
      setIsResizing(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, sidebarWidth, sessionListWidth, rightSidebarWidth, isSidebarVisible, isRightSidebarVisible, effectiveFocusMode])

  // Spring transition config - shared between sidebar and header
  // Critical damping (no bounce): damping = 2 * sqrt(stiffness * mass)
  const springTransition = {
    type: "spring" as const,
    stiffness: 600,
    damping: 49,
  }

  // Use session metadata from Jotai atom (lightweight, no messages)
  // This prevents closures from retaining full message arrays
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)

  // Reload skills when active session's workingDirectory changes (for project-level skills)
  // Skills are loaded from: global (~/.agents/skills/), workspace, and project ({workingDirectory}/.agents/skills/)
  const activeSessionWorkingDirectory = session.selected
    ? sessionMetaMap.get(session.selected)?.workingDirectory
    : undefined
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    window.electronAPI.getSkills(activeWorkspaceId, activeSessionWorkingDirectory).then((loaded) => {
      setSkills(loaded || [])
    }).catch(err => {
      console.error('[Chat] Failed to load skills:', err)
    })
    window.electronAPI.getSkillsCatalog(activeWorkspaceId).then(({ disabledSlugs }) => {
      setDisabledSkillSlugs(new Set(disabledSlugs))
    }).catch(() => {})
  }, [activeWorkspaceId, activeSessionWorkingDirectory])

  // Filter session metadata by active workspace
  // Also exclude hidden sessions (mini-agent sessions) from all counts and lists
  const workspaceSessionMetas = useMemo(() => {
    const metas = Array.from(sessionMetaMap.values())
    return activeWorkspaceId
      ? metas.filter(s => s.workspaceId === activeWorkspaceId && !s.hidden)
      : metas.filter(s => !s.hidden)
  }, [sessionMetaMap, activeWorkspaceId])

  // Label counts removed - labels feature deleted

  // Filter session metadata based on sidebar mode and chat filter
  const filteredSessionMetas = useMemo(() => {
    if (!chatFilter) {
      return []
    }

    let result: SessionMeta[]

    switch (chatFilter.kind) {
      case 'allChats':
        // "All Chats" - shows all sessions
        result = workspaceSessionMetas
        break
      case 'view': {
        // Filter by view: __all__ shows any session matched by any view,
        // otherwise filter to the specific view
        result = workspaceSessionMetas.filter(s => {
          const matched = evaluateViews(s)
          if (chatFilter.viewId === '__all__') {
            return matched.length > 0
          }
          return matched.some(v => v.id === chatFilter.viewId)
        })
        break
      }
      default:
        result = workspaceSessionMetas
    }

    // Label filtering removed - labels feature deleted

    return result
  }, [workspaceSessionMetas, chatFilter, labelFilter])

  // Ensure session messages are loaded when selected
  React.useEffect(() => {
    if (session.selected) {
      ensureMessagesLoaded(session.selected)
    }
  }, [session.selected, ensureMessagesLoaded])

  // Wrap delete handler to clear selection when deleting the currently selected session
  // This prevents stale state during re-renders that could cause crashes
  const handleDeleteSession = useCallback(async (sessionId: string, skipConfirmation?: boolean): Promise<boolean> => {
    // Clear selection first if this is the selected session
    if (session.selected === sessionId) {
      setSession({ selected: null })
    }
    return onDeleteSession(sessionId, skipConfirmation)
  }, [session.selected, setSession, onDeleteSession])

  // Right sidebar OPEN button (fades out when sidebar is open, hidden in non-chat views)
  const rightSidebarOpenButton = React.useMemo(() => {
    if (!isChatsNavigation(navState) || !navState.details) return null

    return (
      <motion.div
        initial={false}
        animate={{ opacity: isRightSidebarVisible ? 0 : 1 }}
        transition={{ duration: 0.15 }}
        style={{ pointerEvents: isRightSidebarVisible ? 'none' : 'auto' }}
      >
        <HeaderIconButton
          icon={<PanelRightRounded className="h-5 w-6" />}
          onClick={() => setIsRightSidebarVisible(true)}
          tooltip={t('tooltip.openSidebar')}
          className="text-foreground"
        />
      </motion.div>
    )
  }, [navState, isRightSidebarVisible, t])

  // Right sidebar CLOSE button (shown in sidebar header when open)
  const rightSidebarCloseButton = React.useMemo(() => {
    if (!isRightSidebarVisible) return null

    return (
      <HeaderIconButton
        icon={<PanelLeftRounded className="h-5 w-6" />}
        onClick={() => setIsRightSidebarVisible(false)}
        tooltip={t('tooltip.closeSidebar')}
        className="text-foreground"
      />
    )
  }, [isRightSidebarVisible, t])

  // Extend context value with local overrides (textareaRef, wrapped onDeleteSession, skills, labels, enabledModes, rightSidebarOpenButton)
  const appShellContextValue = React.useMemo<AppShellContextType>(() => ({
    ...contextValue,
    onDeleteSession: handleDeleteSession,
    textareaRef: chatInputRef,
    skills: skills.filter(s => !disabledSkillSlugs.has(s.slug)),
    enabledModes,
    rightSidebarButton: rightSidebarOpenButton,
    // Search state for ChatDisplay highlighting
    sessionListSearchQuery: searchActive ? searchQuery : undefined,
    isSearchModeActive: searchActive,
    chatDisplayRef,
    onChatMatchInfoChange: handleChatMatchInfoChange,
  }), [contextValue, handleDeleteSession, skills, disabledSkillSlugs, enabledModes, rightSidebarOpenButton, searchActive, searchQuery, handleChatMatchInfoChange])

  // Persist expanded folders to localStorage (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.expandedFolders, [...expandedFolders], activeWorkspaceId)
  }, [expandedFolders, activeWorkspaceId])

  // Persist sidebar visibility to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.sidebarVisible, isSidebarVisible)
  }, [isSidebarVisible])

  // Persist right sidebar visibility to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.rightSidebarVisible, isRightSidebarVisible)
  }, [isRightSidebarVisible])

  // Persist focus mode state to localStorage
  React.useEffect(() => {
    storage.set(storage.KEYS.focusModeEnabled, isFocusModeActive)
  }, [isFocusModeActive])

  // Listen for focus mode toggle from menu (View → Focus Mode)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleFocusMode?.(() => {
      setIsFocusModeActive(v => !v)
    })
    return cleanup
  }, [])

  // Listen for sidebar toggle from menu (View → Toggle Sidebar)
  React.useEffect(() => {
    const cleanup = window.electronAPI.onMenuToggleSidebar?.(() => {
      setIsSidebarVisible(v => !v)
    })
    return cleanup
  }, [])

  // Persist per-view filter map to localStorage (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.viewFilters, viewFiltersMap, activeWorkspaceId)
  }, [viewFiltersMap, activeWorkspaceId])

  // Persist sidebar section collapsed states (workspace-scoped)
  React.useEffect(() => {
    if (!activeWorkspaceId) return
    storage.set(storage.KEYS.collapsedSidebarItems, [...collapsedItems], activeWorkspaceId)
  }, [collapsedItems, activeWorkspaceId])

  const handleAllChatsClick = useCallback(() => {
    setIsFocusModeActive(false)
    navigate(routes.view.allChats())
  }, [])

  // Smart Clean loading state (must be declared before handleSmartClean uses it)
  const [isSmartCleaning, setIsSmartCleaning] = useState(false)

  const handleSmartClean = useCallback(async () => {
    if (!activeWorkspaceId || isSmartCleaning) return
    setIsSmartCleaning(true)
    const toastId = toast.loading(t('smartClean.running'))
    try {
      const result = await window.electronAPI.smartCategorize(activeWorkspaceId)
      if (result.categorized === 0) {
        toast.info(t('smartClean.noUncategorized'), { id: toastId })
      } else {
        toast.success(t('smartClean.done', { count: result.categorized, projects: result.newProjectsCreated }), { id: toastId })
      }
    } catch (err) {
      console.error('[SmartClean] Failed:', err)
      toast.error(t('smartClean.failed'), { id: toastId })
    } finally {
      setIsSmartCleaning(false)
    }
  }, [activeWorkspaceId, isSmartCleaning, t])

  // Label handler removed - labels feature deleted

  const handleViewClick = useCallback((viewId: string) => {
    navigate(routes.view.view(viewId))
  }, [])

  // Handler for skills view
  const handleSkillsClick = useCallback(() => {
    setIsFocusModeActive(false)
    navigate(routes.view.skills())
  }, [])

  // Handler for settings view
  const handleSettingsClick = useCallback((subpage: SettingsSubpage = 'app') => {
    navigate(routes.view.settings(subpage))
  }, [])

  // Handler for language change from dropdown menu
  const handleLanguageChange = useCallback(async (langCode: string) => {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(langCode)) {
      i18n.changeLanguage(langCode)
    }
    try {
      const result = await window.electronAPI.readUserMd()
      const content = result.content || ''
      if (content.includes('language:')) {
        const updated = content.replace(/^(language:)\s*.*$/m, `$1 ${langCode}`)
        await window.electronAPI.writeUserMd(updated)
      } else if (content.startsWith('---')) {
        const updated = content.replace(/\n---/, `\nlanguage: ${langCode}\n---`)
        await window.electronAPI.writeUserMd(updated)
      } else {
        const updated = `---\nlanguage: ${langCode}\n---\n${content}`
        await window.electronAPI.writeUserMd(updated)
      }
    } catch (err) {
      console.error('Failed to persist language change:', err)
    }
  }, [])

  // ============================================================================
  // EDIT POPOVER STATE
  // ============================================================================
  // State to control which EditPopover is open (triggered from context menus).
  // We use controlled popovers instead of deep links so the user can type
  // their request in the popover UI before opening a new chat window.
  const [editPopoverOpen, setEditPopoverOpen] = useState<'labels' | 'views' | 'add-label' | null>(null)

  // State to control the CreateSkillDialog
  const [createSkillDialogOpen, setCreateSkillDialogOpen] = useState(false)

  // Stores the Y position of the last right-clicked sidebar item so the EditPopover
  // appears near it rather than at a fixed location. Updated synchronously before
  // the setTimeout that opens the popover, ensuring the ref is set before render.
  const editPopoverAnchorY = useRef<number>(120)

  // Stores the trigger element (button) so we can keep it highlighted while the
  // EditPopover is open (after Radix removes data-state="open" on context menu close).
  const editPopoverTriggerRef = useRef<Element | null>(null)

  // Captures the bounding rect of the currently-open context menu trigger (the button).
  // Radix sets data-state="open" on the button (via ContextMenuTrigger asChild)
  // while the menu is visible, so we can locate it in the DOM at click time.
  const captureContextMenuPosition = useCallback(() => {
    const trigger = document.querySelector('.group\\/section > [data-state="open"]')
    if (trigger) {
      const rect = trigger.getBoundingClientRect()
      editPopoverAnchorY.current = rect.top
      editPopoverTriggerRef.current = trigger
    }
  }, [])

  // Sync data-edit-active attribute on the trigger element with EditPopover open state.
  // This keeps the sidebar item visually highlighted while the popover is shown,
  // since Radix's data-state="open" disappears when the context menu closes.
  useEffect(() => {
    const el = editPopoverTriggerRef.current
    if (!el) return
    if (editPopoverOpen) {
      el.setAttribute('data-edit-active', 'true')
    } else {
      el.removeAttribute('data-edit-active')
      editPopoverTriggerRef.current = null
    }
  }, [editPopoverOpen])

  // Handler for "Configure Labels" context menu action
  // Label configuration handler removed - labels feature deleted

  // Handler for "Edit Views" context menu action
  // Opens the EditPopover for view configuration
  const openConfigureViews = useCallback(() => {
    captureContextMenuPosition()
    setTimeout(() => setEditPopoverOpen('views'), 50)
  }, [captureContextMenuPosition])

  // Handler for "Delete View" context menu action
  // Removes the view from config by filtering it out and saving
  const handleDeleteView = useCallback(async (viewId: string) => {
    if (!activeWorkspace?.id) return
    try {
      const updated = viewConfigs.filter(v => v.id !== viewId)
      await window.electronAPI.saveViews(activeWorkspace.id, updated)
    } catch (err) {
      console.error('[AppShell] Failed to delete view:', err)
    }
  }, [activeWorkspace?.id, viewConfigs])

  // Label add/delete handlers removed - labels feature deleted

  // Handler for "Add Skill" context menu action
  // Navigates to Settings > Skills catalog
  const openAddSkill = useCallback(() => {
    navigate(routes.view.settings('skills'))
  }, [])

  // Create a new chat and select it
  const handleNewChat = useCallback(async (_useCurrentAgent: boolean = true) => {
    if (!activeWorkspace) {
      console.error('[handleNewChat] activeWorkspace is null', { workspaces, activeWorkspaceId })
      return
    }

    // Exit search mode and switch to All Chats
    setSearchActive(false)
    setSearchQuery('')

    try {
      const newSession = await onCreateSession(activeWorkspace.id)
      // Show chat list panel and navigate to the new session
      setIsFocusModeActive(false)
      navigate(routes.view.allChats(newSession.id))
    } catch (err) {
      console.error('[handleNewChat] createSession failed:', err)
      toast.error('Failed to create chat. Please restart the app if this continues.')
    }
  }, [activeWorkspace, onCreateSession, workspaces, activeWorkspaceId])

  // Create a new skill via skill-creator builtin skill
  const handleCreateSkill = useCallback(() => {
    setCreateSkillDialogOpen(true)
  }, [])

  const handleCreateSkillFromScratch = useCallback(async () => {
    if (!activeWorkspace) return
    const newSession = await onCreateSession(activeWorkspace.id)
    navigate(routes.view.allChats(newSession.id))
    setTimeout(() => {
      onSendMessage(newSession.id, '[skill:skill-creator] Please help me create a new custom skill for my workspace', undefined, ['skill-creator'])
    }, 100)
  }, [activeWorkspace, onCreateSession, navigate, onSendMessage])

  const handleImportSkill = useCallback(async () => {
    if (!activeWorkspace) return
    try {
      const result = await window.electronAPI.pickSkillImportFolder()
      if (!result) return
      const { folderPath } = result
      const newSession = await onCreateSession(activeWorkspace.id, { workingDirectory: folderPath })
      navigate(routes.view.allChats(newSession.id))
      setTimeout(() => {
        const message = `[skill:skill-creator] このフォルダ（${folderPath}）で定義されたSKILLをワークスペースにインポートしたいです。インストールを手伝ってください。`
        onSendMessage(newSession.id, message, undefined, ['skill-creator'])
      }, 100)
    } catch (err) {
      console.error('[Chat] Failed to import skill:', err)
      toast.error(t('createSkillDialog.importError', 'Failed to open folder picker.'))
    }
  }, [activeWorkspace, onCreateSession, navigate, onSendMessage, t])

  // Delete Skill
  const handleDeleteSkill = useCallback(async (skillSlug: string) => {
    if (!activeWorkspace) return
    try {
      await window.electronAPI.deleteSkill(activeWorkspace.id, skillSlug)
      toast.success(`Deleted skill: ${skillSlug}`)
    } catch (error) {
      console.error('[Chat] Failed to delete skill:', error)
      toast.error('Failed to delete skill')
    }
  }, [activeWorkspace])

  // Respond to menu bar "New Chat" trigger
  const menuTriggerRef = useRef(menuNewChatTrigger)
  useEffect(() => {
    // Skip initial render
    if (menuTriggerRef.current === menuNewChatTrigger) return
    menuTriggerRef.current = menuNewChatTrigger
    handleNewChat(true)
  }, [menuNewChatTrigger, handleNewChat])

  // Unified sidebar items: nav buttons only (agents system removed)
  type SidebarItem = {
    id: string
    type: 'nav'
    action?: () => void
  }

  const unifiedSidebarItems = React.useMemo((): SidebarItem[] => {
    const result: SidebarItem[] = []

    // 1. Chats section: All Chats
    result.push({ id: 'nav:allChats', type: 'nav', action: handleAllChatsClick })

    // 2. Labels section removed - labels feature deleted

    // 3. Skills
    result.push({ id: 'nav:skills', type: 'nav', action: handleSkillsClick })

    return result
  }, [handleAllChatsClick, handleSkillsClick])

  // Toggle folder expanded state
  const handleToggleFolder = React.useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  // Get props for any sidebar item (unified roving tabindex pattern)
  const getSidebarItemProps = React.useCallback((id: string) => ({
    tabIndex: focusedSidebarItemId === id ? 0 : -1,
    'data-focused': focusedSidebarItemId === id,
    ref: (el: HTMLElement | null) => {
      if (el) {
        sidebarItemRefs.current.set(id, el)
      } else {
        sidebarItemRefs.current.delete(id)
      }
    },
  }), [focusedSidebarItemId])

  // Unified sidebar keyboard navigation
  const handleSidebarKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (!sidebarFocused || unifiedSidebarItems.length === 0) return

    const currentIndex = unifiedSidebarItems.findIndex(item => item.id === focusedSidebarItemId)
    const currentItem = currentIndex >= 0 ? unifiedSidebarItems[currentIndex] : null

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const nextIndex = currentIndex < unifiedSidebarItems.length - 1 ? currentIndex + 1 : 0
        const nextItem = unifiedSidebarItems[nextIndex]
        setFocusedSidebarItemId(nextItem.id)
        sidebarItemRefs.current.get(nextItem.id)?.focus()
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : unifiedSidebarItems.length - 1
        const prevItem = unifiedSidebarItems[prevIndex]
        setFocusedSidebarItemId(prevItem.id)
        sidebarItemRefs.current.get(prevItem.id)?.focus()
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        // At boundary - do nothing (Left doesn't change zones from sidebar)
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        // Move to next zone (session list)
        focusZone('session-list')
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        if (currentItem?.type === 'nav' && currentItem.action) {
          currentItem.action()
        }
        break
      }
      case 'Home': {
        e.preventDefault()
        if (unifiedSidebarItems.length > 0) {
          const firstItem = unifiedSidebarItems[0]
          setFocusedSidebarItemId(firstItem.id)
          sidebarItemRefs.current.get(firstItem.id)?.focus()
        }
        break
      }
      case 'End': {
        e.preventDefault()
        if (unifiedSidebarItems.length > 0) {
          const lastItem = unifiedSidebarItems[unifiedSidebarItems.length - 1]
          setFocusedSidebarItemId(lastItem.id)
          sidebarItemRefs.current.get(lastItem.id)?.focus()
        }
        break
      }
    }
  }, [sidebarFocused, unifiedSidebarItems, focusedSidebarItemId, focusZone])

  // Focus sidebar item when sidebar zone gains focus
  React.useEffect(() => {
    if (sidebarFocused && unifiedSidebarItems.length > 0) {
      // Set focused item if not already set
      const itemId = focusedSidebarItemId || unifiedSidebarItems[0].id
      if (!focusedSidebarItemId) {
        setFocusedSidebarItemId(itemId)
      }
      // Actually focus the DOM element
      requestAnimationFrame(() => {
        sidebarItemRefs.current.get(itemId)?.focus()
      })
    }
  }, [sidebarFocused, focusedSidebarItemId, unifiedSidebarItems])

  // Get title based on navigation state
  const listTitle = React.useMemo(() => {
    // Skills navigator
    if (isSkillsNavigation(navState)) {
      return t('listTitle.allSkills')
    }

    // Settings navigator
    if (isSettingsNavigation(navState)) return t('listTitle.settings')

    // Chats navigator - use chatFilter
    if (!chatFilter) return t('listTitle.allChats')

    switch (chatFilter.kind) {
      case 'view':
        return chatFilter.viewId === '__all__' ? t('listTitle.views') : viewConfigs.find(v => v.id === chatFilter.viewId)?.name || t('listTitle.views')
      default:
        return t('listTitle.allChats')
    }
  }, [navState, chatFilter, viewConfigs, t])

  // Label sidebar building removed - labels feature deleted

  return (
    <AppShellProvider value={appShellContextValue}>
      <TooltipProvider delayDuration={0}>
        {/*
          Draggable title bar region for transparent window (macOS)
          - Fixed overlay at z-titlebar allows window dragging from the top bar area
          - Interactive elements (buttons, dropdowns) must use:
            1. titlebar-no-drag: prevents drag behavior on clickable elements
            2. relative z-panel: ensures elements render above this drag overlay
        */}
        <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />

      {/* Top bar buttons: Collapse | Search | New Chat
          Always visible (no focus-mode fade) — positioned right of traffic lights
          On macOS: offset 86px to avoid stoplight controls
          On Windows/Linux: offset 12px (no stoplight controls) */}
      {(() => {
        const menuLeftOffset = isMac ? 86 : 12
        return (
          <div
            className="fixed top-0 h-[50px] z-overlay flex items-center gap-1 titlebar-no-drag"
            style={{ left: menuLeftOffset }}
          >
            {/* Collapse/Expand toggle: hides or shows sidebar + center panel */}
            <TopBarButton
              onClick={() => setIsFocusModeActive(prev => !prev)}
              isActive={effectiveFocusMode}
              title={effectiveFocusMode ? t('tooltip.expandPanels') : t('tooltip.collapsePanels')}
            >
              <PanelLeftRounded className="h-5 w-6 text-foreground/50" />
            </TopBarButton>
            {/* Search */}
            <TopBarButton
              onClick={() => setSearchDialogOpen(true)}
              title={t('sidebar.search')}
            >
              <Search className="h-3.5 w-3.5 text-foreground/50" />
            </TopBarButton>
            {/* New Chat */}
            <TopBarButton
              onClick={() => handleNewChat(true)}
              title={t('sidebar.newChat')}
            >
              <SquarePenRounded className="h-3.5 w-3.5 text-foreground/50" />
            </TopBarButton>
            <AppMenu
              onNewChat={() => handleNewChat(true)}
              onNewWindow={() => window.electronAPI.menuNewWindow()}
              onOpenSettings={onOpenSettings}
              onOpenSettingsSubpage={handleSettingsClick}
              onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
              onToggleSidebar={() => setIsSidebarVisible(prev => !prev)}
              onToggleFocusMode={() => setIsFocusModeActive(prev => !prev)}
            />
          </div>
        )
      })()}

      {/* === OUTER LAYOUT: Sidebar | Main Content === */}
      <div className="h-full flex items-stretch relative">
        {/* === SIDEBAR (Left) ===
            Animated width with spring physics for smooth 60-120fps transitions.
            Uses overflow-hidden to clip content during collapse animation.
            Resizable via drag handle on right edge (200-400px range). */}
        <motion.div
          initial={false}
          animate={{
            width: effectiveFocusMode ? 0 : (isSidebarVisible ? sidebarWidth : 0),
            opacity: effectiveFocusMode ? 0 : 1,
          }}
          transition={isResizing ? { duration: 0 } : springTransition}
          className="h-full overflow-hidden shrink-0 relative"
        >
          <div
            ref={sidebarRef}
            style={{ width: sidebarWidth }}
            className="h-full font-sans relative bg-navigator"
            data-focus-zone="sidebar"
            tabIndex={sidebarFocused ? 0 : -1}
            onKeyDown={handleSidebarKeyDown}
          >
            <div className="flex h-full flex-col pt-[50px] select-none">
              {/* Sidebar Top Section */}
              <div className="flex-1 flex flex-col min-h-0">
                {/* Primary Nav: All Chats | Skills */}
                {/* pt-2 gives top breathing room; pb-4 clears mask-fade-bottom gradient */}
                <div className="flex-1 overflow-y-auto min-h-0 mask-fade-bottom pt-2 pb-4">
                <LeftSidebar
                  isCollapsed={false}
                  isIconOnly={true}
                  getItemProps={getSidebarItemProps}
                  focusedItemId={focusedSidebarItemId}
                  links={[
                    // --- Chats Section ---
                    {
                      id: "nav:allChats",
                      title: t('sidebar.allChats'),
                      label: String(workspaceSessionMetas.length),
                      icon: Inbox,
                      variant: chatFilter?.kind === 'allChats' ? "default" : "ghost",
                      onClick: handleAllChatsClick,
                    },
                    // --- Separator ---
                    { id: "separator:chats-skills", type: "separator" },
                    // --- Skills Section ---
                    {
                      id: "nav:skills",
                      title: t('sidebar.skills'),
                      label: String(skills.length),
                      icon: Zap,
                      variant: isSkillsNavigation(navState) ? "default" : "ghost",
                      onClick: handleSkillsClick,
                      contextMenu: {
                        type: 'skills',
                        onAddSkill: openAddSkill,
                      },
                    },
                  ]}
                />
                {/* Agent Tree: Hierarchical list of agents */}
                {/* Agents section removed */}
                </div>
              </div>

              {/* Sidebar Bottom Section: User Session Menu — always visible */}
              <div className="mt-auto shrink-0 py-2 px-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    {/* Icon-only: settings icon centered */}
                    <button className="flex items-center justify-center w-full rounded-lg select-none outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring p-[7px]">
                      <div className="size-5 rounded-full shrink-0 bg-foreground/10 flex items-center justify-center">
                        <Settings className="h-3.5 w-3.5 text-foreground/40" />
                      </div>
                    </button>
                  </DropdownMenuTrigger>
                  <StyledDropdownMenuContent side="top" align="start" className="w-[220px]">
                    {/* Settings */}
                    <StyledDropdownMenuItem onClick={() => handleSettingsClick('app')}>
                      <Settings className="h-3.5 w-3.5" />
                      <span className="flex-1">{t('sidebar.settings')}</span>
                    </StyledDropdownMenuItem>

                    {/* Language — submenu */}
                    <DropdownMenuSub>
                      <StyledDropdownMenuSubTrigger>
                        <Globe className="h-3.5 w-3.5" />
                        <span className="flex-1">{t('sidebar.language')}</span>
                      </StyledDropdownMenuSubTrigger>
                      <StyledDropdownMenuSubContent>
                        {LANGUAGE_OPTIONS.map(lang => (
                          <StyledDropdownMenuItem
                            key={lang.value}
                            onClick={() => handleLanguageChange(lang.value)}
                          >
                            <span className="flex-1">{lang.label}</span>
                            {i18n.language === lang.value && (
                              <Check className="h-3.5 w-3.5 shrink-0" />
                            )}
                          </StyledDropdownMenuItem>
                        ))}
                      </StyledDropdownMenuSubContent>
                    </DropdownMenuSub>
                  </StyledDropdownMenuContent>
                </DropdownMenu>

                {/* Global chat search dialog */}
                {activeWorkspaceId && (
                  <ChatSearchDialog
                    open={searchDialogOpen}
                    onOpenChange={setSearchDialogOpen}
                    workspaceId={activeWorkspaceId}
                  />
                )}

              </div>
            </div>
          </div>
        </motion.div>

        {/* Sidebar resize handle removed — icon-only sidebar has fixed width */}

        {/* === MAIN CONTENT (Right) ===
            Flex layout: Session List | Chat Display */}
        <div
          className="flex-1 overflow-hidden min-w-0 flex h-full"
          style={{
            paddingTop: TITLEBAR_HEIGHT + PANEL_WINDOW_EDGE_SPACING,
            paddingRight: PANEL_WINDOW_EDGE_SPACING,
            paddingBottom: PANEL_WINDOW_EDGE_SPACING,
            paddingLeft: PANEL_WINDOW_EDGE_SPACING,
            gap: PANEL_PANEL_SPACING / 2,
          }}
        >
          {/* === SESSION LIST PANEL ===
              Animated width with spring physics for smooth 60-120fps transitions.
              Outer motion.div animates width (clipping mask), inner div maintains fixed width
              so content doesn't reflow during animation - same pattern as left sidebar. */}
          <motion.div
            initial={false}
            animate={{
              width: effectiveFocusMode ? 0 : sessionListWidth,
              opacity: effectiveFocusMode ? 0 : 1,
            }}
            transition={isResizing ? { duration: 0 } : springTransition}
            className="h-full shrink-0 overflow-hidden"
          >
            <div
              style={{ width: sessionListWidth }}
              className="h-full flex flex-col min-w-0 bg-background shadow-middle rounded-l-[14px] rounded-r-[10px]"
            >
            <PanelHeader
              title={isSidebarVisible ? listTitle : undefined}
              compensateForStoplight={!isSidebarVisible}
              actions={
                <>
                  {/* Add Skill button (only for skills mode) — opens chat with skill-creator */}
                  {isSkillsNavigation(navState) && activeWorkspace && (
                    <HeaderIconButton
                      icon={<Plus className="h-4 w-4" />}
                      tooltip={t('tooltip.addSkill')}
                      data-tutorial="add-skill-button"
                      onClick={handleCreateSkill}
                    />
                  )}
                  {/* Smart Clean button: only shown in All Chats view */}
                  {isChatsNavigation(navState) && chatFilter?.kind === 'allChats' && activeWorkspaceId && (
                    <HeaderIconButton
                      icon={isSmartCleaning
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Sparkles className="h-4 w-4" />
                      }
                      tooltip={isSmartCleaning ? undefined : t('tooltip.smartClean')}
                      disabled={isSmartCleaning}
                      onClick={handleSmartClean}
                    />
                  )}
                </>
              }
            />
            {/* AI connection status — only shown in chat navigation mode */}
            {isChatsNavigation(navState) && (
              <AIConnectionStatus
                activeConnectionId={aiConnectionId}
                authType={aiAuthType}
                connections={aiConnections}
                isLoading={aiConnectionLoading}
                hasError={aiConnectionError}
              />
            )}
            {/* Content: SkillsListPanel, or SettingsNavigator based on navigation state */}
            {isSkillsNavigation(navState) && activeWorkspaceId && (
              /* Skills List */
              <SkillsListPanel
                skills={skills.filter(s => s.metadata.category !== 'system' && !disabledSkillSlugs.has(s.slug))}
                workspaceId={activeWorkspaceId}
                workspaceRootPath={activeWorkspace?.rootPath}
                onSkillClick={handleSkillSelect}
                onDeleteSkill={handleDeleteSkill}
                onCreateSkill={handleCreateSkill}
                selectedSkillSlug={isSkillsNavigation(navState) && navState.details?.type === 'skill' ? navState.details.skillSlug : null}
              />
            )}
            {isSettingsNavigation(navState) && (
              /* Settings Navigator */
              <SettingsNavigator
                selectedSubpage={navState.subpage}
                onSelectSubpage={(subpage) => handleSettingsClick(subpage)}
              />
            )}
            {isChatsNavigation(navState) && (
              /* Sessions List */
              <>
                {/* SessionList: Scrollable list of session cards */}
                {/* Key on sidebarMode forces full remount when switching views, skipping animations */}
                <SessionList
                  key={chatFilter?.kind}
                  items={searchActive ? workspaceSessionMetas : filteredSessionMetas}
                  onDelete={handleDeleteSession}
                  onMarkUnread={onMarkSessionUnread}
                  onRename={onRenameSession}
                  onFocusChatInput={focusChatInput}
                  onSessionSelect={(selectedMeta) => {
                    // Navigate to the session via central routing (with filter context)
                    if (!chatFilter || chatFilter.kind === 'allChats') {
                      navigate(routes.view.allChats(selectedMeta.id))
                    } else if (chatFilter.kind === 'view') {
                      navigate(routes.view.view(chatFilter.viewId, selectedMeta.id))
                    }
                  }}
                  onOpenInNewWindow={(selectedMeta) => {
                    if (activeWorkspaceId) {
                      window.electronAPI.openSessionInNewWindow(activeWorkspaceId, selectedMeta.id)
                    }
                  }}
                  onNavigateToView={(view) => {
                    if (view === 'allChats') {
                      navigate(routes.view.allChats())
                    }
                  }}
                  sessionOptions={sessionOptions}
                  searchActive={searchActive}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onSearchClose={() => {
                    setSearchActive(false)
                    setSearchQuery('')
                  }}
                  evaluateViews={evaluateViews}
                  projects={projectConfigs}
                  onProjectChange={handleSessionProjectChange}
                  workspaceId={activeWorkspaceId ?? undefined}
                />
              </>
            )}
            </div>
          </motion.div>

          {/* Session List Resize Handle (hidden in focused mode) */}
          {!effectiveFocusMode && (
          <div
            ref={sessionListHandleRef}
            onMouseDown={(e) => { e.preventDefault(); setIsResizing('session-list') }}
            onMouseMove={(e) => {
              if (sessionListHandleRef.current) {
                const rect = sessionListHandleRef.current.getBoundingClientRect()
                setSessionListHandleY(e.clientY - rect.top)
              }
            }}
            onMouseLeave={() => { if (isResizing !== 'session-list') setSessionListHandleY(null) }}
            className="relative w-0 h-full cursor-col-resize flex justify-center shrink-0"
          >
            {/* Touch area */}
            <div className="absolute inset-y-0 -left-1.5 -right-1.5 flex justify-center cursor-col-resize">
              <div
                className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5"
                style={getResizeGradientStyle(sessionListHandleY)}
              />
            </div>
          </div>
          )}

          {/* === MAIN CONTENT PANEL === */}
          <div className={cn(
            "flex-1 overflow-hidden min-w-0 bg-foreground-2 shadow-middle",
            effectiveFocusMode ? "rounded-l-[14px]" : "rounded-l-[10px]",
            isRightSidebarVisible ? "rounded-r-[10px]" : "rounded-r-[14px]"
          )}>
            <MainContentPanel isFocusedMode={effectiveFocusMode} />
          </div>

          {/* Right Sidebar - Inline Mode (≥ 920px) */}
          {!shouldUseOverlay && (
            <>
              {/* Resize Handle */}
              {isRightSidebarVisible && (
                <div
                  ref={rightSidebarHandleRef}
                  onMouseDown={(e) => { e.preventDefault(); setIsResizing('right-sidebar') }}
                  onMouseMove={(e) => {
                    if (rightSidebarHandleRef.current) {
                      const rect = rightSidebarHandleRef.current.getBoundingClientRect()
                      setRightSidebarHandleY(e.clientY - rect.top)
                    }
                  }}
                  onMouseLeave={() => { if (isResizing !== 'right-sidebar') setRightSidebarHandleY(null) }}
                  className="relative w-0 h-full cursor-col-resize flex justify-center shrink-0"
                >
                  {/* Touch area */}
                  <div className="absolute inset-y-0 -left-1.5 -right-1.5 flex justify-center cursor-col-resize">
                    <div
                      className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5"
                      style={getResizeGradientStyle(rightSidebarHandleY)}
                    />
                  </div>
                </div>
              )}

              {/* Inline Sidebar */}
              <motion.div
                initial={false}
                animate={{
                  width: isRightSidebarVisible ? rightSidebarWidth : 0,
                  marginLeft: isRightSidebarVisible ? 0 : -PANEL_PANEL_SPACING / 2,
                }}
                transition={isResizing === 'right-sidebar' || skipRightSidebarAnimation ? { duration: 0 } : springTransition}
                className="h-full shrink-0 overflow-visible"
              >
                <motion.div
                  initial={false}
                  animate={{
                    x: isRightSidebarVisible ? 0 : rightSidebarWidth + PANEL_PANEL_SPACING / 2,
                    opacity: isRightSidebarVisible ? 1 : 0,
                  }}
                  transition={isResizing === 'right-sidebar' || skipRightSidebarAnimation ? { duration: 0 } : springTransition}
                  className="h-full bg-foreground-2 shadow-middle rounded-l-[10px] rounded-r-[14px]"
                  style={{ width: rightSidebarWidth }}
                >
                  <RightSidebar
                    panel={{ type: 'sessionMetadata' }}
                    sessionId={isChatsNavigation(navState) && navState.details ? navState.details.sessionId : undefined}
                    closeButton={rightSidebarCloseButton}
                  />
                </motion.div>
              </motion.div>
            </>
          )}

          {/* Right Sidebar - Overlay Mode (< 920px) */}
          {shouldUseOverlay && (
            <AnimatePresence>
              {isRightSidebarVisible && (
                <>
                  {/* Backdrop */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={skipRightSidebarAnimation ? { duration: 0 } : { duration: 0.2 }}
                    className="fixed inset-0 bg-black/25 z-overlay"
                    onClick={() => setIsRightSidebarVisible(false)}
                  />
                  {/* Drawer panel */}
                  <motion.div
                    initial={{ x: 316 }}
                    animate={{ x: 0 }}
                    exit={{ x: 316 }}
                    transition={skipRightSidebarAnimation ? { duration: 0 } : springTransition}
                    className="fixed inset-y-0 right-0 w-[316px] h-screen z-overlay p-1.5"
                  >
                    <div className="h-full bg-foreground-2 overflow-hidden shadow-strong rounded-[12px]">
                      <RightSidebar
                        panel={{ type: 'sessionMetadata' }}
                        sessionId={isChatsNavigation(navState) && navState.details ? navState.details.sessionId : undefined}
                        closeButton={rightSidebarCloseButton}
                      />
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* ============================================================================
       * CONTEXT MENU TRIGGERED EDIT POPOVERS
       * ============================================================================
       * These EditPopovers are opened programmatically from sidebar context menus.
       * They use controlled state (editPopoverOpen) and invisible anchors for positioning.
       * The anchor Y position is captured from the right-clicked item (editPopoverAnchorY ref)
       * so the popover appears near the triggering item rather than at a fixed location.
       * modal={true} prevents auto-close when focus shifts after context menu closes.
       */}
      {activeWorkspace && (
        <>
          {/* Edit Views EditPopover - anchored near sidebar */}
          <EditPopover
            open={editPopoverOpen === 'views'}
            onOpenChange={(isOpen) => setEditPopoverOpen(isOpen ? 'views' : null)}
            modal={true}
            trigger={
              <div
                className="fixed w-0 h-0 pointer-events-none"
                style={{ left: sidebarWidth + 20, top: editPopoverAnchorY.current }}
                aria-hidden="true"
              />
            }
            side="bottom"
            align="start"
            secondaryAction={{
              label: 'Edit File',
              filePath: `${activeWorkspace.rootPath}/views.json`,
            }}
            {...getEditConfig('edit-views', activeWorkspace.rootPath)}
          />
          {/* Create Skill Dialog */}
          <CreateSkillDialog
            open={createSkillDialogOpen}
            onOpenChange={setCreateSkillDialogOpen}
            onCreateFromScratch={handleCreateSkillFromScratch}
            onImportFromFolder={handleImportSkill}
          />
        </>
      )}

      </TooltipProvider>
    </AppShellProvider>
  )
}
