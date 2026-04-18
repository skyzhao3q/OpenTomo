import * as React from 'react'
import { Markdown, type RenderMode } from './Markdown'
import { WidgetRenderer } from '../widget/WidgetRenderer'
import {
  parseAllShowWidgets,
  computePartialWidgetKey,
  extractPartialCode,
  WIDGET_FENCE,
} from '@opentomo/shared/widget'

interface StreamingMarkdownProps {
  content: string
  isStreaming: boolean
  mode?: RenderMode
  onUrlClick?: (url: string) => void
  onFileClick?: (path: string) => void
  /** Forwarded to <Markdown id=...> for block memoization in non-streaming path */
  messageId?: string
  /** Forwarded to <Markdown className=...> in non-streaming path */
  className?: string
  /** Forwarded to <Markdown collapsible> in non-streaming path */
  collapsible?: boolean
}

interface Block {
  content: string
  isCodeBlock: boolean
}

/**
 * Simple hash function for cache keys
 * Uses djb2 algorithm - fast and produces good distribution
 */
function simpleHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Split content into blocks (paragraphs and code blocks)
 *
 * Block boundaries:
 * - Double newlines (paragraph separators)
 * - Code fences (```)
 *
 * This is intentionally simple - just string scanning, no regex per line.
 */
function splitIntoBlocks(content: string): Block[] {
  const blocks: Block[] = []
  const lines = content.split('\n')
  let currentBlock = ''
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Check for code fence (``` at start of line, optionally followed by language)
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        // Starting a code block - flush current paragraph first
        if (currentBlock.trim()) {
          blocks.push({ content: currentBlock.trim(), isCodeBlock: false })
          currentBlock = ''
        }
        inCodeBlock = true
        currentBlock = line + '\n'
      } else {
        // Ending a code block
        currentBlock += line
        blocks.push({ content: currentBlock, isCodeBlock: true })
        currentBlock = ''
        inCodeBlock = false
      }
    } else if (inCodeBlock) {
      // Inside code block - append line
      currentBlock += line + '\n'
    } else if (line === '') {
      // Empty line outside code block = paragraph boundary
      if (currentBlock.trim()) {
        blocks.push({ content: currentBlock.trim(), isCodeBlock: false })
        currentBlock = ''
      }
    } else {
      // Regular text line
      if (currentBlock) {
        currentBlock += '\n' + line
      } else {
        currentBlock = line
      }
    }
  }

  // Flush remaining content
  if (currentBlock) {
    blocks.push({
      content: inCodeBlock ? currentBlock : currentBlock.trim(),
      isCodeBlock: inCodeBlock // Unclosed code block = still streaming
    })
  }

  return blocks
}

/**
 * Memoized block component
 *
 * Only re-renders if content or mode changes.
 * The key is assigned by the parent based on content hash,
 * so identical content won't even attempt to render.
 */
const MemoizedBlock = React.memo(function Block({
  content,
  mode,
  onUrlClick,
  onFileClick,
}: {
  content: string
  mode: RenderMode
  onUrlClick?: (url: string) => void
  onFileClick?: (path: string) => void
}) {
  return (
    <Markdown mode={mode} onUrlClick={onUrlClick} onFileClick={onFileClick}>
      {content}
    </Markdown>
  )
}, (prev, next) => {
  // Only re-render if content actually changed
  return prev.content === next.content && prev.mode === next.mode
})
MemoizedBlock.displayName = 'MemoizedBlock'

/**
 * StreamingMarkdown - Optimized markdown renderer for streaming content
 *
 * Splits content into blocks (paragraphs, code blocks) and memoizes each block
 * independently. Only the last (active) block re-renders during streaming.
 *
 * Key insight: Completed blocks get a content-hash as their React key.
 * Same content = same key = React skips re-render entirely.
 *
 * @example
 * Content: "Hello\n\n```js\ncode\n```\n\nMore..."
 *
 * Block 1: "Hello"           → key="block-abc123" → memoized ✓
 * Block 2: "```js\ncode\n```" → key="block-xyz789" → memoized ✓
 * Block 3: "More..."         → key="active-2"     → re-renders
 */
