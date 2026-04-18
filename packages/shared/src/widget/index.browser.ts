// Browser-safe subset of @opentomo/shared/widget.
// Does NOT export widget-guidelines.ts (imports @anthropic-ai/claude-agent-sdk — Node.js only).
export {
  parseAllShowWidgets,
  computePartialWidgetKey,
  extractTruncatedWidget,
  extractPartialCode,
  WIDGET_FENCE,
  type WidgetSegment,
} from './widget-parser.ts'

export {
  sanitizeForStreaming,
  sanitizeForIframe,
  buildReceiverSrcdoc,
  CDN_WHITELIST,
} from './widget-sanitizer.ts'
