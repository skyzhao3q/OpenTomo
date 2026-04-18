import { describe, test, expect } from 'bun:test'
import {
  parseAllShowWidgets,
  computePartialWidgetKey,
  extractTruncatedWidget,
  extractPartialCode,
} from '../widget-parser.ts'

// ---------------------------------------------------------------------------
// parseAllShowWidgets
// ---------------------------------------------------------------------------

describe('parseAllShowWidgets', () => {
  test('returns empty array when no fence present', () => {
    expect(parseAllShowWidgets('Hello world')).toEqual([])
  })

  test('parses a single complete fence', () => {
    const text = '```show-widget\n{"title":"t","widget_code":"<svg/>"}\n```'
    const segs = parseAllShowWidgets(text)
    expect(segs).toHaveLength(1)
    const seg = segs[0]!
    expect(seg.type).toBe('widget')
    if (seg.type === 'widget') {
      expect(seg.data.widget_code).toBe('<svg/>')
      expect(seg.data.title).toBe('t')
    }
  })

  test('preserves surrounding text as segments', () => {
    const text = 'Before\n```show-widget\n{"title":"g","widget_code":"<b/>"}\n```\nAfter'
    const segs = parseAllShowWidgets(text)
    expect(segs).toHaveLength(3)
    expect(segs[0]!).toEqual({ type: 'text', content: 'Before' })
    expect(segs[1]!.type).toBe('widget')
    expect(segs[2]!).toEqual({ type: 'text', content: 'After' })
  })

  test('parses multiple complete fences with interleaved text', () => {
    const w = (id: string) => `\`\`\`show-widget\n{"title":"${id}","widget_code":"<div/>"}\n\`\`\``
    const text = `Intro\n${w('a')}\nMid\n${w('b')}\nEnd`
    const segs = parseAllShowWidgets(text)
    expect(segs).toHaveLength(5)
    expect(segs.map((s) => s.type)).toEqual(['text', 'widget', 'text', 'widget', 'text'])
  })

  test('handles unclosed (streaming) fence with extractTruncatedWidget fallback', () => {
    const text = '```show-widget\n{"title":"x","widget_code":"<p>hello world!!'
    const segs = parseAllShowWidgets(text)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.type).toBe('widget')
  })

  test('handles text before an unclosed fence', () => {
    const text = 'Intro text\n```show-widget\n{"widget_code":"<p>hello world!!'
    const segs = parseAllShowWidgets(text)
    expect(segs).toHaveLength(2)
    expect(segs[0]!).toEqual({ type: 'text', content: 'Intro text' })
    expect(segs[1]!.type).toBe('widget')
  })

  test('skips malformed JSON in completed fence but keeps subsequent text', () => {
    const bad = '```show-widget\nnot json\n```'
    const text = `${bad}\nAfter`
    const segs = parseAllShowWidgets(text)
    // malformed fence skipped; "After" retained
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ type: 'text', content: 'After' })
  })

  test('handles widget_code containing triple backticks (line-based fence detection)', () => {
    // The widget_code JSON value contains ``` which should NOT close the fence
    const text = '```show-widget\n{"title":"code","widget_code":"<pre>some ``` code</pre>"}\n```'
    const segs = parseAllShowWidgets(text)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.type).toBe('widget')
    if (segs[0]!.type === 'widget') {
      expect(segs[0]!.data.widget_code).toContain('```')
    }
  })

  test('falls back to manual extraction when JSON.parse fails in closed fence', () => {
    // Malformed JSON (unescaped quotes) but extractable via manual path
    const text = '```show-widget\n{"widget_code":"<div style="color">hello world!!</div>"}\n```'
    const segs = parseAllShowWidgets(text)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.type).toBe('widget')
  })

  test('widget without title sets title to undefined', () => {
    const text = '```show-widget\n{"widget_code":"<svg/>"}\n```'
    const segs = parseAllShowWidgets(text)
    const seg = segs[0]!
    expect(seg.type).toBe('widget')
    if (seg.type === 'widget') {
      expect(seg.data.title).toBeUndefined()
    }
  })

  // ── Inline-closed fence: closing ``` on same line as JSON ──────────────────
  // AI models sometimes output the closing fence on the same line as the JSON:
  //   ```show-widget
  //   {"title":"t","widget_code":"<svg/>"} ```
  // (no standalone closing ``` line)

  test('parses inline-closed fence: closing ``` on same line as JSON', () => {
    const text = '```show-widget\n{"title":"t","widget_code":"<svg/>"} ```\n'
    const segs = parseAllShowWidgets(text)
    expect(segs).toHaveLength(1)
    const seg = segs[0]!
    expect(seg.type).toBe('widget')
    if (seg.type === 'widget') {
      expect(seg.data.widget_code).toBe('<svg/>')
      expect(seg.data.title).toBe('t')
    }
  })

  test('parses multiple inline-closed fences in one AI response', () => {
    const text = [
      '```show-widget',
      '{"title":"w1","widget_code":"<div>first</div>"} ```',
      '',
      'Some markdown between widgets.',
      '',
      '```show-widget',
      '{"title":"w2","widget_code":"<div>second</div>"} ```',
    ].join('\n')
    const segs = parseAllShowWidgets(text)
    const widgets = segs.filter((s) => s.type === 'widget')
    expect(widgets).toHaveLength(2)
    if (widgets[0]!.type === 'widget') expect(widgets[0]!.data.widget_code).toBe('<div>first</div>')
    if (widgets[1]!.type === 'widget') expect(widgets[1]!.data.widget_code).toBe('<div>second</div>')
  })

  test('inline-closed fence does not bleed into subsequent markdown', () => {
    const text = [
      '```show-widget',
      '{"title":"w1","widget_code":"<svg/>"} ```',
      '',
      '### Heading after widget',
      '',
      '```show-widget',
      '{"title":"w2","widget_code":"<canvas/>"} ```',
    ].join('\n')
    const segs = parseAllShowWidgets(text)
    const widgets = segs.filter((s) => s.type === 'widget')
    // Both widgets must be correctly extracted (not bled together)
    expect(widgets).toHaveLength(2)
    if (widgets[0]!.type === 'widget') expect(widgets[0]!.data.widget_code).toBe('<svg/>')
    if (widgets[1]!.type === 'widget') expect(widgets[1]!.data.widget_code).toBe('<canvas/>')
    // The markdown heading must appear as a text segment
    const texts = segs.filter((s) => s.type === 'text')
    expect(texts.some((s) => s.type === 'text' && s.content.includes('Heading after widget'))).toBe(true)
  })

  test('inline-closed fence with raw AI response prefix (code1/code2 pattern)', () => {
    // Mimics the tofix/code1.html format: the response starts mid-widget (tail of
    // a heatmap widget_code), then has complete inline-closed ae_dashboard + age_risk blocks
    const tailOfPrev = '<div>heatmap</div>"} ```'
    const text = [
      tailOfPrev,
      '',
      '### Chart 1',
      '',
      '```show-widget',
      '{"title":"ae_dashboard","widget_code":"<canvas id=\\"pie\\"></canvas>"} ```',
      '',
      '### Chart 2',
      '',
      '```show-widget',
      '{"title":"age_risk","widget_code":"<canvas id=\\"bar\\"></canvas>"} ```',
    ].join('\n')
    const segs = parseAllShowWidgets(text)
    const widgets = segs.filter((s) => s.type === 'widget')
    expect(widgets).toHaveLength(2)
    if (widgets[0]!.type === 'widget') {
      expect(widgets[0]!.data.title).toBe('ae_dashboard')
      expect(widgets[0]!.data.widget_code).toContain('<canvas')
    }
    if (widgets[1]!.type === 'widget') {
      expect(widgets[1]!.data.title).toBe('age_risk')
    }
  })

  // ── Raw HTML fence (no JSON wrapper) — Ollama pattern ─────────────────────

  test('parses raw HTML fence (no JSON wrapper)', () => {
    const text = '```show-widget\n<div>hello world</div>\n```\n'
    const segs = parseAllShowWidgets(text)
    expect(segs).toHaveLength(1)
    const seg = segs[0]!
    expect(seg.type).toBe('widget')
    if (seg.type === 'widget') {
      expect(seg.data.widget_code).toBe('<div>hello world</div>')
      expect(seg.data.title).toBeUndefined()
    }
  })

  test('parses raw HTML fence with style and script (Ollama pattern)', () => {
    const html =
      '<style>body{padding:16px}</style><div class="title">Report</div>' +
      '<canvas id="c"></canvas><script>new Chart(document.getElementById("c"),{type:"bar"})</script>'
    const text = '```show-widget\n' + html + '\n```\n'
    const segs = parseAllShowWidgets(text)
    expect(segs).toHaveLength(1)
    const seg = segs[0]!
    expect(seg.type).toBe('widget')
    if (seg.type === 'widget') {
      expect(seg.data.widget_code).toBe(html)
    }
  })

  test('parses streaming raw HTML fence (unclosed, Ollama pattern)', () => {
    const text =
      '```show-widget\n<style>body{padding:16px}</style><div>streaming content</div>'
    const segs = parseAllShowWidgets(text)
    expect(segs).toHaveLength(1)
    const seg = segs[0]!
    expect(seg.type).toBe('widget')
  })
})

