import { describe, test, expect } from 'bun:test'
import {
  sanitizeForStreaming,
  sanitizeForIframe,
  buildReceiverSrcdoc,
  CDN_WHITELIST,
} from '../widget-sanitizer.ts'

// ---------------------------------------------------------------------------
// sanitizeForStreaming
// ---------------------------------------------------------------------------

describe('sanitizeForStreaming', () => {
  test('removes <script> tags', () => {
    const html = '<div>hi</div><script>alert(1)</script>'
    expect(sanitizeForStreaming(html)).not.toContain('<script')
    expect(sanitizeForStreaming(html)).not.toContain('alert')
  })

  test('removes self-closing script tags', () => {
    const html = '<svg/><script src="evil.js"/>'
    expect(sanitizeForStreaming(html)).not.toContain('<script')
  })

  test('removes on* event handler attributes', () => {
    const html = '<button onclick="alert(1)">Click</button>'
    expect(sanitizeForStreaming(html)).not.toContain('onclick')
    expect(sanitizeForStreaming(html)).toContain('<button')
  })

  test('removes onerror and other on* variants', () => {
    const html = '<img src="x" onerror="alert(1)">'
    const result = sanitizeForStreaming(html)
    expect(result).not.toContain('onerror')
  })

  test('removes dangerous embedding tags', () => {
    for (const tag of ['iframe', 'object', 'embed', 'form']) {
      const html = `<${tag} src="x"></${tag}>`
      expect(sanitizeForStreaming(html)).not.toContain(`<${tag}`)
    }
  })

  test('removes void dangerous tags', () => {
    const html = '<meta http-equiv="refresh"><link rel="stylesheet" href="evil.css">'
    expect(sanitizeForStreaming(html)).not.toContain('<meta')
    expect(sanitizeForStreaming(html)).not.toContain('<link')
  })

  test('removes javascript: URLs from href', () => {
    const html = '<a href="javascript:alert(1)">click</a>'
    const result = sanitizeForStreaming(html)
    expect(result).not.toContain('javascript:')
    expect(result).toContain('<a')
  })

  test('removes data: URLs from src', () => {
    const html = '<img src="data:text/html,<script>alert(1)</script>">'
    expect(sanitizeForStreaming(html)).not.toContain('data:')
  })

  test('preserves safe HTML', () => {
    const html = '<div class="chart"><svg viewBox="0 0 100 100"><rect fill="blue"/></svg></div>'
    const result = sanitizeForStreaming(html)
    expect(result).toContain('<svg')
    expect(result).toContain('<rect')
  })

  test('preserves style tags', () => {
    const html = '<style>body{color:red}</style><p>text</p>'
    expect(sanitizeForStreaming(html)).toContain('<style>')
  })
})

// ---------------------------------------------------------------------------
// sanitizeForIframe
// ---------------------------------------------------------------------------

describe('sanitizeForIframe', () => {
  test('removes dangerous embedding tags', () => {
    const html = '<iframe src="evil"/><script>alert(1)</script>'
    const result = sanitizeForIframe(html)
    expect(result).not.toContain('<iframe')
    // script is preserved — sandbox handles execution safety
    expect(result).toContain('<script')
  })

  test('preserves on* handlers (sandbox handles them)', () => {
    const html = '<button onclick="doSomething()">Go</button>'
    expect(sanitizeForIframe(html)).toContain('onclick')
  })

  test('has more content than sanitizeForStreaming', () => {
    const html = '<script>var x=1</script><p onclick="f()">text</p>'
    const forStream = sanitizeForStreaming(html)
    const forIframe = sanitizeForIframe(html)
    expect(forIframe.length).toBeGreaterThan(forStream.length)
  })
})

// ---------------------------------------------------------------------------
// buildReceiverSrcdoc
// ---------------------------------------------------------------------------

