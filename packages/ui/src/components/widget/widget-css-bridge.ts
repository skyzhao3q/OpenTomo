/**
 * CSS variable bridge for Generative UI widgets.
 *
 * Maps OpenTomo's design tokens to widget-standard variable names that widgets
 * can use without knowing the host app's specific variable naming.
 *
 * OpenTomo token notes:
 * - Uses `--accent` (not `--primary`)
 * - Uses `--success`, `--destructive`, `--info` (not `--status-*`)
 * - No `--chart-*` palette; uses foreground-N% mix variables instead
 * - OKLCH-based colour mixing for muted/border/ring
 */

/** Mapping from OpenTomo CSS vars → widget standard vars (injected into :root of srcdoc) */
export const WIDGET_CSS_BRIDGE = `
/* Backgrounds */
--color-background-primary:   var(--background);
--color-background-secondary: var(--muted);
--color-background-card:      var(--card);
--color-background-success:   color-mix(in srgb, var(--success) 15%, var(--background));
--color-background-danger:    color-mix(in srgb, var(--destructive) 15%, var(--background));
--color-background-info:      color-mix(in srgb, var(--info) 15%, var(--background));

/* Text */
--color-text-primary:   var(--foreground);
--color-text-secondary: var(--muted-foreground);
--color-text-accent:    var(--accent);
--color-text-success:   var(--success-text, var(--success));
--color-text-danger:    var(--destructive-text, var(--destructive));
--color-text-info:      var(--info-text, var(--info));

/* Borders */
--color-border:           var(--border);
--color-border-strong:    var(--ring);
--color-input:            var(--input);
--color-border-primary:   var(--ring);
--color-border-secondary: var(--border);
--color-border-tertiary:  color-mix(in srgb, var(--border) 50%, transparent);

/* Interactive */
--color-accent:         var(--accent);
--color-accent-hover:   color-mix(in srgb, var(--accent) 85%, var(--foreground));

/* Chart palette — uses foreground percentage variables */
--color-chart-1: var(--accent);
--color-chart-2: var(--success);
--color-chart-3: var(--info);
--color-chart-4: var(--destructive);
--color-chart-5: var(--muted-foreground);
`

/** OpenTomo CSS variable names to read and forward to the iframe */
const THEME_VAR_NAMES = [
  '--background',
  '--foreground',
  '--accent',
  '--muted',
  '--muted-foreground',
  '--card',
  '--card-foreground',
  '--secondary',
  '--secondary-foreground',
  '--border',
  '--input',
  '--ring',
  '--success',
  '--destructive',
  '--info',
  '--success-text',
  '--destructive-text',
  '--info-text',
  '--foreground-50',
  '--foreground-20',
  '--foreground-10',
  '--font-sans',
  '--font-mono',
]

/**
 * Read computed CSS variable values from the host document.
 * Must be called client-side only (requires `document`).
 */
export function resolveThemeVars(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement)
  const vars: Record<string, string> = {}

  // Use a probe element to resolve CSS functions (color-mix, oklch, var())
  // into concrete rgb() values that work inside sandboxed iframes.
  const probe = document.createElement('div')
  probe.style.display = 'none'
  document.body.appendChild(probe)

  try {
    for (const name of THEME_VAR_NAMES) {
      const raw = computed.getPropertyValue(name).trim()
      if (!raw) continue

      if (raw.includes('color-mix') || raw.includes('oklch') || raw.startsWith('var(')) {
        probe.style.color = raw
        const resolved = getComputedStyle(probe).color
        if (resolved && resolved !== '') {
          vars[name] = resolved
        } else {
          vars[name] = raw
        }
        probe.style.color = ''
      } else {
        vars[name] = raw
      }
    }
  } finally {
    probe.remove()
  }

  return vars
}

/**
 * Build the full CSS style block to inject into the receiver iframe's <head>.
 *
 * Includes:
 * - Resolved :root variables (concrete values, not references to parent doc)
 * - Widget standard variable bridge (--color-* aliases)
 * - Base typography + reset
 */
/**
 * Resolve color-mix() expressions in bridge CSS using a probe element.
 * Replaces `color-mix(...)` with concrete rgb() values computed by the browser.
 */
function resolveBridgeCSS(bridgeCSS: string): string {
  const probe = document.createElement('div')
  probe.style.display = 'none'
  document.body.appendChild(probe)

  try {
    return bridgeCSS.replace(
      /^(--[\w-]+:\s*)(color-mix\(.+\))\s*;?\s*$/gm,
      (_match, prefix: string, expr: string) => {
        probe.style.color = expr
        const resolved = getComputedStyle(probe).color
        probe.style.color = ''
        if (resolved && resolved !== '') {
          return `${prefix}${resolved};`
        }
        return `${prefix}${expr};`
      }
    )
  } finally {
    probe.remove()
  }
}

export function getWidgetIframeStyleBlock(resolvedVars: Record<string, string>): string {
  const rootVars = Object.entries(resolvedVars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')

  const resolvedBridge = resolveBridgeCSS(WIDGET_CSS_BRIDGE)

  return `:root {
${rootVars}
}
.dark { color-scheme: dark; }
body {
${resolvedBridge}
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-primary);
  background: var(--color-background-primary);
}
* { box-sizing: border-box; }
/* Fade-in animation for widgets */
@keyframes widgetFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
#__root { animation: widgetFadeIn 0.2s ease-out; }
/* Shimmer animation (used by loading overlay in WidgetRenderer) */
@keyframes widget-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}`
}
