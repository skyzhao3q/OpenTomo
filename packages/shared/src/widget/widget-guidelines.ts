/**
 * Generative UI guidelines for the AI model.
 *
 * - WIDGET_README: comprehensive always-on reference injected into the system prompt
 * - createWidgetMcpServer(): on-demand detailed SVG/diagram templates via MCP tool
 * - getGuidelines(): returns guideline text for specified modules (diagram/art/interactive)
 *
 * Architecture: WIDGET_README covers format + design rules + CSS variables + CDN allowlist
 * + color palette + Chart.js (pre-bundled). SVG diagram templates remain on-demand via MCP.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

/**
 * Always-on widget reference injected into the system prompt when generativeUiEnabled.
 *
 * Covers everything the model needs to generate correct widgets without calling a tool:
 * - show-widget format and rules
 * - Design principles (flat, warm minimal)
 * - CSS variable dictionary (what's available inside the iframe)
 * - CDN allowlist (only cdnjs, esm.sh, jsdelivr, unpkg)
 * - Color palette (hex values for canvas/SVG)
 * - Chart.js usage (pre-bundled — no CDN script needed)
 *
 * SVG diagram templates (flowchart, timeline, hierarchy, etc.) are available
 * on-demand via `opentomo_load_widget_guidelines(['diagram'])`.
 */
export const WIDGET_README = `<widget-readme>
# Widget Design System

## Format

Create visual widgets with the \`show-widget\` code fence:
\`\`\`show-widget
{"title":"snake_case_id","widget_code":"<raw HTML/SVG string>"}
\`\`\`

- \`widget_code\` is a JSON string — escape all quotes and newlines. No DOCTYPE/html/head/body.
- Each widget ≤ 3000 chars. Always close JSON + fence. Text explanations go OUTSIDE the fence.
- Multi-widget: interleave text, each in a SEPARATE fence.
- Streaming order: SVG → \`<defs>\` first; HTML → \`<style>\` → content → \`<script>\` last.
- Clickable drill-down: \`onclick="window.__widgetSendMessage('...')"\`

## When to Use

- Charts and graphs (bar, line, pie, area, radar) → Chart.js (pre-bundled, see below)
- Dashboards, comparisons, rankings, calculators → HTML + CSS
- Timelines, flows, hierarchies, architecture diagrams → SVG (call \`opentomo_load_widget_guidelines(['diagram'])\` for templates)
- Architecture / ER / sequence / state diagrams → Mermaid only
- When in doubt, prefer show-widget over plain text.

## Design Rules

- **Flat, warm minimal**: no gradients, shadows, blur, glow, neon. Solid fills only.
- Transparent background — host provides bg. No dark/colored backgrounds on outer containers.
- No comments, no emoji, no \`position:fixed\`, no iframes. No font-size below 11px.
- Typography: weights 400/500 only, sentence case.
- Interactive controls MUST update visuals — call \`chart.update()\` after data changes.

## CDN Allowlist (ONLY these 4 — others are blocked by CSP)

- \`cdnjs.cloudflare.com\`
- \`esm.sh\`
- \`cdn.jsdelivr.net\`
- \`unpkg.com\`

For non-Chart.js CDN libraries: no \`crossorigin\` attr. Use \`onload="initFn()"\` + \`if(window.Lib) initFn();\` fallback.

## CSS Variables (available inside the widget iframe)

| Token | Variable |
|---|---|
| Background | \`--color-background-primary\` (white), \`-secondary\`, \`-tertiary\` |
| Text | \`--color-text-primary\`, \`-secondary\`, \`-tertiary\` |
| Borders | \`--color-border-tertiary\` (lightest), \`-secondary\`, \`-primary\` |
| Fonts | \`--font-sans\`, \`--font-mono\` |
| Radius | \`--border-radius-md\` (8px), \`--border-radius-lg\` (12px) |

Border style: \`0.5px solid var(--color-border-tertiary)\`

**Canvas and SVG cannot read CSS variables — use hex values from the color palette below.**

## Color Palette (hex)

| Ramp | 50 (fill) | 200 (stroke) | 400 (accent) | 600 (subtitle) | 800 (title) |
|------|-----------|--------------|--------------|----------------|-------------|
| Indigo | #EEF2FF | #C7D2FE | #818CF8 | #4F46E5 | #3730A3 |
| Emerald | #ECFDF5 | #A7F3D0 | #34D399 | #059669 | #065F46 |
| Amber | #FFFBEB | #FDE68A | #FBBF24 | #D97706 | #92400E |
| Slate | #F8FAFC | #E2E8F0 | #94A3B8 | #64748B | #334155 |
| Rose | #FFF1F2 | #FECDD3 | #FB7185 | #E11D48 | #9F1239 |
| Sky | #F0F9FF | #BAE6FD | #38BDF8 | #0284C7 | #075985 |

Use 2–3 ramps per widget. Indigo = primary accent. Slate = structural/neutral.
Text on fills: 800 from same ramp. Chart.js: 400 for borderColor, 400+0.1 alpha for backgroundColor.

## Charts (Chart.js — pre-bundled)

**\`window.Chart\` is always available. Do NOT add a CDN \`<script>\` for Chart.js.**

\`\`\`html
<div style="position:relative;width:100%;height:300px"><canvas id="c"></canvas></div>
<script>
var chart;
function init(){
  chart=new Chart(document.getElementById('c'),{
    type:'line',
    data:{labels:['Jan','Feb','Mar','Apr','May'],datasets:[{data:[30,45,28,50,42],borderColor:'#818CF8',backgroundColor:'rgba(129,140,248,0.1)',fill:true,tension:0.3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{grid:{color:'rgba(0,0,0,0.06)'}},x:{grid:{display:false}}}}
  });
}
init();
</script>
\`\`\`

Rules: height on wrapper div only; \`responsive:true, maintainAspectRatio:false\`; disable legend by default;
\`borderRadius:6\` for bars, \`tension:0.3\` for smooth lines; unique canvas IDs per widget; hex colors only.

## SVG Diagrams

\`<svg width="100%" viewBox="0 0 680 H">\` — 680px fixed width. H = max(y+height of lowest element) + 40px.
For flowcharts, timelines, hierarchies and other diagram templates, call \`opentomo_load_widget_guidelines(['diagram'])\`.
</widget-readme>`

