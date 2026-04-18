import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { formatDistanceToNow, formatDistanceToNowStrict, isToday, isYesterday, format, startOfDay } from "date-fns"
import type { Locale } from "date-fns"
import { MoreHorizontal, Inbox, ChevronRight, FolderOpen, Plus, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SmartPointerSensor } from '@/components/ui/sortable-list'
import { cn } from "@/lib/utils"
import { rendererPerf } from "@/lib/perf"
import { searchLog } from "@/lib/logger"
import type { ProjectConfig } from "@opentomo/shared/projects"
import { resolveEntityColor } from "@opentomo/shared/colors"
import { useTheme } from "@/context/ThemeContext"
import { Spinner, Tooltip, TooltipTrigger, TooltipContent } from "@opentomo/ui"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from "@/components/ui/styled-context-menu"
import { DropdownMenuProvider, ContextMenuProvider } from "@/components/ui/menu-context"
import { SessionMenu } from "./SessionMenu"
import { SessionSearchHeader } from "./SessionSearchHeader"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { RenameDialog } from "@/components/ui/rename-dialog"
import { useSession } from "@/hooks/useSession"
import { useFocusZone, useRovingTabIndex } from "@/hooks/keyboard"
import { useNavigation, useNavigationState, routes, isChatsNavigation, type ChatFilter } from "@/contexts/NavigationContext"
import { useAppShellContext } from "@/context/AppShellContext"
import { useFocusContext } from "@/context/FocusContext"
import { getSessionTitle } from "@/utils/session"
import type { SessionMeta } from "@/atoms/sessions"
import type { ViewConfig } from "@opentomo/shared/views"
import { PERMISSION_MODE_CONFIG, type PermissionMode } from "@opentomo/shared/agent/modes"
import { MODE_I18N_KEYS } from "@/components/ui/slash-command-menu"
import { fuzzyScore, fuzzyMatch } from "@opentomo/shared/search"

// Pagination constants
const INITIAL_DISPLAY_LIMIT = 20
const BATCH_SIZE = 20
const MAX_SEARCH_RESULTS = 100

/** Short relative time locale for date-fns formatDistanceToNowStrict.
 *  Produces compact strings: "7m", "2h", "3d", "2w", "5mo", "1y" */
const shortTimeLocale: Pick<Locale, 'formatDistance'> = {
  formatDistance: (token: string, count: number) => {
    const units: Record<string, string> = {
      xSeconds: `${count}s`,
      xMinutes: `${count}m`,
      xHours: `${count}h`,
      xDays: `${count}d`,
      xWeeks: `${count}w`,
      xMonths: `${count}mo`,
      xYears: `${count}y`,
    }
    return units[token] || `${count}`
  },
}

/**
 * Format a date for the date header
 * Returns "Today", "Yesterday", or formatted date like "Dec 19"
 */
function formatDateHeader(date: Date, t: (key: string) => string): string {
  if (isToday(date)) return t('sessionList.today')
  if (isYesterday(date)) return t('sessionList.yesterday')
  return format(date, "MMM d")
}

/**
 * Group sessions by date (day boundary)
 * Returns array of { date, sessions } sorted by date descending
 */
function groupSessionsByDate(sessions: SessionMeta[], t: (key: string) => string): Array<{ date: Date; label: string; sessions: SessionMeta[] }> {
  const groups = new Map<string, { date: Date; sessions: SessionMeta[] }>()

  for (const session of sessions) {
    const timestamp = session.lastMessageAt || 0
    const date = startOfDay(new Date(timestamp))
    const key = date.toISOString()

    if (!groups.has(key)) {
      groups.set(key, { date, sessions: [] })
    }
    groups.get(key)!.sessions.push(session)
  }

  // Sort groups by date descending and add labels
  return Array.from(groups.values())
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .map(group => ({
      ...group,
      label: formatDateHeader(group.date, t),
    }))
}

/**
 * Project group: a project (or uncategorized) with date-grouped sessions.
 */
interface ProjectGroup {
  projectId: string | null
  project: ProjectConfig | null
  dateGroups: Array<{ date: Date; label: string; sessions: SessionMeta[] }>
  totalCount: number
}

/**
 * Group sessions by project first, then by date within each project.
 * Empty projects are included (so they render as visible folder rows for drag targets).
 * Sessions without a project appear in the "uncategorized" group at the end.
 */
function groupSessionsByProjectAndDate(
  sessions: SessionMeta[],
  projects: ProjectConfig[],
  t: (key: string) => string
): ProjectGroup[] {
  // Group by projectId
  const projectMap = new Map<string | null, SessionMeta[]>()
  for (const session of sessions) {
    const pid = session.projectId ?? null
    if (!projectMap.has(pid)) projectMap.set(pid, [])
    projectMap.get(pid)!.push(session)
  }

  const groups: ProjectGroup[] = []

  // Project groups sorted by order (includes empty projects)
  const sortedProjects = [...projects].sort((a, b) => a.order - b.order)
  for (const project of sortedProjects) {
    const projectSessions = projectMap.get(project.id) ?? []

    groups.push({
      projectId: project.id,
      project,
      dateGroups: projectSessions.length > 0 ? groupSessionsByDate(projectSessions, t) : [],
      totalCount: projectSessions.length,
    })
  }

  // Uncategorized group
  const uncategorized = projectMap.get(null)
  if (uncategorized && uncategorized.length > 0) {
    groups.push({
      projectId: null,
      project: null,
      dateGroups: groupSessionsByDate(uncategorized, t),
      totalCount: uncategorized.length,
    })
  }

  return groups
}


/**
 * Check if a session has unread messages.
 * Uses the explicit hasUnread flag (state machine approach) as single source of truth.
 * This avoids race conditions from comparing two independently-updated IDs.
 */
function hasUnreadMessages(session: SessionMeta): boolean {
  return session.hasUnread === true
}

/**
 * Check if session has any messages (uses lastFinalMessageId as proxy)
 */
function hasMessages(session: SessionMeta): boolean {
  return session.lastFinalMessageId !== undefined
}

/** Options for sessionMatchesCurrentFilter including secondary filters */
interface FilterMatchOptions {
  evaluateViews?: (meta: SessionMeta) => ViewConfig[]
}

