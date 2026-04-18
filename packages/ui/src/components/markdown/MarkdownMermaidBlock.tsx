import * as React from 'react'
import { CodeBlock } from './CodeBlock'

// ============================================================================
// MarkdownMermaidBlock — stub implementation.
//
// The @opentomo/mermaid package has been removed. This stub falls back to
// rendering mermaid code fences as plain code blocks so the app continues to
// compile and display the raw diagram source rather than crashing.
// ============================================================================

interface MarkdownMermaidBlockProps {
  code: string
  className?: string
  /** Whether to show the inline expand button. Default true.
   *  Set to false when the mermaid block is the first block in a message,
   *  where the TurnCard's own fullscreen button already occupies the same position. */
  showExpandButton?: boolean
}

export function MarkdownMermaidBlock({ code, className }: MarkdownMermaidBlockProps) {
  return <CodeBlock code={code} language="mermaid" mode="full" className={className} />
}
