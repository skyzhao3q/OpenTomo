/**
 * SessionFilesSection - Displays files in the session directory as a tree view
 *
 * Features:
 * - Recursive tree view with expandable folders (matches sidebar styling)
 * - File watcher for auto-refresh when files change
 * - Click to reveal in Finder, double-click to open
 * - Persisted expanded folder state per session
 *
 * Styling matches LeftSidebar patterns:
 * - Chevron hidden by default, shown on hover
 * - Vertical connector lines for nested items
 * - 14x14px icons, 8px gaps, 6px radius
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { File, Folder, FolderOpen, FileText, Image, FileCode, ChevronRight, RefreshCw, Eye, EyeOff } from 'lucide-react'
import type { SessionFile } from '../../../shared/types'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { useAppShellContext } from '@/context/AppShellContext'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

/**
 * Stagger animation variants for child items - matches LeftSidebar pattern
 * Creates a pleasing "cascade" effect when expanding folders
 */
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.025,
      delayChildren: 0.01,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.015,
      staggerDirection: -1,
    },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.15, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    x: -8,
    transition: { duration: 0.1, ease: 'easeIn' },
  },
}

export interface SessionFilesSectionProps {
  sessionId?: string
  /** When set, show this directory's contents instead of the session folder */
  workingDirectory?: string
  className?: string
  /** When set, called on file click instead of opening with the system handler */
  onFileSelect?: (file: SessionFile) => void
  /** Base directory used to compute relative paths in the context menu */
  baseDirectory?: string
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Get icon for file based on name/type (14x14px matching sidebar)
 */
function getFileIcon(file: SessionFile, isExpanded?: boolean) {
  const iconClass = "h-3.5 w-3.5 text-muted-foreground"

  if (file.type === 'directory') {
    return isExpanded
      ? <FolderOpen className={iconClass} />
      : <Folder className={iconClass} />
  }

  const ext = file.name.split('.').pop()?.toLowerCase()

  if (ext === 'md' || ext === 'markdown') {
    return <FileText className={iconClass} />
  }

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext || '')) {
    return <Image className={iconClass} />
  }

  if (['ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'py', 'rb', 'go', 'rs'].includes(ext || '')) {
    return <FileCode className={iconClass} />
  }

  return <File className={iconClass} />
}

/**
 * Extensions that have thumbnail previews via the thumbnail:// protocol.
 * Matches the ALL_PREVIEWABLE set in thumbnail-protocol.ts.
 */
const PREVIEWABLE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'heif',
  'pdf', 'svg', 'psd', 'ai',
])

/**
 * Constructs a thumbnail:// protocol URL for a given file path.
 * The path is URI-encoded so it can be embedded safely in a URL.
 * Works cross-platform (macOS paths start with /, Windows with C:\).
 */
function getThumbnailUrl(filePath: string): string {
  return `thumbnail://thumb/${encodeURIComponent(filePath)}`
}

/**
 * FileThumbnail — Renders an image thumbnail with cross-fade from icon fallback.
 *
 * Shows the Lucide icon immediately, then loads the thumbnail from the
 * custom thumbnail:// protocol. On load, the icon fades out and the
 * thumbnail fades in (200ms CSS transition). If loading fails, the icon
 * stays visible — no layout shift, no error state.
 */
const FileThumbnail = memo(function FileThumbnail({ file }: { file: SessionFile }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  // Reset state when file changes (e.g. watcher triggered re-render)
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [file.path])

  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const canPreview = PREVIEWABLE_EXTENSIONS.has(ext)

  // Fall back to regular icon if not previewable or thumbnail failed
  if (!canPreview || failed) {
    return getFileIcon(file)
  }

  return (
    <>
      {/* Fallback icon — visible initially, fades out when thumbnail loads */}
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center transition-opacity duration-200',
          loaded ? 'opacity-0' : 'opacity-100'
        )}
      >
        {getFileIcon(file)}
      </span>
      {/* Thumbnail — fades in on successful load */}
      <img
        src={getThumbnailUrl(file.path)}
        alt=""
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          'absolute inset-0 h-full w-full rounded-[2px] object-cover transition-opacity duration-200',
          loaded ? 'opacity-100' : 'opacity-0'
        )}
      />
    </>
  )
})

