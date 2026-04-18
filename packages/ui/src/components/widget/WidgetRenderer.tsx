import * as React from 'react'
import { sanitizeForStreaming, sanitizeForIframe, buildReceiverSrcdoc } from '@opentomo/shared/widget'
import chartJsSrc from './vendor/chartjs.umd.min.js?raw'
import { resolveThemeVars, getWidgetIframeStyleBlock } from './widget-css-bridge'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'

export interface WidgetRendererProps {
  widgetCode: string
  isStreaming: boolean
  title?: string
  /** Show shimmer overlay — used when <script> is being truncated during streaming */
  showOverlay?: boolean
}

const MAX_IFRAME_HEIGHT = 4000
const STREAM_DEBOUNCE = 120
const CDN_PATTERN = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|esm\.sh/

// ---------------------------------------------------------------------------
// Module-level height cache — survives component remounts (Issue 4)
// Key: first 200 chars of widgetCode
// ---------------------------------------------------------------------------
const _heightCache = new Map<string, number>()

function getHeightCacheKey(code: string): string {
  return code.slice(0, 200)
}

// ---------------------------------------------------------------------------
// Inner component (wrapped by WidgetErrorBoundary)
// ---------------------------------------------------------------------------

function WidgetRendererInner({
  widgetCode,
  isStreaming,
  title,
  showOverlay,
}: WidgetRendererProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentRef = React.useRef<string>('')
  const finalizedRef = React.useRef(false)
  const heightLockedRef = React.useRef(false) // Issue 2/3: prevent height collapse during finalize

  const cacheKey = getHeightCacheKey(widgetCode)
  const cachedH = _heightCache.get(cacheKey) ?? 0

  const [iframeReady, setIframeReady] = React.useState(false)
  const [iframeHeight, setIframeHeight] = React.useState<number>(cachedH) // Issue 4: restore from cache
  const [showCode, setShowCode] = React.useState(false)
  const [finalized, setFinalized] = React.useState(false)

  // Whether we have already received the first height report (skip transition on first resize)
  const hasReceivedFirstHeight = React.useRef(cachedH > 0) // Issue 2

  // CDN-dependent widgets show loading overlay until finalize completes
  const hasCDN = React.useMemo(() => CDN_PATTERN.test(widgetCode), [widgetCode])

  // Build srcdoc once at mount — theme vars are resolved at this point (Issue 7)
  const srcdoc = React.useMemo(() => {
    const isDark = document.documentElement.classList.contains('dark')
    const resolvedVars = resolveThemeVars()
    const styleBlock = getWidgetIframeStyleBlock(resolvedVars)
    return buildReceiverSrcdoc(styleBlock, isDark, chartJsSrc)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // postMessage handler
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || typeof e.data.type !== 'string') return
      // Ensure message comes from our iframe (Issue 6 defence)
      if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return

      switch (e.data.type) {
        case 'widget:ready':
          console.log('[WidgetRenderer] iframe ready')
          setIframeReady(true)
          break

        case 'widget:resize': {
          if (typeof e.data.height !== 'number' || e.data.height <= 0) break
          const newH = Math.min(e.data.height + 2, MAX_IFRAME_HEIGHT)
          if (heightLockedRef.current) {
            // During finalize: only allow height to grow, never shrink (Issue 3)
            setIframeHeight((prev) => {
              const h = Math.max(prev, newH)
              _heightCache.set(cacheKey, h)
              return h
            })
            break
          }
          _heightCache.set(cacheKey, newH)
          if (!hasReceivedFirstHeight.current) {
            // Issue 2: disable transition on very first height report
            hasReceivedFirstHeight.current = true
            const el = iframeRef.current
            if (el) {
              el.style.transition = 'none'
              void el.offsetHeight // force reflow
            }
            setIframeHeight(newH)
            requestAnimationFrame(() => {
              if (iframeRef.current) {
                iframeRef.current.style.transition = 'height 0.3s ease-out'
              }
            })
          } else {
            setIframeHeight(newH)
          }
          break
        }

        case 'widget:link': {
          const href = String(e.data.href ?? '')
          if (href && !/^\s*(javascript|data)\s*:/i.test(href)) {
            // Prefer IPC-based openExternal (set via window.__widgetOpenUrl by ChatDisplay)
            const openFn = (window as unknown as Record<string, unknown>).__widgetOpenUrl
            if (typeof openFn === 'function') {
              ;(openFn as (url: string) => void)(href)
            } else {
              window.open(href, '_blank', 'noopener,noreferrer')
            }
          }
          break
        }

        case 'widget:sendMessage': {
          const text = String(e.data.text ?? '')
          const fn = (window as unknown as Record<string, unknown>).__widgetSendMessage
          if (text && text.length <= 500 && typeof fn === 'function') {
            ;(fn as (msg: string) => void)(text)
          }
          break
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [cacheKey])

  // -------------------------------------------------------------------------
  // Streaming update (debounced)
  // -------------------------------------------------------------------------
  const sendUpdate = React.useCallback((html: string) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    if (html === lastSentRef.current) return // dedup
    lastSentRef.current = html
    iframe.contentWindow.postMessage({ type: 'widget:update', html }, '*')
  }, [])

  React.useEffect(() => {
    if (!isStreaming || !iframeReady) return
    const sanitized = sanitizeForStreaming(widgetCode)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => sendUpdate(sanitized), STREAM_DEBOUNCE)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [widgetCode, isStreaming, iframeReady, sendUpdate])

  // -------------------------------------------------------------------------
  // Finalize
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    if (isStreaming || !iframeReady || finalizedRef.current) return
    const sanitized = sanitizeForIframe(widgetCode)
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    finalizedRef.current = true
    lastSentRef.current = sanitized
    heightLockedRef.current = true // prevent height collapse during innerHTML swap (Issue 3)
    console.log('[WidgetRenderer] Sending widget:finalize, html length:', sanitized.length,
      'hasCDN:', CDN_PATTERN.test(widgetCode),
      'hasScript:', /<script/i.test(sanitized),
      'preview:', sanitized.slice(0, 200))
    iframe.contentWindow.postMessage({ type: 'widget:finalize', html: sanitized }, '*')
    setTimeout(() => {
      heightLockedRef.current = false
      setFinalized(true)
    }, 400)
  }, [isStreaming, iframeReady, widgetCode])

  // -------------------------------------------------------------------------
  // Theme sync via MutationObserver (FR-7)
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    if (!iframeReady) return
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains('dark')
      const vars = resolveThemeVars()
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'widget:theme', vars, isDark },
        '*'
      )
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [iframeReady])

  const showLoadingOverlay = hasCDN && !isStreaming && iframeReady && !finalized

  return (
    <div className="group/widget relative my-1 min-w-0">
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        title={title ?? 'Widget'}
        // Issue 6: onLoad as fallback in case widget:ready fires before useEffect listener
        onLoad={() => setIframeReady(true)}
        style={{
          width: '100%',
          height: iframeHeight || undefined,
          border: 'none',
          display: showCode ? 'none' : 'block',
          overflow: 'hidden',
          colorScheme: 'auto',
          minHeight: iframeHeight ? undefined : '20px',
        }}
      />

      {/* Shimmer overlay for CDN loading or script truncation during streaming */}
      {(showLoadingOverlay || showOverlay) && (
        <div
          className="absolute inset-0 pointer-events-none rounded-lg"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(128,128,128,0.08) 50%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'widget-shimmer 1.5s ease-in-out infinite',
          }}
        />
      )}

      {/* Show code view */}
      {showCode && (
        <pre className="p-3 text-xs rounded-lg bg-muted/30 overflow-x-auto max-h-80 overflow-y-auto border border-border/30">
          <code>{widgetCode}</code>
        </pre>
      )}

      {/* Show/hide code toggle (visible on hover) */}
      <button
        type="button"
        onClick={() => setShowCode((v) => !v)}
        className="absolute top-1 right-1 opacity-0 group-hover/widget:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50"
      >
        {showCode ? 'Hide code' : 'Show code'}
      </button>
    </div>
  )
}

/**
 * WidgetRenderer — renders an AI-generated HTML/SVG widget in a sandbox iframe.
 *
 * Supports:
 * - Streaming preview (sanitized, no scripts)
 * - Finalize with script execution and zero-redraw optimisation
 * - Height auto-adjustment with cache for remount stability
 * - Dark/light theme sync via MutationObserver
 * - Drill-down via `window.__widgetSendMessage`
 * - Error boundary to prevent chat crashes
 */
export function WidgetRenderer(props: WidgetRendererProps) {
  return (
    <WidgetErrorBoundary>
      <WidgetRendererInner {...props} />
    </WidgetErrorBoundary>
  )
}
