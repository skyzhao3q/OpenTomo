import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MODE_I18N_KEYS, type SlashCommandId } from '@/components/ui/slash-command-menu'
import { ChevronDown, X, Check, Hand, Code2, Map, SlidersHorizontal } from 'lucide-react'
import { type PermissionMode } from '@opentomo/shared/agent/modes'
import { type ThinkingLevel } from '@opentomo/shared/agent/thinking-levels'
import { ActiveTasksBar, type BackgroundTask } from './ActiveTasksBar'


export interface ActiveOptionBadgesProps {
  /** Show design agent badge */
  designAgentEnabled?: boolean
  /** Callback when design agent is toggled off */
  onDesignAgentChange?: (enabled: boolean) => void
  /** Current permission mode */
  permissionMode?: PermissionMode
  /** Callback when permission mode changes */
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** Background tasks to display */
  tasks?: BackgroundTask[]
  /** Session ID for opening preview windows */
  sessionId?: string
  /** Callback when kill button is clicked on a task */
  onKillTask?: (taskId: string) => void
  /** Callback to insert message into input field */
  onInsertMessage?: (text: string) => void
  /** Additional CSS classes */
  className?: string
}

export function ActiveOptionBadges({
  designAgentEnabled = false,
  onDesignAgentChange,
  permissionMode = 'ask',
  onPermissionModeChange,
  tasks = [],
  sessionId,
  onKillTask,
  onInsertMessage,
  className,
}: ActiveOptionBadgesProps) {
  const { t } = useTranslation()

  // Only render if badges or tasks are active
  if (!designAgentEnabled && tasks.length === 0) {
    return null
  }

  return (
    <div className={cn("flex items-start gap-2 mb-2 px-px pt-px pb-0.5", className)}>
      {/* Design Agent Badge */}
      {designAgentEnabled && (
        <button
          type="button"
          onClick={() => onDesignAgentChange?.(false)}
          className="h-[30px] pl-2.5 pr-2 text-xs font-medium rounded-[8px] flex items-center gap-1.5 shrink-0 transition-all bg-emerald-500/10 hover:bg-emerald-500/15 shadow-tinted outline-none select-none"
          style={{ '--shadow-color': '16, 185, 129' } as React.CSSProperties}
        >
          <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          <span className="text-emerald-500">
            {t('modes.designAgent', 'Design Agent')}
          </span>
          <X className="h-3 w-3 text-emerald-500 opacity-60 hover:opacity-100 translate-y-px" />
        </button>
      )}
    </div>
  )
}

// ============================================================================
// Permission Mode Dropdown Component
// ============================================================================

interface PermissionModeDropdownProps {
  permissionMode: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** When true, uses compact sizing (h-7) to fit in the bottom action bar */
  compact?: boolean
  /** Current thinking level — when provided, shows the Effort toggle */
  thinkingLevel?: ThinkingLevel
  onThinkingLevelChange?: (level: ThinkingLevel) => void
}

