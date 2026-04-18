/**
 * Widget sanitizer utilities for Generative UI.
 *
 * Two sanitization levels:
 * - sanitizeForStreaming: strict — removes scripts, handlers, dangerous tags, JS URLs
 * - sanitizeForIframe:  loose  — removes only dangerous embedding tags; keeps scripts
 *
 * Also provides buildReceiverSrcdoc() to generate the sandbox iframe HTML.
 */

export const CDN_WHITELIST = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'esm.sh',
] as const

const DANGEROUS_TAGS =
  /<(iframe|object|embed|meta|link|base|form)[\s>][\s\S]*?<\/\1>/gi
const DANGEROUS_VOID =
  /<(iframe|object|embed|meta|link|base)\b[^>]*\/?>/gi

/**
 * Matches HTML attribute values that were double-escaped by the model: =\"value\"
 *
 * The simpler `[^"\\]*` (no backslash-sequence extension) is intentional:
 * attribute values in these AI-generated widgets never contain `\` or `"`, and
 * the more complex `(?:\\.[^"\\]*)` alternative greedily over-matches across
 * consecutive `=\"...\"` pairs, corrupting multiple attributes in one element.
 */
const DOUBLE_ESCAPED_ATTR = /=\\"([^"\\]*)\\"/g

/**
 * Fix double-escaped HTML attribute quotes produced by model over-escaping.
 *
 * When the model writes `\\\"` in the JSON fence body instead of `\"`,
 * JSON.parse yields `\"` (backslash-quote) in widget_code. Browsers parse
 * `style=\"...\"` as an unquoted attribute, breaking CSS, IDs, and src URLs.
 *
 * This converts `=\"...\"` → `="..."` before the HTML reaches the iframe.
 */
function fixDoubleEscapedQuotes(html: string): string {
  if (!html.includes('\\"')) return html
  return html.replace(DOUBLE_ESCAPED_ATTR, '="$1"')
}

/**
 * Streaming preview sanitizer (strict).
 *
 * Removes:
 * - `<script>` tags (open/close and self-closing)
 * - `on*` event handler attributes
 * - Dangerous embedding tags (iframe, object, embed, meta, link, base, form)
 * - `javascript:` / `data:` URLs in href / src / action attributes
 */
