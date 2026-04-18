/**
 * @opentomo/ui - Shared React UI components for OpenTomo
 *
 * This package provides platform-agnostic UI components that work in both:
 * - Electron desktop app (full interactive mode)
 * - Web session viewer (read-only mode)
 *
 * Key components:
 * - SessionViewer: Read-only session transcript viewer (used by web viewer)
 * - TurnCard: Email-like display for assistant turns
 * - Markdown: Customizable markdown renderer with syntax highlighting
 *
 * Platform abstraction:
 * - PlatformProvider/usePlatform: Inject platform-specific actions
 */

// Context
export {
  PlatformProvider,
  usePlatform,
  type PlatformActions,
  type PlatformProviderProps,
  ShikiThemeProvider,
  useShikiTheme,
  type ShikiThemeProviderProps,
} from './context'

// Chat components
export {
  SessionViewer,
  TurnCard,
  TurnCardActionsMenu,
  ResponseCard,
  UserMessageBubble,
  SystemMessage,
  FileTypeIcon,
  getFileTypeLabel,
  // Inline execution for EditPopover
  InlineExecution,
  mapToolEventToActivity,
  SIZE_CONFIG,
  ActivityStatusIcon,
  type SessionViewerProps,
  type SessionViewerMode,
  type TurnCardProps,
  type TurnCardActionsMenuProps,
  type ResponseCardProps,
  type UserMessageBubbleProps,
  type SystemMessageProps,
  type SystemMessageType,
  type FileTypeIconProps,
  type ActivityItem,
  type ActivityStatus,
  type ResponseContent,
  type TodoItem,
  type InlineExecutionProps,
  type InlineExecutionStatus,
  type InlineActivityItem,
} from './components/chat'

// Markdown
export {
  Markdown,
  MemoizedMarkdown,
  StreamingMarkdown,
  CodeBlock,
  InlineCode,
  CollapsibleMarkdownProvider,
  useCollapsibleMarkdown,
  MarkdownMediaProvider,
  useMarkdownMedia,
  type MarkdownProps,
  type RenderMode,
  type MarkdownMediaActions,
} from './components/markdown'

// UI primitives
export {
  Spinner,
  SimpleDropdown,
  SimpleDropdownItem,
  PreviewHeader,
  PreviewHeaderBadge,
  PREVIEW_BADGE_VARIANTS,
  type SpinnerProps,
  type SimpleDropdownProps,
  type SimpleDropdownItemProps,
  type PreviewHeaderProps,
  type PreviewHeaderBadgeProps,
  type PreviewBadgeVariant,
} from './components/ui'

// Tooltip
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './components/tooltip'

// Code viewer components
export {
  ShikiCodeViewer,
  ShikiDiffViewer,
  getDiffStats,
  DiffViewerControls,
  DiffSplitIcon,
  DiffUnifiedIcon,
  DiffBackgroundIcon,
  LANGUAGE_MAP,
  getLanguageFromPath,
  formatFilePath,
  truncateFilePath,
  type ShikiCodeViewerProps,
  type ShikiDiffViewerProps,
  type DiffViewerControlsProps,
} from './components/code-viewer'

// Terminal components
export {
  TerminalOutput,
  parseAnsi,
  stripAnsi,
  isGrepContentOutput,
  parseGrepOutput,
  ANSI_COLORS,
  type TerminalOutputProps,
  type ToolType,
  type AnsiSpan,
  type GrepLine,
} from './components/terminal'

// Overlay components
export {
  // Base overlay components
  FullscreenOverlayBase,
  FullscreenOverlayBaseHeader,
  PreviewOverlay,
  ContentFrame,
  CopyButton,
  type FullscreenOverlayBaseProps,
  type FullscreenOverlayBaseHeaderProps,
  type OverlayTypeBadge,
  type PreviewOverlayProps,
  type ContentFrameProps,
  type BadgeVariant,
  type CopyButtonProps,
  // Specialized overlays
  CodePreviewOverlay,
  MultiDiffPreviewOverlay,
  TerminalPreviewOverlay,
  GenericOverlay,
  JSONPreviewOverlay,
  DataTableOverlay,
  DocumentFormattedMarkdownOverlay,
  ImagePreviewOverlay,
  PDFPreviewOverlay,
  SVGPreviewOverlay,
  detectLanguage,
  detectLanguageFromPath,
  type CodePreviewOverlayProps,
  type MultiDiffPreviewOverlayProps,
  type FileChange,
  type DiffViewerSettings,
  type TerminalPreviewOverlayProps,
  type GenericOverlayProps,
  type JSONPreviewOverlayProps,
  type DataTableOverlayProps,
  type DocumentFormattedMarkdownOverlayProps,
  type ImagePreviewOverlayProps,
  type PDFPreviewOverlayProps,
  type SVGPreviewOverlayProps,
} from './components/overlay'

// File classification (for link interceptor)
export {
  classifyFile,
  type FilePreviewType,
  type FileClassification,
} from './lib/file-classification'

// Widget (Generative UI)
export { WidgetRenderer, type WidgetRendererProps } from './components/widget/WidgetRenderer'
export { WidgetErrorBoundary } from './components/widget/WidgetErrorBoundary'
export { resolveThemeVars, getWidgetIframeStyleBlock, WIDGET_CSS_BRIDGE } from './components/widget/widget-css-bridge'

// Utilities
export { cn } from './lib/utils'

// Layout constants and hooks
export {
  CHAT_LAYOUT,
  CHAT_CLASSES,
  OVERLAY_LAYOUT,
  useOverlayMode,
  type OverlayMode,
} from './lib/layout'

// Tool result parsers
export {
  parseReadResult,
  parseBashResult,
  parseGrepResult,
  parseGlobResult,
  extractOverlayData,
  type ReadResult,
  type BashResult,
  type GrepResult,
  type GlobResult,
  type CodeOverlayData,
  type TerminalOverlayData,
  type GenericOverlayData,
  type JSONOverlayData,
  type DocumentOverlayData,
  type OverlayData,
} from './lib/tool-parsers'

// Turn utilities (pure functions)
export * from './components/chat/turn-utils'

// Icons
export {
  Icon_Folder,
  Icon_Home,
  Icon_Inbox,
  type IconProps,
} from './components/icons'
