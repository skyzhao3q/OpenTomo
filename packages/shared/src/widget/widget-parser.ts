/**
 * Widget parser utilities for Generative UI.
 *
 * Handles parsing of `show-widget` code fences from streaming and completed
 * AI responses into WidgetSegment arrays for rendering.
 */

export type WidgetSegment =
  | { type: 'text'; content: string }
  | { type: 'widget'; data: { title?: string; widget_code: string } }

/** Fence marker used by the AI to output widgets */
export const WIDGET_FENCE = '```show-widget'

/**
 * Find all show-widget fence ranges using line-based scanning.
 *
 * Unlike regex `[\s\S]*?```, this correctly handles widget_code values
 * that contain triple-backtick characters (e.g. code examples in HTML).
 * The closing fence must be a line that is exactly ``` (with optional whitespace).
 */
function findFenceRanges(text: string): Array<{ start: number; end: number; body: string }> {
  const ranges: Array<{ start: number; end: number; body: string }> = []
  let searchFrom = 0

  while (searchFrom < text.length) {
    const fenceStart = text.indexOf(WIDGET_FENCE, searchFrom)
    if (fenceStart === -1) break

    // Find end of the opening fence line
    const afterMarker = fenceStart + WIDGET_FENCE.length
    let lineEnd = text.indexOf('\n', afterMarker)
    if (lineEnd === -1) {
      // No newline after marker — unclosed, single-line fence (streaming)
      break
    }

    // Scan subsequent lines for a closing fence: a line that is exactly ```
    const bodyStart = lineEnd + 1
    let closingPos = -1
    let closingLineStart = -1
    let scanPos = bodyStart

    while (scanPos < text.length) {
      let nextLineEnd = text.indexOf('\n', scanPos)
      if (nextLineEnd === -1) nextLineEnd = text.length
      const line = text.slice(scanPos, nextLineEnd).trim()
      if (line === '```') {
        // Standard closing fence: a line that is exactly ```
        closingLineStart = scanPos
        closingPos = nextLineEnd
        break
      }
      if (line !== '```' && line.endsWith('```')) {
        // Inline-closed fence: closing ``` appears at end of JSON line, e.g.:
        //   {"title":"...","widget_code":"..."} ```
        // Include this line in the body so JSON can be extracted, then strip ``` below.
        closingLineStart = nextLineEnd
        closingPos = nextLineEnd
        break
      }
      scanPos = nextLineEnd + 1
    }

    if (closingPos === -1) {
      // Unclosed fence — no more complete fences after this
      break
    }

    // The body is between the opening line and the closing ``` line.
    // Strip any trailing ``` (inline-closed fence format).
    const body = text.slice(bodyStart, closingLineStart).trim().replace(/\s*```\s*$/, '')
    ranges.push({ start: fenceStart, end: closingPos, body })
    searchFrom = closingPos + 1
  }

  return ranges
}

/**
 * Parse all completed `show-widget` fences in text, returning an array of
 * text and widget segments.
 *
 * Handles both:
 * - Fully closed fences (both opening and closing ``` present)
 * - A trailing unclosed fence (streaming in progress)
 *
 * Uses line-based fence detection (not regex) so that triple-backticks
 * inside widget_code values don't break the parsing.
 */
export function parseAllShowWidgets(text: string): WidgetSegment[] {
  const segments: WidgetSegment[] = []
  const ranges = findFenceRanges(text)

  if (ranges.length === 0) {
    // No completed fences — check for a single unclosed fence
    const fenceStart = text.indexOf(WIDGET_FENCE)
    if (fenceStart === -1) return []
    const before = text.slice(0, fenceStart).trim()
    if (before) segments.push({ type: 'text', content: before })
    const fenceBody = text.slice(fenceStart + WIDGET_FENCE.length).trim()
    const widget = extractTruncatedWidget(fenceBody)
    if (widget) segments.push({ type: 'widget', data: widget })
    return segments
  }

  let lastEnd = 0
  for (const range of ranges) {
    const before = text.slice(lastEnd, range.start).trim()
    if (before) segments.push({ type: 'text', content: before })
    try {
      const json = JSON.parse(range.body)
      if (json.widget_code) {
        segments.push({
          type: 'widget',
          data: { title: json.title || undefined, widget_code: String(json.widget_code) },
        })
      }
    } catch {
      // JSON.parse failed — try manual extraction as fallback
      const widget = extractTruncatedWidget(range.body)
      if (widget) {
        segments.push({ type: 'widget', data: widget })
      }
    }
    lastEnd = range.end + 1
  }

  // Handle remaining text after last completed fence (may contain another unclosed fence)
  const remaining = text.slice(lastEnd).trim()
  if (remaining) {
    const truncFenceStart = remaining.indexOf(WIDGET_FENCE)
    if (truncFenceStart !== -1) {
      const beforeTrunc = remaining.slice(0, truncFenceStart).trim()
      if (beforeTrunc) segments.push({ type: 'text', content: beforeTrunc })
      const truncBody = remaining.slice(truncFenceStart + WIDGET_FENCE.length).trim()
      const widget = extractTruncatedWidget(truncBody)
      if (widget) segments.push({ type: 'widget', data: widget })
    } else {
      segments.push({ type: 'text', content: remaining })
    }
  }

  return segments
}

/**
 * Compute the React key for a partial (streaming) widget so it matches the
 * key assigned after the fence closes.
 *
 * The closed fence will be rendered by `parseAllShowWidgets` at index N of
 * the resulting segments array, producing key `w-N`. This function predicts
 * that same N so the WidgetRenderer is not remounted when the fence closes
 * (preventing Issue 7: flicker on fence close).
 */
export function computePartialWidgetKey(content: string): string {
  const lastFenceStart = content.lastIndexOf(WIDGET_FENCE)
  const beforePart = content.slice(0, lastFenceStart).trim()
  const hasCompletedFences = beforePart.length > 0 && beforePart.includes(WIDGET_FENCE)
  const completedSegments = hasCompletedFences ? parseAllShowWidgets(beforePart) : []
  return `w-${hasCompletedFences ? completedSegments.length : (beforePart ? 1 : 0)}`
}

/** Minimum widget_code length to consider renderable */
const MIN_WIDGET_CODE_LEN = 10

/**
 * Extract raw widget_code string from a (possibly incomplete) JSON fence body.
 *
 * Tries full JSON.parse first; falls back to manual string search for the
 * `"widget_code"` key to handle still-streaming JSON.
 *
 * Returns `{ widgetCode, title }` or null if extraction fails or code is too short.
 */
function extractRawWidgetCode(
  fenceBody: string
): { widgetCode: string; title?: string } | null {
  // Happy path: JSON is complete
  try {
    const json = JSON.parse(fenceBody)
    if (json.widget_code) {
      const code = String(json.widget_code)
      if (code.length < MIN_WIDGET_CODE_LEN) return null
      return { widgetCode: code, title: json.title || undefined }
    }
  } catch {
    // fall through to manual extraction
  }

  const keyIdx = fenceBody.indexOf('"widget_code"')
  if (keyIdx === -1) {
    // Raw HTML fallback: Ollama and some models output raw HTML directly in the
    // fence without the JSON wrapper {"title":"...","widget_code":"..."}.
    const trimmed = fenceBody.trim()
    if (trimmed.startsWith('<') && trimmed.length >= MIN_WIDGET_CODE_LEN) {
      return { widgetCode: trimmed, title: undefined }
    }
    return null
  }
  const colonIdx = fenceBody.indexOf(':', keyIdx + 13)
  if (colonIdx === -1) return null
  const quoteIdx = fenceBody.indexOf('"', colonIdx + 1)
  if (quoteIdx === -1) return null

  let raw = fenceBody.slice(quoteIdx + 1)
  // Find the actual closing quote of the JSON string value by scanning backward
  // for an unescaped " (even number of preceding backslashes).
  // This is safer than the previous regex approach which could corrupt widget_code
  // ending with "}" (common in Chart.js config objects).
  let end = raw.length
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i] === '"') {
      let bs = 0
      for (let j = i - 1; j >= 0 && raw[j] === '\\'; j--) bs++
      if (bs % 2 === 0) {
        end = i
        break
      }
    }
  }
  raw = raw.slice(0, end)
  if (raw.endsWith('\\')) raw = raw.slice(0, -1)

  try {
    const widgetCode = raw
      .replace(/\\\\/g, '\x00BACKSLASH\x00')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\"/g, '"')
      .replace(/\\\//g, '/')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\x00BACKSLASH\x00/g, '\\')
    if (widgetCode.length < MIN_WIDGET_CODE_LEN) return null
    const titleMatch = fenceBody.match(/"title"\s*:\s*"([^"]*?)"/)
    return { widgetCode, title: titleMatch?.[1] }
  } catch {
    return null
  }
}