export function PermissionModeDropdown({
  permissionMode,
  onPermissionModeChange,
  compact = false,
  thinkingLevel,
  onThinkingLevelChange,
}: PermissionModeDropdownProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  // Optimistic local state - updates immediately, syncs with prop
  const [optimisticMode, setOptimisticMode] = React.useState(permissionMode)

  // Sync optimistic state when prop changes (confirmation from backend)
  React.useEffect(() => {
    setOptimisticMode(permissionMode)
  }, [permissionMode])

  // Handle mode selection
  const handleSelect = React.useCallback((commandId: SlashCommandId) => {
    if (commandId === 'safe' || commandId === 'ask' || commandId === 'allow-all') {
      setOptimisticMode(commandId)
      onPermissionModeChange?.(commandId)
    }
    setOpen(false)
  }, [onPermissionModeChange])

  // Mode-specific styling for the trigger button
  const modeStyles: Record<PermissionMode, { className: string; shadowVar: string }> = {
    'safe': {
      className: 'bg-foreground/5 text-foreground/60',
      shadowVar: 'var(--foreground-rgb)',
    },
    'ask': {
      className: 'bg-info/10 text-info',
      shadowVar: 'var(--info-rgb)',
    },
    'allow-all': {
      className: 'bg-accent/5 text-accent',
      shadowVar: 'var(--accent-rgb)',
    },
  }
  const currentStyle = modeStyles[optimisticMode]

  // Icon for the trigger button (matches popup menu icons)
  const TRIGGER_MODE_ICON: Record<PermissionMode, React.ReactNode> = {
    ask:         <Hand className="h-3.5 w-3.5" />,
    'allow-all': <Code2 className="h-3.5 w-3.5" />,
    safe:        <Map className="h-3.5 w-3.5" />,
  }

  // Mode list for the popover (order: ask → allow-all → safe)
  const POPUP_MODES = [
    {
      mode: 'ask' as PermissionMode,
      icon: <Hand className="h-4 w-4" />,
      label: t('modes.askBeforeEditsLabel', 'Ask before edits'),
      desc: t('modes.askBeforeEditsDesc', 'Agent will ask for approval before making each edit'),
    },
    {
      mode: 'allow-all' as PermissionMode,
      icon: <Code2 className="h-4 w-4" />,
      label: t('modes.editAutomaticallyLabel', 'Edit automatically'),
      desc: t('modes.editAutomaticallyDesc', 'Agent will edit your selected text or the whole file'),
    },
    {
      mode: 'safe' as PermissionMode,
      icon: <Map className="h-4 w-4" />,
      label: t('modes.planModeLabel', 'Plan mode'),
      desc: t('modes.planModeDesc', 'Agent will explore the code and present a plan before editing'),
    },
  ]

  // Trigger button long-form label
  const triggerLabel: Record<PermissionMode, string> = {
    ask:         t('modes.askBeforeEditsLabel',   'Ask before edits'),
    'allow-all': t('modes.editAutomaticallyLabel', 'Edit automatically'),
    safe:        t('modes.planModeLabel',          'Plan mode'),
  }

  // Effort levels for the 3-dot control
  const EFFORT_LEVELS = [
    { level: 'off'   as ThinkingLevel, labelKey: 'modes.effortLow',    defaultLabel: 'Low' },
    { level: 'think' as ThinkingLevel, labelKey: 'modes.effortMedium', defaultLabel: 'Medium' },
    { level: 'max'   as ThinkingLevel, labelKey: 'modes.effortHigh',   defaultLabel: 'High' },
  ]
  const currentEffortEntry = EFFORT_LEVELS.find(e => e.level === thinkingLevel) ?? EFFORT_LEVELS[1]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-tutorial="permission-mode-dropdown"
          className={cn(
            compact ? "h-7 rounded-[6px]" : "h-[30px] rounded-[8px]",
            "pl-2.5 pr-2 text-xs font-medium flex items-center gap-1.5 shadow-tinted outline-none select-none",
            currentStyle.className
          )}
          style={{ '--shadow-color': currentStyle.shadowVar } as React.CSSProperties}
        >
          {TRIGGER_MODE_ICON[optimisticMode]}
          <span>{triggerLabel[optimisticMode]}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0 bg-background/80 backdrop-blur-xl backdrop-saturate-150 border-border/50"
        side="top"
        align="start"
        sideOffset={4}
        style={{ borderRadius: '10px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)' }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('ss:focus-input'))
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
          <span className="text-xs font-semibold text-muted-foreground select-none">
            {t('modes.modesHeader', 'Modes')}
          </span>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground select-none">
            <kbd className="px-1 py-px rounded border border-border/60 font-mono bg-foreground/5">⇧</kbd>
            <span>+</span>
            <kbd className="px-1 py-px rounded border border-border/60 font-mono bg-foreground/5">tab</kbd>
            <span className="ml-0.5">to switch</span>
          </div>
        </div>

        {/* Mode list */}
        <div className="p-1.5 flex flex-col gap-0.5">
          {POPUP_MODES.map(({ mode, icon, label, desc }) => {
            const isSelected = mode === optimisticMode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => handleSelect(mode as SlashCommandId)}
                className={cn(
                  "w-full flex items-start gap-3 rounded-[8px] px-3 py-2.5 text-left transition-colors select-none outline-none",
                  isSelected
                    ? "bg-blue-600 text-white"
                    : "hover:bg-foreground/5 text-foreground"
                )}
              >
                <span className={cn("mt-0.5 shrink-0", isSelected ? "opacity-90" : "text-muted-foreground")}>
                  {icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold leading-tight">{label}</div>
                  <div className={cn("text-xs leading-tight mt-0.5", isSelected ? "text-white/70" : "text-muted-foreground")}>
                    {desc}
                  </div>
                </div>
                {isSelected && <Check className="h-4 w-4 shrink-0 mt-0.5 opacity-80" />}
              </button>
            )
          })}
        </div>

        {/* Effort section - shown when thinkingLevel props are provided */}
        {thinkingLevel !== undefined && onThinkingLevelChange && (
          <>
            <div className="border-t border-border/50 mx-1.5" />
            <div className="px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-sm">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium">{t('modes.effort', 'Effort')}</span>
                <span className="text-muted-foreground text-xs">
                  ({t(currentEffortEntry.labelKey, currentEffortEntry.defaultLabel)})
                </span>
              </div>
              <div className="flex items-center gap-1.5 bg-foreground/10 rounded-full px-2 py-1.5">
                {EFFORT_LEVELS.map(({ level }) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => onThinkingLevelChange(level)}
                    className={cn(
                      "h-2.5 w-2.5 rounded-full transition-all outline-none",
                      level === thinkingLevel
                        ? "bg-foreground scale-110"
                        : "bg-foreground/25 hover:bg-foreground/40"
                    )}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