// ---------------------------------------------------------------------------
// computePartialWidgetKey
// ---------------------------------------------------------------------------

describe('computePartialWidgetKey', () => {
  test('single widget (no preceding text): key is w-0', () => {
    const open = '```show-widget\n{"widget_code":"<p>'
    expect(computePartialWidgetKey(open)).toBe('w-0')
  })

  test('text before single widget: key is w-1', () => {
    const open = 'Some intro\n```show-widget\n{"widget_code":"<p>'
    expect(computePartialWidgetKey(open)).toBe('w-1')
  })

  test('key matches index in closed parseAllShowWidgets result — single widget', () => {
    const openContent = '```show-widget\n{"widget_code":"<svg>'
    const closedContent = '```show-widget\n{"widget_code":"<svg/>"}\n```'
    const partialKey = computePartialWidgetKey(openContent)
    const segs = parseAllShowWidgets(closedContent)
    const idx = segs.findIndex((s) => s.type === 'widget')
    expect(partialKey).toBe(`w-${idx}`)
  })

  test('key matches index — one completed + one streaming widget', () => {
    const w1 = '```show-widget\n{"title":"a","widget_code":"<b/>"}\n```'
    const openContent = `${w1}\nMid\n\`\`\`show-widget\n{"widget_code":"<p>`
    const closedContent = `${w1}\nMid\n\`\`\`show-widget\n{"widget_code":"<p/>"}\n\`\`\``
    const partialKey = computePartialWidgetKey(openContent)
    const segs = parseAllShowWidgets(closedContent)
    // The invariant: partial key w-N must match the index N in allSegments (includes text + widget)
    const lastWidgetIdx = segs.reduce((acc, seg, i) => (seg.type === 'widget' ? i : acc), -1)
    expect(partialKey).toBe(`w-${lastWidgetIdx}`)
  })
})