interface FileTreeItemProps {
  file: SessionFile
  depth: number
  expandedPaths: Set<string>
  onToggleExpand: (path: string) => void
  onFileClick: (file: SessionFile) => void
  onFileDoubleClick: (file: SessionFile) => void
  onShowInFolder: (file: SessionFile) => void
  onCopyPath: (file: SessionFile) => void
  onCopyRelativePath: (file: SessionFile) => void
  onNewFolder: (file: SessionFile) => void
  onDelete: (file: SessionFile) => void
  renamingPath: string | null
  onStartRename: (file: SessionFile) => void
  onFinishRename: (file: SessionFile, newName: string) => void
  onCancelRename: () => void
  /** Whether this item is inside an expanded folder (for stagger animation) */
  isNested?: boolean
}

/**
 * Recursive file tree item component
 * Matches LeftSidebar styling patterns exactly:
 * - Vertical line on container level (not per-item)
 * - Framer-motion staggered animation for expand/collapse
 * - Chevron shown on hover, icon hidden
 */
function FileTreeItem({
  file,
  depth,
  expandedPaths,
  onToggleExpand,
  onFileClick,
  onFileDoubleClick,
  onShowInFolder,
  onCopyPath,
  onCopyRelativePath,
  onNewFolder,
  onDelete,
  renamingPath,
  onStartRename,
  onFinishRename,
  onCancelRename,
  isNested,
}: FileTreeItemProps) {
  const isDirectory = file.type === 'directory'
  const isExpanded = expandedPaths.has(file.path)
  const hasChildren = isDirectory && file.children && file.children.length > 0

  const handleClick = () => {
    if (isDirectory && hasChildren) {
      onToggleExpand(file.path)
    } else {
      onFileClick(file)
    }
  }

  const handleDoubleClick = () => {
    onFileDoubleClick(file)
  }

  // Handle chevron click separately to toggle expand
  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (hasChildren) {
      onToggleExpand(file.path)
    }
  }

  // The button element for the file/folder item
  const buttonElement = (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          className={cn(
            // Base styles matching LeftSidebar exactly
            // min-w-0 and overflow-hidden required for truncation to work in grid context
            "group flex w-full min-w-0 overflow-hidden items-center gap-2 rounded-[6px] py-[5px] text-[13px] select-none outline-none text-left",
            "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
            "hover:bg-sidebar-hover transition-colors",
            // Same padding for all items - nested indentation handled by container
            "px-2"
          )}
          title={`${file.path}\n${file.type === 'file' ? formatFileSize(file.size) : 'Directory'}\n\nClick to ${hasChildren ? 'expand' : 'reveal'}, double-click to open`}
        >
          {/* Icon container with hover-revealed chevron for expandable items */}
          <span className="relative h-3.5 w-3.5 shrink-0 flex items-center justify-center">
            {hasChildren ? (
              <>
                {/* Main icon - hidden on hover */}
                <span className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity duration-150">
                  {getFileIcon(file, isExpanded)}
                </span>
                {/* Toggle chevron - shown on hover */}
                <span
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 cursor-pointer"
                  onClick={handleChevronClick}
                >
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                      isExpanded && "rotate-90"
                    )}
                  />
                </span>
              </>
            ) : (
              /* Non-directory files: show thumbnail preview for previewable types,
                 with cross-fade from icon. Falls back to icon for unsupported types. */
              <FileThumbnail file={file} />
            )}
          </span>

          {/* File/folder name — inline rename input when renaming, otherwise truncated span */}
          {renamingPath === file.path ? (
            <input
              autoFocus
              defaultValue={file.name}
              className="flex-1 min-w-0 bg-background border border-ring rounded px-1 text-[13px] outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') onFinishRename(file, e.currentTarget.value)
                if (e.key === 'Escape') onCancelRename()
              }}
              onBlur={(e) => onFinishRename(file, e.currentTarget.value)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 min-w-0 truncate">{file.name}</span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onCopyPath(file)}>Copy</ContextMenuItem>
        <ContextMenuItem disabled>Cut</ContextMenuItem>
        <ContextMenuItem onClick={() => onNewFolder(file)}>New Folder</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onStartRename(file)}>Rename</ContextMenuItem>
        <ContextMenuItem onClick={() => onShowInFolder(file)}>Reveal in Finder</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCopyRelativePath(file)}>Copy Relative Path</ContextMenuItem>
        <ContextMenuItem onClick={() => onCopyPath(file)}>Copy Absolute Path</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => onDelete(file)}
          className="text-destructive focus:text-destructive"
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )

  // Inner content: button and expandable children (wrapped in group/section like LeftSidebar)
  const innerContent = (
    <div className="group/section min-w-0">
      {buttonElement}
      {/* Expandable children with framer-motion animation - matches LeftSidebar exactly */}
      {hasChildren && (
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              animate={{ height: 'auto', opacity: 1, marginTop: 2, marginBottom: 8 }}
              exit={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              {/* Wrapper div matches LeftSidebar recursive structure - min-w-0 allows shrinking */}
              <div className="flex flex-col select-none min-w-0">
                <motion.nav
                  className="grid gap-0.5 pl-5 pr-0 relative"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {/* Vertical line at container level - matches LeftSidebar pattern */}
                  <div
                    className="absolute left-[13px] top-1 bottom-1 w-px bg-foreground/10"
                    aria-hidden="true"
                  />
                  {file.children!.map((child) => (
                    <motion.div key={child.path} variants={itemVariants} className="min-w-0">
                      <FileTreeItem
                        file={child}
                        depth={depth + 1}
                        expandedPaths={expandedPaths}
                        onToggleExpand={onToggleExpand}
                        onFileClick={onFileClick}
                        onFileDoubleClick={onFileDoubleClick}
                        onShowInFolder={onShowInFolder}
                        onCopyPath={onCopyPath}
                        onCopyRelativePath={onCopyRelativePath}
                        onNewFolder={onNewFolder}
                        onDelete={onDelete}
                        renamingPath={renamingPath}
                        onStartRename={onStartRename}
                        onFinishRename={onFinishRename}
                        onCancelRename={onCancelRename}
                        isNested={true}
                      />
                    </motion.div>
                  ))}
                </motion.nav>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )

  // For nested items, the parent already wraps in motion.div for stagger
  // Root items use Fragment to avoid extra wrapper (matches LeftSidebar exactly)
  return <>{innerContent}</>
}

/**
 * Section displaying session files (or working directory) as a tree
 */
// Renderer-safe path helpers (no Node.js path module in browser context)
function pathDirname(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx > 0 ? p.slice(0, idx) : '/'
}
function pathJoin(a: string, b: string): string {
  return `${a.replace(/\/$/, '')}/${b}`
}
function pathRelative(from: string, to: string): string {
  if (!from) return to
  return to.startsWith(from + '/') ? to.slice(from.length + 1) : to
}

export function SessionFilesSection({ sessionId, workingDirectory, className, onFileSelect, baseDirectory }: SessionFilesSectionProps) {
  const [files, setFiles] = useState<SessionFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [showHiddenFiles, setShowHiddenFiles] = useState(() =>
    storage.get(storage.KEYS.explorerShowHidden, false)
  )
  const mountedRef = useRef(true)

  // Determine which mode we're in
  const isWorkingDirMode = !!workingDirectory

  // Load expanded paths from storage when session changes
  useEffect(() => {
    if (sessionId) {
      const saved = storage.get<string[]>(storage.KEYS.sessionFilesExpandedFolders, [], sessionId)
      setExpandedPaths(new Set(saved))
    } else {
      setExpandedPaths(new Set())
    }
  }, [sessionId])

  // Save expanded paths to storage when they change (only in session mode)
  const saveExpandedPaths = useCallback((paths: Set<string>) => {
    if (sessionId && !isWorkingDirMode) {
      storage.set(storage.KEYS.sessionFilesExpandedFolders, Array.from(paths), sessionId)
    }
  }, [sessionId, isWorkingDirMode])

  // Load files — uses working directory if set, otherwise session folder
  const loadFiles = useCallback(async () => {
    if (isWorkingDirMode) {
      setIsLoading(true)
      try {
        const dirFiles = await window.electronAPI.getDirectoryFiles(workingDirectory, showHiddenFiles)
        if (mountedRef.current) setFiles(dirFiles)
      } catch (error) {
        console.error('Failed to load directory files:', error)
        if (mountedRef.current) setFiles([])
      } finally {
        if (mountedRef.current) setIsLoading(false)
      }
    } else {
      if (!sessionId) {
        setFiles([])
        return
      }
      setIsLoading(true)
      try {
        const sessionFiles = await window.electronAPI.getSessionFiles(sessionId, showHiddenFiles)
        if (mountedRef.current) setFiles(sessionFiles)
      } catch (error) {
        console.error('Failed to load session files:', error)
        if (mountedRef.current) setFiles([])
      } finally {
        if (mountedRef.current) setIsLoading(false)
      }
    }
  }, [sessionId, workingDirectory, isWorkingDirMode, showHiddenFiles])

  // Initial load and file watcher setup
  useEffect(() => {
    mountedRef.current = true
    loadFiles()

    if (isWorkingDirMode) {
      window.electronAPI.watchDirectoryFiles(workingDirectory)
      const unsubscribe = window.electronAPI.onDirectoryFilesChanged((changedPath) => {
        if (changedPath === workingDirectory && mountedRef.current) {
          loadFiles()
        }
      })
      return () => {
        mountedRef.current = false
        unsubscribe()
        window.electronAPI.unwatchDirectoryFiles()
      }
    } else if (sessionId) {
      window.electronAPI.watchSessionFiles(sessionId)
      const unsubscribe = window.electronAPI.onSessionFilesChanged((changedSessionId) => {
        if (changedSessionId === sessionId && mountedRef.current) {
          loadFiles()
        }
      })
      return () => {
        mountedRef.current = false
        unsubscribe()
        window.electronAPI.unwatchSessionFiles()
      }
    }

    return () => {
      mountedRef.current = false
    }
  }, [sessionId, workingDirectory, isWorkingDirMode, loadFiles])

  // Use the link interceptor (via context) so file clicks show in-app previews
  // instead of always opening in Finder / default app.
  const { onOpenFile } = useAppShellContext()

  // Handle file click — preview in-app if possible, reveal directory in system explorer
  const handleFileClick = useCallback((file: SessionFile) => {
    if (file.type === 'directory') {
      // Use revealInExplorer — supports paths outside home dir (e.g. /Volumes/...)
      window.electronAPI.revealInExplorer(file.path)
    } else if (onFileSelect) {
      onFileSelect(file)
    } else {
      onOpenFile(file.path)
    }
  }, [onOpenFile, onFileSelect])

  // Handle double-click — same as single click
  const handleFileDoubleClick = useCallback((file: SessionFile) => {
    if (file.type === 'directory') {
      window.electronAPI.revealInExplorer(file.path)
    } else if (onFileSelect) {
      onFileSelect(file)
    } else {
      onOpenFile(file.path)
    }
  }, [onOpenFile, onFileSelect])

  // Handle "Show in System Explorer" — reveal the item in Finder/Explorer
  // Uses revealInExplorer which supports paths outside home dir (no validateFilePath restriction)
  const handleShowInFolder = useCallback((file: SessionFile) => {
    window.electronAPI.revealInExplorer(file.path)
  }, [])

  // Context menu handlers
  const handleCopyPath = useCallback((file: SessionFile) => {
    navigator.clipboard.writeText(file.path)
  }, [])

  const handleCopyRelativePath = useCallback((file: SessionFile) => {
    const base = baseDirectory ?? workingDirectory ?? ''
    const rel = base ? pathRelative(base, file.path) : file.path
    navigator.clipboard.writeText(rel)
  }, [baseDirectory, workingDirectory])

  const handleNewFolder = useCallback(async (file: SessionFile) => {
    const parentDir = file.type === 'directory' ? file.path : pathDirname(file.path)
    const newPath = pathJoin(parentDir, 'New Folder')
    await window.electronAPI.fsCreateDir(newPath)
    // File watcher will trigger loadFiles; set rename immediately so it activates when tree updates
    setRenamingPath(newPath)
  }, [])

  const handleStartRename = useCallback((file: SessionFile) => {
    setRenamingPath(file.path)
  }, [])

  const handleFinishRename = useCallback(async (file: SessionFile, newName: string) => {
    setRenamingPath(null)
    const trimmed = newName.trim()
    if (!trimmed || trimmed === file.name) return
    const newPath = pathJoin(pathDirname(file.path), trimmed)
    await window.electronAPI.fsRename(file.path, newPath)
    // File watcher triggers loadFiles automatically
  }, [])

  const handleCancelRename = useCallback(() => {
    setRenamingPath(null)
  }, [])

  const handleDelete = useCallback(async (file: SessionFile) => {
    await window.electronAPI.fsDelete(file.path, file.type === 'directory')
    // File watcher triggers loadFiles automatically
  }, [])

  const handleToggleHidden = useCallback(() => {
    setShowHiddenFiles((prev) => {
      const next = !prev
      storage.set(storage.KEYS.explorerShowHidden, next)
      return next
    })
  }, [])

  // Toggle folder expanded state
  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      saveExpandedPaths(next)
      return next
    })
  }, [saveExpandedPaths])

  if (!sessionId && !isWorkingDirMode) {
    return null
  }

  const emptyMessage = isLoading
    ? 'Loading...'
    : isWorkingDirMode
      ? 'No files found in working directory.'
      : 'Files attached or created by this chat will appear here.'

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0 select-none">
        <span className="text-xs font-semibold text-muted-foreground tracking-wider">EXPLORER</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleToggleHidden}
            title={showHiddenFiles ? 'Hide hidden files' : 'Show hidden files'}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
          >
            {showHiddenFiles
              ? <Eye className="size-3" />
              : <EyeOff className="size-3" />}
          </button>
          <button
            onClick={() => loadFiles()}
            disabled={isLoading}
            title="Refresh"
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={cn('size-3', isLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-2 min-h-0">
        {files.length === 0 ? (
          <div className="px-4 text-muted-foreground select-none">
            <p className="text-xs">{emptyMessage}</p>
          </div>
        ) : (
          <nav className="grid gap-0.5 px-2">
            {files.map((file) => (
              <FileTreeItem
                key={file.path}
                file={file}
                depth={0}
                expandedPaths={expandedPaths}
                onToggleExpand={handleToggleExpand}
                onFileClick={handleFileClick}
                onFileDoubleClick={handleFileDoubleClick}
                onShowInFolder={handleShowInFolder}
                onCopyPath={handleCopyPath}
                onCopyRelativePath={handleCopyRelativePath}
                onNewFolder={handleNewFolder}
                onDelete={handleDelete}
                renamingPath={renamingPath}
                onStartRename={handleStartRename}
                onFinishRename={handleFinishRename}
                onCancelRename={handleCancelRename}
              />
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}
