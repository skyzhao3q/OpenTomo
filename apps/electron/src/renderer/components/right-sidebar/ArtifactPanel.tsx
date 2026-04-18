/**
 * ArtifactPanel - Right sidebar panel
 *
 * Shows the Explorer: file tree (left) + file content viewer (right), resizable split.
 *
 * The file tree shows the session's working directory, or session folder
 * as fallback (handled by SessionFilesSection internally).
 */

import * as React from 'react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { PanelHeader } from '../app-shell/PanelHeader'
import { SessionFilesSection } from './SessionFilesSection'
import { ArtifactFileViewer } from './ArtifactFileViewer'
import { useSession as useSessionData } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import type { SessionFile } from '../../../shared/types'

const DEFAULT_TREE_WIDTH = 180
const MIN_TREE_WIDTH = 100
const MIN_VIEWER_WIDTH = 120

export interface ArtifactPanelProps {
  sessionId?: string
  closeButton?: React.ReactNode
}

export function ArtifactPanel({ sessionId, closeButton }: ArtifactPanelProps) {
  const session = useSessionData(sessionId ?? '')

  // Explorer: selected file and tree width
  const [selectedFile, setSelectedFile] = useState<SessionFile | null>(null)
  const [treeWidth, setTreeWidth] = useState(() =>
    storage.get(storage.KEYS.artifactPanelTreeWidth, DEFAULT_TREE_WIDTH)
  )
  const [isResizing, setIsResizing] = useState(false)
  const explorerRef = useRef<HTMLDivElement>(null)

  // Reset selected file when session changes
  useEffect(() => {
    setSelectedFile(null)
  }, [sessionId])

  const handleFileSelect = useCallback((file: SessionFile) => {
    setSelectedFile(file)
  }, [])

  // Vertical resize handle for tree/viewer split
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!explorerRef.current) return
      const rect = explorerRef.current.getBoundingClientRect()
      const newWidth = e.clientX - rect.left
      const maxWidth = rect.width - MIN_VIEWER_WIDTH
      setTreeWidth(Math.max(MIN_TREE_WIDTH, Math.min(newWidth, maxWidth)))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      setTreeWidth((w) => {
        storage.set(storage.KEYS.artifactPanelTreeWidth, w)
        return w
      })
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <PanelHeader
        title="Artifact Panel"
        actions={
          <div className="flex items-center">
            {closeButton}
          </div>
        }
      />

      {/* Explorer — horizontal split: file tree | file viewer */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div
          ref={explorerRef}
          className="absolute inset-0 flex overflow-hidden"
        >
          {/* File tree */}
          <div
            className="shrink-0 overflow-hidden flex flex-col"
            style={{ width: treeWidth }}
          >
            <SessionFilesSection
              sessionId={sessionId}
              workingDirectory={session?.workingDirectory}
              baseDirectory={session?.workingDirectory ?? session?.sessionFolderPath}
              onFileSelect={handleFileSelect}
              className="h-full"
            />
          </div>

          {/* Vertical resize handle */}
          <div
            onMouseDown={handleResizeMouseDown}
            className={cn(
              'w-0 shrink-0 relative cursor-col-resize z-10',
              isResizing && 'select-none'
            )}
          >
            <div className="absolute inset-y-0 -left-1.5 -right-1.5 flex items-center justify-center">
              <div className="w-px h-full bg-border hover:bg-foreground/20 transition-colors" />
            </div>
          </div>

          {/* File viewer */}
          <div className="flex-1 min-w-0 overflow-hidden border-l border-border">
            <ArtifactFileViewer path={selectedFile?.path ?? null} />
          </div>
        </div>
      </div>
    </div>
  )
}
