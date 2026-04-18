import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Command as CommandPrimitive } from 'cmdk'
import { toast } from 'sonner'
import {
  Paperclip,
  Send,
  Square,
  Check,
  ChevronDown,
  Folder,
} from 'lucide-react'
import { Icon_Folder } from '@opentomo/ui'

import * as storage from '@/lib/local-storage'

import { Button } from '@/components/ui/button'
import {
  InlineSlashCommand,
  useInlineSlashCommand,
  type SlashCommandId,
} from '@/components/ui/slash-command-menu'
import {
  InlineMentionMenu,
  useInlineMention,
  type MentionItem,
  type MentionItemType,
} from '@/components/ui/mention-menu'
import { parseMentions } from '@/lib/mentions'
import { RichTextInput, type RichTextInputHandle } from '@/components/ui/rich-text-input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@opentomo/ui'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from '@/components/ui/styled-dropdown'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { isMac, PATH_SEP, getPathBasename } from '@/lib/platform'
import { applySmartTypography } from '@/lib/smart-typography'
import { AttachmentPreview } from '../AttachmentPreview'
import { getModelsForProvider, getModelShortName, getModelContextWindow, isClaudeModel } from '@config/models'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { FreeFormInputContextBadge } from './FreeFormInputContextBadge'
import { PermissionModeDropdown } from '@/components/app-shell/ActiveOptionBadges'
import type { FileAttachment, LoadedSkill } from '../../../../shared/types'
import type { PermissionMode } from '@opentomo/shared/agent/modes'
import { PERMISSION_MODE_ORDER } from '@opentomo/shared/agent/modes'
import { type ThinkingLevel, THINKING_LEVELS, getThinkingLevelName } from '@opentomo/shared/agent/thinking-levels'
import { useEscapeInterrupt } from '@/context/EscapeInterruptContext'
import { hasOpenOverlay } from '@/lib/overlay-detection'
import { EscapeInterruptOverlay } from './EscapeInterruptOverlay'

/**
 * Circular arc progress icon for context usage indicator
 */
function ContextRingIcon({ percent }: { percent: number }) {
  const r = 7
  const circ = 2 * Math.PI * r
  const dash = (percent / 100) * circ
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" className="shrink-0" aria-hidden="true">
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <circle
        cx="9" cy="9" r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 9 9)"
      />
    </svg>
  )
}



export interface FreeFormInputProps {
  /** Placeholder text(s) for the textarea - can be array for rotation */
  placeholder?: string | string[]
  /** Whether input is disabled */
  disabled?: boolean
  /** Whether the session is currently processing */
  isProcessing?: boolean
  /** Callback when message is submitted (skillSlugs from @mentions) */
  onSubmit: (message: string, attachments?: FileAttachment[], skillSlugs?: string[]) => void
  /** Callback to stop processing. Pass silent=true to skip "Response interrupted" message */
  onStop?: (silent?: boolean) => void
  /** External ref for the input */
  inputRef?: React.RefObject<RichTextInputHandle>
  /** Current model ID */
  currentModel: string
  /** Callback when model changes */
  onModelChange: (model: string) => void
  // Thinking level (session-level setting)
  /** Current thinking level ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel
  /** Callback when thinking level changes */
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  // Advanced options
  designAgentEnabled?: boolean
  onDesignAgentChange?: (enabled: boolean) => void
  permissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** Enabled permission modes for Shift+Tab cycling (min 2 modes) */
  enabledModes?: PermissionMode[]
  // Controlled input value (for persisting across mode switches and conversation changes)
  /** Current input value - if provided, component becomes controlled */
  inputValue?: string
  /** Callback when input value changes */
  onInputChange?: (value: string) => void
  /** When true, removes container styling (shadow, bg, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
  /** Callback when component height changes (for external animation sync) */
  onHeightChange?: (height: number) => void
  /** Callback when focus state changes */
  onFocusChange?: (focused: boolean) => void
  // Skill selection (for @mentions)
  /** Available skills for @mention autocomplete */
  skills?: LoadedSkill[]
  /** Workspace ID for loading skill icons */
  workspaceId?: string
  /** Current working directory path */
  workingDirectory?: string
  /** Callback when working directory changes */
  onWorkingDirectoryChange?: (path: string) => void
  /** Session folder path (for "Reset to Session Root" option) */
  sessionFolderPath?: string
  /** Session ID for scoping events like approve-plan */
  sessionId?: string
  /** Current todo state of the session (for # menu state selection) */
  currentTodoState?: string
  /** Disable send action (for tutorial guidance) */
  disableSend?: boolean
  /** Whether the session is empty (no messages yet) - affects context badge prominence */
  isEmptySession?: boolean
  /** Context status for showing compaction indicator and token usage */
  contextStatus?: {
    /** True when SDK is actively compacting the conversation */
    isCompacting?: boolean
    /** Input tokens used so far in this session */
    inputTokens?: number
    /** Model's context window size in tokens */
    contextWindow?: number
  }
  /** Enable compact mode - hides attach, sources, working directory for popover embedding */
  compactMode?: boolean
}

/**
 * FreeFormInput - Self-contained textarea input with attachments and controls
 *
 * Features:
 * - Auto-growing textarea
 * - File attachments via button or drag-drop
 * - Slash commands menu
 * - Model selector
 * - Active option badges
 */