/** @deprecated Use WIDGET_README. Kept for backward compatibility. */
export const WIDGET_SYSTEM_PROMPT = WIDGET_README

// ---------------------------------------------------------------------------
// Section constants — each is a self-contained guideline block
// ---------------------------------------------------------------------------

const CORE_DESIGN_SYSTEM = `## Core Design System

### Philosophy
- **Seamless**: widget should feel native to the chat, not a foreign embed.
- **Flat**: no gradients, shadows, blur, glow, neon. Solid fills only.
- **Warm minimal**: clean geometric layouts with soft rounded corners (rx=12). Not cold/sterile — use warm neutrals (slate tones) with indigo as primary accent.
- **Diverse**: pick the visualization type that best fits the content — flowchart, timeline, cycle, hierarchy, chart, interactive. Don't default to one type.
- **Text outside, visuals inside** — explanatory text OUTSIDE the code fence.

### Streaming
- **SVG**: \`<defs>\` first → visual elements immediately.
- **HTML**: \`<style>\` (short) → content → \`<script>\` last.
- Solid fills only — gradients/shadows flash during DOM diffs.

### Rules
- No comments, no emoji, no position:fixed, no iframes
- No font-size below 11px
- No dark/colored backgrounds on outer containers
- Typography: weights 400/500 only, sentence case
- No DOCTYPE/html/head/body
- CDN allowlist: \`cdnjs.cloudflare.com\`, \`esm.sh\`, \`cdn.jsdelivr.net\`, \`unpkg.com\`. No Tailwind CDN.

### CSS Variables (HTML widgets)
- Backgrounds: \`--color-background-primary\` (white), \`-secondary\`, \`-tertiary\`
- Text: \`--color-text-primary\`, \`-secondary\`, \`-tertiary\`
- Borders: \`--color-border-tertiary\`, \`-secondary\`, \`-primary\`
- Fonts: \`--font-sans\`, \`--font-mono\`
`