/**
 * Check if a session matches the current navigation filter AND secondary filters.
 * Used to split search results into "Matching Current Filters" vs "All Results".
 *
 * Filter layers:
 * 1. Primary filter (chatFilter) - "All Chats", specific view
 *
 * A session must pass the filter to be considered "matching".
 */
function sessionMatchesCurrentFilter(
  session: SessionMeta,
  currentFilter: ChatFilter | undefined,
  options: FilterMatchOptions = {}
): boolean {
  const { evaluateViews } = options

  // Check primary filter
  if (!currentFilter) return true

  switch (currentFilter.kind) {
    case 'allChats':
      return true

    case 'view':
      if (!evaluateViews) return true
      const matched = evaluateViews(session)
      if (currentFilter.viewId === '__all__') return matched.length > 0
      return matched.some(v => v.id === currentFilter.viewId)

    default:
      // Exhaustive check - TypeScript will error if we miss a case
      const _exhaustive: never = currentFilter
      return true
  }
}

/**
 * Highlight matching text in a string
 * Returns React nodes with matched portions wrapped in a highlight span
 */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const index = lowerText.indexOf(lowerQuery)

  if (index === -1) return text

  const before = text.slice(0, index)
  const match = text.slice(index, index + query.length)
  const after = text.slice(index + query.length)

  return (
    <>
      {before}
      <span className="bg-yellow-300/30 rounded-[2px]">{match}</span>
      {highlightMatch(after, query)}
    </>
  )
}

interface SessionItemProps {
  item: SessionMeta
  index: number
  itemProps: {
    id: string
    tabIndex: number
    'aria-selected': boolean
    onKeyDown: (e: React.KeyboardEvent) => void
    onFocus: () => void
    ref: (el: HTMLElement | null) => void
    role: string
  }
  isSelected: boolean
  isLast: boolean
  isFirstInGroup: boolean
  onKeyDown: (e: React.KeyboardEvent, item: SessionMeta) => void
  onRenameClick: (sessionId: string, currentName: string) => void
  onMarkUnread: (sessionId: string) => void
  onDelete: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  onSelect: () => void
  onOpenInNewWindow: () => void
  /** Current permission mode for this session (from real-time state) */
  permissionMode?: PermissionMode
  /** Current search query for highlighting matches */
  searchQuery?: string
  /** Project configs for "Move to Project" submenu */
  projects?: ProjectConfig[]
  /** Callback when session project is changed */
  onProjectChange?: (sessionId: string, projectId: string | null) => void
  /** Whether this item can be dragged to a project */
  isDraggable?: boolean
  /** Number of matches in ChatDisplay (only set when session is selected and loaded) */
  chatMatchCount?: number
}

/**
 * SessionItem - Individual session card with todo checkbox and dropdown menu
 * Tracks menu open state to keep "..." button visible
 */