export function FreeFormInput({
  placeholder,
  disabled = false,
  isProcessing = false,
  onSubmit,
  onStop,
  inputRef: externalInputRef,
  currentModel,
  onModelChange,
  thinkingLevel = 'think',
  onThinkingLevelChange,
  designAgentEnabled = false,
  onDesignAgentChange,
  permissionMode = 'ask',
  onPermissionModeChange,
  enabledModes = ['safe', 'ask', 'allow-all'],
  inputValue,
  onInputChange,
  unstyled = false,
  onHeightChange,
  onFocusChange,
  skills = [],
  workspaceId,
  workingDirectory,
  onWorkingDirectoryChange,
  sessionFolderPath,
  sessionId,
  currentTodoState,
  disableSend = false,
  isEmptySession = false,
  contextStatus,
  compactMode = false,
}: FreeFormInputProps) {
  const { t } = useTranslation()

  // Read custom model, provider, and workspace info from context.
  // Uses optional variant so playground (no provider) doesn't crash.
  const appShellCtx = useOptionalAppShellContext()
  const customModel = appShellCtx?.customModel ?? null
  const customConnectionModels = appShellCtx?.customConnectionModels ?? null
  const provider = appShellCtx?.provider ?? 'opentomo'
  // Get models for current provider
  const activeModels = React.useMemo(() => getModelsForProvider(provider), [provider])
  // Build tier model options from the active connection (best, balanced, fast)
  const tierModelOptions = React.useMemo(() => {
    if (!customConnectionModels) return null
    const tiers = [
      { key: 'best' as const,     label: 'Best · most capable' },
      { key: 'balanced' as const, label: 'Balanced · everyday use' },
      { key: 'fast' as const,     label: 'Fast · summarization & utility' },
    ]
    // Always keep all 3 tiers as separate entries (even when modelIds overlap).
    // Use tierKey (not modelId) as the React key to avoid duplicate-key warnings.
    const options = tiers
      .filter(({ key }) => Boolean(customConnectionModels[key]))
      .map(({ key, label }) => ({ tierKey: key, modelId: customConnectionModels[key]!, label }))
    return options.length > 0 ? options : null
  }, [customConnectionModels])
  // Resolve workspace rootPath for "Add New Label" deep link
  const workspaceRootPath = React.useMemo(() => {
    if (!appShellCtx || !workspaceId) return null
    return appShellCtx.workspaces.find(w => w.id === workspaceId)?.rootPath ?? null
  }, [appShellCtx, workspaceId])

  // Compute workspace slug from rootPath for SDK skill qualification
  // SDK expects "workspaceSlug:skillSlug" format, NOT UUID
  const workspaceSlug = React.useMemo(() => {
    if (!workspaceRootPath) return workspaceId // Fallback to ID if no path
    const pathParts = workspaceRootPath.split('/').filter(Boolean)
    return pathParts[pathParts.length - 1] || workspaceId
  }, [workspaceRootPath, workspaceId])

  // Performance optimization: Always use internal state for typing to avoid parent re-renders
  // Sync FROM parent on mount/change (for restoring drafts)
  // Sync TO parent on blur/submit (debounced persistence)
  const [input, setInput] = React.useState(inputValue ?? '')
  const [attachments, setAttachments] = React.useState<FileAttachment[]>([])
  // Ref to track current attachments for use in event handlers (avoids stale closure issues)
  const attachmentsRef = React.useRef<FileAttachment[]>([])
  React.useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  // Sync from parent when inputValue changes externally (e.g., switching sessions)
  const prevInputValueRef = React.useRef(inputValue)
  React.useEffect(() => {
    if (inputValue !== undefined && inputValue !== prevInputValueRef.current) {
      setInput(inputValue)
      prevInputValueRef.current = inputValue
    }
  }, [inputValue])

  // Debounced sync to parent (saves draft without blocking typing)
  const syncTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const syncToParent = React.useCallback((value: string) => {
    if (!onInputChange) return
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    syncTimeoutRef.current = setTimeout(() => {
      onInputChange(value)
      prevInputValueRef.current = value
    }, 300) // Debounce 300ms
  }, [onInputChange])

  // Sync immediately on unmount to preserve input across mode switches
  // Also cleanup any pending debounced sync
  const inputRef = React.useRef(input)
  inputRef.current = input // Keep ref in sync with state

  React.useEffect(() => {
    return () => {
      // Cancel pending debounced sync
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
      // Immediately sync current value to parent on unmount
      // This preserves input when switching to structured input (e.g., permission request)
      if (onInputChange && inputRef.current !== prevInputValueRef.current) {
        onInputChange(inputRef.current)
      }
    }
  }, [onInputChange])

  const [isDraggingOver, setIsDraggingOver] = React.useState(false)
  const [loadingCount, setLoadingCount] = React.useState(0)
  const [isFocused, setIsFocused] = React.useState(false)
  const [inputMaxHeight, setInputMaxHeight] = React.useState(540)
  const [modelDropdownOpen, setModelDropdownOpen] = React.useState(false)
  // Track which tier is selected for custom connections
  // (needed when multiple tiers share the same modelId)
  const [selectedTierKey, setSelectedTierKey] = React.useState<'best' | 'balanced' | 'fast' | null>(null)

  // Input settings (loaded from config)
  const [autoCapitalisation, setAutoCapitalisation] = React.useState(true)
  const [sendMessageKey, setSendMessageKey] = React.useState<'enter' | 'cmd-enter'>('enter')
  const [spellCheck, setSpellCheck] = React.useState(false)

  // Load input settings on mount
  React.useEffect(() => {
    const loadInputSettings = async () => {
      if (!window.electronAPI) return
      try {
        const [autoCapEnabled, sendKey, spellCheckEnabled] = await Promise.all([
          window.electronAPI.getAutoCapitalisation(),
          window.electronAPI.getSendMessageKey(),
          window.electronAPI.getSpellCheck(),
        ])
        setAutoCapitalisation(autoCapEnabled)
        setSendMessageKey(sendKey)
        setSpellCheck(spellCheckEnabled)
      } catch (error) {
        console.error('Failed to load input settings:', error)
      }
    }
    loadInputSettings()
  }, [])

  // Double-Esc interrupt: show warning overlay on first Esc, interrupt on second
  const { showEscapeOverlay } = useEscapeInterrupt()

  // Calculate max height: min(66% of window height, 540px)
  React.useEffect(() => {
    const updateMaxHeight = () => {
      const maxFromWindow = Math.floor(window.innerHeight * 0.66)
      setInputMaxHeight(Math.min(maxFromWindow, 540))
    }
    updateMaxHeight()
    window.addEventListener('resize', updateMaxHeight)
    return () => window.removeEventListener('resize', updateMaxHeight)
  }, [])

  // Sync selectedTierKey when tierModelOptions or currentModel changes externally
  // (e.g. after switching provider in settings)
  React.useEffect(() => {
    if (!tierModelOptions) {
      setSelectedTierKey(null)
      return
    }
    // If current selection is still valid for the current model, keep it
    const currentTierValid = selectedTierKey != null &&
      tierModelOptions.find(t => t.tierKey === selectedTierKey)?.modelId === currentModel
    if (currentTierValid) return
    // Re-derive: prefer balanced > best > fast
    for (const key of ['balanced', 'best', 'fast'] as const) {
      const opt = tierModelOptions.find(t => t.tierKey === key)
      if (opt && opt.modelId === currentModel) {
        setSelectedTierKey(key)
        return
      }
    }
    // No tier matches currentModel — fall back to balanced (or first available)
    const fallback = (['balanced', 'best', 'fast'] as const).find(k =>
      tierModelOptions.some(t => t.tierKey === k)
    )
    setSelectedTierKey(fallback ?? null)
  }, [tierModelOptions, currentModel]) // eslint-disable-line react-hooks/exhaustive-deps -- selectedTierKey intentionally excluded to avoid loop

  const dragCounterRef = React.useRef(0)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Merge refs for RichTextInput
  const internalInputRef = React.useRef<RichTextInputHandle>(null)
  const richInputRef = externalInputRef || internalInputRef

  // Track last caret position for focus restoration (e.g., after permission mode popover closes)
  const lastCaretPositionRef = React.useRef<number | null>(null)

  // Listen for ss:insert-text events (generic mechanism for inserting text into input)
  // Used by components that want to pre-fill the input with text
  React.useEffect(() => {
    const handleInsertText = (e: CustomEvent<{ text: string }>) => {
      const { text } = e.detail
      setInput(text)
      syncToParent(text)
      // Focus the input after inserting
      setTimeout(() => {
        richInputRef.current?.focus()
        // Move cursor to end
        richInputRef.current?.setSelectionRange(text.length, text.length)
      }, 0)
    }

    window.addEventListener('ss:insert-text', handleInsertText as EventListener)
    return () => window.removeEventListener('ss:insert-text', handleInsertText as EventListener)
  }, [syncToParent, richInputRef])

  // Listen for ss:approve-plan events (used by ResponseCard's Accept Plan button)
  // This disables safe mode AND submits the message in one action
  // Only process events for this session (sessionId must match)
  React.useEffect(() => {
    const handleApprovePlan = (e: CustomEvent<{ text?: string; sessionId?: string }>) => {
      // Only handle if this event is for our session
      if (e.detail?.sessionId && e.detail.sessionId !== sessionId) {
        return
      }
      const text = e.detail?.text
      if (!text) {
        toast.error('No details provided')
        return
      }
      // Switch to allow-all (Auto) mode if in Explore mode (allow execution without prompts)
      // Only switch if currently in safe mode - if user is in 'ask' mode, respect their choice
      if (permissionMode === 'safe') {
        onPermissionModeChange?.('allow-all')
      }
      // Submit the message
      onSubmit(text, undefined)
    }

    window.addEventListener('ss:approve-plan', handleApprovePlan as EventListener)
    return () => window.removeEventListener('ss:approve-plan', handleApprovePlan as EventListener)
  }, [sessionId, permissionMode, onPermissionModeChange, onSubmit])

  // Listen for ss:approve-plan-with-compact events (Accept & Compact option)
  // This compacts the conversation first, then executes the plan.
  // The pending state is persisted to survive page reloads (CMD+R).
  React.useEffect(() => {
    const handleApprovePlanWithCompact = async (e: CustomEvent<{ sessionId?: string; planPath?: string }>) => {
      // Only handle if this event is for our session
      if (e.detail?.sessionId && e.detail.sessionId !== sessionId) {
        return
      }

      const planPath = e.detail?.planPath

      // Switch to allow-all (Auto) mode if in Explore mode
      if (permissionMode === 'safe') {
        onPermissionModeChange?.('allow-all')
      }

      // Persist the pending plan execution state BEFORE sending /compact.
      // This allows reload recovery if CMD+R happens during compaction.
      if (planPath && sessionId) {
        await window.electronAPI.sessionCommand(sessionId, {
          type: 'setPendingPlanExecution',
          planPath,
        })
      }

      // Send /compact to trigger compaction
      onSubmit('/compact', undefined)

      // Set up a one-time listener for compaction complete.
      // This handles the normal case (no reload during compaction).
      const handleCompactionComplete = async (compactEvent: CustomEvent<{ sessionId?: string }>) => {
        // Only handle if this is for our session
        if (compactEvent.detail?.sessionId !== sessionId) {
          return
        }

        // Remove the listener (one-time use)
        window.removeEventListener('ss:compaction-complete', handleCompactionComplete as unknown as EventListener)

        // Send the execution message with explicit plan path
        // After compaction, Claude doesn't automatically remember the plan file
        if (planPath) {
          onSubmit(`Read the plan at ${planPath} and execute it.`, undefined)
        } else {
          onSubmit('Plan approved, please execute.', undefined)
        }

        // Clear the pending state since we just sent the execution message
        if (sessionId) {
          await window.electronAPI.sessionCommand(sessionId, {
            type: 'clearPendingPlanExecution',
          })
        }
      }

      window.addEventListener('ss:compaction-complete', handleCompactionComplete as unknown as EventListener)
    }

    window.addEventListener('ss:approve-plan-with-compact', handleApprovePlanWithCompact as unknown as EventListener)
    return () => window.removeEventListener('ss:approve-plan-with-compact', handleApprovePlanWithCompact as unknown as EventListener)
  }, [sessionId, permissionMode, onPermissionModeChange, onSubmit])

  // Reload recovery: Check for pending plan execution on mount.
  // If the page reloaded after compaction completed (awaitingCompaction = false),
  // we need to send the plan execution message that was interrupted by the reload.
  // Also listen for compaction-complete in case CMD+R happened during compaction.
  React.useEffect(() => {
    if (!sessionId) return

    let hasExecuted = false

    const executePendingPlan = async () => {
      if (hasExecuted) return

      const pending = await window.electronAPI.getPendingPlanExecution(sessionId)
      if (!pending || pending.awaitingCompaction) return

      // Compaction completed but we never sent the execution message (page reloaded).
      // Send it now and clear the pending state.
      hasExecuted = true
      console.log('[FreeFormInput] Resuming pending plan execution after reload:', pending.planPath)
      onSubmit(`Read the plan at ${pending.planPath} and execute it.`, undefined)

      await window.electronAPI.sessionCommand(sessionId, {
        type: 'clearPendingPlanExecution',
      })
    }

    // Check immediately on mount (handles case where compaction already completed)
    executePendingPlan()

    // Also listen for compaction-complete in case CMD+R happened during compaction.
    // When compaction finishes after reload, this listener will trigger execution.
    const handleCompactionComplete = async (e: CustomEvent<{ sessionId: string }>) => {
      if (e.detail?.sessionId !== sessionId) return
      // Small delay to ensure markCompactionComplete has been called
      await new Promise(resolve => setTimeout(resolve, 100))
      executePendingPlan()
    }

    window.addEventListener('ss:compaction-complete', handleCompactionComplete as unknown as EventListener)
    return () => {
      window.removeEventListener('ss:compaction-complete', handleCompactionComplete as unknown as EventListener)
    }
  }, [sessionId, onSubmit])

  // Listen for ss:focus-input events (restore focus after popover/dropdown closes)
  React.useEffect(() => {
    const handleFocusInput = () => {
      richInputRef.current?.focus()
      // Restore caret position if saved, then clear it (one-shot)
      if (lastCaretPositionRef.current !== null) {
        richInputRef.current?.setSelectionRange(
          lastCaretPositionRef.current,
          lastCaretPositionRef.current
        )
        lastCaretPositionRef.current = null
      }
    }

    window.addEventListener('ss:focus-input', handleFocusInput)
    return () => window.removeEventListener('ss:focus-input', handleFocusInput)
  }, [richInputRef])

  // Get the next available number for a pasted file prefix (e.g., pasted-image-1, pasted-image-2)
  const getNextPastedNumber = (
    prefix: 'image' | 'text' | 'file',
    existingAttachments: FileAttachment[]
  ): number => {
    const pattern = new RegExp(`^pasted-${prefix}-(\\d+)\\.`)
    let maxNum = 0
    for (const att of existingAttachments) {
      const match = att.name.match(pattern)
      if (match) {
        maxNum = Math.max(maxNum, parseInt(match[1], 10))
      }
    }
    return maxNum + 1
  }

  // Listen for ss:paste-files events (for global paste when input not focused)
  React.useEffect(() => {
    const handlePasteFiles = async (e: CustomEvent<{ files: File[] }>) => {
      if (disabled) return

      const { files } = e.detail
      if (!files || files.length === 0) return

      setLoadingCount(prev => prev + files.length)

      // Pre-assign sequential names using ref to avoid race conditions
      let nextImageNum = getNextPastedNumber('image', attachmentsRef.current)
      const fileNames: string[] = files.map(file => {
        if (!file.name || file.name === 'image.png' || file.name === 'image.jpg' || file.name === 'blob') {
          const ext = file.type.split('/')[1] || 'png'
          return `pasted-image-${nextImageNum++}.${ext}`
        }
        return file.name
      })

      for (let i = 0; i < files.length; i++) {
        try {
          const attachment = await readFileAsAttachment(files[i], fileNames[i])
          if (attachment) {
            setAttachments(prev => [...prev, attachment])
          }
        } catch (error) {
          console.error('[FreeFormInput] Failed to process pasted file:', error)
        }
        setLoadingCount(prev => prev - 1)
      }

      // Focus the input after adding attachments
      richInputRef.current?.focus()
    }

    window.addEventListener('ss:paste-files', handlePasteFiles as unknown as EventListener)
    return () => window.removeEventListener('ss:paste-files', handlePasteFiles as unknown as EventListener)
  }, [disabled, richInputRef])

  // Build active commands list for slash command menu
  const activeCommands = React.useMemo(() => {
    const active: SlashCommandId[] = []
    // Add the currently active permission mode
    if (permissionMode === 'safe') active.push('safe')
    else if (permissionMode === 'ask') active.push('ask')
    else if (permissionMode === 'allow-all') active.push('allow-all')
    if (designAgentEnabled) active.push('design-agent' as SlashCommandId)
    return active
  }, [permissionMode, designAgentEnabled])

  // Handle slash command selection (mode/feature commands)
  const handleSlashCommand = React.useCallback((commandId: SlashCommandId) => {
    if (commandId === 'safe') onPermissionModeChange?.('safe')
    else if (commandId === 'ask') onPermissionModeChange?.('ask')
    else if (commandId === 'allow-all') onPermissionModeChange?.('allow-all')
  }, [permissionMode, onPermissionModeChange])

  // Handle folder selection from slash command menu
  const handleSlashFolderSelect = React.useCallback((path: string) => {
    if (onWorkingDirectoryChange) {
      addRecentDir(path)
      setRecentFolders(getRecentDirs())
      onWorkingDirectoryChange(path)
    }
  }, [onWorkingDirectoryChange])

  // Get recent folders and home directory for slash menu and mention menu
  const [recentFolders, setRecentFolders] = React.useState<string[]>([])
  const [homeDir, setHomeDir] = React.useState<string>('')

  React.useEffect(() => {
    setRecentFolders(getRecentDirs())
    window.electronAPI?.getHomeDir?.().then((dir: string) => {
      if (dir) setHomeDir(dir)
    })
  }, [])

  // Inline slash command hook (modes, features, folders, and commands)
  const inlineSlash = useInlineSlashCommand({
    inputRef: richInputRef,
    onSelectCommand: handleSlashCommand,
    onSelectFolder: handleSlashFolderSelect,
    activeCommands,
    recentFolders,
    homeDir,
  })

  // Handle mention selection (skills, files)
  const handleMentionSelect = React.useCallback((_item: MentionItem) => {
    // Files via @ mention: [file:path] in text is sufficient context for the agent.
    // Skills also don't need special handling beyond text insertion.
  }, [])

  // Inline mention hook (for skills and files)
  const inlineMention = useInlineMention({
    inputRef: richInputRef,
    skills,
    basePath: workingDirectory,
    onSelect: handleMentionSelect,
    // Use workspace slug (not UUID) for SDK skill qualification
    workspaceId: workspaceSlug,
  })

  // Report height changes to parent (for external animation sync)
  React.useLayoutEffect(() => {
    if (!onHeightChange || !containerRef.current) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        onHeightChange(entry.contentRect.height)
      }
    })

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [onHeightChange])

  // In compact mode, immediately report collapsed height when processing state changes
  // This ensures smooth animation timing when input collapses/expands
  React.useEffect(() => {
    if (!onHeightChange || !compactMode) return
    if (isProcessing) {
      // Collapsed state - only bottom bar visible (~44px)
      onHeightChange(44)
    }
    // When not processing, ResizeObserver will report the full height
  }, [compactMode, isProcessing, onHeightChange])

  // Check if running in Electron environment (has electronAPI)
  const hasElectronAPI = typeof window !== 'undefined' && !!window.electronAPI

  // File attachment handlers
  const handleAttachClick = async () => {
    if (disabled || !hasElectronAPI) return
    try {
      const attachments = await window.electronAPI.openAndReadFileAttachments()
      if (attachments.length > 0) {
        setAttachments(prev => [...prev, ...attachments])
      }
    } catch (error) {
      console.error('[FreeFormInput] Failed to attach files:', error)
      toast.error('Failed to attach files')
    }
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  // Helper to read a File using FileReader API
  const readFileAsAttachment = async (file: File, overrideName?: string): Promise<FileAttachment | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const result = reader.result as ArrayBuffer
        const base64 = btoa(
          new Uint8Array(result).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )

        let type: FileAttachment['type'] = 'unknown'
        const fileName = overrideName || file.name
        if (file.type.startsWith('image/')) type = 'image'
        else if (file.type === 'application/pdf') type = 'pdf'
        else if (file.type.includes('text') || fileName.match(/\.(txt|md|json|js|ts|tsx|py|css|html)$/i)) type = 'text'
        else if (file.type.includes('officedocument') || fileName.match(/\.(docx?|xlsx?|pptx?)$/i)) type = 'office'

        const mimeType = file.type || 'application/octet-stream'

        // For text files, decode the ArrayBuffer as UTF-8 text
        let text: string | undefined
        if (type === 'text') {
          text = new TextDecoder('utf-8').decode(new Uint8Array(result))
        }

        let thumbnailBase64: string | undefined
        if (hasElectronAPI) {
          try {
            const thumb = await window.electronAPI.generateThumbnail(base64, mimeType)
            if (thumb) thumbnailBase64 = thumb
          } catch (err) {
            console.log('[FreeFormInput] Thumbnail generation failed:', err)
          }
        }

        resolve({
          type,
          path: fileName,
          name: fileName,
          mimeType,
          base64,
          text,
          size: file.size,
          thumbnailBase64,
        })
      }
      reader.onerror = () => resolve(null)
      reader.readAsArrayBuffer(file)
    })
  }

  // Clipboard paste handler for files/images
  const handlePaste = async (e: React.ClipboardEvent) => {
    if (disabled) return

    const clipboardItems = e.clipboardData?.files
    if (!clipboardItems || clipboardItems.length === 0) return

    // We have files to process - prevent default text paste behavior
    e.preventDefault()

    const files = Array.from(clipboardItems)
    setLoadingCount(prev => prev + files.length)

    // Pre-assign sequential names using ref to avoid race conditions
    let nextImageNum = getNextPastedNumber('image', attachmentsRef.current)
    const fileNames: string[] = files.map(file => {
      if (!file.name || file.name === 'image.png' || file.name === 'image.jpg' || file.name === 'blob') {
        const ext = file.type.split('/')[1] || 'png'
        return `pasted-image-${nextImageNum++}.${ext}`
      }
      return file.name
    })

    for (let i = 0; i < files.length; i++) {
      try {
        const attachment = await readFileAsAttachment(files[i], fileNames[i])
        if (attachment) {
          setAttachments(prev => [...prev, attachment])
        }
      } catch (error) {
        console.error('[FreeFormInput] Failed to read pasted file:', error)
      }
      setLoadingCount(prev => prev - 1)
    }
  }

  // Handle long text paste - convert to file attachment
  const handleLongTextPaste = React.useCallback((text: string) => {
    const nextNum = getNextPastedNumber('text', attachmentsRef.current)
    const fileName = `pasted-text-${nextNum}.txt`
    const attachment: FileAttachment = {
      type: 'text',
      path: fileName,
      name: fileName,
      mimeType: 'text/plain',
      text: text,
      size: new Blob([text]).size,
    }
    setAttachments(prev => [...prev, attachment])
    // Focus input after adding attachment
    richInputRef.current?.focus()
  }, []) // No deps needed - uses ref

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDraggingOver(false)
    if (disabled) return

    const files = Array.from(e.dataTransfer.files)
    setLoadingCount(files.length)

    for (const file of files) {
      const filePath = (file as File & { path?: string }).path
      if (filePath && hasElectronAPI) {
        try {
          const attachment = await window.electronAPI.readFileAttachment(filePath)
          if (attachment) {
            setAttachments(prev => [...prev, attachment])
            setLoadingCount(prev => prev - 1)
            continue
          }
        } catch (error) {
          console.error('[FreeFormInput] Failed to read via IPC:', error)
        }
      }

      try {
        const attachment = await readFileAsAttachment(file)
        if (attachment) {
          setAttachments(prev => [...prev, attachment])
        }
      } catch (error) {
        console.error('[FreeFormInput] Failed to read dropped file:', error)
      }
      setLoadingCount(prev => prev - 1)
    }
  }

  // Submit message - backend handles queueing and interruption
  const submitMessage = React.useCallback(() => {
    const hasContent = input.trim() || attachments.length > 0
    if (!hasContent || disabled) return false

    // Tutorial may disable sending to guide user through specific steps
    if (disableSend) return false

    // Parse all @mentions (skills, folders)
    const skillSlugs = skills.map(s => s.slug)
    const mentions = parseMentions(input, skillSlugs, [])

    onSubmit(
      input.trim(),
      attachments.length > 0 ? attachments : undefined,
      mentions.skills.length > 0 ? mentions.skills : undefined
    )
    setInput('')
    setAttachments([])
    // Clear draft immediately (cancel any pending debounced sync)
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    onInputChange?.('')
    prevInputValueRef.current = ''

    // Restore focus after state updates
    requestAnimationFrame(() => {
      richInputRef.current?.focus()
    })

    return true
  }, [input, attachments, disabled, disableSend, onInputChange, onSubmit, skills, onWorkingDirectoryChange, homeDir])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    submitMessage()
  }

  const handleStop = (silent = false) => {
    onStop?.(silent)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Shift+Tab cycles through enabled permission modes
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      // Use enabled modes or fallback to all modes
      const modes = enabledModes.length >= 2 ? enabledModes : PERMISSION_MODE_ORDER
      const currentIndex = modes.indexOf(permissionMode)
      // If current mode not in enabled list, jump to first enabled mode
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length
      const nextMode = modes[nextIndex]
      onPermissionModeChange?.(nextMode)
      return
    }

    // Don't submit when mention menu is open AND has visible content
    if (inlineMention.isOpen) {
      // Only intercept navigation/selection keys if menu actually shows items or is loading
      const hasVisibleContent = inlineMention.sections.some(s => s.items.length > 0) || inlineMention.isSearching
      if (hasVisibleContent && (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        // These keys are handled by the InlineMentionMenu component
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        inlineMention.close()
        return
      }
    }

    // Don't submit when slash command menu is open - let it handle the Enter key
    if (inlineSlash.isOpen) {
      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // These keys are handled by the InlineSlashCommand component
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        inlineSlash.close()
        return
      }
    }


    // Skip submission during IME composition - user is confirming composed characters, not sending
    // Handle send key based on user preference:
    // - 'enter': Enter sends (Shift+Enter for newline)
    // - 'cmd-enter': ⌘/Ctrl+Enter sends (Enter for newline)
    if (sendMessageKey === 'enter') {
      // Enter sends, Shift+Enter adds newline
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        submitMessage()
      }
      // Also allow Cmd/Ctrl+Enter to send (power user shortcut)
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
        e.preventDefault()
        submitMessage()
      }
    } else {
      // cmd-enter mode: ⌘/Ctrl+Enter sends, plain Enter adds newline
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
        e.preventDefault()
        submitMessage()
      }
      // Plain Enter is allowed to pass through (adds newline)
    }
    if (e.key === 'Escape') {
      // Skip blur if a popover/overlay is open — let the overlay handle ESC instead.
      // This prevents the input from consuming ESC when focus gets pulled back here
      // while a popover is still visible (portal DOM isolation means the event won't
      // reach the popover's DismissableLayer otherwise).
      if (!hasOpenOverlay()) {
        richInputRef.current?.blur()
      }
    }
  }

  // Handle input changes from RichTextInput
  const handleInputChange = React.useCallback((value: string) => {
    // Get previous input value before updating state
    const prevValue = inputRef.current

    setInput(value)
    syncToParent(value) // Debounced sync to parent for draft persistence
  }, [syncToParent])

  // Handle input with cursor position (for menu detection)
  const handleRichInput = React.useCallback((value: string, cursorPosition: number) => {
    // Update inline slash command state
    inlineSlash.handleInputChange(value, cursorPosition)

    // Update inline mention state (for @mentions - skills, sources, folders)
    inlineMention.handleInputChange(value, cursorPosition)

    // Auto-capitalize first letter (but not for slash commands or @mentions)
    // Only if autoCapitalisation setting is enabled
    let newValue = value
    if (autoCapitalisation && value.length > 0 && value.charAt(0) !== '/' && value.charAt(0) !== '@' && value.charAt(0) !== '#') {
      const capitalizedFirst = value.charAt(0).toUpperCase()
      if (capitalizedFirst !== value.charAt(0)) {
        newValue = capitalizedFirst + value.slice(1)
        // Set cursor position BEFORE state update so it's used when useEffect syncs the value
        richInputRef.current?.setSelectionRange(cursorPosition, cursorPosition)
        setInput(newValue)
        syncToParent(newValue)
        return
      }
    }

    // Apply smart typography (-> to →, etc.)
    const typography = applySmartTypography(value, cursorPosition)
    if (typography.replaced) {
      newValue = typography.text
      // Set cursor position BEFORE state update so it's used when useEffect syncs the value
      richInputRef.current?.setSelectionRange(typography.cursor, typography.cursor)
      setInput(newValue)
      syncToParent(newValue)
    }
  }, [inlineSlash, inlineMention, syncToParent, autoCapitalisation])

  // Handle inline slash command selection (removes the /command text)
  const handleInlineSlashCommandSelect = React.useCallback((commandId: SlashCommandId) => {
    const newValue = inlineSlash.handleSelectCommand(commandId)
    setInput(newValue)
    syncToParent(newValue)
    richInputRef.current?.focus()
  }, [inlineSlash, syncToParent])

  // Handle inline slash folder selection (inserts [dir:/path] badge)
  const handleInlineSlashFolderSelect = React.useCallback((path: string) => {
    const newValue = inlineSlash.handleSelectFolder(path)
    setInput(newValue)
    syncToParent(newValue)
    richInputRef.current?.focus()
  }, [inlineSlash, syncToParent])

  // Handle inline mention selection (inserts appropriate mention text)
  const handleInlineMentionSelect = React.useCallback((item: MentionItem) => {
    const { value: newValue, cursorPosition } = inlineMention.handleSelect(item)
    setInput(newValue)
    syncToParent(newValue)
    // Focus input and restore cursor position after badge renders
    setTimeout(() => {
      richInputRef.current?.focus()
      richInputRef.current?.setSelectionRange(cursorPosition, cursorPosition)
    }, 0)
  }, [inlineMention, syncToParent])

  const hasContent = input.trim() || attachments.length > 0

  return (
    <form onSubmit={handleSubmit}>
      <div
        ref={containerRef}
        className={cn(
          'overflow-hidden transition-all',
          // Container styling - only when not wrapped by InputContainer
          !unstyled && 'rounded-[16px] shadow-middle border border-border/40',
          !unstyled && 'bg-background',
          isDraggingOver && 'ring-2 ring-foreground ring-offset-2 ring-offset-background bg-foreground/5'
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Inline Slash Command Autocomplete */}
        <InlineSlashCommand
          open={inlineSlash.isOpen}
          onOpenChange={(open) => !open && inlineSlash.close()}
          sections={inlineSlash.sections}
          activeCommands={activeCommands}
          onSelectCommand={handleInlineSlashCommandSelect}
          onSelectFolder={handleInlineSlashFolderSelect}
          filter={inlineSlash.filter}
          position={inlineSlash.position}
        />

        {/* Inline Mention Autocomplete (skills, sources, files) */}
        <InlineMentionMenu
          open={inlineMention.isOpen}
          onOpenChange={(open) => !open && inlineMention.close()}
          sections={inlineMention.sections}
          onSelect={handleInlineMentionSelect}
          filter={inlineMention.filter}
          position={inlineMention.position}
          workspaceId={workspaceId}
          maxWidth={280}
          isSearching={inlineMention.isSearching}
        />

        {/* Attachment Preview */}
        <AttachmentPreview
          attachments={attachments}
          onRemove={handleRemoveAttachment}
          disabled={disabled}
          loadingCount={loadingCount}
        />

        {/* Rich Text Input with inline mention badges */}
        {/* In compact mode, hide input while processing (collapses to just bottom bar) */}
        {!(compactMode && isProcessing) && (
        <RichTextInput
          ref={richInputRef}
          value={input}
          onChange={handleInputChange}
          onInput={handleRichInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onLongTextPaste={handleLongTextPaste}
          onFocus={() => { setIsFocused(true); onFocusChange?.(true) }}
          onBlur={() => {
            // Save caret position before losing focus (for restoration via ss:focus-input)
            lastCaretPositionRef.current = richInputRef.current?.selectionStart ?? null
            setIsFocused(false)
            onFocusChange?.(false)
          }}
          placeholder={placeholder ?? 'type a message...'}
          disabled={disabled}
          skills={skills}
          workspaceId={workspaceId}
          className="pl-5 pr-4 pt-4 pb-3 overflow-y-auto min-h-[88px]"
          style={{ maxHeight: inputMaxHeight }}
          data-tutorial="chat-input"
          spellCheck={spellCheck}
        />
        )}

        {/* Bottom Row: Controls - wrapped in relative container for escape overlay */}
        <div className="relative">
          {/* Escape interrupt overlay - shown on first Esc press during processing */}
          <EscapeInterruptOverlay isVisible={isProcessing && showEscapeOverlay} />

          <div className={cn("flex items-center gap-1 px-2 py-2", !compactMode && "border-t border-border/50")}>
          {/* Left side: Context badges - shrinkable so model + send always stay visible */}
          {/* Hidden in compact mode (EditPopover embedding) */}
          {!compactMode && (
          <div className="flex items-center gap-1 min-w-32 shrink overflow-hidden">
          {/* 1. Attach Files Badge */}
          <FreeFormInputContextBadge
            icon={<Paperclip className="h-4 w-4" />}
            label={attachments.length > 0
              ? attachments.length === 1
                ? "1 file"
                : `${attachments.length} files`
              : t('chatInput.attachFiles')
            }
            isExpanded={false}
            hasSelection={attachments.length > 0}
            showChevron={false}
            iconOnly={true}
            onClick={handleAttachClick}
            tooltip={t('chatInput.attachFiles')}
            disabled={disabled}
          />


          {/* 3. Working Directory Selector Badge */}
          {onWorkingDirectoryChange && (
            <WorkingDirectoryBadge
              workingDirectory={workingDirectory}
              onWorkingDirectoryChange={onWorkingDirectoryChange}
              sessionFolderPath={sessionFolderPath}
              isEmptySession={isEmptySession}
            />
          )}

          </div>
          )}

          {/* 5. Model Selector - Hidden in compact mode (EditPopover embedding) */}
          {!compactMode && (
          <DropdownMenu open={modelDropdownOpen} onOpenChange={setModelDropdownOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center h-7 px-1.5 gap-0.5 text-[13px] shrink-0 rounded-[6px] hover:bg-foreground/5 transition-colors select-none",
                      modelDropdownOpen && "bg-foreground/5"
                    )}
                  >
                    {/* When tier models are active, show tier short name (e.g. "Balanced");
                        otherwise show the model short name */}
                    {tierModelOptions
                      ? (tierModelOptions.find(t => t.tierKey === (selectedTierKey ?? tierModelOptions[0]?.tierKey))
                          ?.label.split('·')[0].trim()
                        ?? getModelShortName(currentModel))
                      : getModelShortName(
                          customModel || customConnectionModels?.balanced || customConnectionModels?.best || currentModel
                        )
                    }
                    {(!customConnectionModels || tierModelOptions) && <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">Model</TooltipContent>
            </Tooltip>
            <StyledDropdownMenuContent side="top" align="end" sideOffset={8} className="min-w-[240px]">
              {/* When a custom connection is active with tier models, show selectable tier options */}
              {customConnectionModels && tierModelOptions ? (
                tierModelOptions.map(({ tierKey, modelId, label }) => {
                  const isSelected = tierKey === selectedTierKey
                  return (
                    <StyledDropdownMenuItem
                      key={tierKey}
                      onSelect={() => { setSelectedTierKey(tierKey); onModelChange(modelId) }}
                      className="flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer"
                    >
                      <div className="text-left">
                        <div className="font-medium text-sm">{modelId}</div>
                        <div className="text-xs text-muted-foreground">{label}</div>
                      </div>
                      {isSelected && <Check className="h-4 w-4 text-foreground shrink-0 ml-3" />}
                    </StyledDropdownMenuItem>
                  )
                })
              ) : customConnectionModels ? (
                /* Custom connection active but no tier models configured — show disabled single item */
                <StyledDropdownMenuItem
                  disabled
                  className="flex items-center justify-between px-2 py-2 rounded-lg"
                >
                  <div className="text-left">
                    <div className="font-medium text-sm">{customModel ?? customConnectionModels?.balanced ?? customConnectionModels?.best ?? 'Custom model'}</div>
                    <div className="text-xs text-muted-foreground">Custom API connection</div>
                  </div>
                  <Check className="h-4 w-4 text-foreground shrink-0 ml-3" />
                </StyledDropdownMenuItem>
              ) : (
                /* Model options */
                activeModels.map((model) => {
                  const isSelected = currentModel === model.id
                  const descriptions: Record<string, string> = {
                    'anthropic/claude-opus-4.6':   'Most capable for complex work',
                    'anthropic/claude-sonnet-4.6': 'Best for everyday tasks',
                    'anthropic/claude-haiku-4.5':  'Fastest for quick answers',
                    'claude-opus-4-6':             'Most capable for complex work',
                    'claude-sonnet-4-5-20250929':  'Best for everyday tasks',
                    'claude-haiku-4-5-20251001':   'Fastest for quick answers',
                  }
                  return (
                    <StyledDropdownMenuItem
                      key={model.id}
                      onSelect={() => onModelChange(model.id)}
                      className="flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer"
                    >
                      <div className="text-left">
                        <div className="font-medium text-sm">{model.name}</div>
                        <div className="text-xs text-muted-foreground">{descriptions[model.id] || model.description}</div>
                      </div>
                      {isSelected && (
                        <Check className="h-4 w-4 text-foreground shrink-0 ml-3" />
                      )}
                    </StyledDropdownMenuItem>
                  )
                })
              )}

              {/* Thinking level selector — shown for all Claude-compatible providers */}
              {(!customModel || isClaudeModel(customModel)) && (
                <>
                  <StyledDropdownMenuSeparator className="my-1" />

                  <DropdownMenuSub>
                    <StyledDropdownMenuSubTrigger className="flex items-center justify-between px-2 py-2 rounded-lg">
                      <div className="text-left flex-1">
                        <div className="font-medium text-sm">{getThinkingLevelName(thinkingLevel)}</div>
                        <div className="text-xs text-muted-foreground">Extended reasoning depth</div>
                      </div>
                    </StyledDropdownMenuSubTrigger>
                    <StyledDropdownMenuSubContent className="min-w-[220px]">
                      {THINKING_LEVELS.map(({ id, name, description }) => {
                        const isSelected = thinkingLevel === id
                        return (
                          <StyledDropdownMenuItem
                            key={id}
                            onSelect={() => onThinkingLevelChange?.(id)}
                            className="flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer"
                          >
                            <div className="text-left">
                              <div className="font-medium text-sm">{name}</div>
                              <div className="text-xs text-muted-foreground">{description}</div>
                            </div>
                            {isSelected && (
                              <Check className="h-4 w-4 text-foreground shrink-0 ml-3" />
                            )}
                          </StyledDropdownMenuItem>
                        )
                      })}
                    </StyledDropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}

            </StyledDropdownMenuContent>
          </DropdownMenu>
          )}

          {/* 5.5 Context Usage Badge - always visible when token data is available */}
          {(() => {
            const effectiveContextWindow = contextStatus?.contextWindow || getModelContextWindow(customModel || currentModel)
            const compactionThreshold = effectiveContextWindow
              ? Math.round(effectiveContextWindow * 0.775)
              : null
            const usagePercent = contextStatus?.inputTokens && compactionThreshold
              ? Math.min(99, Math.round((contextStatus.inputTokens / compactionThreshold) * 100))
              : null

            if (usagePercent === null) return null

            const handleCompactClick = () => {
              if (!isProcessing) {
                onSubmit('/compact', [])
              }
            }

            const isWarning = usagePercent >= 80

            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleCompactClick}
                    disabled={isProcessing}
                    className={cn(
                      "inline-flex items-center gap-1 h-7 px-1.5 rounded-[6px] text-[12px] select-none transition-colors",
                      "hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed",
                      isWarning ? "text-info" : "text-muted-foreground"
                    )}
                  >
                    <ContextRingIcon percent={usagePercent} />
                    <span>{usagePercent}%</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isProcessing
                    ? t('chatInput.contextUsageProcessing', { percent: usagePercent })
                    : t('chatInput.contextUsage', { percent: usagePercent })
                  }
                </TooltipContent>
              </Tooltip>
            )
          })()}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right side: Send - never shrink so it's always visible */}
          <div className="flex items-center shrink-0">
          {/* 5.7 Permission Mode Dropdown - Hidden in compact mode */}
          {!compactMode && (
            <PermissionModeDropdown
              permissionMode={permissionMode}
              onPermissionModeChange={onPermissionModeChange}
              thinkingLevel={thinkingLevel}
              onThinkingLevelChange={onThinkingLevelChange}
              compact
            />
          )}
          {/* 6. Send/Stop Button - Always show stop when processing */}
          {isProcessing ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-7 w-7 rounded-full shrink-0 hover:bg-foreground/15 active:bg-foreground/20 ml-2"
              onClick={() => handleStop(false)}
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="h-7 w-7 rounded-full shrink-0 ml-2"
              disabled={!hasContent || disabled}
              data-tutorial="send-button"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
          </div>
          </div>
        </div>
      </div>
    </form>
  )
}