const UI_COMPONENTS = `## UI components (HTML widgets)

### Tokens
- Borders: \`0.5px solid var(--color-border-tertiary)\`
- Radius: \`var(--border-radius-md)\` (8px), \`var(--border-radius-lg)\` (12px)
- Form elements pre-styled — write bare tags
- Round every displayed number

### Patterns
1. **Chart + controls** — sliders/buttons above or beside Chart.js canvas. Controls MUST update chart via \`chart.update()\`.
2. **Metric dashboard** — grid of stat cards above a chart.
3. **Calculator** — range sliders with live result display.
4. **Bar comparison** — horizontal bars with labels and percentages.
5. **Toggle/select** — buttons or select to switch between data views.
`

const COLOR_PALETTE = `## Color palette

Canvas cannot read CSS variables — use these hex values directly for Chart.js and SVG fills.

| Ramp | 50 (fill) | 200 (stroke) | 400 (accent) | 600 (subtitle) | 800 (title) |
|------|-----------|---------------|---------------|-----------------|-------------|
| Indigo | #EEF2FF | #C7D2FE | #818CF8 | #4F46E5 | #3730A3 |
| Emerald | #ECFDF5 | #A7F3D0 | #34D399 | #059669 | #065F46 |
| Amber | #FFFBEB | #FDE68A | #FBBF24 | #D97706 | #92400E |
| Slate | #F8FAFC | #E2E8F0 | #94A3B8 | #64748B | #334155 |
| Rose | #FFF1F2 | #FECDD3 | #FB7185 | #E11D48 | #9F1239 |
| Sky | #F0F9FF | #BAE6FD | #38BDF8 | #0284C7 | #075985 |

- Indigo is the primary accent. Use 2-3 ramps per diagram. Slate for structural/neutral.
- Text on fills: 800 from same ramp. Never black.
- SVG: 50 fill + 200 stroke + 800 title + 600 subtitle
- Chart.js: use 400 for borderColor, 400 with 0.1 alpha for backgroundColor
`


const SVG_SETUP = `## SVG setup

\`<svg width="100%" viewBox="0 0 680 H">\` — 680px fixed width. Adjust H to fit content + 40px buffer.

**ViewBox checklist**:
1. max(y + height) of lowest element + 40 = H
2. All content within x=0..680
3. text-anchor="end" extends LEFT from x
4. No negative coordinates

**Arrow marker** (required for any diagram with arrows):
\`\`\`xml
<defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
\`\`\`

**Style**: inline font styles with system-ui fallback. 13-14px labels, 11-12px subtitles. Stroke 0.5-1px borders, 1.5px arrows. rx=8-12 for nodes. One SVG per widget.
`