function SessionItem({
  item,
  index,
  itemProps,
  isSelected,
  isLast,
  isFirstInGroup,
  onKeyDown,
  onRenameClick,
  onMarkUnread,
  onDelete,
  onSelect,
  onOpenInNewWindow,
  permissionMode,
  searchQuery,
  projects,
  onProjectChange,
  isDraggable: enableDrag,
  chatMatchCount,
}: SessionItemProps) {
  const { t } = useTranslation()
  const { attributes: dragAttributes, listeners: dragListeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `session-${item.id}`,
    data: { type: 'session', sessionId: item.id },
    disabled: !enableDrag,
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)

  const handleClick = () => {
    // Start perf tracking for session switch
    rendererPerf.startSessionSwitch(item.id)
    onSelect()
  }

  return (
    <div
      ref={enableDrag ? setDragRef : undefined}
      className={cn("session-item", isDragging && "opacity-40")}
      data-selected={isSelected || undefined}
      data-session-id={item.id}
      {...(enableDrag ? { ...dragAttributes, ...dragListeners } : {})}
    >
      {/* Separator - only show if not first in group */}
      {!isFirstInGroup && (
        <div className="session-separator pl-12 pr-4">
          <Separator />
        </div>
      )}
      {/* Wrapper for button + dropdown + context menu, group for hover state */}
      <ContextMenu modal={true} onOpenChange={setContextMenuOpen}>
        <ContextMenuTrigger asChild>
          <div className="session-content relative group select-none pl-2 mr-2">
        {/* Main content button */}
        <button
          {...itemProps}
          className={cn(
            "flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm outline-none rounded-[8px]",
            // Fast hover transition (75ms vs default 150ms), selection is instant
            "transition-[background-color] duration-75",
            isSelected
              ? "bg-foreground/5 hover:bg-foreground/7"
              : "hover:bg-foreground/2"
          )}
          onMouseDown={handleClick}
          onKeyDown={(e) => {
            itemProps.onKeyDown(e)
            onKeyDown(e, item)
          }}
        >
          {/* Content column */}
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            {/* Title - up to 2 lines, with shimmer during async operations (sharing, title regen, etc.) */}
            <div className="flex items-start gap-2 w-full pr-6 min-w-0">
              <div className={cn(
                "font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]",
                item.isAsyncOperationOngoing && "animate-shimmer-text"
              )}>
                {searchQuery ? highlightMatch(getSessionTitle(item), searchQuery) : getSessionTitle(item)}
              </div>
            </div>
            {/* Subtitle row — badges scroll horizontally when they overflow */}
            <div className="flex items-center gap-1.5 text-xs text-foreground/70 w-full -mb-[2px] min-w-0">
              {/* Fixed indicators (Spinner + New) — always visible */}
              {item.isProcessing && (
                <Spinner className="text-[8px] text-foreground shrink-0" />
              )}
              {!item.isProcessing && hasUnreadMessages(item) && (
                <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent text-foreground">
                  {t('sessionList.new')}
                </span>
              )}

              {/* Scrollable badges container — horizontal scroll with hidden scrollbar,
                  right-edge gradient mask to hint at overflow */}
              <div
                className="flex-1 flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-hide pr-4"
                style={{ maskImage: 'linear-gradient(to right, black calc(100% - 16px), transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 16px), transparent 100%)' }}
              >
                {item.lastMessageRole === 'plan' && (
                  <span className="shrink-0 h-[18px] px-1.5 text-[10px] font-medium rounded bg-success/10 text-success flex items-center whitespace-nowrap">
                    {t('sessionList.plan')}
                  </span>
                )}
                {permissionMode && (
                  <span
                    className={cn(
                      "shrink-0 h-[18px] px-1.5 text-[10px] font-medium rounded flex items-center whitespace-nowrap",
                      permissionMode === 'safe' && "bg-foreground/5 text-foreground/60",
                      permissionMode === 'ask' && "bg-info/10 text-info",
                      permissionMode === 'allow-all' && "bg-accent/10 text-accent"
                    )}
                  >
                    {t(MODE_I18N_KEYS[permissionMode].short, PERMISSION_MODE_CONFIG[permissionMode].shortName)}
                  </span>
                )}
              </div>
              {/* Timestamp — outside stacking container so it never overlaps badges.
                  shrink-0 keeps it fixed-width; the badges container clips instead. */}
              {item.lastMessageAt && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="shrink-0 text-[11px] text-foreground/40 whitespace-nowrap cursor-default">
                      {formatDistanceToNowStrict(new Date(item.lastMessageAt), { locale: shortTimeLocale as Locale, roundingMethod: 'floor' })}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={4}>
                    {formatDistanceToNow(new Date(item.lastMessageAt), { addSuffix: true })}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </button>

        {/* Match count badge - shown on right side for all items with matches */}
        {chatMatchCount != null && chatMatchCount > 0 && (
          <div className="absolute right-3 top-2 z-10">
            <span
              className={cn(
                "inline-flex items-center justify-center min-w-[24px] px-1 py-1 rounded-[6px] text-[10px] font-medium tabular-nums leading-tight whitespace-nowrap",
                isSelected
                  ? "bg-yellow-300/50 border border-yellow-500 text-yellow-900"
                  : "bg-yellow-300/10 border border-yellow-600/20 text-yellow-800"
              )}
              style={{ boxShadow: isSelected ? '0 1px 2px 0 rgba(234, 179, 8, 0.3)' : '0 1px 2px 0 rgba(133, 77, 14, 0.15)' }}
              title="Matches found (⌘G next, ⌘⇧G prev)"
            >
              {chatMatchCount}
            </span>
          </div>
        )}

        {/* Action buttons - visible on hover or when menu is open, hidden when match badge is visible */}
        {!(chatMatchCount != null && chatMatchCount > 0) && (
        <div
          className={cn(
            "absolute right-2 top-2 transition-opacity z-10 flex items-center gap-1",
            menuOpen || contextMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          {/* More menu */}
          <div className="flex items-center rounded-[8px] overflow-hidden border border-transparent hover:border-border/50">
            <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <div className="p-1.5 hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </div>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                <DropdownMenuProvider>
                  <SessionMenu
                    sessionId={item.id}
                    sessionName={getSessionTitle(item)}

                    hasMessages={hasMessages(item)}
                    hasUnreadMessages={hasUnreadMessages(item)}
                    sessionProjectId={item.projectId}
                    projects={projects}
                    onProjectChange={onProjectChange ? (projectId) => onProjectChange(item.id, projectId) : undefined}
                    onRename={() => onRenameClick(item.id, getSessionTitle(item))}
                    onMarkUnread={() => onMarkUnread(item.id)}
                    onOpenInNewWindow={onOpenInNewWindow}
                    onDelete={() => onDelete(item.id)}
                  />
                </DropdownMenuProvider>
              </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        )}
          </div>
        </ContextMenuTrigger>
        {/* Context menu - same content as dropdown */}
        <StyledContextMenuContent>
          <ContextMenuProvider>
            <SessionMenu
              sessionId={item.id}
              sessionName={getSessionTitle(item)}
              sharedUrl={item.sharedUrl}
              hasMessages={hasMessages(item)}
              hasUnreadMessages={hasUnreadMessages(item)}
              sessionProjectId={item.projectId}
              projects={projects}
              onProjectChange={onProjectChange ? (projectId) => onProjectChange(item.id, projectId) : undefined}
              onRename={() => onRenameClick(item.id, getSessionTitle(item))}
              onMarkUnread={() => onMarkUnread(item.id)}
              onOpenInNewWindow={onOpenInNewWindow}
              onDelete={() => onDelete(item.id)}
            />
          </ContextMenuProvider>
        </StyledContextMenuContent>
      </ContextMenu>
    </div>
  )
}

/**
 * SessionListSectionHeader - Section header for date groups and search result sections.
 * No sticky behavior - just scrolls with the list.
 */
function SessionListSectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 py-2">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  )
}

/**
 * ProjectHeader - Folder row for project grouping in SessionList.
 * Shows chevron (expand/collapse), folder icon, project name, session count, and a "..." menu.
 * Also acts as a drop target for drag-and-drop session assignment.
 */
function ProjectHeader({
  project,
  count,
  expanded,
  onToggle,
  onRename,
  onDelete,
}: {
  project: ProjectConfig
  count: number
  expanded: boolean
  onToggle: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({
    id: `project-${project.id}`,
    data: { type: 'project', projectId: project.id },
  })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-1.5 px-4 py-2 cursor-pointer group select-none transition-colors",
        isOver ? "bg-accent/10 ring-2 ring-accent/20 ring-inset" : "hover:bg-foreground/[0.02]"
      )}
      onClick={onToggle}
    >
      <ChevronRight
        className={cn(
          "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-150",
          expanded && "rotate-90"
        )}
      />
      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-[12px] font-medium text-foreground/80 truncate flex-1 min-w-0">
        {project.icon ? `${project.icon} ` : ''}{project.name}
      </span>
      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
        {count}
      </span>
      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <div
            className="p-0.5 rounded hover:bg-foreground/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end">
          <StyledDropdownMenuItem onClick={onRename}>
            <Pencil className="h-3.5 w-3.5" />
            {t('projects.rename')}
          </StyledDropdownMenuItem>
          <StyledDropdownMenuSeparator />
          <StyledDropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
            {t('projects.delete')}
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** Filter mode for tri-state filtering: include shows only matching, exclude hides matching */
type FilterMode = 'include' | 'exclude'

interface SessionListProps {
  items: SessionMeta[]
  onDelete: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  onMarkUnread: (sessionId: string) => void
  onRename: (sessionId: string, name: string) => void
  /** Called when Enter is pressed to focus chat input */
  onFocusChatInput?: () => void
  /** Called when a session is selected */
  onSessionSelect?: (session: SessionMeta) => void
  /** Called when user wants to open a session in a new window */
  onOpenInNewWindow?: (session: SessionMeta) => void
  /** Called to navigate to a specific view (e.g., 'allChats') */
  onNavigateToView?: (view: 'allChats') => void
  /** Unified session options per session (real-time state) */
  sessionOptions?: Map<string, import('../../hooks/useSessionOptions').SessionOptions>
  /** Whether search mode is active */
  searchActive?: boolean
  /** Current search query */
  searchQuery?: string
  /** Called when search query changes */
  onSearchChange?: (query: string) => void
  /** Called when search is closed */
  onSearchClose?: () => void
  /** View evaluator — evaluates a session and returns matching view configs */
  evaluateViews?: (meta: SessionMeta) => ViewConfig[]
  /** Project configs for folder-style grouping */
  projects?: ProjectConfig[]
  /** Callback when session project is changed */
  onProjectChange?: (sessionId: string, projectId: string | null) => void
  /** Workspace ID for content search (optional - if not provided, content search is disabled) */
  workspaceId?: string
}

/**
 * SessionList - Scrollable list of session cards with keyboard navigation
 *
 * Keyboard shortcuts:
 * - Arrow Up/Down: Navigate and select sessions (immediate selection)
 * - Enter: Focus chat input
 * - Delete/Backspace: Delete session
 * - C: Mark complete/incomplete
 * - R: Rename session
 */
export function SessionList({
  items,
  onDelete,
  onMarkUnread,
  onRename,
  onFocusChatInput,
  onSessionSelect,
  onOpenInNewWindow,
  onNavigateToView,
  sessionOptions,
  searchActive,
  searchQuery = '',
  onSearchChange,
  onSearchClose,
  evaluateViews,
  projects = [],
  onProjectChange,
  workspaceId,
}: SessionListProps) {
  const { t } = useTranslation()
  const [session] = useSession()
  const { navigate } = useNavigation()
  const navState = useNavigationState()
  const { onCreateSession } = useAppShellContext()

  // Filter out hidden sessions (e.g., mini edit sessions) before any processing
  const visibleItems = useMemo(() => items.filter(item => !item.hidden), [items])

  // Get current filter from navigation state (for preserving context in tab routes)
  const currentFilter = isChatsNavigation(navState) ? navState.filter : undefined

  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState("")
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Content search state (full-text search via ripgrep)
  const [contentSearchResults, setContentSearchResults] = useState<Map<string, { matchCount: number; snippet: string }>>(new Map())
  const [isSearchingContent, setIsSearchingContent] = useState(false)
  // Track if search input has actual DOM focus (for proper keyboard navigation gating)
  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false)

  // Search mode is active when search is open AND query has 2+ characters
  // This is the single source of truth for all search mode behavior:
  // - Show results count, highlights, match badges, flat list with sections
  const isSearchMode = searchActive && searchQuery.length >= 2

  // Only highlight matches when in search mode
  const highlightQuery = isSearchMode ? searchQuery : undefined

  // Content search - triggers immediately when search query changes (ripgrep cancels previous search)
  useEffect(() => {
    if (!workspaceId || !isSearchMode) {
      setContentSearchResults(new Map())
      return
    }

    const searchId = Date.now().toString(36)
    searchLog.info('query:change', { searchId, query: searchQuery })

    // Track if this effect was cleaned up (user typed new query)
    let cancelled = false

    setIsSearchingContent(true)

    // 100ms debounce to prevent I/O contention from overlapping ripgrep searches
    const timer = setTimeout(async () => {
      try {
        searchLog.info('ipc:call', { searchId })
        const ipcStart = performance.now()

        const results = await window.electronAPI.searchSessionContent(workspaceId, searchQuery, searchId)

        // Ignore results if user already typed a new query
        if (cancelled) return

        searchLog.info('ipc:received', {
          searchId,
          durationMs: Math.round(performance.now() - ipcStart),
          resultCount: results.length,
        })

        const resultMap = new Map<string, { matchCount: number; snippet: string }>()
        for (const result of results) {
          resultMap.set(result.sessionId, {
            matchCount: result.matchCount,
            snippet: result.matches[0]?.snippet || '',
          })
        }
        setContentSearchResults(resultMap)

        // Log render complete after React commits the state update
        requestAnimationFrame(() => {
          searchLog.info('render:complete', { searchId, sessionsDisplayed: resultMap.size })
        })
      } catch (error) {
        if (cancelled) return
        console.error('[SessionList] Content search error:', error)
        setContentSearchResults(new Map())
      } finally {
        if (!cancelled) {
          setIsSearchingContent(false)
        }
      }
    }, 100)

    return () => {
      cancelled = true
      clearTimeout(timer)
      setIsSearchingContent(false)
    }
  }, [workspaceId, isSearchMode, searchQuery])

  // Focus search input when search becomes active
  useEffect(() => {
    if (searchActive) {
      searchInputRef.current?.focus()
    }
  }, [searchActive])

  // Sort by most recent activity first
  const sortedItems = [...visibleItems].sort((a, b) =>
    (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
  )

  // Filter items by search query — ripgrep content search only for consistent results
  // When not in search mode, apply current filter to maintain filtered view
  const searchFilteredItems = useMemo(() => {
    // Not in search mode: filter to current view (same as non-search mode)
    if (!isSearchMode) {
      return sortedItems.filter(item =>
        sessionMatchesCurrentFilter(item, currentFilter, { evaluateViews })
      )
    }

    // Search mode (2+ chars): show sessions with ripgrep content matches (from ALL sessions)
    // Sort by: fuzzy title score first, then by match count
    return sortedItems
      .filter(item => contentSearchResults.has(item.id) || fuzzyMatch(getSessionTitle(item), searchQuery))
      .sort((a, b) => {
        const aScore = fuzzyScore(getSessionTitle(a), searchQuery)
        const bScore = fuzzyScore(getSessionTitle(b), searchQuery)

        // Title matches come first, sorted by fuzzy score (higher = better)
        if (aScore > 0 && bScore === 0) return -1
        if (aScore === 0 && bScore > 0) return 1
        if (aScore !== bScore) return bScore - aScore

        // Then sort by ripgrep match count
        const countA = contentSearchResults.get(a.id)?.matchCount || 0
        const countB = contentSearchResults.get(b.id)?.matchCount || 0
        return countB - countA
      })
  }, [sortedItems, isSearchMode, searchQuery, contentSearchResults, currentFilter, evaluateViews])

  // Split search results: sessions matching current filter vs all others
  // Also limits total results to MAX_SEARCH_RESULTS (100)
  const { matchingFilterItems, otherResultItems, exceededSearchLimit } = useMemo(() => {
    // Check if ANY filtering is active (primary only)
    const hasActiveFilters = currentFilter && currentFilter.kind !== 'allChats'

    // DEBUG: Trace values to diagnose grouping issue
    if (searchQuery.trim() && searchFilteredItems.length > 0) {
      searchLog.info('search:grouping', {
        searchQuery,
        currentFilterKind: currentFilter?.kind,
        hasActiveFilters,
        itemCount: searchFilteredItems.length,
      })
    }

    // Check if we have more results than the limit
    const totalCount = searchFilteredItems.length
    const exceeded = totalCount > MAX_SEARCH_RESULTS

    if (!isSearchMode || !hasActiveFilters) {
      // No grouping needed - all results go to "matching", but limit to MAX_SEARCH_RESULTS
      const limitedItems = searchFilteredItems.slice(0, MAX_SEARCH_RESULTS)
      return { matchingFilterItems: limitedItems, otherResultItems: [] as SessionMeta[], exceededSearchLimit: exceeded }
    }

    const matching: SessionMeta[] = []
    const others: SessionMeta[] = []

    // Split results, stopping once we hit MAX_SEARCH_RESULTS total
    for (const item of searchFilteredItems) {
      if (matching.length + others.length >= MAX_SEARCH_RESULTS) break

      const matches = sessionMatchesCurrentFilter(item, currentFilter, { evaluateViews })
      if (matches) {
        matching.push(item)
      } else {
        others.push(item)
      }
    }

    // DEBUG: Log split result
    if (searchFilteredItems.length > 0) {
      searchLog.info('search:grouping:result', {
        matchingCount: matching.length,
        othersCount: others.length,
        exceeded,
      })
    }

    return { matchingFilterItems: matching, otherResultItems: others, exceededSearchLimit: exceeded }
  }, [searchFilteredItems, currentFilter, evaluateViews, isSearchMode])

  // Reset display limit when search query changes
  useEffect(() => {
    setDisplayLimit(INITIAL_DISPLAY_LIMIT)
  }, [searchQuery])

  // Paginate items - only show up to displayLimit
  const paginatedItems = useMemo(() => {
    return searchFilteredItems.slice(0, displayLimit)
  }, [searchFilteredItems, displayLimit])

  // Check if there are more items to load
  const hasMore = displayLimit < searchFilteredItems.length

  // Load more items callback
  const loadMore = useCallback(() => {
    setDisplayLimit(prev => Math.min(prev + BATCH_SIZE, searchFilteredItems.length))
  }, [searchFilteredItems.length])

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore()
        }
      },
      { rootMargin: '100px' }  // Trigger slightly before reaching bottom
    )

    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  // Group sessions by date (only used in normal mode, not search mode)
  const dateGroups = useMemo(() => groupSessionsByDate(paginatedItems, t), [paginatedItems, t])

  // Project grouping: group by project then date (only when projects exist and not searching)
  const hasProjects = projects.length > 0
  const projectGroups = useMemo(() => {
    if (!hasProjects || isSearchMode) return []
    return groupSessionsByProjectAndDate(paginatedItems, projects, t)
  }, [hasProjects, isSearchMode, paginatedItems, projects, t])

  // Expand/collapse state for project folders (persisted in localStorage)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('expanded-projects')
      return stored ? new Set(JSON.parse(stored)) : new Set<string>()
    } catch {
      return new Set<string>()
    }
  })

  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      try {
        localStorage.setItem('expanded-projects', JSON.stringify(Array.from(next)))
      } catch { /* ignore */ }
      return next
    })
  }, [])

  // Wrapper: auto-expand the target project when a session is moved to it.
  // Prevents sessions from vanishing into collapsed folders.
  const handleProjectChangeWithExpand = useCallback((sessionId: string, projectId: string | null) => {
    if (projectId) {
      setExpandedProjects(prev => {
        if (prev.has(projectId)) return prev
        const next = new Set(prev)
        next.add(projectId)
        try { localStorage.setItem('expanded-projects', JSON.stringify(Array.from(next))) } catch { /* ignore */ }
        return next
      })
    }
    onProjectChange?.(sessionId, projectId)
  }, [onProjectChange])

  // Create Project dialog state
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null)
  const [renameProjectName, setRenameProjectName] = useState('')
  const [renameProjectOpen, setRenameProjectOpen] = useState(false)

  const handleCreateProject = useCallback(async () => {
    if (!workspaceId || !newProjectName.trim()) return
    try {
      const project = await window.electronAPI.createProject(workspaceId, { name: newProjectName.trim() })
      // Auto-expand the new project
      setExpandedProjects(prev => {
        const next = new Set(prev)
        next.add(project.id)
        try {
          localStorage.setItem('expanded-projects', JSON.stringify(Array.from(next)))
        } catch { /* ignore */ }
        return next
      })
      setCreateProjectOpen(false)
      setNewProjectName('')
      toast(t('projects.created'))
    } catch (err) {
      console.error('[SessionList] Failed to create project:', err)
      toast.error(t('projects.createFailed'))
    }
  }, [workspaceId, newProjectName, t])

  const handleRenameProject = useCallback(async () => {
    if (!workspaceId || !renameProjectId || !renameProjectName.trim()) return
    try {
      await window.electronAPI.updateProject(workspaceId, renameProjectId, { name: renameProjectName.trim() })
      setRenameProjectOpen(false)
      setRenameProjectId(null)
      setRenameProjectName('')
    } catch (err) {
      console.error('[SessionList] Failed to rename project:', err)
      toast.error(t('projects.renameFailed'))
    }
  }, [workspaceId, renameProjectId, renameProjectName, t])

  const handleDeleteProject = useCallback(async (projectId: string) => {
    if (!workspaceId) return
    try {
      const result = await window.electronAPI.deleteProject(workspaceId, projectId)
      toast(t('projects.deleted'))
    } catch (err) {
      console.error('[SessionList] Failed to delete project:', err)
      toast.error(t('projects.deleteFailed'))
    }
  }, [workspaceId, t])

  // Drag-and-drop: move sessions to projects
  const dndSensors = useSensors(
    useSensor(SmartPointerSensor, { activationConstraint: { distance: 8 } })
  )
  const [dragSessionId, setDragSessionId] = useState<string | null>(null)

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current
    if (data?.type === 'session') {
      setDragSessionId(data.sessionId)
    }
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDragSessionId(null)
    const { active, over } = event
    if (!over || !onProjectChange) return

    const activeData = active.data.current
    const overData = over.data.current
    if (activeData?.type !== 'session' || overData?.type !== 'project') return

    const sessionId = activeData.sessionId as string
    const projectId = overData.projectId as string
    handleProjectChangeWithExpand(sessionId, projectId)

    // Find project name for toast
    const project = projects.find(p => p.id === projectId)
    if (project) {
      toast(t('sessionMenu.movedToProject', { projectName: project.name }))
    }
  }, [onProjectChange, handleProjectChangeWithExpand, projects, t])

  const handleDragCancel = useCallback(() => {
    setDragSessionId(null)
  }, [])

  // Create flat list for keyboard navigation (maintains order across groups/sections)
  const flatItems = useMemo(() => {
    if (isSearchMode) {
      // Search mode: flat list of matching + other results (no date grouping)
      return [...matchingFilterItems, ...otherResultItems]
    }
    // Project-grouped mode: flatten expanded projects
    if (hasProjects && projectGroups.length > 0) {
      const items: SessionMeta[] = []
      for (const pg of projectGroups) {
        // Only include sessions from expanded projects (uncategorized is always expanded)
        if (pg.projectId === null || expandedProjects.has(pg.projectId)) {
          for (const dg of pg.dateGroups) {
            items.push(...dg.sessions)
          }
        }
      }
      return items
    }
    // Normal mode: flatten date groups
    return dateGroups.flatMap(group => group.sessions)
  }, [isSearchMode, matchingFilterItems, otherResultItems, dateGroups, hasProjects, projectGroups, expandedProjects])

  // Resolve the dragged session for DragOverlay (must be after flatItems)
  const dragSession = dragSessionId ? flatItems.find(s => s.id === dragSessionId) ?? paginatedItems.find(s => s.id === dragSessionId) ?? null : null

  // Create a lookup map for session ID -> flat index
  const sessionIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    flatItems.forEach((item, index) => map.set(item.id, index))
    return map
  }, [flatItems])

  // Find initial index based on selected session
  const selectedIndex = flatItems.findIndex(item => item.id === session.selected)

  // Focus zone management
  const { focusZone } = useFocusContext()

  // Register as focus zone
  const { zoneRef, isFocused } = useFocusZone({ zoneId: 'session-list' })

  // Handle session selection (immediate on arrow navigation)
  const handleActiveChange = useCallback((item: SessionMeta) => {
    // Navigate using view routes to preserve filter context
    if (!currentFilter || currentFilter.kind === 'allChats') {
      navigate(routes.view.allChats(item.id))
    }
    // Scroll the selected item into view
    requestAnimationFrame(() => {
      const element = document.querySelector(`[data-session-id="${item.id}"]`)
      element?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    })
  }, [navigate, currentFilter])

  // NOTE: We intentionally do NOT auto-select sessions while typing in search.
  // Auto-selecting causes: 1) ChatDisplay to scroll, 2) focus loss from search input
  // Selection only changes via: arrow key navigation or explicit click

  // Handle Enter to focus chat input
  const handleEnter = useCallback(() => {
    onFocusChatInput?.()
  }, [onFocusChatInput])

  const handleDeleteWithToast = useCallback(async (sessionId: string): Promise<boolean> => {
    // Confirmation dialog is shown by handleDeleteSession in App.tsx
    // We await so toast only shows after successful deletion (if user confirmed)
    const deleted = await onDelete(sessionId)
    if (deleted) {
      toast(t('sessionList.conversationDeleted'))
    }
    return deleted
  }, [onDelete])

  // Roving tabindex for keyboard navigation
  // During search: enabled but moveFocus=false so focus stays on search input
  const rovingEnabled = isFocused || (searchActive && isSearchInputFocused)

  const {
    activeIndex,
    setActiveIndex,
    getItemProps,
    getContainerProps,
    focusActiveItem,
  } = useRovingTabIndex({
    items: flatItems,
    getId: (item, _index) => item.id,
    orientation: 'vertical',
    wrap: true,
    onActiveChange: handleActiveChange,
    onEnter: handleEnter,
    initialIndex: selectedIndex >= 0 ? selectedIndex : 0,
    enabled: rovingEnabled,
    moveFocus: !searchActive, // Keep focus on search input during search
  })

  // Sync activeIndex when selection changes externally
  useEffect(() => {
    const newIndex = flatItems.findIndex(item => item.id === session.selected)
    if (newIndex >= 0 && newIndex !== activeIndex) {
      setActiveIndex(newIndex)
    }
  }, [session.selected, flatItems, activeIndex, setActiveIndex])

  // Focus active item when zone gains focus (but not while search input is active)
  useEffect(() => {
    if (isFocused && flatItems.length > 0 && !searchActive) {
      focusActiveItem()
    }
  }, [isFocused, focusActiveItem, flatItems.length, searchActive])

  // Arrow key shortcuts for zone navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent, _item: SessionMeta) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusZone('sidebar')
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusZone('chat')
      return
    }
  }, [focusZone])

  const handleRenameClick = (sessionId: string, currentName: string) => {
    setRenameSessionId(sessionId)
    setRenameName(currentName)
    // Defer dialog open to next frame to let dropdown fully unmount first
    // This prevents race condition between dropdown's modal cleanup and dialog's modal setup
    requestAnimationFrame(() => {
      setRenameDialogOpen(true)
    })
  }

  const handleRenameSubmit = () => {
    if (renameSessionId && renameName.trim()) {
      onRename(renameSessionId, renameName.trim())
    }
    setRenameDialogOpen(false)
    setRenameSessionId(null)
    setRenameName("")
  }

  // Handle search input key events (Arrow keys handled by native listener above)
  // Note: Escape blurs the input but doesn't close search - only the X button closes it
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Escape: Blur the input but keep search visible
    if (e.key === 'Escape') {
      e.preventDefault()
      searchInputRef.current?.blur()
      return
    }

    // Enter: Focus the chat input (same as pressing Enter on a selected session)
    if (e.key === 'Enter') {
      e.preventDefault()
      onFocusChatInput?.()
      return
    }

    // Forward arrow keys to roving tabindex (search input is outside the container)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      getContainerProps().onKeyDown(e)
      return
    }
  }

  // Empty state - render outside ScrollArea for proper vertical centering
  // Don't show empty state if sessions exist inside collapsed project folders
  const hasSessionsInCollapsedProjects = hasProjects && projectGroups.some(pg => pg.totalCount > 0)
  if (flatItems.length === 0 && !searchActive && !hasSessionsInCollapsedProjects) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox />
          </EmptyMedia>
          <EmptyTitle>{t('sessionList.noConversationsYet')}</EmptyTitle>
          <EmptyDescription>
            {t('sessionList.noConversationsDesc')}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <button
            onClick={async () => {
              if (!workspaceId) return
              try {
                const session = await onCreateSession(workspaceId)
                navigate(routes.view.allChats(session.id))
              } catch (error) {
                console.error('[SessionList] Failed to create new session:', error)
              }
            }}
            className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
          >
            {t('sessionList.newConversation')}
          </button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Search header - input + status row (shared with playground) */}
      {searchActive && (
        <SessionSearchHeader
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onSearchClose={onSearchClose}
          onKeyDown={handleSearchKeyDown}
          onFocus={() => setIsSearchInputFocused(true)}
          onBlur={() => setIsSearchInputFocused(false)}
          isSearching={isSearchingContent}
          resultCount={matchingFilterItems.length + otherResultItems.length}
          exceededLimit={exceededSearchLimit}
          inputRef={searchInputRef}
        />
      )}
      {/* ScrollArea with mask-fade-top-short - shorter fade to avoid header overlap */}
      <DndContext
        sensors={dndSensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      <ScrollArea className="flex-1 select-none mask-fade-top-short">
        <div
          ref={zoneRef}
          className="flex flex-col pb-14 min-w-0"
          data-focus-zone="session-list"
          role="listbox"
          aria-label="Sessions"
        >
          {/* No results message when in search mode */}
          {isSearchMode && flatItems.length === 0 && !isSearchingContent && (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <p className="text-sm text-muted-foreground">{t('sessionList.noConversationsFound')}</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                {t('sessionList.searchedContent')}
              </p>
              <button
                onClick={() => onSearchChange?.('')}
                className="text-xs text-foreground hover:underline mt-2"
              >
                {t('sessionList.clearSearch')}
              </button>
            </div>
          )}

          {/* New Project button - shown in non-search mode when workspace is active */}
          {!isSearchMode && workspaceId && (
            <div className="px-4 py-1.5">
              <button
                onClick={() => setCreateProjectOpen(true)}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="h-3 w-3" />
                {t('projects.createNew')}
              </button>
            </div>
          )}

          {/* Search mode: flat list with two sections (In Current View + Other Conversations) */}
          {isSearchMode ? (
            <>
              {/* No results in current filter message */}
              {matchingFilterItems.length === 0 && otherResultItems.length > 0 && (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  {t('sessionList.noResultsInFilter')}
                </div>
              )}

              {/* Matching Filters section - flat list, no date grouping */}
              {matchingFilterItems.length > 0 && (
                <>
                  <SessionListSectionHeader label={t('sessionList.inCurrentView')} />
                  {matchingFilterItems.map((item, index) => {
                    const flatIndex = sessionIndexMap.get(item.id) ?? 0
                    const itemProps = getItemProps(item, flatIndex)
                    return (
                      <SessionItem
                        key={item.id}
                        item={item}
                        index={flatIndex}
                        itemProps={itemProps}
                        isSelected={session.selected === item.id}
                        isLast={flatIndex === flatItems.length - 1}
                        isFirstInGroup={index === 0}
                        onKeyDown={handleKeyDown}
                        onRenameClick={handleRenameClick}
                        onMarkUnread={onMarkUnread}
                        onDelete={handleDeleteWithToast}
                        onSelect={() => {
                          if (!currentFilter || currentFilter.kind === 'allChats') {
                            navigate(routes.view.allChats(item.id))
                          }
                          onSessionSelect?.(item)
                        }}
                        onOpenInNewWindow={() => onOpenInNewWindow?.(item)}
                        permissionMode={sessionOptions?.get(item.id)?.permissionMode}
                        searchQuery={highlightQuery}
                        projects={projects}
                        onProjectChange={handleProjectChangeWithExpand}
                        isDraggable={hasProjects}
                        chatMatchCount={isSearchMode ? contentSearchResults.get(item.id)?.matchCount : undefined}
                      />
                    )
                  })}
                </>
              )}

              {/* Other Matches section - flat list, no date grouping */}
              {otherResultItems.length > 0 && (
                <>
                  <SessionListSectionHeader label={t('sessionList.otherConversations')} />
                  {otherResultItems.map((item, index) => {
                    const flatIndex = sessionIndexMap.get(item.id) ?? 0
                    const itemProps = getItemProps(item, flatIndex)
                    return (
                      <SessionItem
                        key={item.id}
                        item={item}
                        index={flatIndex}
                        itemProps={itemProps}
                        isSelected={session.selected === item.id}
                        isLast={flatIndex === flatItems.length - 1}
                        isFirstInGroup={index === 0}
                        onKeyDown={handleKeyDown}
                        onRenameClick={handleRenameClick}
                        onMarkUnread={onMarkUnread}
                        onDelete={handleDeleteWithToast}
                        onSelect={() => {
                          if (!currentFilter || currentFilter.kind === 'allChats') {
                            navigate(routes.view.allChats(item.id))
                          }
                          onSessionSelect?.(item)
                        }}
                        onOpenInNewWindow={() => onOpenInNewWindow?.(item)}
                        permissionMode={sessionOptions?.get(item.id)?.permissionMode}
                        searchQuery={highlightQuery}
                        projects={projects}
                        onProjectChange={handleProjectChangeWithExpand}
                        isDraggable={hasProjects}
                        chatMatchCount={isSearchMode ? contentSearchResults.get(item.id)?.matchCount : undefined}
                      />
                    )
                  })}
                </>
              )}
            </>
          ) : hasProjects && projectGroups.length > 0 ? (
            /* Project-grouped mode: show projects as folders with date-grouped sessions inside */
            <>
              {projectGroups.map((pg) => (
                <div key={pg.projectId ?? '__uncategorized'}>
                  {/* Project header (named projects only) */}
                  {pg.project && (
                    <ProjectHeader
                      project={pg.project}
                      count={pg.totalCount}
                      expanded={expandedProjects.has(pg.projectId!)}
                      onToggle={() => toggleProject(pg.projectId!)}
                      onRename={() => {
                        setRenameProjectId(pg.projectId!)
                        setRenameProjectName(pg.project!.name)
                        requestAnimationFrame(() => setRenameProjectOpen(true))
                      }}
                      onDelete={() => handleDeleteProject(pg.projectId!)}
                    />
                  )}
                  {/* Uncategorized header (only when there are also project groups) */}
                  {pg.projectId === null && projectGroups.length > 1 && (
                    <SessionListSectionHeader label={t('projects.uncategorized')} />
                  )}
                  {/* Sessions: show if expanded or uncategorized */}
                  {(pg.projectId === null || expandedProjects.has(pg.projectId)) && (
                    pg.dateGroups.length > 0 ? (
                      pg.dateGroups.map((group) => (
                        <div key={group.date.toISOString()}>
                          <SessionListSectionHeader label={group.label} />
                          {group.sessions.map((item, indexInGroup) => {
                            const flatIndex = sessionIndexMap.get(item.id) ?? 0
                            const itemProps = getItemProps(item, flatIndex)
                            return (
                              <SessionItem
                                key={item.id}
                                item={item}
                                index={flatIndex}
                                itemProps={itemProps}
                                isSelected={session.selected === item.id}
                                isLast={flatIndex === flatItems.length - 1}
                                isFirstInGroup={indexInGroup === 0}
                                onKeyDown={handleKeyDown}
                                onRenameClick={handleRenameClick}
                                onMarkUnread={onMarkUnread}
                                onDelete={handleDeleteWithToast}
                                onSelect={() => {
                                  if (!currentFilter || currentFilter.kind === 'allChats') {
                                    navigate(routes.view.allChats(item.id))
                                  }
                                  onSessionSelect?.(item)
                                }}
                                onOpenInNewWindow={() => onOpenInNewWindow?.(item)}
                                permissionMode={sessionOptions?.get(item.id)?.permissionMode}
                                searchQuery={searchQuery}
                                projects={projects}
                                onProjectChange={handleProjectChangeWithExpand}
                                isDraggable={hasProjects}
                                chatMatchCount={contentSearchResults.get(item.id)?.matchCount}
                              />
                            )
                          })}
                        </div>
                      ))
                    ) : pg.projectId !== null ? (
                      /* Empty project hint */
                      <div className="px-8 py-3 text-xs text-muted-foreground/50">
                        {t('projects.emptyHint')}
                      </div>
                    ) : null
                  )}
                </div>
              ))}
            </>
          ) : (
            /* Normal mode (no projects): show date-grouped sessions */
            dateGroups.map((group) => (
              <div key={group.date.toISOString()}>
                <SessionListSectionHeader label={group.label} />
                {group.sessions.map((item, indexInGroup) => {
                  const flatIndex = sessionIndexMap.get(item.id) ?? 0
                  const itemProps = getItemProps(item, flatIndex)
                  return (
                    <SessionItem
                      key={item.id}
                      item={item}
                      index={flatIndex}
                      itemProps={itemProps}
                      isSelected={session.selected === item.id}
                      isLast={flatIndex === flatItems.length - 1}
                      isFirstInGroup={indexInGroup === 0}
                      onKeyDown={handleKeyDown}
                      onRenameClick={handleRenameClick}
                      onMarkUnread={onMarkUnread}
                      onDelete={handleDeleteWithToast}
                      onSelect={() => {
                        if (!currentFilter || currentFilter.kind === 'allChats') {
                          navigate(routes.view.allChats(item.id))
                        }
                        onSessionSelect?.(item)
                      }}
                      onOpenInNewWindow={() => onOpenInNewWindow?.(item)}
                      permissionMode={sessionOptions?.get(item.id)?.permissionMode}
                      searchQuery={searchQuery}
                      projects={projects}
                      onProjectChange={handleProjectChangeWithExpand}
                      isDraggable={hasProjects}
                      chatMatchCount={contentSearchResults.get(item.id)?.matchCount}
                    />
                  )
                })}
              </div>
            ))
          )}
          {/* Load more sentinel - triggers infinite scroll */}
          {hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              <Spinner className="text-muted-foreground" />
            </div>
          )}
        </div>
      </ScrollArea>
      <DragOverlay style={{ zIndex: 9999 }}>
        {dragSession ? (
          <div className="rounded-[8px] bg-background px-4 py-2 shadow-lg border border-border/50 text-sm font-medium truncate max-w-[240px]">
            {getSessionTitle(dragSession)}
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>

      {/* Rename Session Dialog */}
      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title={t('sessionList.renameConversation')}
        value={renameName}
        onValueChange={setRenameName}
        onSubmit={handleRenameSubmit}
        placeholder={t('sessionList.enterName')}
      />

      {/* Create Project Dialog */}
      <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>{t('projects.createNew')}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleCreateProject()
                }
              }}
              placeholder={t('projects.namePlaceholder')}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateProjectOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreateProject} disabled={!newProjectName.trim()}>
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Project Dialog */}
      <RenameDialog
        open={renameProjectOpen}
        onOpenChange={(open) => {
          setRenameProjectOpen(open)
          if (!open) {
            setRenameProjectId(null)
            setRenameProjectName('')
          }
        }}
        title={t('projects.rename')}
        value={renameProjectName}
        onValueChange={setRenameProjectName}
        onSubmit={handleRenameProject}
        placeholder={t('projects.namePlaceholder')}
      />
    </div>
  )
}