/**
 * Helper functions for recent directories storage
 */
function getRecentDirs(): string[] {
  return storage.get<string[]>(storage.KEYS.recentWorkingDirs, [])
}

function addRecentDir(path: string): void {
  const recent = getRecentDirs().filter(p => p !== path)
  const updated = [path, ...recent].slice(0, 25)
  storage.set(storage.KEYS.recentWorkingDirs, updated)
}

/**
 * Format path for display, with home directory shortened
 */
function formatPathForDisplay(path: string, homeDir: string): string {
  let displayPath = path
  if (homeDir && path.startsWith(homeDir)) {
    const relativePath = path.slice(homeDir.length)
    // Remove leading separator if present, show root separator if empty
    displayPath = relativePath.startsWith(PATH_SEP)
      ? relativePath.slice(1)
      : (relativePath || PATH_SEP)
  }
  return `in ${displayPath}`
}

/**
 * WorkingDirectoryBadge - Context badge for selecting working directory
 * Uses cmdk for filterable folder list when there are more than 5 recent folders.
 */
function WorkingDirectoryBadge({
  workingDirectory,
  onWorkingDirectoryChange,
  sessionFolderPath,
  isEmptySession = false,
}: {
  workingDirectory?: string
  onWorkingDirectoryChange: (path: string) => void
  sessionFolderPath?: string
  isEmptySession?: boolean
}) {
  const { t } = useTranslation()
  const [recentDirs, setRecentDirs] = React.useState<string[]>([])
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const [homeDir, setHomeDir] = React.useState<string>('')
  const [gitBranch, setGitBranch] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Load home directory and recent directories on mount
  React.useEffect(() => {
    setRecentDirs(getRecentDirs())
    window.electronAPI?.getHomeDir?.().then((dir: string) => {
      if (dir) setHomeDir(dir)
    })
  }, [])

  // Fetch git branch when working directory changes
  React.useEffect(() => {
    if (workingDirectory) {
      window.electronAPI?.getGitBranch?.(workingDirectory).then((branch: string | null) => {
        setGitBranch(branch)
      })
    } else {
      setGitBranch(null)
    }
  }, [workingDirectory])

  // Reset filter and focus input when popover opens
  React.useEffect(() => {
    if (popoverOpen) {
      setFilter('')
      // Focus input after popover animation completes (only if filter is shown)
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [popoverOpen])

  const handleChooseFolder = async () => {
    if (!window.electronAPI) return
    setPopoverOpen(false)
    const selectedPath = await window.electronAPI.openFolderDialog()
    if (selectedPath) {
      addRecentDir(selectedPath)
      setRecentDirs(getRecentDirs())
      onWorkingDirectoryChange(selectedPath)
    }
  }

  const handleSelectRecent = (path: string) => {
    addRecentDir(path) // Move to top of recent list
    setRecentDirs(getRecentDirs())
    onWorkingDirectoryChange(path)
    setPopoverOpen(false)
  }

  const handleReset = () => {
    if (sessionFolderPath) {
      onWorkingDirectoryChange(sessionFolderPath)
      setPopoverOpen(false)
    }
  }

  // Filter out current directory from recent list and sort alphabetically by folder name
  const filteredRecent = recentDirs
    .filter(p => p !== workingDirectory)
    .sort((a, b) => {
      const nameA = getPathBasename(a).toLowerCase()
      const nameB = getPathBasename(b).toLowerCase()
      return nameA.localeCompare(nameB)
    })
  // Show filter input only when more than 5 recent folders
  const showFilter = filteredRecent.length > 5

  // Determine label - "Work in Folder" if not set or at session root, otherwise folder name
  const hasFolder = !!workingDirectory && workingDirectory !== sessionFolderPath
  const folderName = hasFolder ? (getPathBasename(workingDirectory) || 'Folder') : 'Work in Folder'

  // Show reset option when a folder is selected and it differs from session folder
  const showReset = hasFolder && sessionFolderPath && sessionFolderPath !== workingDirectory

  // Once the session has messages, folder selection is locked (CWD can't change mid-session)
  const canChangeFolder = isEmptySession

  if (!canChangeFolder) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="shrink min-w-0 overflow-hidden inline-flex">
            <FreeFormInputContextBadge
              icon={<Folder className="h-4 w-4" />}
              label={folderName}
              isExpanded={false}
              hasSelection={hasFolder}
              showChevron={false}
              iconOnly={true}
              isOpen={false}
              disabled={true}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {hasFolder ? (
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t('chatInput.workingDirectory')}</span>
              <span className="text-xs opacity-70">{formatPathForDisplay(workingDirectory!, homeDir)}</span>
              {gitBranch && <span className="text-xs opacity-70">on {gitBranch}</span>}
            </span>
          ) : (
            t('chatInput.workingDirectoryNotSet')
          )}
        </TooltipContent>
      </Tooltip>
    )
  }

  // Styles matching todo-filter-menu.tsx for consistency
  const MENU_CONTAINER_STYLE = 'min-w-[200px] max-w-[400px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small p-0'
  const MENU_LIST_STYLE = 'max-h-[200px] overflow-y-auto p-1 [&_[cmdk-list-sizer]]:space-y-px'
  const MENU_ITEM_STYLE = 'flex cursor-pointer select-none items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] outline-none'

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <span className="shrink min-w-0 overflow-hidden">
          <FreeFormInputContextBadge
            icon={<Folder className="h-4 w-4" />}
            label={folderName}
            isExpanded={false}
            hasSelection={hasFolder}
            showChevron={false}
            iconOnly={true}
            isOpen={popoverOpen}
            tooltip={
              hasFolder ? (
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{t('chatInput.workingDirectory')}</span>
                  <span className="text-xs opacity-70">{formatPathForDisplay(workingDirectory, homeDir)}</span>
                  {gitBranch && <span className="text-xs opacity-70">on {gitBranch}</span>}
                </span>
              ) : t('chatInput.workingDirectory')
            }
          />
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className={MENU_CONTAINER_STYLE}>
        <CommandPrimitive shouldFilter={showFilter}>
          {/* Filter input - only shown when more than 5 recent folders */}
          {showFilter && (
            <div className="border-b border-border/50 px-3 py-2">
              <CommandPrimitive.Input
                ref={inputRef}
                value={filter}
                onValueChange={setFilter}
                placeholder={t('sessionList.filterFolders')}
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 placeholder:select-none"
              />
            </div>
          )}

          <CommandPrimitive.List className={MENU_LIST_STYLE}>
            {/* Current Folder Display - shown at top with checkmark */}
            {hasFolder && (
              <CommandPrimitive.Item
                value={`current-${workingDirectory}`}
                className={cn(MENU_ITEM_STYLE, 'pointer-events-none bg-foreground/5')}
                disabled
              >
                <Icon_Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 min-w-0 truncate">
                  <span>{folderName}</span>
                  <span className="text-muted-foreground ml-1.5">{formatPathForDisplay(workingDirectory, homeDir)}</span>
                </span>
                <Check className="h-4 w-4 shrink-0" />
              </CommandPrimitive.Item>
            )}

            {/* Separator after current folder */}
            {hasFolder && filteredRecent.length > 0 && (
              <div className="h-px bg-border my-1 mx-1" />
            )}

            {/* Recent Directories - filterable (current directory already filtered out via filteredRecent) */}
            {filteredRecent.map((path) => {
              const recentFolderName = getPathBasename(path) || 'Folder'
              return (
                <CommandPrimitive.Item
                  key={path}
                  value={`${recentFolderName} ${path}`}
                  onSelect={() => handleSelectRecent(path)}
                  className={cn(MENU_ITEM_STYLE, 'data-[selected=true]:bg-foreground/5')}
                >
                  <Icon_Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0 truncate">
                    <span>{recentFolderName}</span>
                    <span className="text-muted-foreground ml-1.5">{formatPathForDisplay(path, homeDir)}</span>
                  </span>
                </CommandPrimitive.Item>
              )
            })}

            {/* Empty state when filtering */}
            {showFilter && (
              <CommandPrimitive.Empty className="py-3 text-center text-sm text-muted-foreground">
                No folders found
              </CommandPrimitive.Empty>
            )}
          </CommandPrimitive.List>

          {/* Bottom actions - always visible, outside scrollable area */}
          <div className="border-t border-border/50 p-1">
            <button
              type="button"
              onClick={handleChooseFolder}
              className={cn(MENU_ITEM_STYLE, 'w-full hover:bg-foreground/5')}
            >
              Choose Folder...
            </button>
            {showReset && (
              <button
                type="button"
                onClick={handleReset}
                className={cn(MENU_ITEM_STYLE, 'w-full hover:bg-foreground/5')}
              >
                Reset
              </button>
            )}
          </div>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  )
}