const DIAGRAM_TYPES = `## Diagram type catalog

### Flowchart (process)
Nodes left→right or top→bottom. Straight arrows. Color = semantic category.
- Decision points: diamond shape or bold-bordered node
- ≤4 nodes per row

### Timeline
Horizontal axis line with event markers. Stagger labels above/below to avoid overlap.
\`<line x1="40" y1="100" x2="640" y2="100" stroke="#E2E8F0" stroke-width="2"/>\`
\`<circle cx="120" cy="100" r="6" fill="#818CF8"/>\`
\`<text x="120" y="85" text-anchor="middle" font-size="13" fill="#334155">Event A</text>\`

### Cycle / feedback loop
3-5 nodes in circular arrangement connected by curved arrows.
\`<path d="M x1 y1 Q cx cy x2 y2" fill="none" stroke="#94A3B8" stroke-width="1.5" marker-end="url(#a)"/>\`
Center label for the cycle name.

### Hierarchy / tree
Root at top, children below with vertical arrows. Indent levels. Group siblings with container rects.

### Layered stack (architecture)
Full-width horizontal bands stacked vertically. Each band = rounded rect. Items positioned inside.
Top layer = user-facing, bottom = infrastructure. Use different colors per layer.

### Quadrant / matrix (2x2)
Two axes with labels. Four colored quadrant rects. Items plotted as circles or labels within quadrants.
\`<line x1="340" y1="20" x2="340" y2="340" stroke="#E2E8F0" stroke-width="1"/>\`
\`<line x1="20" y1="180" x2="660" y2="180" stroke="#E2E8F0" stroke-width="1"/>\`

### Hub-spoke / radial
Central circle node, surrounding nodes connected by lines. Hub = larger circle, spokes = smaller rects/circles.

### Side-by-side comparison
Two parallel groups. Matching rows. Different fill colors per group. Optional connecting lines for correspondences.

### Design rules
- ≤4 nodes per row, ≤5 words per title
- Node width ≥ (chars × 8 + 40) px
- Verify no arrow crosses unrelated boxes
- 2-3 color ramps max, gray for structural
- Clickable nodes: \`onclick="window.__widgetSendMessage('...')"\` on 2-3 key nodes

### Multi-widget narratives
For complex topics, output multiple widgets of DIFFERENT types:
1. Overview SVG (e.g. hierarchy)
2. Text explaining one part
3. Detail SVG (e.g. cycle diagram for that part)
4. Text with quantitative insight
5. Interactive Chart.js with controls
Mix types freely.
`

// ---------------------------------------------------------------------------
// Module → section mapping
// ---------------------------------------------------------------------------

const MODULE_SECTIONS: Record<string, string[]> = {
  // 'chart' removed — Chart.js guidance is now in WIDGET_README (always-on)
  interactive: [CORE_DESIGN_SYSTEM, UI_COMPONENTS, COLOR_PALETTE],
  mockup: [CORE_DESIGN_SYSTEM, UI_COMPONENTS, COLOR_PALETTE],
  art: [CORE_DESIGN_SYSTEM, SVG_SETUP, COLOR_PALETTE],
  diagram: [CORE_DESIGN_SYSTEM, COLOR_PALETTE, SVG_SETUP, DIAGRAM_TYPES],
}

/** Module type for guideline requests. 'chart' removed — covered by WIDGET_README always-on context. */
type GuidelineModule = 'interactive' | 'mockup' | 'art' | 'diagram'

/**
 * Return guideline text for the requested modules.
 * Uses Set-based deduplication so shared sections (e.g. CORE_DESIGN_SYSTEM)
 * appear only once even when multiple modules reference them.
 */
export function getGuidelines(modules: GuidelineModule[]): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const mod of modules) {
    const key = mod.toLowerCase().trim()
    const sections = MODULE_SECTIONS[key]
    if (!sections) continue
    for (const section of sections) {
      if (!seen.has(section)) {
        seen.add(section)
        parts.push(section)
      }
    }
  }
  return parts.length > 0 ? `# Widget Design System\n\n${parts.join('\n\n')}` : ''
}

/**
 * Create the in-process MCP server that provides on-demand widget guidelines.
 * Register this as `'opentomo-widget'` in the mcpServers config.
 */
export function createWidgetMcpServer(): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: 'opentomo-widget-guidelines',
    version: '1.0.0',
    tools: [
      tool(
        'opentomo_load_widget_guidelines',
        'Load detailed SVG diagram templates and interactive widget patterns. Chart.js guidance is already in your system prompt — use this for diagram, art, interactive, or mockup templates.',
        { modules: z.array(z.enum(['interactive', 'mockup', 'art', 'diagram'])) },
        async ({ modules }) => ({
          content: [{ type: 'text' as const, text: getGuidelines(modules) }],
        })
      ),
    ],
  })
}

// Module-level cache — one server instance per process lifetime is sufficient
let _widgetServer: ReturnType<typeof createSdkMcpServer> | null = null

/** Return a cached widget MCP server (created once per process) */
export function getWidgetGuidelinesServer(): ReturnType<typeof createSdkMcpServer> {
  if (!_widgetServer) {
    _widgetServer = createWidgetMcpServer()
  }
  return _widgetServer
}
