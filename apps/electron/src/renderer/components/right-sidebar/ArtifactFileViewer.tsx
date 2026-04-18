/**
 * ArtifactFileViewer - Displays file content with syntax highlighting
 *
 * - Empty state when no file is selected
 * - Reads file content via electronAPI.readFile
 * - For .md/.markdown: Preview (react-markdown) or Code tab toggle
 * - For other text files: ShikiCodeViewer with auto-detected language
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import { FileText, Copy, Check, Ban } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ShikiCodeViewer } from '@/components/shiki/ShikiCodeViewer'
import { StreamingMarkdown } from '@/components/markdown/StreamingMarkdown'
import * as storage from '@/lib/local-storage'
import { cn } from '@/lib/utils'

/**
 * Binary/non-text extensions that cannot be previewed as code.
 * Files with these extensions show an "unsupported format" message
 * instead of attempting a text read.
 */
const BINARY_EXTENSIONS = new Set([
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico',
  'heic', 'heif', 'avif', 'raw', 'cr2', 'nef',
  // PDF
  'pdf',
  // Audio
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus',
  // Video
  'mp4', 'avi', 'mov', 'mkv', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg',
  // Executables / native binaries
  'exe', 'dmg', 'pkg', 'deb', 'rpm', 'msi', 'app',
  'so', 'dylib', 'dll', 'o', 'a', 'out',
  // Archives
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'br',
  // Office / document formats
  'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt',
  'odt', 'ods', 'odp', 'pages', 'numbers', 'key',
  // Fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // Databases
  'sqlite', 'sqlite3', 'db',
  // Design
  'psd', 'ai', 'sketch', 'fig', 'xd',
  // Other binary
  'bin', 'dat', 'iso', 'img',
])

function isPreviewable(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return !BINARY_EXTENSIONS.has(ext)
}

type MdMode = 'preview' | 'code'

interface ArtifactFileViewerProps {
  path: string | null
}

function isMarkdown(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase()
  return ext === 'md' || ext === 'markdown'
}

export function ArtifactFileViewer({ path }: ArtifactFileViewerProps) {
  const [content, setContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [mdMode, setMdMode] = useState<MdMode>(() =>
    storage.get(storage.KEYS.artifactMdMode, 'preview' as MdMode)
  )

  useEffect(() => {
    if (!path || !isPreviewable(path)) {
      setContent('')
      setError(null)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)
    setContent('')

    window.electronAPI.readFile(path).then((text) => {
      if (!cancelled) {
        setContent(text)
        setIsLoading(false)
      }
    }).catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Failed to read file')
        setIsLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [path])

  const handleCopy = () => {
    if (!content) return
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleMdModeChange = (mode: MdMode) => {
    setMdMode(mode)
    storage.set(storage.KEYS.artifactMdMode, mode)
  }

  // Empty state
  if (!path) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6 text-center gap-3">
        <div className="size-12 bg-foreground/[0.04] rounded-xl flex items-center justify-center">
          <FileText className="size-6 text-muted-foreground/50" />
        </div>
        <p className="text-sm text-muted-foreground">Select a file to view it here</p>
      </div>
    )
  }

  const fileName = path.split('/').pop() ?? path
  const isMd = isMarkdown(path)

  // Unsupported binary format
  if (!isPreviewable(path)) {
    const ext = path.split('.').pop()?.toLowerCase() ?? 'unknown'
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 min-w-0">
          <FileText className="size-3.5 text-muted-foreground shrink-0" />
          <span className="flex-1 min-w-0 text-xs font-mono text-muted-foreground truncate select-all" title={path}>
            {fileName}
          </span>
        </div>
        <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
          <div className="size-12 bg-foreground/[0.04] rounded-xl flex items-center justify-center">
            <Ban className="size-6 text-muted-foreground/50" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">.{ext} files cannot be previewed</p>
            <p className="text-xs text-muted-foreground">
              Supported: text, code, markdown, HTML, JSON, YAML, and other plain-text formats
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* File header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 min-w-0">
        <FileText className="size-3.5 text-muted-foreground shrink-0" />
        <span
          className="flex-1 min-w-0 text-xs font-mono text-muted-foreground truncate select-all"
          title={path}
        >
          {fileName}
        </span>

        {/* Markdown Preview/Code toggle */}
        {isMd && !isLoading && !error && (
          <div className="flex items-center rounded-md bg-foreground/[0.06] p-0.5 shrink-0">
            <button
              onClick={() => handleMdModeChange('preview')}
              className={cn(
                'px-2 py-0.5 text-xs rounded-sm transition-colors select-none',
                mdMode === 'preview'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Preview
            </button>
            <button
              onClick={() => handleMdModeChange('code')}
              className={cn(
                'px-2 py-0.5 text-xs rounded-sm transition-colors select-none',
                mdMode === 'code'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Code
            </button>
          </div>
        )}

        {/* Copy button */}
        <button
          onClick={handleCopy}
          disabled={!content}
          title="Copy file content"
          className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors disabled:opacity-40"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-xs">Loading...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
            <p className="text-xs font-medium text-destructive">Failed to read file</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        ) : isMd && mdMode === 'preview' ? (
          <ScrollArea className="h-full">
            <div className="p-4">
              <StreamingMarkdown content={content} isStreaming={false} />
            </div>
          </ScrollArea>
        ) : (
          <ShikiCodeViewer
            code={content}
            filePath={path}
            className="h-full"
          />
        )}
      </div>
    </div>
  )
}