// ---------------------------------------------------------------------------
// extractTruncatedWidget
// ---------------------------------------------------------------------------

describe('extractTruncatedWidget', () => {
  test('returns null when no widget_code key', () => {
    expect(extractTruncatedWidget('{"title":"t"}')).toBeNull()
  })

  test('parses complete JSON even without closing fence', () => {
    const result = extractTruncatedWidget('{"title":"t","widget_code":"<svg width=100/>"}')
    expect(result).not.toBeNull()
    expect(result?.widget_code).toBe('<svg width=100/>')
    expect(result?.title).toBe('t')
  })

  test('extracts partial widget_code from incomplete JSON', () => {
    const result = extractTruncatedWidget('{"widget_code":"<div>hello')
    expect(result).not.toBeNull()
    expect(result?.widget_code).toContain('<div>hello')
  })

  test('unescapes JSON string sequences', () => {
    const result = extractTruncatedWidget('{"widget_code":"line1\\nline2"}')
    expect(result?.widget_code).toContain('\n')
  })

  test('unescapes \\/ (forward slash)', () => {
    const result = extractTruncatedWidget('{"widget_code":"<a href=\\"http:\\/\\/example.com\\">link<\\/a>"}')
    expect(result?.widget_code).toContain('http://example.com')
    expect(result?.widget_code).toContain('</a>')
  })

  test('unescapes \\uXXXX unicode escapes', () => {
    const result = extractTruncatedWidget('{"widget_code":"\\u003csvg width=\\u002780%\\u0027\\u003e\\u003c/svg\\u003e"}')
    expect(result?.widget_code).toBe("<svg width='80%'></svg>")
  })

  test('unescapes mixed escapes in streaming (manual extraction path)', () => {
    // Incomplete JSON — forces manual extraction
    const result = extractTruncatedWidget('{"widget_code":"<div style=\\"color: red\\">\\u003cb\\u003eBold\\u003c\\/b\\u003e<\\/div>')
    expect(result?.widget_code).toContain('<b>Bold</b>')
    expect(result?.widget_code).toContain('style="color: red"')
  })

  test('returns null for very short widget_code', () => {
    expect(extractTruncatedWidget('{"widget_code":"<p}')).toBeNull()
  })

  test('manual extraction preserves trailing braces in Chart.js config', () => {
    // Malformed JSON (unescaped quotes inside) forces manual extraction path.
    // widget_code ends with nested braces like Chart.js config — must not be stripped.
    const fenceBody = '{"widget_code":"<script>var c=new Chart(el,{type:\\"bar\\",options:{}})</script>"}'
    const result = extractTruncatedWidget(fenceBody)
    expect(result).not.toBeNull()
    expect(result?.widget_code).toContain('options:{}})')
  })

  test('manual extraction works when title comes after widget_code', () => {
    // widget_code is not the last property — trailing ,"title":"x"} should not corrupt code
    const fenceBody = '{"widget_code":"<div>content</div>","title":"chart"}'
    const result = extractTruncatedWidget(fenceBody)
    expect(result).not.toBeNull()
    expect(result?.widget_code).toBe('<div>content</div>')
    expect(result?.title).toBe('chart')
  })
})