describe('buildReceiverSrcdoc', () => {
  const srcdoc = buildReceiverSrcdoc(':root { --background: #fff; }', false)
  const darkSrcdoc = buildReceiverSrcdoc(':root {}', true)

  test('contains #__root container', () => {
    expect(srcdoc).toContain('id="__root"')
  })

  test('includes CSP meta tag with all 4 CDN domains', () => {
    for (const domain of CDN_WHITELIST) {
      expect(srcdoc).toContain(domain)
    }
  })

  test('CSP includes connect-src none', () => {
    expect(srcdoc).toContain("connect-src 'none'")
  })

  test('dark mode sets class="dark" on html', () => {
    expect(darkSrcdoc).toContain('<html class="dark"')
  })

  test('light mode sets empty class on html', () => {
    expect(srcdoc).toContain('<html class=""')
  })

  test('contains widget:ready postMessage', () => {
    expect(srcdoc).toContain("type:'widget:ready'")
  })

  test('contains widget:resize postMessage', () => {
    expect(srcdoc).toContain("type:'widget:resize'")
  })

  test('contains widget:update handler', () => {
    expect(srcdoc).toContain("'widget:update'")
  })

  test('contains widget:finalize handler', () => {
    expect(srcdoc).toContain("'widget:finalize'")
  })

  test('contains widget:theme handler', () => {
    expect(srcdoc).toContain("'widget:theme'")
  })

  test('contains widget:link postMessage', () => {
    expect(srcdoc).toContain("type:'widget:link'")
  })

  test('contains widget:sendMessage API', () => {
    expect(srcdoc).toContain("type:'widget:sendMessage'")
  })

  test('uses ResizeObserver', () => {
    expect(srcdoc).toContain('ResizeObserver')
  })

  test('includes zero-redraw optimization check', () => {
    expect(srcdoc).toContain('root.innerHTML!==visualHtml')
  })

  test('does NOT use _failedOnloads (bug was removed)', () => {
    expect(srcdoc).not.toContain('_failedOnloads')
  })

  test('appendScript calls appendScript(idx+1) before checking onload code', () => {
    // The new pattern: appendScript(idx+1) appears before the _chartsExist check
    const appendNextIdx = srcdoc.indexOf('appendScript(idx+1)')
    const chartsExistIdx = srcdoc.indexOf('_chartsExist')
    expect(appendNextIdx).toBeGreaterThan(-1)
    expect(chartsExistIdx).toBeGreaterThan(-1)
    // appendScript(idx+1) call inside n.onload should come before the _chartsExist check
    expect(appendNextIdx).toBeLessThan(chartsExistIdx)
  })

  test('_verifyChart does not re-execute inline scripts', () => {
    // The old bug: _verifyChart would call querySelectorAll('script:not([src])') and
    // re-run inline scripts, creating duplicate charts. This should no longer be present.
    expect(srcdoc).not.toContain("querySelectorAll('script:not([src])')")
  })

  test('injects provided style block', () => {
    const custom = buildReceiverSrcdoc('body { color: red; }', false)
    expect(custom).toContain('body { color: red; }')
  })

  test('injects bundledScripts as inline <script> when provided', () => {
    const s = buildReceiverSrcdoc(':root {}', false, 'window.__TestLib=1;')
    expect(s).toContain('<script>window.__TestLib=1;</script>')
    // bundled library must appear before the receiver script so it's available to widget code
    expect(s.indexOf('window.__TestLib=1;')).toBeLessThan(s.indexOf("type:'widget:ready'"))
  })

  test('omits extra <script> tag when bundledScripts not provided', () => {
    const s = buildReceiverSrcdoc(':root {}', false)
    // only the receiver script — no additional script block
    expect((s.match(/<script/g) ?? []).length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// fixDoubleEscapedQuotes (tested via sanitizeForStreaming / sanitizeForIframe)
// ---------------------------------------------------------------------------

describe('fixDoubleEscapedQuotes', () => {
  test('converts \\"-escaped attribute quotes to normal quotes', () => {
    const html = '<div style=\\"color:red\\">text</div>'
    const result = sanitizeForStreaming(html)
    expect(result).toContain('style="color:red"')
    expect(result).not.toContain('\\"')
  })

  test('fixes multiple attributes in one element', () => {
    const html = '<canvas id=\\"myChart\\" class=\\"chart\\"></canvas>'
    const result = sanitizeForIframe(html)
    expect(result).toContain('id="myChart"')
    expect(result).toContain('class="chart"')
  })

  test('fixes CDN src attribute with double-escaped quotes', () => {
    const cdn = '<script src=\\"https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js\\" onload=\\"init()\\"></script>'
    // sanitizeForIframe preserves scripts
    const result = sanitizeForIframe(cdn)
    expect(result).toContain('src="https://cdnjs.cloudflare.com')
    expect(result).not.toContain('\\"')
  })

  test('does not modify HTML without double-escaped quotes', () => {
    const html = '<div style="color:red">text</div>'
    expect(sanitizeForStreaming(html)).toBe(html)
  })

  test('code1 pattern: fixes wrapper div then strips scripts for streaming', () => {
    const code1 =
      '<div style=\\"position:relative;width:100%;height:320px\\"><canvas id=\\"cat\\"></canvas></div>' +
      '<script src=\\"https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js\\" onload=\\"initCat()\\"></script>' +
      '<script>function initCat(){/*...*/}if(window.Chart)initCat();</script>'
    const streamed = sanitizeForStreaming(code1)
    // Attributes should be unescaped
    expect(streamed).toContain('style="position:relative;width:100%;height:320px"')
    expect(streamed).toContain('id="cat"')
    // Scripts must be stripped
    expect(streamed).not.toContain('<script')
    expect(streamed).not.toContain('initCat')

    const finalized = sanitizeForIframe(code1)
    // Scripts preserved with fixed quotes
    expect(finalized).toContain('src="https://cdnjs.cloudflare.com')
    expect(finalized).toContain('onload="initCat()"')
    expect(finalized).toContain('function initCat()')
  })
})

// ---------------------------------------------------------------------------
// CDN_WHITELIST
// ---------------------------------------------------------------------------

describe('CDN_WHITELIST', () => {
  test('contains exactly 4 domains', () => {
    expect(CDN_WHITELIST).toHaveLength(4)
  })

  test('contains expected domains', () => {
    expect(CDN_WHITELIST).toContain('cdnjs.cloudflare.com')
    expect(CDN_WHITELIST).toContain('cdn.jsdelivr.net')
    expect(CDN_WHITELIST).toContain('unpkg.com')
    expect(CDN_WHITELIST).toContain('esm.sh')
  })
})