export function sanitizeForStreaming(html: string): string {
  return fixDoubleEscapedQuotes(html)
    .replace(DANGEROUS_TAGS, '')
    .replace(DANGEROUS_VOID, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']*)/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(
      /\s+(href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']*))/gi,
      (match, _attr, dq, sq, uq) => {
        const url = (dq ?? sq ?? uq ?? '').trim()
        if (/^\s*(javascript|data)\s*:/i.test(url)) return ''
        return match
      }
    )
}

/**
 * Finalize sanitizer (loose).
 *
 * Removes only dangerous embedding tags. Scripts and event handlers are
 * preserved — the sandbox iframe's `allow-scripts` + absence of
 * `allow-same-origin` provides the security boundary.
 */
export function sanitizeForIframe(html: string): string {
  return fixDoubleEscapedQuotes(html).replace(DANGEROUS_TAGS, '').replace(DANGEROUS_VOID, '')
}

/**
 * Build the srcdoc HTML for the receiver iframe.
 *
 * The receiver handles:
 * - `widget:update`   — streaming preview (innerHTML, no scripts)
 * - `widget:finalize` — final render with zero-redraw optimisation
 * - `widget:theme`    — CSS variable update on theme change
 * - `widget:ready`    — signals iframe init complete
 * - `widget:resize`   — reports body.scrollHeight to parent
 * - `widget:link`     — intercepts <a> clicks and forwards to parent
 * - `widget:sendMessage` — `window.__widgetSendMessage()` drill-down
 *
 * @param styleBlock      CSS from getWidgetIframeStyleBlock()
 * @param isDark          whether dark mode is active at mount time
 * @param bundledScripts  optional JS to inject as an inline <script> before the receiver
 *                        (e.g. pre-bundled Chart.js UMD source so window.Chart is always available)
 */
export function buildReceiverSrcdoc(styleBlock: string, isDark: boolean, bundledScripts?: string): string {
  const cspDomains = CDN_WHITELIST.map((d) => 'https://' + d).join(' ')
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${cspDomains}`,
    "style-src 'unsafe-inline'",
    "img-src * data: blob:",
    "font-src * data:",
    "connect-src 'none'",
  ].join('; ')

  // Inline receiver script — runs inside the sandboxed iframe
  const receiverScript = `(function(){
var root=document.getElementById('__root');
var _t=null,_first=true,_retryCount=0;
function _h(){
  if(_t)clearTimeout(_t);
  _t=setTimeout(function(){
    var h=document.body.scrollHeight;
    if(h>0)parent.postMessage({type:'widget:resize',height:h,first:_first},'*');
    _first=false;
  },60);
}
var _ro=new ResizeObserver(_h);
_ro.observe(document.body);

function applyHtml(html){
  root.innerHTML=html;
  _h();
}

function _verifyChart(){
  var canvases=root.querySelectorAll('canvas');
  if(canvases.length===0)return;
  var allOk=true;
  for(var i=0;i<canvases.length;i++){
    var cv=canvases[i];
    if(cv.offsetWidth===0||cv.offsetHeight===0){
      console.warn('[widget-iframe] Canvas['+i+'] has zero dimensions, fixing parent height');
      var p=cv.parentElement;
      if(p&&(!p.style.height||p.style.height==='0px'))p.style.height='300px';
      _h();
    }
    if(window.Chart&&typeof Chart.getChart==='function'){
      if(!Chart.getChart(cv)){
        console.warn('[widget-iframe] Canvas['+i+'] has no chart instance');
        allOk=false;
      }
    }
  }
  if(allOk)console.log('[widget-iframe] Chart verification passed');
}

function finalizeHtml(html){
  console.log('[widget-iframe] finalizeHtml called, html length:', html.length);
  var tmp=document.createElement('div');
  tmp.innerHTML=html;
  var ss=tmp.querySelectorAll('script');
  var scripts=[];
  console.log('[widget-iframe] Found', ss.length, 'script tags');
  for(var i=0;i<ss.length;i++){
    var s=ss[i];
    var entry={src:s.getAttribute('src')||'',text:s.textContent||'',preview:s.textContent?s.textContent.slice(0,100)+'...':'',attrs:[]};
    for(var j=0;j<s.attributes.length;j++){
      var a=s.attributes[j];
      if(a.name!=='src')entry.attrs.push({name:a.name,value:a.value});
    }
    console.log('[widget-iframe] Script['+i+']:', entry.src?'CDN='+entry.src:'inline('+entry.preview.length+'chars)', 'attrs:', JSON.stringify(entry.attrs));
    scripts.push(entry);
    s.remove();
  }
  // Zero-redraw: skip innerHTML swap when visual HTML is unchanged (Issue 3)
  var visualHtml=tmp.innerHTML;
  if(root.innerHTML!==visualHtml)root.innerHTML=visualHtml;
  console.log('[widget-iframe] Visual HTML set, root children:', root.childElementCount);
  // Execute scripts individually so they run in document context
  // Use sequential loading for src scripts to preserve dependency order
  function appendScript(idx){
    if(idx>=scripts.length){
      console.log('[widget-iframe] All scripts appended');
      // Schedule chart verification at increasing intervals
      [200,600,1500].forEach(function(ms){
        setTimeout(function(){
          if(_retryCount<3){_retryCount++;_verifyChart();}
        },ms);
      });
      return;
    }
    var s=scripts[idx];
    var n=document.createElement('script');
    if(s.src){
      // Set src — skip crossorigin (opaque origin in sandbox breaks CORS)
      var _cdns=['cdnjs.cloudflare.com','cdn.jsdelivr.net','unpkg.com','esm.sh'];
      var _cdnOk=false;
      for(var k=0;k<_cdns.length;k++){if(s.src.indexOf(_cdns[k])!==-1){_cdnOk=true;break;}}
      if(!_cdnOk)console.warn('[widget-iframe] CDN URL not in whitelist (CSP will block):', s.src);
      console.log('[widget-iframe] Loading CDN script['+idx+']:', s.src);
      n.src=s.src;
      var onloadCode=null;
      for(var j=0;j<s.attrs.length;j++){
        var aname=s.attrs[j].name.toLowerCase();
        if(aname==='crossorigin'){console.log('[widget-iframe] Skipping crossorigin attr');continue;}
        // Collect onload code to run via event listener
        if(aname==='onload'){
          onloadCode=s.attrs[j].value;
          console.log('[widget-iframe] Found onload attr:', onloadCode);
          continue;
        }
        n.setAttribute(s.attrs[j].name,s.attrs[j].value);
      }
      // Chain: load remaining scripts FIRST (inline scripts run synchronously, defining init
      // functions), then call onloadCode only if charts were not already created by inline
      // script fallbacks (e.g. if(window.Chart)init()). This prevents duplicate chart
      // creation when the common AI-generated pattern is used.
      n.onload=(function(code){return function(){
        console.log('[widget-iframe] CDN script['+idx+'] loaded successfully');
        if(s.src.indexOf('chart')!==-1&&!window.Chart)console.warn('[widget-iframe] Chart CDN onload but window.Chart undefined — possible 404');
        // Append remaining scripts first: inline scripts execute synchronously, so by the
        // time appendScript(idx+1) returns all subsequent inline scripts have already run.
        appendScript(idx+1);
        if(code){
          // Only call onload code if inline scripts have not already initialised the charts.
          var _cvs=root.querySelectorAll('canvas');
          var _chartsExist=_cvs.length>0&&window.Chart&&typeof Chart.getChart==='function'&&
            Array.prototype.some.call(_cvs,function(cv){return !!Chart.getChart(cv);});
          if(_chartsExist){
            console.log('[widget-iframe] Charts already initialised by inline scripts, skipping onload code');
          } else {
            console.log('[widget-iframe] No charts found after inline scripts, calling onload code');
            try{new Function(code)();}catch(e){console.error('[widget-iframe] onload code error:',e);}
          }
        }
      };})(onloadCode);
      n.onerror=function(e){console.error('[widget-iframe] CDN script['+idx+'] FAILED to load:', s.src, e);appendScript(idx+1);};
      root.appendChild(n);
    } else {
      console.log('[widget-iframe] Appending inline script['+idx+']');
      if(s.text)n.textContent=s.text;
      for(var j=0;j<s.attrs.length;j++){
        var aname=s.attrs[j].name.toLowerCase();
        if(aname==='crossorigin')continue;
        n.setAttribute(s.attrs[j].name,s.attrs[j].value);
      }
      root.appendChild(n);
      appendScript(idx+1);
    }
  }
  appendScript(0);
  _h();
}

window.addEventListener('message',function(e){
  if(!e.data)return;
  console.log('[widget-iframe] Received message:', e.data.type, e.data.html?'html='+e.data.html.length+'chars':'');
  switch(e.data.type){
    case 'widget:update':applyHtml(e.data.html);break;
    case 'widget:finalize':finalizeHtml(e.data.html);setTimeout(_h,150);break;
    case 'widget:theme':
      var r=document.documentElement,v=e.data.vars;
      if(v)for(var k in v)r.style.setProperty(k,v[k]);
      if(typeof e.data.isDark==='boolean')r.className=e.data.isDark?'dark':'';
      setTimeout(_h,100);
      break;
  }
});

// Link intercept: forward <a> clicks to parent for shell.openExternal (Issue UC-6)
document.addEventListener('click',function(e){
  var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
  if(!a)return;
  var h=a.getAttribute('href');
  if(!h||h.charAt(0)==='#')return;
  e.preventDefault();
  parent.postMessage({type:'widget:link',href:h},'*');
});

// Drill-down API: onclick="window.__widgetSendMessage('...')"
window.__widgetSendMessage=function(t){
  if(typeof t!=='string'||t.length>500)return;
  parent.postMessage({type:'widget:sendMessage',text:t},'*');
};

console.log('[widget-iframe] Receiver script initialized, posting widget:ready');
parent.postMessage({type:'widget:ready'},'*');
})();`

  return `<!DOCTYPE html>
<html class="${isDark ? 'dark' : ''}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
${styleBlock}
</style>
</head>
<body style="margin:0;padding:0;">
<div id="__root"></div>
${bundledScripts ? `<script>${bundledScripts}</script>` : ''}
<script>${receiverScript}</script>
</body>
</html>`
}