export function StreamingMarkdown({
  content,
  isStreaming,
  mode = 'minimal',
  onUrlClick,
  onFileClick,
  messageId,
  className,
  collapsible,
}: StreamingMarkdownProps) {
  // Split into blocks - memoized to avoid recomputation
  // Must be called unconditionally to satisfy Rules of Hooks
  const blocks = React.useMemo(
    () => (isStreaming ? splitIntoBlocks(content) : []),
    [content, isStreaming]
  )

  // Widget-aware path — checked BEFORE !isStreaming so that WidgetRenderer keeps the
  // same React key (w-N) across the streaming→non-streaming transition.
  // Remounting the iframe on streaming end would reload CDN scripts and lose the chart.
  if (content.includes(WIDGET_FENCE)) {
    return (
      <StreamingWidgetContent
        content={content}
        mode={mode}
        onUrlClick={onUrlClick}
        onFileClick={onFileClick}
      />
    )
  }

  // Not streaming - use simple Markdown (no block splitting needed)
  // Completed show-widget fences are handled by Markdown.tsx's code block renderer.
  if (!isStreaming) {
    return (
      <Markdown
        mode={mode}
        onUrlClick={onUrlClick}
        onFileClick={onFileClick}
        id={messageId}
        className={className}
        collapsible={collapsible}
      >
        {content}
      </Markdown>
    )
  }

  // Default streaming path: block-level memoization
  return (
    <>
      {blocks.map((block, i) => {
        const isLastBlock = i === blocks.length - 1

        // Complete blocks use content hash as key → stable identity → memoized
        // Last block uses "active" prefix → always re-renders on content change
        const key = isLastBlock
          ? `active-${i}`
          : `block-${simpleHash(block.content)}`

        return (
          <MemoizedBlock
            key={key}
            content={block.content}
            mode={mode}
            onUrlClick={onUrlClick}
            onFileClick={onFileClick}
          />
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Widget-aware streaming renderer
// ---------------------------------------------------------------------------

/**
 * Renders content that contains one or more show-widget fences during streaming.
 *
 * Handles:
 * - Issue 1: text before the first fence preserved (not passed through parseAllShowWidgets)
 * - Issue 5: unclosed <script> truncated with shimmer overlay
 * - Issue 7: partial widget React key matches the key after fence closes
 */
function StreamingWidgetContent({
  content,
  mode,
  onUrlClick,
  onFileClick,
}: {
  content: string
  mode: RenderMode
  onUrlClick?: (url: string) => void
  onFileClick?: (path: string) => void
}) {
  const lastFenceStart = content.lastIndexOf(WIDGET_FENCE)
  const afterLastFence = content.slice(lastFenceStart)
  // Line-based check: find a line that is exactly ``` after the fence marker
  const lastFenceClosed = (() => {
    const markerEnd = afterLastFence.indexOf('\n')
    if (markerEnd === -1) return false
    const lines = afterLastFence.slice(markerEnd + 1).split('\n')
    return lines.some(line => line.trim() === '```')
  })()

  if (lastFenceClosed) {
    // All fences are complete — parse the full content
    const allSegments = parseAllShowWidgets(content)
    return (
      <>
        {allSegments.map((seg, i) =>
          seg.type === 'text' ? (
            <Markdown key={`t-${i}`} mode={mode} onUrlClick={onUrlClick} onFileClick={onFileClick}>
              {seg.content}
            </Markdown>
          ) : (
            <WidgetRenderer
              key={`w-${i}`}
              widgetCode={seg.data.widget_code}
              isStreaming={false}
              title={seg.data.title}
            />
          )
        )}
      </>
    )
  }

  // Last fence is still open (streaming)
  const beforePart = content.slice(0, lastFenceStart).trim()
  const hasCompletedFences = beforePart.length > 0 && beforePart.includes(WIDGET_FENCE)
  const completedSegments = hasCompletedFences ? parseAllShowWidgets(beforePart) : []

  const fenceBody = content.slice(lastFenceStart + WIDGET_FENCE.length).trim()
  const { code: partialCode, scriptsTruncated } = extractPartialCode(fenceBody)

  // Issue 7: stable key that matches the key after fence closes
  const partialWidgetKey = computePartialWidgetKey(content)

  return (
    <>
      {/* Issue 1: text before first fence rendered directly, not through parseAllShowWidgets */}
      {!hasCompletedFences && beforePart && (
        <Markdown key="pre-text" mode={mode} onUrlClick={onUrlClick} onFileClick={onFileClick}>
          {beforePart}
        </Markdown>
      )}
      {/* Completed fences before the current streaming one */}
      {completedSegments.map((seg, i) =>
        seg.type === 'text' ? (
          <Markdown key={`t-${i}`} mode={mode} onUrlClick={onUrlClick} onFileClick={onFileClick}>
            {seg.content}
          </Markdown>
        ) : (
          <WidgetRenderer
            key={`w-${i}`}
            widgetCode={seg.data.widget_code}
            isStreaming={false}
            title={seg.data.title}
          />
        )
      )}
      {/* Current streaming (partial) widget */}
      {partialCode ? (
        <WidgetRenderer
          key={partialWidgetKey}
          widgetCode={partialCode}
          isStreaming={true}
          showOverlay={scriptsTruncated}
        />
      ) : (
        <span className="text-muted-foreground text-xs animate-pulse">生成中...</span>
      )}
    </>
  )
}
