/**
 * MarkdownImageGenBlock
 *
 * Renders image-gen-request and image-gen-result fenced blocks inside Markdown.
 * Uses MarkdownMediaContext for IPC actions (generate, cancel, show in folder, etc.)
 * so this component works without direct Electron dependency.
 */

import * as React from 'react'
import * as ReactDOM from 'react-dom'

// ─────────────────────────────────────────────────────────────────────────────
// Context for media actions (provided by the Electron renderer)
// ─────────────────────────────────────────────────────────────────────────────

export interface MarkdownMediaActions {
  /** Current session ID — needed for persisting results */
  sessionId?: string
  generate: (params: {
    prompt: string
    aspectRatio?: string
    resolution?: string
    referenceImagePath?: string
  }) => Promise<{
    success: boolean
    generation?: {
      id: string
      prompt: string
      filePath: string
      aspectRatio: string
      resolution: string
      model: string
      provider: string
    }
    error?: string
  }>
  cancelGenerate: () => Promise<void>
  showInFolder: (path: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  /** Fallback: read image file as data URL when custom protocol fails */
  readImageAsDataUrl?: (path: string) => Promise<string | null>
  /** Persist image-gen-result back into the assistant message (replaces image-gen-request) */
  persistResult?: (requestCode: string, resultCode: string) => Promise<boolean>
  /** Get the last generated image path for continuous editing */
  getLastGeneratedPath?: () => string | null
  /** Set the last generated image path after generation */
  setLastGeneratedPath?: (path: string) => void
}

const MarkdownMediaContext = React.createContext<MarkdownMediaActions | null>(null)

export const MarkdownMediaProvider = MarkdownMediaContext.Provider

export function useMarkdownMedia(): MarkdownMediaActions | null {
  return React.useContext(MarkdownMediaContext)
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

interface ImageGenRequestData {
  prompt: string
  aspectRatio?: string
  resolution?: string
  useLastGenerated?: boolean
}

interface ImageGenResultData {
  id: string
  prompt: string
  filePath: string
  aspectRatio: string
  resolution: string
  model: string
  provider: string
}

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9']
const RESOLUTIONS = ['1K', '2K', '4K']

// ─────────────────────────────────────────────────────────────────────────────
// ImageGenConfirmBlock
// ─────────────────────────────────────────────────────────────────────────────

export function ImageGenConfirmBlock({ code, className }: { code: string; className?: string }) {
  const actions = useMarkdownMedia()

  let data: ImageGenRequestData
  try {
    data = JSON.parse(code)
  } catch {
    return <pre className={className}><code>{code}</code></pre>
  }

  const [prompt, setPrompt] = React.useState(data.prompt)
  const [aspectRatio, setAspectRatio] = React.useState(data.aspectRatio || '1:1')
  const [resolution, setResolution] = React.useState(data.resolution || '1K')
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ImageGenResultData | null>(null)

  const handleGenerate = React.useCallback(async () => {
    if (!actions) return
    setIsGenerating(true)
    setError(null)

    // If useLastGenerated, pass the last generated image as reference
    let referenceImagePath: string | undefined
    if (data.useLastGenerated && actions.getLastGeneratedPath) {
      referenceImagePath = actions.getLastGeneratedPath() || undefined
    }

    const res = await actions.generate({ prompt, aspectRatio, resolution, referenceImagePath })
    setIsGenerating(false)

    if (res.success && res.generation) {
      const resultData = res.generation as ImageGenResultData
      setResult(resultData)

      // Track last generated image for continuous editing
      actions.setLastGeneratedPath?.(resultData.filePath)

      // Persist result back into the message so it survives session reload
      actions.persistResult?.(code, JSON.stringify(resultData))
        .then((ok) => console.log('[ImageGen] persistResult:', ok ? 'success' : 'failed'))
        .catch((err) => console.error('[ImageGen] persistResult error:', err))
    } else {
      setError(res.error || 'Generation failed')
    }
  }, [actions, prompt, aspectRatio, resolution, code, data.useLastGenerated])

  const handleCancel = React.useCallback(async () => {
    if (!actions) return
    await actions.cancelGenerate()
    setIsGenerating(false)
  }, [actions])

  if (result) {
    return <ImageGenResultBlock code={JSON.stringify(result)} className={className} onRegenerate={() => setResult(null)} />
  }

  return (
    <div className={`rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-4 my-2 max-w-lg ${className || ''}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <span className="text-sm font-medium">Image Generation</span>
        {data.useLastGenerated && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border opacity-60">Edit</span>
        )}
      </div>

      {/* Prompt */}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 text-sm resize-none min-h-[80px] focus:outline-none"
        placeholder="Image prompt..."
        disabled={isGenerating}
      />

      {/* Aspect Ratio Pills */}
      <div className="mt-3">
        <span className="text-xs opacity-60 mb-1.5 block">Aspect Ratio</span>
        <div className="flex flex-wrap gap-1.5">
          {ASPECT_RATIOS.map((ar) => (
            <button
              key={ar}
              type="button"
              onClick={() => setAspectRatio(ar)}
              disabled={isGenerating}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                aspectRatio === ar
                  ? 'bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]'
                  : 'border-[var(--border)] opacity-60 hover:opacity-80'
              }`}
            >
              {ar}
            </button>
          ))}
        </div>
      </div>