/**
 * Attempt to extract widget data from a partial (unclosed) fence body.
 *
 * Tries full JSON.parse first; falls back to manual string search for the
 * `"widget_code"` key to handle still-streaming JSON.
 */
export function extractTruncatedWidget(
  fenceBody: string
): { title?: string; widget_code: string } | null {
  const result = extractRawWidgetCode(fenceBody)
  if (!result) return null
  return { title: result.title, widget_code: result.widgetCode }
}

/**
 * Extract partial widget code from a streaming fence body, with script truncation.
 *
 * Returns `{ code, scriptsTruncated }`.
 * - `code`: the extracted HTML/SVG, with unclosed `<script>` truncated
 * - `scriptsTruncated`: true when a `<script` was truncated (show shimmer overlay)
 */
export function extractPartialCode(fenceBody: string): {
  code: string | null
  scriptsTruncated: boolean
} {
  const result = extractRawWidgetCode(fenceBody)
  if (!result) return { code: null, scriptsTruncated: false }

  let partialCode: string | null = result.widgetCode

  // Truncate unclosed <script> tag to prevent JS code leaking as visible text (Issue 5)
  let scriptsTruncated = false
  const lastScript = partialCode.lastIndexOf('<script')
  if (lastScript !== -1) {
    const afterScript = partialCode.slice(lastScript)
    if (!/<script[\s\S]*?<\/script>/i.test(afterScript)) {
      partialCode = partialCode.slice(0, lastScript).trim() || null
      scriptsTruncated = true
    }
  }

  return { code: partialCode, scriptsTruncated }
}