// ---------------------------------------------------------------------------
// extractPartialCode (script truncation)
// ---------------------------------------------------------------------------

describe('extractPartialCode', () => {
  test('returns null when no widget_code key', () => {
    const { code } = extractPartialCode('{"title":"t"}')
    expect(code).toBeNull()
  })

  test('no truncation when no script tag', () => {
    const { code, scriptsTruncated } = extractPartialCode('{"widget_code":"<svg width=100 height=100/>"}')
    expect(code).not.toBeNull()
    expect(scriptsTruncated).toBe(false)
  })

  test('no truncation when script tag is closed', () => {
    const fenceBody = '{"widget_code":"<svg/><script>var x=1;</script>"}'
    const { scriptsTruncated } = extractPartialCode(fenceBody)
    expect(scriptsTruncated).toBe(false)
  })

  test('truncates at unclosed script tag and sets scriptsTruncated', () => {
    const fenceBody = '{"widget_code":"<svg/><script src=\\"https://cdn.jsdelivr.net/npm/chart.js\\"'
    const { code, scriptsTruncated } = extractPartialCode(fenceBody)
    expect(scriptsTruncated).toBe(true)
    // Visual HTML before <script is preserved
    expect(code).toContain('<svg/>')
    expect(code).not.toContain('<script')
  })
})

// ---------------------------------------------------------------------------
// Real chart code roundtrip (Chart.js population chart)
// ---------------------------------------------------------------------------

describe('real chart code pipeline', () => {
  // The actual chart HTML from chart-code.txt
  const CHART_HTML = '<style>body{margin:0;padding:20px;font-family:var(--font-sans)}.header{text-align:center;margin-bottom:24px}.header h1{font-size:22px;font-weight:500;color:#334155;margin:0 0 8px 0}.header p{font-size:13px;color:#64748B;margin:0}.chart-wrapper{position:relative;width:100%;height:400px;margin-bottom:20px}</style><div class="header"><h1>Test</h1></div><div class="chart-wrapper"><canvas id="c"></canvas></div><script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js" onload="init()"></script><script>var chart;function init(){var ctx=document.getElementById(\'c\').getContext(\'2d\');chart=new Chart(ctx,{type:\'line\',data:{labels:[1,2,3],datasets:[{data:[10,20,30]}]}});}if(window.Chart)init();</script>'

  test('JSON.parse roundtrip preserves chart code', () => {
    // Simulate what the AI model outputs: JSON with widget_code as escaped string
    const jsonStr = JSON.stringify({ title: 'Chart', widget_code: CHART_HTML })
    const parsed = JSON.parse(jsonStr)
    expect(parsed.widget_code).toBe(CHART_HTML)
  })

  test('parseAllShowWidgets preserves chart code with script tags', () => {
    const jsonStr = JSON.stringify({ title: 'Chart', widget_code: CHART_HTML })
    const fenced = `\`\`\`show-widget\n${jsonStr}\n\`\`\``
    const segs = parseAllShowWidgets(fenced)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.type).toBe('widget')
    if (segs[0]!.type === 'widget') {
      const code = segs[0]!.data.widget_code
      // Must contain both script tags
      expect(code).toContain('<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js" onload="init()">')
      expect(code).toContain('</script>')
      expect(code).toContain('new Chart(ctx,')
      expect(code).toContain('if(window.Chart)init();')
    }
  })

  test('parseAllShowWidgets with manual extraction path preserves onload attr', () => {
    // When JSON has unescaped quotes (forces manual extraction)
    // The onload="init()" must survive extraction
    const fenceBody = '{"widget_code":"<div><canvas id=\\"c\\"></canvas></div><script src=\\"https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js\\" onload=\\"init()\\"></script><script>function init(){console.log(\'ok\');}</script>"}'
    const result = extractTruncatedWidget(fenceBody)
    expect(result).not.toBeNull()
    expect(result!.widget_code).toContain('onload="init()"')
    expect(result!.widget_code).toContain('</script>')
  })
})