      {/* Resolution Pills */}
      <div className="mt-3">
        <span className="text-xs opacity-60 mb-1.5 block">Resolution</span>
        <div className="flex gap-1.5">
          {RESOLUTIONS.map((res) => (
            <button
              key={res}
              type="button"
              onClick={() => setResolution(res)}
              disabled={isGenerating}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                resolution === res
                  ? 'bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]'
                  : 'border-[var(--border)] opacity-60 hover:opacity-80'
              }`}
            >
              {res}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-3 text-xs text-red-500 bg-red-500/10 rounded-lg p-2">{error}</div>
      )}

      {/* Buttons */}
      <div className="mt-4 flex gap-2">
        {isGenerating ? (
          <>
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
            >
              Stop
            </button>
            <span className="flex items-center gap-2 text-sm opacity-60">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Generating...
            </span>
          </>
        ) : (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!prompt.trim() || !actions}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Generate
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ImageGenResultBlock
// ─────────────────────────────────────────────────────────────────────────────

export function ImageGenResultBlock({ code, className, onRegenerate }: { code: string; className?: string; onRegenerate?: () => void }) {
  const actions = useMarkdownMedia()
  const [imgError, setImgError] = React.useState(false)
  const [dataUrl, setDataUrl] = React.useState<string | null>(null)
  const [fullscreen, setFullscreen] = React.useState(false)

  let data: ImageGenResultData
  try {
    data = JSON.parse(code)
  } catch {
    return <pre className={className}><code>{code}</code></pre>
  }

  const fileName = data.filePath.replace(/\\/g, '/').split('/').pop() || ''
  const imageUrl = `media-image://serve/${fileName}`

  // Fallback: if custom protocol fails, load image via IPC as base64
  React.useEffect(() => {
    if (imgError && !dataUrl && actions?.readImageAsDataUrl) {
      actions.readImageAsDataUrl(data.filePath)
        .then((url) => { if (url) setDataUrl(url) })
        .catch(() => { /* no fallback available */ })
    }
  }, [imgError, dataUrl, actions, data.filePath])

  // Close fullscreen on Escape
  React.useEffect(() => {
    if (!fullscreen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [fullscreen])

  const displayUrl = dataUrl || imageUrl

  return (
    <>
      <div className={`rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 p-4 my-2 max-w-lg ${className || ''}`}>
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          <span className="text-sm font-medium">Image Generation</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border opacity-60">
            {data.aspectRatio} · {data.resolution}
          </span>
        </div>

        {/* Image */}
        <div
          className="rounded-lg overflow-hidden cursor-pointer border border-[var(--border)] bg-[var(--background)]"
          onClick={() => setFullscreen(true)}
        >
          <img
            src={displayUrl}
            alt={data.prompt}
            className="w-full h-auto object-contain"
            style={{ maxHeight: '400px' }}
            onError={() => {
              console.error(`[ImageGenResultBlock] Failed to load image: ${imageUrl}`)
              setImgError(true)
            }}
            onLoad={() => console.log(`[ImageGenResultBlock] Image loaded: ${displayUrl}`)}
          />
        </div>

        {/* Prompt */}
        <p className="mt-3 text-xs opacity-60" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {data.prompt}
        </p>

        {/* Actions */}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => actions?.showInFolder(data.filePath)}
            className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
          >
            Show in Folder
          </button>
          <button
            type="button"
            onClick={() => actions?.openFile(data.filePath)}
            className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
          >
            Open
          </button>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
            >
              Regenerate
            </button>
          )}
        </div>
      </div>

      {/* Fullscreen overlay — portaled to body to escape overflow:hidden containers */}
      {fullscreen && ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
          onClick={() => setFullscreen(false)}
        >
          <img
            src={displayUrl}
            alt={data.prompt}
            className="max-w-[90vw] max-h-[90vh] object-contain cursor-default"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}
    </>
  )
}
