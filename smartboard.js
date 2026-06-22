/*! Teaching Smartboard — library build (CSS + JS).
 *  Load smartboard.css + this file once in your site <head>, then drop
 *  <div class="smartboard-embed" data-height="640"></div> into any post/page.
 *  Heavy libraries (PDF.js, jsPDF, PPTXjs) are lazy-loaded only when used.
 */
(function(){
"use strict";

// locate this script so we can auto-load the matching CSS from the same CDN folder
var THIS = document.currentScript || (function(){var s=document.getElementsByTagName('script');return s[s.length-1];})();
var BASE = (THIS && THIS.src) ? THIS.src.replace(/[^\/]*$/,'') : '';

function ensureCSS(){
  if(!BASE) return;
  var href = BASE + 'smartboard.css';
  if(document.querySelector('link[data-smartboard-css]')) return;
  var links = document.getElementsByTagName('link'), i;
  for(i=0;i<links.length;i++){ if((links[i].href||'').indexOf('smartboard.css')>-1) return; }
  var l=document.createElement('link'); l.rel='stylesheet'; l.href=href; l.setAttribute('data-smartboard-css','1');
  document.head.appendChild(l);
}

var MARKUP = `
<div id="sb-app">
  <div id="sb-board-wrap">
    <canvas id="sb-canvas"></canvas>
    <canvas id="sb-overlay"></canvas>
    <div id="sb-hint">
      <h2>Your teaching canvas is ready</h2>
      <p>Pick up the pen and write, or open a PDF / slides / image to annotate over.</p>
    </div>
    <div id="sb-shade"><div class="grip">Screen shade — drag to reveal</div></div>
    <textarea id="sb-textedit" spellcheck="false"></textarea>
  </div>

  <!-- TOP BAR -->
  <div id="sb-top" class="sb-glass">
    <div class="sb-brand">
      <div class="sb-mark">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18v11H3z"/><path d="M8 20h8M12 16v4"/></svg>
      </div>
    </div>
    <div class="sb-sep"></div>
    <button class="sb-btn" id="sb-prev" title="Previous page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
    <div id="sb-pagelbl">1 / 1</div>
    <button class="sb-btn" id="sb-next" title="Next page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
    <button class="sb-btn" id="sb-addpage" title="Add blank page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg></button>
    <div class="sb-sep"></div>
    <button class="sb-btn" id="sb-undo" title="Undo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/></svg></button>
    <button class="sb-btn" id="sb-redo" title="Redo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/></svg></button>
    <div class="sb-sep"></div>
    <button class="sb-btn" id="sb-bg" title="Page background"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M3 9h18M9 3v18"/></svg></button>
    <div class="sb-sep"></div>
    <button class="sb-btn" id="sb-zoomout" title="Zoom out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></svg></button>
    <button class="sb-btn" id="sb-zoomfit" title="Fit to screen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/><circle cx="12" cy="12" r="3"/></svg></button>
    <button class="sb-btn" id="sb-zoomin" title="Zoom in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/></svg></button>
    <button class="sb-btn" id="sb-export" title="Save / export"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg></button>
    <button class="sb-btn" id="sb-full" title="Fullscreen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button>
    <div class="sb-sep" id="sb-lang-sep" style="display:none"></div>
    <button class="sb-btn sb-lang-mode-btn" id="sb-lang-en" data-lang="en" title="English" style="display:none;font-size:12px;font-weight:700;letter-spacing:.04em;padding:0 10px;min-width:44px;">EN</button>
    <button class="sb-btn sb-lang-mode-btn" id="sb-lang-hi" data-lang="hi" title="\u0939\u093f\u0902\u0926\u0940 \u092e\u0947\u0902 \u0926\u0947\u0916\u0947\u0902" style="display:none;font-size:12px;font-weight:700;letter-spacing:.04em;padding:0 10px;min-width:44px;">\u0939\u093f\u0902\u0926\u0940</button>
    <button class="sb-btn sb-lang-mode-btn" id="sb-lang-both" data-lang="both" title="Show English & \u0939\u093f\u0902\u0926\u0940 side by side" style="display:none;font-size:11px;font-weight:700;letter-spacing:.03em;padding:0 8px;min-width:52px;">EN+\u0939\u093f</button>
    <div class="sb-sep" id="sb-fsz-sep" style="display:none"></div>
    <div id="sb-fontsizer" title="Question font size">
      <button class="sb-fsz-btn" id="sb-fsz-dec" title="Smaller question text" aria-label="Decrease question font size"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
      <input type="number" id="sb-fsz-input" value="100" min="40" max="300" step="10" title="Question font size %" aria-label="Question font size percent">
      <span id="sb-fsz-pct">%</span>
      <button class="sb-fsz-btn" id="sb-fsz-inc" title="Larger question text" aria-label="Increase question font size"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
    </div>
  </div>

  <!-- TOOL DOCK -->
  <div id="sb-dock" class="sb-glass">
    <button class="sb-tool active" data-tool="pen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg><span class="tip">Pen <kbd>P</kbd></span></button>
    <button class="sb-tool" data-tool="marker"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-6 6v3h3l6-6"/><path d="M22 3L11 14l-1-1L21 2z" fill="currentColor" stroke="none" opacity=".4"/><path d="M14 6l4 4"/></svg><span class="tip">Highlighter <kbd>H</kbd></span></button>
    <button class="sb-tool" data-tool="eraser"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21h10"/><path d="M5 13l6-6 8 8-5 5H9z"/></svg><span class="tip">Eraser <kbd>E</kbd></span></button>
    <button class="sb-tool" data-tool="shape" id="sb-shapebtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="7" r="4"/><path d="M7 21l-4-6h8z"/></svg><span class="tip">Shapes <kbd>S</kbd></span></button>
    <button class="sb-tool" data-tool="text"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg><span class="tip">Text <kbd>T</kbd></span></button>
    <button class="sb-tool" data-tool="select"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.5 18 2.5-7 7-2.5z"/></svg><span class="tip">Select / move <kbd>V</kbd></span></button>
    <div class="sb-dock-sep"></div>
    <button class="sb-tool" data-tool="laser"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg><span class="tip">Laser pointer <kbd>L</kbd></span></button>
    <button class="sb-tool" data-tool="spotlight"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg><span class="tip">Spotlight <kbd>O</kbd></span></button>
    <button class="sb-tool" id="sb-shadebtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="8" rx="1"/><path d="M3 14h18M3 18h18" opacity=".5"/></svg><span class="tip">Screen shade</span></button>
    <button class="sb-tool" id="sb-webbtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 1 3 3v1h1a3 3 0 0 1 3 3v1a3 3 0 0 1-1 2.24V15a3 3 0 0 1-3 3h-1v1a3 3 0 0 1-6 0v-1H7a3 3 0 0 1-3-3v-2.76A3 3 0 0 1 3 10V9a3 3 0 0 1 3-3h1V5a3 3 0 0 1 3-3z"/><circle cx="9" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1" fill="currentColor" stroke="none"/></svg><span class="tip">AI Chatbot</span></button>
    <button class="sb-tool" id="sb-timerbtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg><span class="tip">Timer</span></button>
    <div class="sb-dock-sep"></div>
    <button class="sb-tool" id="sb-clear"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg><span class="tip">Clear page</span></button>

    <div id="sb-shapes-menu" class="sb-glass">
      <button class="sb-tool active" data-shape="line"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20L20 4"/></svg></button>
      <button class="sb-tool" data-shape="arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20L20 4M20 4h-7M20 4v7"/></svg></button>
      <button class="sb-tool" data-shape="rect"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1"/></svg></button>
      <button class="sb-tool" data-shape="ellipse"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="9" ry="6"/></svg></button>
    </div>
  </div>

  <!-- PROPERTIES BAR -->
  <div id="sb-props" class="sb-glass">
    <div id="sb-swatches" style="display:flex;gap:5px;align-items:center;"></div>
    <div id="sb-customwrap">
      <div id="sb-customface"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></div>
      <input type="color" id="sb-custom" value="#1f6feb">
    </div>
    <div class="sb-sep"></div>
    <div class="sb-sizes" id="sb-sizes"></div>
    <div class="sb-sep" id="sb-opsep"></div>
    <span id="sb-oplabel" style="font-size:11px;color:var(--txt-dim);">Opacity</span>
    <input type="range" id="sb-opacity" min="10" max="100" value="100">
  </div>

  <!-- AI CHATBOT PANEL -->
  <div id="sb-web" class="sb-glass">
    <div class="sb-web-head sb-drag" id="sb-web-head">
      <div class="sb-ai-mark"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 1 3 3v1h1a3 3 0 0 1 3 3v1a3 3 0 0 1-1 2.24V15a3 3 0 0 1-3 3h-1v1a3 3 0 0 1-6 0v-1H7a3 3 0 0 1-3-3v-2.76A3 3 0 0 1 3 10V9a3 3 0 0 1 3-3h1V5a3 3 0 0 1 3-3z"/><circle cx="9" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1" fill="currentColor" stroke="none"/></svg></div>
      <div class="sb-web-title">
        <b>AI Study Assistant</b>
        <small><span class="sb-ai-dot off" id="sb-ai-dot"></span><span id="sb-ai-statusline">No AI connected</span></small>
      </div>
      <button class="sb-btn" id="sb-ai-settingsbtn" title="AI settings" style="height:34px;min-width:34px;padding:0 8px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
      <button class="sb-btn" id="sb-web-close" style="height:34px;min-width:34px;padding:0 8px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    </div>
    <div class="sb-web-quick" id="sb-web-quick">
      <button class="sb-chip" data-provider="openai">OpenAI</button>
      <button class="sb-chip" data-provider="gemini">Gemini</button>
      <button class="sb-chip" data-provider="deepseek">DeepSeek</button>
    </div>
    <div id="sb-web-body">
      <div id="sb-chat-log">
        <div id="sb-chat-empty">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 1 3 3v1h1a3 3 0 0 1 3 3v1a3 3 0 0 1-1 2.24V15a3 3 0 0 1-3 3h-1v1a3 3 0 0 1-6 0v-1H7a3 3 0 0 1-3-3v-2.76A3 3 0 0 1 3 10V9a3 3 0 0 1 3-3h1V5a3 3 0 0 1 3-3z"/></svg>
          <b>Ask a study question</b>
          <p>Connect an AI provider in settings, then ask anything about your lesson — answers are kept short (about 100 words) and focused on educational content.</p>
        </div>
      </div>
    </div>
    <div id="sb-chat-input-wrap">
      <textarea id="sb-chat-input" rows="1" placeholder="Ask an educational question…"></textarea>
      <button id="sb-chat-send" title="Send"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>
    </div>
    <div id="sb-chat-hint">For learning & homework help only · answers limited to ~100 words</div>
  </div>

  <!-- AI SETTINGS MODAL -->
  <div id="sb-ai-settings">
    <div id="sb-ai-card" class="sb-glass">
      <button class="sb-ai-close" id="sb-ai-close"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      <h3>AI Chatbot settings</h3>
      <p class="sb-ai-sub">Pick a provider and paste your own API key. It's saved in this browser only (never uploaded anywhere) and stays remembered across refreshes and closing the tab — sent directly from your browser to the provider only when you send a message.</p>

      <div class="sb-ai-providers" id="sb-ai-providers">
        <button class="sb-ai-provider-btn" data-provider="openai">OpenAI<br><span style="font-weight:400;opacity:.7;">ChatGPT</span></button>
        <button class="sb-ai-provider-btn" data-provider="gemini">Google<br><span style="font-weight:400;opacity:.7;">Gemini</span></button>
        <button class="sb-ai-provider-btn" data-provider="deepseek">DeepSeek<br><span style="font-weight:400;opacity:.7;">DeepSeek</span></button>
      </div>

      <div class="sb-ai-field">
        <label for="sb-ai-key">API key</label>
        <div class="sb-ai-keyrow">
          <input type="password" id="sb-ai-key" autocomplete="off" spellcheck="false" placeholder="Paste your API key">
          <button class="sb-ai-eye" id="sb-ai-eye" title="Show/hide key"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg></button>
        </div>
        <div class="sb-ai-help" id="sb-ai-keyhelp">Get a key at <a id="sb-ai-keylink" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a></div>
      </div>

      <div class="sb-ai-field" id="sb-ai-modelwrap">
        <label for="sb-ai-model">Model</label>
        <input type="text" id="sb-ai-model" autocomplete="off" spellcheck="false">
      </div>

      <div class="sb-ai-note">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <div>For best results, calling these APIs directly from a browser may require a provider that allows it (CORS). If a request fails, your provider/network may block client-side calls — see the panel message for details.</div>
      </div>

      <div class="sb-ai-actions">
        <button class="sb-ai-btn-ghost" id="sb-ai-clear">Remove key</button>
        <button class="sb-ai-btn-primary" id="sb-ai-save">Save & connect</button>
      </div>
      <div class="sb-ai-status" id="sb-ai-status"></div>
    </div>
  </div>



  <!-- TIMER -->
  <div id="sb-timer" class="sb-glass">
    <div class="t" id="sb-timer-t">00:00</div>
    <button class="sb-btn" id="sb-timer-start" style="background:var(--good);color:#06291a;height:34px;">Start</button>
    <button class="sb-btn" id="sb-timer-reset" style="height:34px;">Reset</button>
    <button class="sb-btn" id="sb-timer-close" style="height:34px;min-width:34px;padding:0 8px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
  </div>

  <div id="sb-toast"></div>
  <div id="sb-load"><div class="sb-spin"></div><div id="sb-load-txt">Loading…</div></div>

  <input type="file" id="sb-loadfile" accept=".smartboard,.json" class="sb-hidden">

  <!-- FILE PICKER (in-board overlay — keeps fullscreen) -->
  <div id="sb-picker">
    <div id="sb-picker-card">
      <button id="sb-picker-close" class="sb-btn" title="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      <h2 id="sb-picker-title">Open board</h2>
      <div id="sb-drop">
        <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/></svg>
        <div class="sb-drop-main">Drag &amp; drop a board file here</div>
        <div class="sb-drop-or">or</div>
        <button id="sb-picker-browse">Browse files</button>
        <div id="sb-picker-accept" class="sb-drop-accept">Accepted: .smartboard file</div>
      </div>
    </div>
  </div>

  <!-- WELCOME -->
  <div id="sb-welcome">
    <div id="sb-welcome-card">
      <div id="sb-welcome-logo">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18M5 5v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5"/><path d="M9 19l-1.5 2.5M15 19l1.5 2.5"/><path d="M8.5 12.5l2 2 4.5-5"/></svg>
      </div>
      <h1>EduBoard</h1>
      <p>Professional teaching smartboard</p>
      <button id="sb-start">Start EduBoard</button>
      <div class="sb-welcome-or">or upload a file to begin</div>
      <div id="sb-welcome-drop">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/></svg>
        <div class="sb-drop-main">Drag &amp; drop a PDF, PowerPoint, or quiz file</div>
        <button id="sb-welcome-browse">Browse files</button>
        <div class="sb-drop-accept">Accepted: PDF · PPTX (modern PowerPoint) · JSON (quiz)</div>
      </div>
      <div id="sb-welcome-notice">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>
        <div id="sb-welcome-notice-text"></div>
        <button id="sb-welcome-notice-close" title="Dismiss"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>
      <div id="sb-welcome-lang" style="display:none;margin-top:12px;text-align:center;">
        <span style="font-size:13px;color:#64748b;margin-right:8px;">Quiz language / क्विज भाषा:</span>
        <button class="sb-lang-btn active" data-lang="en" id="sb-welcome-lang-en" style="padding:5px 14px;border-radius:6px;border:1.5px solid #3b82f6;background:#eff6ff;color:#1d4ed8;font-weight:600;font-size:13px;cursor:pointer;margin-right:6px;">English</button>
        <button class="sb-lang-btn" data-lang="hi" id="sb-welcome-lang-hi" style="padding:5px 14px;border-radius:6px;border:1.5px solid #e2e8f0;background:#f8fafc;color:#475569;font-weight:600;font-size:13px;cursor:pointer;margin-right:6px;">हिंदी</button>
        <button class="sb-lang-btn" data-lang="both" id="sb-welcome-lang-both" style="padding:5px 14px;border-radius:6px;border:1.5px solid #e2e8f0;background:#f8fafc;color:#475569;font-weight:600;font-size:13px;cursor:pointer;">EN + हि</button>
      </div>
      <input type="file" id="sb-welcome-file" accept=".pdf,.pptx,.json,.smartboard" class="sb-hidden">
      <div id="sb-welcome-hint">Opens in full screen · press <b>Esc</b> to return here</div>
    </div>
  </div>
</div>
`;

function boot(host){
  if(!host || host.getAttribute('data-sb-mounted')) return;
  host.setAttribute('data-sb-mounted','1');
  host.classList.add('smartboard-embed');
  if(!host.hasAttribute('tabindex')) host.setAttribute('tabindex','0');
  // ---- sizing ----
  // data-height -> fixed height (number = px, or any CSS length / vh).
  // otherwise responsive: height follows the post's width via data-aspect
  // (e.g. '16:9' or '1.6'); defaults to 16:10. Clamped to a sensible range.
  var fixedH = host.getAttribute('data-height');
  function parseAspect(a){ if(!a) return 1.6; if(a.indexOf(':')>-1){var p=a.split(':');var r=parseFloat(p[0])/parseFloat(p[1]);return (r>0&&isFinite(r))?r:1.6;} var n=parseFloat(a); return (n>0&&isFinite(n))?n:1.6; }
  var ASPECT = parseAspect(host.getAttribute('data-aspect'));
  var MINH = parseInt(host.getAttribute('data-min-height')||'360',10) || 360;
  var MAXH = parseInt(host.getAttribute('data-max-height')||'0',10) || 0;
  function isHostFS(){ return (document.fullscreenElement===host)||(document.webkitFullscreenElement===host); }
  function applyHeight(){
    if(isHostFS()) return;            // in fullscreen the :fullscreen CSS fills the screen
    if(fixedH){ var v=fixedH; if(/^[0-9]+$/.test(v)) v=v+'px'; if(host.style.height!==v) host.style.height=v; return; }
    var w = host.clientWidth || (host.getBoundingClientRect&&host.getBoundingClientRect().width) || 0;
    if(!w) return;
    var vh = window.innerHeight || 800;
    var max = MAXH || Math.min(900, Math.round(vh*0.86));
    var hgt = Math.max(MINH, Math.min(max, Math.round(w/ASPECT)));
    var px = hgt+'px';
    if(host.style.height!==px) host.style.height=px;
  }
  applyHeight();
  // keep height in sync as the column/viewport changes
  if(window.ResizeObserver){ try{ new ResizeObserver(function(){ applyHeight(); }).observe(host); }catch(_){ } }
  window.addEventListener('resize', applyHeight);
  // while the board is fullscreen, drop the inline height so it fills the screen; restore on exit
  function onHostFS(){ if(isHostFS()){ host.style.height=''; } else { applyHeight(); } }
  document.addEventListener('fullscreenchange', onHostFS);
  document.addEventListener('webkitfullscreenchange', onHostFS);
  host.innerHTML = MARKUP;
  var root = host;
  /* ====================== engine (scoped to root/host) ====================== */
/* ============================== refs ============================== */
const $=s=>root.querySelector(s);
const wrap=$('#sb-board-wrap'), cv=$('#sb-canvas'), ov=$('#sb-overlay');
const ctx=cv.getContext('2d'), octx=ov.getContext('2d');
const hint=$('#sb-hint'), toastEl=$('#sb-toast'), loadEl=$('#sb-load'), loadTxt=$('#sb-load-txt');
const ta=$('#sb-textedit');

/* ============================== state ============================== */
let dpr=Math.max(1,window.devicePixelRatio||1);
const COLORS=['#15181d','#ffffff','#E5484D','#F4B740','#46A758','#1f6feb','#8E4EC6','#EC4899'];
const SIZES=[2,4,7,12,20];
const DEF_BG={type:'grid',color:'#ffffff'};
let pages=[newPage()], cur=0;
let view={scale:1,x:0,y:0};
pages[0].view=view;
let tool='pen', shapeKind='line';
let color='#15181d', sizeIdx=1, opacity=1;
let undoStack=[], redoStack=[];
const imgCache=new Map();

function newPage(){return {bg:{...DEF_BG}, objs:[], view:{scale:1,x:0,y:0}};}
function page(){return pages[cur];}

/* ============================== sizing ============================== */
function resize(){
  dpr=Math.max(1,window.devicePixelRatio||1);
  const w=wrap.clientWidth, h=wrap.clientHeight;
  [cv,ov].forEach(c=>{c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);});
  // Imported PDF/PPTX pages that haven't been manually zoomed/panned stay
  // fitted to the screen across rotation, fullscreen toggles, and moving
  // between phone/tablet/desktop — recompute their view for the new size.
  if(page() && page().bg.type==='image' && page().autofit) fitView();
  render();
}
window.addEventListener('resize',resize); if(window.ResizeObserver){try{new ResizeObserver(()=>resize()).observe(wrap);}catch(_){ }}

/* ============================== coords ============================== */
function boardPt(e){
  const r=cv.getBoundingClientRect();
  const cx=e.clientX-r.left, cy=e.clientY-r.top;
  return {x:(cx-view.x)/view.scale, y:(cy-view.y)/view.scale, cx, cy};
}
function visibleRect(){
  const w=cv.clientWidth, h=cv.clientHeight;
  return {x:(-view.x)/view.scale, y:(-view.y)/view.scale, w:w/view.scale, h:h/view.scale};
}

/* ============================== image cache ============================== */
function ensureImg(src){
  if(imgCache.has(src)) return imgCache.get(src);
  const im=new Image(); im.onload=()=>render(); im.src=src; imgCache.set(src,im); return im;
}

/* ============================== rendering ============================== */
function drawBackground(c, pg, rect){
  c.save();
  c.fillStyle = (pg.bg.color && pg.bg.type!=='black') ? pg.bg.color : (pg.bg.type==='black'?'#11141a':'#ffffff');
  c.fillRect(rect.x,rect.y,rect.w,rect.h);
  const t=pg.bg.type;
  if(t==='grid'||t==='lined'||t==='dots'){
    const gap=38;
    const x0=Math.floor(rect.x/gap)*gap, y0=Math.floor(rect.y/gap)*gap;
    c.strokeStyle='rgba(70,90,120,.13)'; c.fillStyle='rgba(70,90,120,.22)'; c.lineWidth=1/view.scale;
    if(t==='grid'){
      c.beginPath();
      for(let x=x0;x<rect.x+rect.w;x+=gap){c.moveTo(x,rect.y);c.lineTo(x,rect.y+rect.h);}
      for(let y=y0;y<rect.y+rect.h;y+=gap){c.moveTo(rect.x,y);c.lineTo(rect.x+rect.w,y);}
      c.stroke();
    }else if(t==='lined'){
      c.beginPath();
      for(let y=y0;y<rect.y+rect.h;y+=gap){c.moveTo(rect.x,y);c.lineTo(rect.x+rect.w,y);}
      c.stroke();
    }else{
      for(let x=x0;x<rect.x+rect.w;x+=gap) for(let y=y0;y<rect.y+rect.h;y+=gap){c.beginPath();c.arc(x,y,1.3/view.scale,0,7);c.fill();}
    }
  }
  if(t==='image' && pg.bg.src){
    const im=ensureImg(pg.bg.src);
    if(im.complete && im.naturalWidth){
      // paper shadow
      c.save();c.shadowColor='rgba(0,0,0,.25)';c.shadowBlur=24/view.scale;c.shadowOffsetY=6/view.scale;
      c.fillStyle='#fff';c.fillRect(0,0,pg.bg.w,pg.bg.h);c.restore();
      c.drawImage(im,0,0,pg.bg.w,pg.bg.h);
    }
  }
  c.restore();
}
function drawPath(c,o){
  const p=o.pts; if(!p.length)return;
  c.save(); c.lineCap='round'; c.lineJoin='round'; c.strokeStyle=o.color; c.fillStyle=o.color;
  if(o.tool==='marker'){c.globalCompositeOperation='multiply';c.globalAlpha=o.op??0.4;}
  if(p.length===1){c.beginPath();c.arc(p[0].x,p[0].y,(o.tool==='marker'?o.size*1.1:o.size*0.55),0,7);c.fill();c.restore();return;}
  if(o.tool==='marker'){
    c.lineWidth=o.size*2.2; c.beginPath(); c.moveTo(p[0].x,p[0].y);
    for(let i=1;i<p.length;i++)c.lineTo(p[i].x,p[i].y);
    c.stroke();
  }else{
    for(let i=1;i<p.length;i++){
      const a=p[i-1],b=p[i]; const pr=((a.p||.5)+(b.p||.5))/2;
      c.lineWidth=Math.max(.4,o.size*(0.45+pr*1.15));
      c.beginPath(); c.moveTo(a.x,a.y); c.lineTo(b.x,b.y); c.stroke();
    }
  }
  c.restore();
}
function drawShape(c,o){
  c.save(); c.strokeStyle=o.color; c.fillStyle=o.color; c.lineWidth=o.size; c.lineCap='round'; c.lineJoin='round';
  const {x1,y1,x2,y2,kind}=o;
  if(kind==='line'||kind==='arrow'){
    c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();
    if(kind==='arrow'){
      const a=Math.atan2(y2-y1,x2-x1), h=Math.max(10,o.size*3.2);
      c.beginPath();c.moveTo(x2,y2);
      c.lineTo(x2-h*Math.cos(a-0.45),y2-h*Math.sin(a-0.45));
      c.moveTo(x2,y2);
      c.lineTo(x2-h*Math.cos(a+0.45),y2-h*Math.sin(a+0.45));
      c.stroke();
    }
  }else if(kind==='rect'){
    c.strokeRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));
  }else if(kind==='ellipse'){
    c.beginPath();c.ellipse((x1+x2)/2,(y1+y2)/2,Math.abs(x2-x1)/2,Math.abs(y2-y1)/2,0,0,7);c.stroke();
  }
  c.restore();
}
function drawText(c,o){
  c.save(); c.fillStyle=o.color; c.font=`500 ${o.size}px system-ui,-apple-system,Segoe UI,Roboto,sans-serif`;
  c.textBaseline='top';
  o.text.split('\n').forEach((ln,i)=>c.fillText(ln,o.x,o.y+i*o.size*1.18));
  c.restore();
}
function drawImage(c,o){
  const im=ensureImg(o.src);
  if(im.complete&&im.naturalWidth) c.drawImage(im,o.x,o.y,o.w,o.h);
}
function drawObj(c,o){
  if(o.t==='path')drawPath(c,o);
  else if(o.t==='shape')drawShape(c,o);
  else if(o.t==='text')drawText(c,o);
  else if(o.t==='image')drawImage(c,o);
}
function render(){
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.translate(view.x,view.y); ctx.scale(view.scale,view.scale);
  const pg=page();
  drawBackground(ctx,pg,visibleRect());
  for(const o of pg.objs) drawObj(ctx,o);
  // hint
  const empty = pg.objs.length===0 && (pg.bg.type==='grid'||pg.bg.type==='plain') && cur===0 && pages.length===1;
  hint.style.opacity = empty?1:0;
}

/* ============================== overlay loop (live tools) ============================== */
let lastPointer=null, spotR=130;
let live=null;            // in-progress path/shape preview
let laserTrail=[];
let selection=null;       // selected obj
function renderOverlay(){
  octx.setTransform(dpr,0,0,dpr,0,0);
  octx.clearRect(0,0,ov.width,ov.height);
  // live preview (board space)
  if(live){
    octx.save();octx.translate(view.x,view.y);octx.scale(view.scale,view.scale);
    drawObj(octx,live);octx.restore();
  }
  // selection box (board space)
  if(selection && tool==='select'){
    const b=bbox(selection);
    octx.save();octx.translate(view.x,view.y);octx.scale(view.scale,view.scale);
    octx.strokeStyle='#1f6feb';octx.lineWidth=1.5/view.scale;octx.setLineDash([5/view.scale,4/view.scale]);
    octx.strokeRect(b.x,b.y,b.w,b.h);octx.setLineDash([]);
    if(selection.t==='image'){
      octx.fillStyle='#1f6feb';const hs=9/view.scale;
      octx.fillRect(b.x+b.w-hs/2,b.y+b.h-hs/2,hs,hs);
    }
    octx.restore();
  }
  // spotlight (screen space)
  if(tool==='spotlight' && lastPointer){
    octx.save();octx.fillStyle='rgba(8,10,14,.74)';octx.fillRect(0,0,ov.clientWidth,ov.clientHeight);
    octx.globalCompositeOperation='destination-out';
    const g=octx.createRadialGradient(lastPointer.cx,lastPointer.cy,spotR*0.55,lastPointer.cx,lastPointer.cy,spotR);
    g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(1,'rgba(0,0,0,0)');
    octx.fillStyle=g;octx.beginPath();octx.arc(lastPointer.cx,lastPointer.cy,spotR,0,7);octx.fill();
    octx.restore();
  }
  // laser (screen space)
  if(laserTrail.length){
    const now=performance.now();
    laserTrail=laserTrail.filter(p=>now-p.t<650);
    octx.save();
    for(const p of laserTrail){
      const a=1-(now-p.t)/650;
      octx.beginPath();octx.fillStyle=`rgba(255,40,40,${a*0.9})`;
      octx.shadowColor='rgba(255,30,30,.9)';octx.shadowBlur=16;
      octx.arc(p.cx,p.cy,7,0,7);octx.fill();
    }
    octx.restore();
  }
  requestAnimationFrame(renderOverlay);
}
requestAnimationFrame(renderOverlay);

/* ============================== geometry helpers ============================== */
function distSeg(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1; const l=dx*dx+dy*dy;
  let t=l?((px-x1)*dx+(py-y1)*dy)/l:0; t=Math.max(0,Math.min(1,t));
  const cx=x1+t*dx, cy=y1+t*dy; return Math.hypot(px-cx,py-cy);
}
function bbox(o){
  if(o.t==='path'){let xs=o.pts.map(p=>p.x),ys=o.pts.map(p=>p.y);
    const pad=o.size; return {x:Math.min(...xs)-pad,y:Math.min(...ys)-pad,w:Math.max(...xs)-Math.min(...xs)+pad*2,h:Math.max(...ys)-Math.min(...ys)+pad*2};}
  if(o.t==='shape'){return {x:Math.min(o.x1,o.x2)-o.size,y:Math.min(o.y1,o.y2)-o.size,w:Math.abs(o.x2-o.x1)+o.size*2,h:Math.abs(o.y2-o.y1)+o.size*2};}
  if(o.t==='text'){const lines=o.text.split('\n');const w=Math.max(...lines.map(l=>l.length))*o.size*0.56;return {x:o.x,y:o.y,w:Math.max(20,w),h:lines.length*o.size*1.18};}
  if(o.t==='image'){return {x:o.x,y:o.y,w:o.w,h:o.h};}
}
function inBox(b,x,y,pad=0){return x>=b.x-pad&&x<=b.x+b.w+pad&&y>=b.y-pad&&y<=b.y+b.h+pad;}
function selectHit(x,y){
  for(let i=page().objs.length-1;i>=0;i--){if(inBox(bbox(page().objs[i]),x,y,4))return page().objs[i];}
  return null;
}
function eraseAt(x,y,r){
  const objs=page().objs; let removed=false;
  for(let i=objs.length-1;i>=0;i--){
    const o=objs[i]; let hit=false;
    if(o.t==='path'){for(const p of o.pts){if(Math.hypot(p.x-x,p.y-y)<r+o.size){hit=true;break;}}}
    else if(o.t==='shape'){
      if(o.kind==='line'||o.kind==='arrow')hit=distSeg(x,y,o.x1,o.y1,o.x2,o.y2)<r+o.size;
      else hit=inBox(bbox(o),x,y,r);
    }
    else hit=inBox(bbox(o),x,y,0);
    if(hit){objs.splice(i,1);removed=true;}
  }
  return removed;
}

/* ============================== history ============================== */
function serObj(o){return o.t==='image'?{t:'image',src:o.src,x:o.x,y:o.y,w:o.w,h:o.h}:o;}
function serAll(){
  // The page you're currently on may have had its view live-fitted (e.g. an
  // imported PDF/PPTX page auto-fitting on first visit) without that fitted
  // view ever being written back into pages[cur].view — only switchPage()
  // does that, and only when you *leave* a page. Sync it here so every
  // undo/redo/save snapshot reflects what's actually on screen, not a stale
  // default (scale:1,x:0,y:0) that makes the page look blank when restored.
  if(page()) page().view={...view};
  return JSON.stringify(pages.map(p=>({bg:p.bg,view:p.view,objs:p.objs.map(serObj),autofit:p.autofit})));
}
function loadAll(json, stripDrawings){
  pages=JSON.parse(json).map(p=>({bg:p.bg,view:p.view||{scale:1,x:0,y:0},objs:stripDrawings?[]:(p.objs||[]),autofit:p.autofit}));
  pages.forEach(p=>{if(p.bg.src)ensureImg(p.bg.src);p.objs.forEach(o=>{if(o.t==='image')ensureImg(o.src);});});
  cur=Math.min(cur,pages.length-1); view=page().view; selection=null;
}
function pushUndo(){undoStack.push(serAll());if(undoStack.length>50)undoStack.shift();redoStack=[];updateUndo();}
function undo(){if(!undoStack.length)return;redoStack.push(serAll());loadAll(undoStack.pop());updateUndo();render();updatePageLbl();}
function redo(){if(!redoStack.length)return;undoStack.push(serAll());loadAll(redoStack.pop());updateUndo();render();updatePageLbl();}
function updateUndo(){$('#sb-undo').disabled=!undoStack.length;$('#sb-redo').disabled=!redoStack.length;}

/* ============================== pointer / drawing ============================== */
const pointers=new Map();
let drawId=null, gesturing=false, gLast=null;
let startPt=null, panStart=null, moveOff=null, resizing=false, rightDown=false;

function pressure(e){if(e.pointerType==='mouse'||!e.pressure)return 0.5;return e.pressure;}

cv.addEventListener('pointerdown',e=>{
  try{host.focus({preventScroll:true});}catch(_){ try{host.focus();}catch(__){} }
  if(tool==='spotlight'){lastPointer=boardPt(e);return;}
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId,{cx:e.clientX,cy:e.clientY});
  if(pointers.size===2){ // start gesture, cancel any draw
    if(drawId!==null){live=null;drawId=null;}
    gesturing=true;gLast=gestureState();return;
  }
  if(pointers.size>2)return;
  drawId=e.pointerId;
  const b=boardPt(e); lastPointer=b;

  if(e.button===2){rightDown=true;panStart={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};return;}
  if(e.button===1||spaceDown){panStart={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};return;}

  if(tool==='pen'||tool==='marker'){
    live={t:'path',tool:tool,color:color,size:SIZES[sizeIdx],op:(tool==='marker'?opacity*0.45:opacity),pts:[{x:b.x,y:b.y,p:pressure(e)}]};
  }else if(tool==='eraser'){
    pushUndo(); if(eraseAt(b.x,b.y,SIZES[sizeIdx]*2.5))render();
  }else if(tool==='shape'){
    startPt=b; live={t:'shape',kind:shapeKind,color:color,size:SIZES[sizeIdx],x1:b.x,y1:b.y,x2:b.x,y2:b.y};
  }else if(tool==='text'){
    openText(null,b.x,b.y);
  }else if(tool==='laser'){
    laserTrail.push({cx:b.cx,cy:b.cy,t:performance.now()});
  }else if(tool==='select'){
    const hit=selectHit(b.x,b.y);
    if(selection&&selection.t==='image'){ // resize handle?
      const bb=bbox(selection);const hx=bb.x+bb.w,hy=bb.y+bb.h;
      if(Math.hypot(b.x-hx,b.y-hy)<14/view.scale){resizing=true;pushUndo();return;}
    }
    selection=hit;
    if(hit){pushUndo();moveOff={x:b.x,y:b.y};}
  }
});

cv.addEventListener('pointermove',e=>{
  if(tool==='spotlight'){lastPointer=boardPt(e);return;}
  if(pointers.has(e.pointerId))pointers.set(e.pointerId,{cx:e.clientX,cy:e.clientY});
  if(gesturing&&pointers.size>=2){doGesture();return;}
  if(e.pointerId!==drawId)return;
  const b=boardPt(e); lastPointer=b;

  if(panStart){leaveAutofit();view.x=panStart.vx+(e.clientX-panStart.x);view.y=panStart.vy+(e.clientY-panStart.y);render();return;}

  if((tool==='pen'||tool==='marker')&&live){
    const evs=e.getCoalescedEvents?e.getCoalescedEvents():[e];
    for(const ce of evs){const r=cv.getBoundingClientRect();
      live.pts.push({x:(ce.clientX-r.left-view.x)/view.scale,y:(ce.clientY-r.top-view.y)/view.scale,p:pressure(ce)});}
  }else if(tool==='eraser'){if(eraseAt(b.x,b.y,SIZES[sizeIdx]*2.5))render();}
  else if(tool==='shape'&&live){live.x2=b.x;live.y2=b.y;}
  else if(tool==='laser'){laserTrail.push({cx:b.cx,cy:b.cy,t:performance.now()});}
  else if(tool==='select'){
    if(resizing&&selection&&selection.t==='image'){
      const ratio=selection.w/selection.h; let nw=Math.max(20,b.x-selection.x);
      selection.w=nw;selection.h=nw/ratio;render();
    }else if(selection&&moveOff){
      const dx=b.x-moveOff.x,dy=b.y-moveOff.y;moveOff={x:b.x,y:b.y};moveObj(selection,dx,dy);render();
    }
  }
});

function endPointer(e){
  if(e.button===2)rightDown=false;
  if(tool==='spotlight')return;
  pointers.delete(e.pointerId);
  if(gesturing){if(pointers.size<2)gesturing=false;return;}
  if(e.pointerId!==drawId)return;
  drawId=null;
  if(panStart){panStart=null;return;}
  if((tool==='pen'||tool==='marker')&&live){pushUndo();page().objs.push(live);live=null;render();}
  else if(tool==='shape'&&live){
    if(Math.hypot(live.x2-live.x1,live.y2-live.y1)>3){pushUndo();page().objs.push(live);}
    live=null;render();
  }
  else if(tool==='select'){resizing=false;moveOff=null;}
}
cv.addEventListener('pointerup',endPointer);
cv.addEventListener('pointercancel',endPointer);
cv.addEventListener('pointerleave',e=>{if(e.pointerId===drawId&&!live&&!panStart)return;});
cv.addEventListener('contextmenu',e=>e.preventDefault());

function moveObj(o,dx,dy){
  if(o.t==='path')o.pts.forEach(p=>{p.x+=dx;p.y+=dy;});
  else if(o.t==='shape'){o.x1+=dx;o.y1+=dy;o.x2+=dx;o.y2+=dy;}
  else{o.x+=dx;o.y+=dy;}
}

/* ---------- gestures (pinch / two-finger pan) ---------- */
function gestureState(){
  const p=[...pointers.values()];
  return {mx:(p[0].cx+p[1].cx)/2,my:(p[0].cy+p[1].cy)/2,d:Math.hypot(p[0].cx-p[1].cx,p[0].cy-p[1].cy)};
}
function doGesture(){
  const g=gestureState(); if(!gLast){gLast=g;return;}
  leaveAutofit();
  const r=cv.getBoundingClientRect();
  view.x+=g.mx-gLast.mx; view.y+=g.my-gLast.my;
  if(gLast.d>0){
    const f=g.d/gLast.d; const ns=Math.max(.2,Math.min(8,view.scale*f));
    const fx=g.mx-r.left, fy=g.my-r.top;
    view.x=fx-(fx-view.x)*(ns/view.scale); view.y=fy-(fy-view.y)*(ns/view.scale); view.scale=ns;
  }
  gLast=g; render();
}

/* ---------- wheel zoom / pan ---------- */
cv.addEventListener('wheel',e=>{
  e.preventDefault();
  if(tool==='spotlight'){spotR=Math.max(50,Math.min(420,spotR-e.deltaY*0.5));return;}
  leaveAutofit();
  const r=cv.getBoundingClientRect(), fx=e.clientX-r.left, fy=e.clientY-r.top;
  if(e.ctrlKey||e.metaKey||rightDown){
    const f=Math.exp(-e.deltaY*0.0016); const ns=Math.max(.2,Math.min(8,view.scale*f));
    view.x=fx-(fx-view.x)*(ns/view.scale); view.y=fy-(fy-view.y)*(ns/view.scale); view.scale=ns;
  }else{view.x-=e.deltaX;view.y-=e.deltaY;}
  // A pan may be active at the same time (right-click held). Its baseline
  // was captured at pointerdown and knows nothing about the view change we
  // just made — without this resync, the next pointermove tick (even a
  // sub-pixel jitter from a finger resting on the wheel) would snap view.x/y
  // back toward the pre-zoom position, fighting the zoom and causing jerk.
  if(panStart){panStart.x=e.clientX;panStart.y=e.clientY;panStart.vx=view.x;panStart.vy=view.y;}
  render();
},{passive:false});

/* ============================== text editing ============================== */
let editTarget=null;
function openText(obj,bx,by){
  editTarget=obj;
  const fpx=obj?obj.size:SIZES[sizeIdx]*5+8;
  const x=obj?obj.x:bx, y=obj?obj.y:by;
  ta.style.display='block';
  ta.style.left=(view.x+x*view.scale)+'px';
  ta.style.top=(view.y+y*view.scale)+'px';
  ta.style.fontSize=(fpx*view.scale)+'px';
  ta.style.color=obj?obj.color:color;
  ta.style.fontFamily='system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  ta.style.fontWeight='500';
  ta.dataset.bx=x; ta.dataset.by=y; ta.dataset.fpx=fpx;
  ta.value=obj?obj.text:'';
  if(obj){page().objs=page().objs.filter(o=>o!==obj);render();}
  autosizeTA(); setTimeout(()=>{ta.focus();},10);
}
function autosizeTA(){ta.style.width='auto';ta.style.height='auto';ta.style.width=Math.max(40,ta.scrollWidth+6)+'px';ta.style.height=ta.scrollHeight+'px';}
ta.addEventListener('input',autosizeTA);
function commitText(){
  if(ta.style.display==='none')return;
  const v=ta.value.replace(/\s+$/,'');
  ta.style.display='none';
  if(v){pushUndo();page().objs.push({t:'text',text:v,x:+ta.dataset.bx,y:+ta.dataset.by,size:+ta.dataset.fpx,color:editTarget?editTarget.color:color});}
  else if(editTarget){/* deleted */ pushUndo();}
  editTarget=null; render();
}
ta.addEventListener('blur',commitText);
ta.addEventListener('keydown',e=>{if(e.key==='Escape'){ta.value='';commitText();}if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();commitText();}});
cv.addEventListener('dblclick',e=>{
  if(tool!=='select')return; const b=boardPt(e); const h=selectHit(b.x,b.y);
  if(h&&h.t==='text')openText(h);
});

/* ============================== tools UI ============================== */
const dock=$('#sb-dock');
function setTool(t){
  if(t!=='select')selection=null;
  tool=t;
  dock.querySelectorAll('.sb-tool[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));
  $('#sb-shapes-menu').classList.toggle('open',false);
  // cursor + props visibility
  const showProps=['pen','marker','shape','text','eraser'].includes(t);
  $('#sb-props').style.display=showProps?'flex':'none';
  const showOpacity=(t==='marker');
  $('#sb-opacity').style.display=showOpacity?'':'none';$('#sb-oplabel').style.display=showOpacity?'':'none';$('#sb-opsep').style.display=showOpacity?'':'none';
  $('#sb-props').scrollLeft=0;
  cv.style.cursor = t==='select'?'default' : (t==='text'?'text':'crosshair');
  if(t!=='spotlight')lastPointer=lastPointer; // keep
}
dock.querySelectorAll('.sb-tool[data-tool]').forEach(b=>{
  b.addEventListener('click',()=>{
    if(b.dataset.tool==='shape'){$('#sb-shapes-menu').classList.toggle('open');}
    setTool(b.dataset.tool);
  });
});
$('#sb-shapes-menu').querySelectorAll('[data-shape]').forEach(b=>{
  b.addEventListener('click',()=>{
    shapeKind=b.dataset.shape; setTool('shape');
    $('#sb-shapes-menu').querySelectorAll('.sb-tool').forEach(x=>x.classList.toggle('active',x===b));
    $('#sb-shapes-menu').classList.remove('open');
    $('#sb-shapebtn').classList.add('active');
  });
});

/* tool dots for laser/spotlight/etc colour cue */
function markActive(id){dock.querySelectorAll('.sb-tool').forEach(b=>{if(!b.dataset.tool)b.classList.remove('active');});if(id)$(id).classList.add('active');}
$('#sb-shadebtn').addEventListener('click',()=>toggleShade());
$('#sb-webbtn').addEventListener('click',()=>toggleWeb());
$('#sb-timerbtn').addEventListener('click',()=>toggleTimer());
$('#sb-clear').addEventListener('click',()=>{if(page().objs.length){pushUndo();page().objs=[];render();toast('Page cleared');}});

/* spotlight/laser tools also need active highlight via data-tool path already handled */

/* ============================== palette + sizes ============================== */
const swWrap=$('#sb-swatches');
COLORS.forEach((c,i)=>{const s=document.createElement('div');s.className='sb-swatch'+(i===0?' active':'');s.style.background=c;
  s.addEventListener('click',()=>{color=c;swWrap.querySelectorAll('.sb-swatch').forEach(x=>x.classList.remove('active'));s.classList.add('active');$('#sb-customface').style.opacity=.6;});swWrap.appendChild(s);});
$('#sb-custom').addEventListener('input',e=>{color=e.target.value;swWrap.querySelectorAll('.sb-swatch').forEach(x=>x.classList.remove('active'));$('#sb-customface').style.opacity=1;});
const szWrap=$('#sb-sizes');
SIZES.forEach((s,i)=>{const b=document.createElement('button');b.className='sb-size'+(i===sizeIdx?' active':'');
  const d=Math.max(5,Math.min(22,s+3));b.innerHTML=`<i style="width:${d}px;height:${d}px"></i>`;
  b.addEventListener('click',()=>{sizeIdx=i;szWrap.querySelectorAll('.sb-size').forEach(x=>x.classList.remove('active'));b.classList.add('active');});szWrap.appendChild(b);});
$('#sb-opacity').addEventListener('input',e=>opacity=+e.target.value/100);

/* ============================== pages ============================== */
function updatePageLbl(){$('#sb-pagelbl').textContent=`${cur+1} / ${pages.length}`;
  $('#sb-prev').disabled=cur===0;$('#sb-next').disabled=cur===pages.length-1;}
function switchPage(i){if(i<0||i>=pages.length)return;page().view={...view};cur=i;view={...pages[cur].view};if(pages[cur].bg.type==='image'&&pages[cur].autofit)fitView();selection=null;updatePageLbl();render();}
$('#sb-prev').addEventListener('click',()=>switchPage(cur-1));
$('#sb-next').addEventListener('click',()=>switchPage(cur+1));
$('#sb-undo').addEventListener('click',undo);
$('#sb-redo').addEventListener('click',redo);
$('#sb-zoomin').addEventListener('click',()=>zoomBy(1.15));
$('#sb-zoomout').addEventListener('click',()=>zoomBy(1/1.15));
$('#sb-zoomfit').addEventListener('click',()=>{fitView();render();});
$('#sb-addpage').addEventListener('click',()=>{pushUndo();page().view={...view};pages.splice(cur+1,0,newPage());cur++;view={...page().view};updatePageLbl();render();toast('Blank page added');});

/* ============================== background menu ============================== */
const bgMenu=popup($('#sb-bg'),[
  {label:'Plain white',act:()=>setBg({type:'plain',color:'#ffffff'})},
  {label:'Grid',act:()=>setBg({type:'grid',color:'#ffffff'})},
  {label:'Lined',act:()=>setBg({type:'lined',color:'#ffffff'})},
  {label:'Dots',act:()=>setBg({type:'dots',color:'#ffffff'})},
  {label:'Blackboard',act:()=>setBg({type:'black'})},
]);
function setBg(bg){pushUndo();page().bg=bg;render();bgMenu.hide();}

/* ============================== export menu ============================== */
const exMenu=popup($('#sb-export'),[
  {label:'Save page as image',act:()=>{exportPNG();exMenu.hide();}},
  {label:'Export all pages as PDF',act:()=>{exportPDF();exMenu.hide();}},
  {label:'Save board file',act:()=>{saveBoard();exMenu.hide();}},
  {label:'Open board file',act:()=>{exMenu.hide();pickFile();}},
]);

function popup(anchor, items){
  const el=document.createElement('div');el.className='sb-glass';
  el.style.cssText='position:absolute;z-index:60;display:none;flex-direction:column;padding:6px;min-width:190px;';
  items.forEach(it=>{const b=document.createElement('button');b.className='sb-btn';b.style.justifyContent='flex-start';b.style.width='100%';b.style.height='38px';b.textContent=it.label;b.addEventListener('click',it.act);el.appendChild(b);});
  $('#sb-app').appendChild(el);
  const api={show(){const a=$('#sb-app').getBoundingClientRect();const r=anchor.getBoundingClientRect();el.style.display='flex';el.style.top=(r.bottom-a.top+8)+'px';el.style.left=Math.max(6,Math.min(r.left-a.left,a.width-210))+'px';},hide(){el.style.display='none';}};
  popup._all=popup._all||[]; popup._all.push(api);
  anchor.addEventListener('click',e=>{e.stopPropagation();const open=el.style.display==='flex';popup._all.forEach(p=>{if(p!==api)p.hide();});api[open?'hide':'show']();});
  document.addEventListener('click',()=>api.hide());
  el.addEventListener('click',e=>e.stopPropagation());
  return api;
}

/* ============================== fullscreen & welcome ============================== */
var fsEl = (typeof host !== 'undefined' && host) ? host : $('#sb-app');
function enterFS(){
  var r = fsEl.requestFullscreen ? fsEl.requestFullscreen()
        : (fsEl.webkitRequestFullscreen ? fsEl.webkitRequestFullscreen() : null);
  return (r && r.then) ? r : Promise.resolve();
}
function exitFS(){
  if(document.exitFullscreen) return document.exitFullscreen();
  if(document.webkitExitFullscreen) return document.webkitExitFullscreen();
}
function isFS(){ return !!(document.fullscreenElement || document.webkitFullscreenElement); }
$('#sb-full').addEventListener('click',()=>{
  if(!isFS()) enterFS().then(()=>setTimeout(resize,80)).catch(()=>{});
  else { _exitingFSviaBtn=true; exitFS(); }
});
var _exitingFSviaBtn=false;
function onFSchange(){
  setTimeout(resize,80);
  if(isFS()){
    $('#sb-welcome').classList.add('hide');
  } else {
    if(_exitingFSviaBtn){
      // user pressed fullscreen button — just exit fullscreen, stay on board
      _exitingFSviaBtn=false;
    } else if(!fileDialogActive){
      // Esc key or browser exit — only return to welcome if board has no content
      var hasContent = pages.some(function(p){ return p.objs.length>0 || p.bg.type==='image'; });
      if(!hasContent) $('#sb-welcome').classList.remove('hide');
    }
  }
  // Update fullscreen button icon & tooltip
  var btn=$('#sb-full');
  if(btn){
    if(isFS()){
      btn.title='Exit fullscreen';
      btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 0 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';
    } else {
      btn.title='Fullscreen';
      btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
    }
  }
}
document.addEventListener('fullscreenchange', onFSchange);
document.addEventListener('webkitfullscreenchange', onFSchange);

/* ============================== welcome-screen upload (PDF / PPTX) ============================== */
// PDF/PPTX import happens ONLY here, before fullscreen is entered, so the native
// file dialog never has to fight with fullscreen — there is nothing to suppress.
const welcomeNoticeEl=$('#sb-welcome-notice'), welcomeNoticeText=$('#sb-welcome-notice-text');
function showWelcomeNotice(html){ welcomeNoticeText.innerHTML=html; welcomeNoticeEl.classList.add('show'); }
function hideWelcomeNotice(){ welcomeNoticeEl.classList.remove('show'); }
$('#sb-welcome-notice-close').addEventListener('click',hideWelcomeNotice);
function startWithFile(f){
  if(!f) return;
  const n=(f.name||'').toLowerCase();
  if(n.endsWith('.ppt')){
    showWelcomeNotice('<b>Old PowerPoint (97-2003 .ppt) isn\'t supported.</b> That\'s the legacy binary format — this board can only read modern <b>.pptx</b>. In PowerPoint, use <b>File → Save As</b> and pick <b>PowerPoint Presentation (.pptx)</b> (or <b>PDF</b>), then import that file instead.');
    return;
  }
  hideWelcomeNotice();
  if(n.endsWith('.json')||n.endsWith('.smartboard')){ startWithQuizJSON(f); return; }
  if(!(n.endsWith('.pdf')||n.endsWith('.pptx'))){
    showWelcomeNotice('<b>Unsupported file type.</b> Only PDF, PowerPoint (.pptx), and quiz (.json) files can be imported here.'); return;
  }
  $('#sb-welcome').classList.add('hide');
  try{ fsEl.focus && fsEl.focus({preventScroll:true}); }catch(_){ try{ fsEl.focus && fsEl.focus(); }catch(__){} }
  enterFS().then(()=>setTimeout(resize,80)).catch(()=>{ setTimeout(resize,80); });
  if(n.endsWith('.pdf')) importPDF(f); else importPPT(f);
}
// Welcome-screen-only quiz loader. Unlike the in-canvas "Open board file"
// (which fully restores a saved session, drawings included), this is meant
// for handing the *same* prepared quiz to one student after another: the
// quiz content itself always loads exactly as authored, but the drawing
// layer (objs) always starts empty, so nothing from a previous student
// carries over. Two input formats are supported:
//   A) A SmartBoard board/pages file (top-level array) — its own export.
//   B) An MCQ-style quiz export (top-level object with a posts[] array of
//      post_type:'question', e.g. a WordPress quiz-plugin export) — each
//      question becomes one page, rendered as a worksheet image with the
//      question text and lettered options. The correct answer / explanation
//      fields, if present, are intentionally NOT shown on the page, so the
//      board can be used as a real worksheet rather than spoiling answers.
function enterAndShowBoard(){
  $('#sb-welcome').classList.add('hide');
  try{ fsEl.focus && fsEl.focus({preventScroll:true}); }catch(_){ try{ fsEl.focus && fsEl.focus(); }catch(__){} }
  enterFS().then(()=>setTimeout(resize,80)).catch(()=>{ setTimeout(resize,80); });
}
function startWithQuizJSON(f){
  const r=new FileReader();
  r.onload=async ()=>{
    let parsed;
    try{ parsed=JSON.parse(r.result); }
    catch(e){ showWelcomeNotice('<b>Invalid quiz file.</b> That .json file could not be read as JSON.'); return; }

    // Format A: SmartBoard's own saved board/pages file.
    if(Array.isArray(parsed)){
      if(!parsed.length){ showWelcomeNotice('<b>Empty quiz file.</b> That board file has no pages.'); return; }
      hideWelcomeNotice();
      undoStack=[]; redoStack=[];
      loadAll(r.result, true); // true = keep the quiz content, strip any drawings
      cur=0; view=page().view; selection=null;
      updateUndo(); updatePageLbl();
      enterAndShowBoard();
      render();
      toast(`Quiz loaded · ${parsed.length} page${parsed.length>1?'s':''} · ready for drawing`);
      return;
    }

    // Format B: MCQ-style quiz export.
    if(parsed && Array.isArray(parsed.posts)){
      const qs=parsed.posts.filter(p=>p&&p.post_type==='question'&&p.post_status!=='draft');
      if(!qs.length){ showWelcomeNotice('<b>No questions found.</b> This file doesn\'t contain any quiz questions to import.'); return; }
      const topicName=(parsed.terms&&parsed.terms[0]&&parsed.terms[0].name)||'';
      // Detect if Hindi content is available in this quiz
      const hasHindi=qs.some(q=>q.meta_input&&q.meta_input._aimcq_question_content_hi);
      hideWelcomeNotice();
      enterAndShowBoard();
      try{
        showLoad('Preparing quiz…');
        await ensureH2C();
        // Cache questions for language re-rendering
        quizQsCache=qs; quizTopicCache=topicName;
        quizFontScale=1; // reset question font size for each newly loaded quiz
        const out=await renderMCQPages(qs,topicName,quizLang);
        if(!out.length) throw new Error('no pages rendered');
        pages=out.map(d=>({bg:{type:'image',src:d.src,w:d.w,h:d.h},view:{scale:1,x:0,y:0},objs:[],autofit:true,fitWidth:true}));
        out.forEach(d=>ensureImg(d.src));
        cur=0; fitView(); pages[0].view={...view}; selection=null;
        undoStack=[]; redoStack=[];
        updateUndo(); updatePageLbl(); render();
        toast(`Quiz loaded · ${out.length} question${out.length>1?'s':''} · ready for drawing`);
        // Show the question font-size resizer for any loaded quiz
        showFontSizer(); updateFszLabel();
        // Show language toggle in the top bar when Hindi content exists
        if(hasHindi){
          showLangButtons(); updateLangBtn();
        }
      }catch(err){
        console.error(err);
        toast('Could not build this quiz — check the file and try again');
      }
      hideLoad();
      return;
    }

    showWelcomeNotice('<b>Unrecognized quiz format.</b> This .json file doesn\'t match a SmartBoard board file or a supported quiz export.');
  };
  r.onerror=()=>{ showWelcomeNotice('<b>Could not read that file.</b> Please try again.'); };
  r.readAsText(f);
}
(function(){
  const wdrop=$('#sb-welcome-drop'), wfile=$('#sb-welcome-file');
  $('#sb-welcome-browse').addEventListener('click',e=>{ e.stopPropagation(); wfile.click(); });
  wfile.addEventListener('change',e=>{ const f=e.target.files[0]; e.target.value=''; if(f) startWithFile(f); });
  ['dragenter','dragover'].forEach(t=>wdrop.addEventListener(t,e=>{e.preventDefault();e.stopPropagation();wdrop.classList.add('drag');}));
  ['dragleave','dragend'].forEach(t=>wdrop.addEventListener(t,e=>{e.preventDefault();e.stopPropagation();wdrop.classList.remove('drag');}));
  wdrop.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();wdrop.classList.remove('drag');const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(f)startWithFile(f);});

  /* Language selector on welcome screen */
  function updateWelcomeLangBtns(){
    const btns=['en','hi','both'].map(l=>$('#sb-welcome-lang-'+l)).filter(Boolean);
    btns.forEach(btn=>{
      const active=btn.dataset.lang===quizLang;
      Object.assign(btn.style,active?{borderColor:'#3b82f6',background:'#eff6ff',color:'#1d4ed8'}:{borderColor:'#e2e8f0',background:'#f8fafc',color:'#475569'});
    });
  }
  // Show welcome lang selector when a JSON file is hovered/dropped
  function peekFileForHindi(file){
    if(!file||!file.name.endsWith('.json'))return;
    const r=new FileReader();
    r.onload=()=>{
      try{
        const p=JSON.parse(r.result);
        const qs=Array.isArray(p&&p.posts)?p.posts.filter(q=>q&&q.post_type==='question'):[];
        const hasHi=qs.some(q=>q.meta_input&&q.meta_input._aimcq_question_content_hi);
        if(hasHi){ const el=$('#sb-welcome-lang'); if(el){el.style.display=''; updateWelcomeLangBtns();}}
      }catch(e){}
    };
    r.readAsText(file);
  }
  // Intercept drop to peek for Hindi
  const origDrop=wdrop._dropHandler;
  wdrop.addEventListener('dragover',e=>{
    if(e.dataTransfer&&e.dataTransfer.items&&e.dataTransfer.items[0]&&e.dataTransfer.items[0].getAsFile){
      const f=e.dataTransfer.items[0].getAsFile&&e.dataTransfer.items[0].getAsFile();
      if(f&&f.name.endsWith('.json')){}// can't peek on hover reliably
    }
  });
  // When file input changes, peek
  wfile.addEventListener('change',e=>{ peekFileForHindi(e.target.files[0]); },true);

  // Welcome screen lang button handlers
  document.querySelectorAll('.sb-lang-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      quizLang=btn.dataset.lang||'en';
      updateWelcomeLangBtns();
    });
  });
})();

/* Language button helpers (top bar) */
function updateLangBtn(){
  ['en','hi','both'].forEach(l=>{
    const btn=$('#sb-lang-'+l);
    if(!btn) return;
    const active=quizLang===l;
    btn.style.background=active?'rgba(99,102,241,.28)':'';
    btn.style.color=active?'#c7d2fe':'';
    btn.style.borderColor=active?'rgba(99,102,241,.7)':'';
    btn.style.border=active?'1.5px solid rgba(99,102,241,.7)':'';
  });
}
function showLangButtons(){
  ['en','hi','both'].forEach(l=>{
    const btn=$('#sb-lang-'+l); if(btn) btn.style.display='';
  });
  const sep=$('#sb-lang-sep'); if(sep) sep.style.display='';
}
(function(){
  document.addEventListener('click',e=>{
    const btn=e.target.closest('.sb-lang-mode-btn');
    if(btn&&btn.dataset.lang){
      rerenderQuizInLang(btn.dataset.lang);
      updateLangBtn();
    }
  });
})();

/* ---------- Question font-size resizer (top bar) ---------- */
// Lets the presenter shrink/enlarge the question + option text of a loaded
// quiz on the fly — handy for matching room size / projector distance —
// without needing to re-export or re-author the quiz JSON.
function showFontSizer(){
  const wrap=$('#sb-fontsizer'); if(wrap) wrap.style.display='flex';
  const sep=$('#sb-fsz-sep'); if(sep) sep.style.display='';
}
function updateFszLabel(){
  const inp=$('#sb-fsz-input'); if(inp && document.activeElement!==inp) inp.value=Math.round((quizFontScale||1)*100);
  const dec=$('#sb-fsz-dec'); if(dec) dec.disabled = quizFontScale<=QUIZ_FONT_MIN+1e-9;
  const inc=$('#sb-fsz-inc'); if(inc) inc.disabled = quizFontScale>=QUIZ_FONT_MAX-1e-9;
}
async function rerenderQuizFontSize(delta){
  if(!quizQsCache||!quizQsCache.length) return;
  const next=Math.min(QUIZ_FONT_MAX,Math.max(QUIZ_FONT_MIN,+(quizFontScale+delta).toFixed(2)));
  await applyQuizFontScale(next);
}
async function applyQuizFontScale(scale){
  if(!quizQsCache||!quizQsCache.length) return;
  const next=Math.min(QUIZ_FONT_MAX,Math.max(QUIZ_FONT_MIN,+(scale).toFixed(2)));
  if(next===quizFontScale){ updateFszLabel(); return; }
  quizFontScale=next;
  updateFszLabel();
  try{
    showLoad('Resizing question text…');
    await ensureH2C();
    const out=await renderMCQPages(quizQsCache,quizTopicCache,quizLang);
    if(!out.length) throw new Error('no pages');
    const prevCur=Math.min(cur,out.length-1);
    pages=out.map(d=>({bg:{type:'image',src:d.src,w:d.w,h:d.h},view:{scale:1,x:0,y:0},objs:[],autofit:true,fitWidth:true}));
    out.forEach(d=>ensureImg(d.src));
    cur=prevCur; fitView(); pages[cur].view={...view}; selection=null;
    undoStack=[]; redoStack=[];
    updateUndo(); updatePageLbl(); render();
    toast(`Question text · ${Math.round(quizFontScale*100)}%`);
  }catch(e){ console.error(e); toast('Could not resize question text'); }
  hideLoad();
}
(function(){
  const dec=$('#sb-fsz-dec'), inc=$('#sb-fsz-inc'), inp=$('#sb-fsz-input');
  if(dec) dec.addEventListener('click',()=>rerenderQuizFontSize(-QUIZ_FONT_STEP));
  if(inc) inc.addEventListener('click',()=>rerenderQuizFontSize(QUIZ_FONT_STEP));
  if(inp){
    const commit=()=>{
      let pct=parseFloat(inp.value);
      if(!isFinite(pct)) pct=Math.round(quizFontScale*100);
      pct=Math.min(300,Math.max(40,Math.round(pct)));
      inp.value=pct;
      applyQuizFontScale(pct/100);
    };
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); } });
    inp.addEventListener('blur',commit);
  }
})();

/* ============================== open-board overlay picker ============================== */
// Opening a native file dialog can drop fullscreen on some browsers. The "Open
// board" picker's drag-drop keeps fullscreen; the native dialog is only used by
// the explicit "Browse" fallback, with re-enter protection.
var fileDialogActive=false;
function pickFile(){
  $('#sb-drop').classList.remove('drag');
  $('#sb-picker').classList.add('open');
}
function closePicker(){ $('#sb-picker').classList.remove('open'); }
function handlePicked(f){ if(!f)return; closePicker(); openBoard(f); }
// native OS dialog fallback — keeps the welcome suppression + re-enters fullscreen
function nativeBrowse(inp){
  if(!inp) return;
  var wasFS=isFS(), finished=false;
  fileDialogActive=true;
  function fin(){
    if(finished) return; finished=true;
    window.removeEventListener('focus',onF,true);
    inp.removeEventListener('change',onC);
    if(wasFS && !isFS()){ enterFS().then(()=>setTimeout(resize,80)).catch(()=>{}); }
    setTimeout(function(){ fileDialogActive=false; if(wasFS && !isFS()) $('#sb-welcome').classList.add('hide'); },90);
  }
  function onC(){ fin(); }
  function onF(){ fin(); }
  inp.addEventListener('change',onC);
  setTimeout(function(){ window.addEventListener('focus',onF,true); },0);
  inp.click();
}
/* picker overlay wiring */
(function(){
  var pk=$('#sb-picker'), drop=$('#sb-drop');
  $('#sb-picker-close').addEventListener('click',closePicker);
  pk.addEventListener('click',e=>{ if(e.target===pk) closePicker(); });
  $('#sb-picker-browse').addEventListener('click',()=>nativeBrowse($('#sb-loadfile')));
  ['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();e.stopPropagation();drop.classList.add('drag');}));
  ['dragleave','dragend'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();e.stopPropagation();drop.classList.remove('drag');}));
  drop.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();drop.classList.remove('drag');var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(f)handlePicked(f);});
  pk.addEventListener('dragover',e=>{e.preventDefault();});
  pk.addEventListener('drop',e=>{e.preventDefault();var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(f)handlePicked(f);});
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&pk.classList.contains('open'))closePicker(); });
})();
/* drop a board file anywhere on the board to restore it (no dialog, stays fullscreen).
   PDF/PPTX are intentionally NOT accepted here — import those from the welcome screen. */
(function(){
  var app=$('#sb-app');
  app.addEventListener('dragover',e=>{ var t=e.dataTransfer&&e.dataTransfer.types; if(t&&Array.prototype.indexOf.call(t,'Files')>-1) e.preventDefault(); });
  app.addEventListener('drop',e=>{
    if($('#sb-picker').classList.contains('open'))return;
    var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]; if(!f)return;
    e.preventDefault();
    var n=(f.name||'').toLowerCase();
    if(n.endsWith('.smartboard')||n.endsWith('.json')) openBoard(f);
    else toast('Import a PDF or PowerPoint from the welcome screen (exit fullscreen first)');
  });
})();
$('#sb-start').addEventListener('click',()=>{
  $('#sb-welcome').classList.add('hide');
  try{ fsEl.focus && fsEl.focus({preventScroll:true}); }catch(_){ try{ fsEl.focus && fsEl.focus(); }catch(__){} }
  // Start directly in fullscreen; if the browser denies it, keep the board usable.
  enterFS().then(()=>setTimeout(resize,80)).catch(()=>{ setTimeout(resize,80); });
});

/* ============================== board file open ============================== */
$('#sb-loadfile').addEventListener('change',e=>{const f=e.target.files[0];if(f)openBoard(f);closePicker();e.target.value='';});

/* ---------- PDF ---------- */
let pdfLib=false;
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('load '+src));document.head.appendChild(s);});}
async function ensurePDF(){if(pdfLib)return;showLoad('Preparing PDF engine…');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  pdfLib=true;}
async function importPDF(f){
  try{
    await ensurePDF();
    showLoad('Opening PDF…');
    const buf=await f.arrayBuffer();
    const pdf=await window.pdfjsLib.getDocument({data:buf}).promise;
    const out=[];
    for(let i=1;i<=pdf.numPages;i++){
      showLoad(`Rendering page ${i} of ${pdf.numPages}…`);
      const pg=await pdf.getPage(i); const vp0=pg.getViewport({scale:1});
      const scale=Math.min(2.2,1700/vp0.width); const vp=pg.getViewport({scale});
      const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;
      await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
      out.push({src:c.toDataURL('image/jpeg',0.85),w:vp.width,h:vp.height});
    }
    addDocPages(out); toast(`Loaded ${out.length} page${out.length>1?'s':''}`);
  }catch(err){console.error(err);toast('Could not open this PDF');}
  hideLoad();
}

/* ---------- MCQ quiz JSON (welcome screen only) ---------- */
// Reuses the same html2canvas lib the PPT path loads, but doesn't need the
// rest of the PPTXjs/jQuery stack — just one rasterization call per question.
let h2cReady=false;

/* --- Language support (English / Hindi) --- */
let quizLang='en';           // 'en' or 'hi'
let quizQsCache=null;         // last loaded questions array
let quizTopicCache=''        // last loaded topic name
let quizFontScale=1;          // question/option text size multiplier (font resizer setting)
const QUIZ_FONT_MIN=0.4, QUIZ_FONT_MAX=3.0, QUIZ_FONT_STEP=0.1;
async function ensureH2C(){
  if(h2cReady||window.html2canvas){h2cReady=true;return;}
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  h2cReady=true;
}
function escapeHtml(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function questionCardHTML(post,i,total,topicName,lang){
  const mi=post.meta_input||{};
  const isHi=(lang||quizLang)==='hi';
  // Pick language-appropriate content
  const questionContent = isHi && mi._aimcq_question_content_hi ? mi._aimcq_question_content_hi : (post.post_content||'');
  const rawOpts = isHi && Array.isArray(mi._aimcq_options_hi) && mi._aimcq_options_hi.length ? mi._aimcq_options_hi : (Array.isArray(mi._aimcq_options)?mi._aimcq_options:[]);
  const topicDisplay = topicName ? escapeHtml(topicName) : (isHi ? 'क्विज' : 'Quiz');
  const questionLabel = isHi ? `प्रश्न ${i+1} / ${total}` : `Question ${i+1} of ${total}`;
  // Choose font: Hindi needs a Devanagari-supporting font
  const bodyFont = isHi ? "'Noto Sans Devanagari','Mangal','Arial Unicode MS',Arial,sans-serif" : "'Segoe UI',Arial,sans-serif";
  const fs=quizFontScale||1;
  const qPx=Math.round(32*fs), optPx=Math.round(28*fs), letterPx=Math.round(20*fs);
  const opts=rawOpts;
  const letters=['A','B','C','D','E','F','G','H'];
  const optsHtml=opts.length
    ? opts.map((o,idx)=>`
        <div style="display:flex;gap:18px;align-items:flex-start;margin:0;padding:0;border:none;">
          <div style="flex:0 0 32px;font:700 ${letterPx}px/1.2 Arial,sans-serif;color:#475569;">${letters[idx]||(idx+1)}.</div>
          <div style="flex:1;font:400 ${optPx}px/1.25 ${bodyFont};color:#1e293b;">${escapeHtml(o.text)}</div>
        </div>`).join('')
    : [0,1,2].map(()=>`<div style="margin-top:32px;border-bottom:2px solid #cbd5e1;height:44px;"></div>`).join('');
  return `<div style="width:1280px;min-height:720px;background:#fff;padding:11px 12px;box-sizing:border-box;font-family:${bodyFont};display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex:none;">
      <div style="font:700 13px/1 Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#64748b;">${topicDisplay}</div>
      <div style="font:600 13px/1 Arial,sans-serif;color:#94a3b8;">${questionLabel}</div>
    </div>
    <div style="font:600 ${qPx}px/1.4 ${bodyFont};color:#0f172a;margin-bottom:8px;flex:none;">${questionContent}</div>
    <div style="display:flex;flex-direction:column;gap:12px;flex:none;">${optsHtml}</div>
  </div>`;
}
function questionCardBilingualHTML(post,i,total,topicName){
  const mi=post.meta_input||{};
  const enFont="'Segoe UI',Arial,sans-serif";
  const hiFont="'Noto Sans Devanagari','Mangal','Arial Unicode MS',Arial,sans-serif";
  const letters=['A','B','C','D','E','F','G','H'];
  // English content
  const enContent=post.post_content||'';
  const enOpts=Array.isArray(mi._aimcq_options)?mi._aimcq_options:[];
  // Hindi content
  const hiContent=mi._aimcq_question_content_hi||enContent;
  const hiOpts=Array.isArray(mi._aimcq_options_hi)&&mi._aimcq_options_hi.length?mi._aimcq_options_hi:enOpts;
  const topicName2=topicName?escapeHtml(topicName):'Quiz';
  const maxOpts=Math.max(enOpts.length,hiOpts.length);
  const fs=quizFontScale||1;
  const qPx=Math.round(32*fs), optPx=Math.round(28*fs), letterPx=Math.round(20*fs);
  function colOpts(opts,font){
    if(!opts.length) return [0,1,2].map(()=>`<div style="margin-top:20px;border-bottom:2px solid #cbd5e1;height:36px;"></div>`).join('');
    return opts.map((o,idx)=>`
      <div style="display:flex;gap:12px;align-items:flex-start;margin:0;padding:0;">
        <div style="flex:0 0 32px;font:700 ${letterPx}px/1.2 Arial,sans-serif;color:#475569;">${letters[idx]||(idx+1)}.</div>
        <div style="flex:1;font:400 ${optPx}px/1.25 ${font};color:#1e293b;">${escapeHtml(o.text)}</div>
      </div>`).join('');
  }
  return `<div style="width:1280px;min-height:720px;background:#fff;padding:10px 12px;box-sizing:border-box;display:flex;flex-direction:column;">
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex:none;">
      <div style="font:700 12px/1 Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#64748b;">${topicName2}</div>
      <div style="font:600 12px/1 Arial,sans-serif;color:#94a3b8;">Question ${i+1} of ${total}</div>
    </div>
    <!-- Two-column body -->
    <div style="display:flex;flex:1 1 auto;gap:0;">
      <!-- English column -->
      <div style="flex:1;padding:10px 14px 10px 0;border-right:2px solid #e2e8f0;display:flex;flex-direction:column;overflow:visible;">
        <div style="font:700 11px/1 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#3b82f6;margin-bottom:8px;flex:none;">English</div>
        <div style="font:600 ${qPx}px/1.4 ${enFont};color:#0f172a;margin-bottom:10px;flex:none;">${enContent}</div>
        <div style="display:flex;flex-direction:column;gap:10px;flex:none;">${colOpts(enOpts,enFont)}</div>
      </div>
      <!-- Hindi column -->
      <div style="flex:1;padding:10px 0 10px 14px;display:flex;flex-direction:column;overflow:visible;">
        <div style="font:700 11px/1 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8b5cf6;margin-bottom:8px;flex:none;">हिंदी</div>
        <div style="font:600 ${qPx}px/1.4 ${hiFont};color:#0f172a;margin-bottom:10px;flex:none;">${hiContent}</div>
        <div style="display:flex;flex-direction:column;gap:10px;flex:none;">${colOpts(hiOpts,hiFont)}</div>
      </div>
    </div>
  </div>`;
}

async function renderMCQPages(qs,topicName,lang){
  const holder=document.createElement('div');
  holder.style.cssText='position:fixed;left:-99999px;top:0;background:#fff;';
  document.body.appendChild(holder);
  const out=[];
  const effectiveLang=lang||quizLang;
  const BASE_W=1280, BASE_H=720;
  try{
    for(let i=0;i<qs.length;i++){
      showLoad(`Building question ${i+1} of ${qs.length}…`);
      if(effectiveLang==='both'){
        holder.innerHTML=questionCardBilingualHTML(qs[i],i,qs.length,topicName);
      } else {
        holder.innerHTML=questionCardHTML(qs[i],i,qs.length,topicName,effectiveLang);
      }
      const el=holder.firstElementChild;
      // The card template fixes width at 1280px always and never alters
      // font size on its own — it only uses min-height:720px so the box
      // itself grows downward when content (at the chosen font %) is taller
      // than the standard slide. We capture the element's own natural box
      // as-is (no forced width/height passed to html2canvas), so the
      // screenshot always matches exactly what's really on screen: fixed
      // width, fixed font size, bottom edge stretched only if needed.
      const naturalW=Math.ceil(el.getBoundingClientRect().width);
      const naturalH=Math.ceil(el.getBoundingClientRect().height);
      if(naturalH>BASE_H){
        console.log(`[smartboard] Question ${i+1}/${qs.length}${topicName?` ("${topicName}")`:''} overflowed the ${BASE_H}px slide by ${naturalH-BASE_H}px at ${Math.round((quizFontScale||1)*100)}% font size — stretching slide bottom to ${naturalH}px (width stays ${naturalW}px, font size unchanged).`);
      }
      const c=await window.html2canvas(el,{scale:1.5,backgroundColor:'#fff',logging:false});
      out.push({src:c.toDataURL('image/jpeg',0.88),w:c.width,h:c.height});
    }
  }finally{ holder.remove(); }
  return out;
}

/* Re-render the currently loaded quiz in a new language */
async function rerenderQuizInLang(lang){
  if(!quizQsCache||!quizQsCache.length) return;
  quizLang=lang;
  try{
    showLoad('Switching language…');
    await ensureH2C();
    const out=await renderMCQPages(quizQsCache,quizTopicCache,lang);
    if(!out.length) throw new Error('no pages');
    // Preserve current page index
    const prevCur=Math.min(cur,out.length-1);
    pages=out.map(d=>({bg:{type:'image',src:d.src,w:d.w,h:d.h},view:{scale:1,x:0,y:0},objs:[],autofit:true,fitWidth:true}));
    out.forEach(d=>ensureImg(d.src));
    cur=prevCur; fitView(); pages[cur].view={...view}; selection=null;
    undoStack=[]; redoStack=[];
    updateUndo(); updatePageLbl(); render();
    toast(lang==='hi' ? 'हिंदी में बदला गया' : lang==='both' ? 'Bilingual mode — English & हिंदी side by side' : 'Switched to English');
  }catch(e){ console.error(e); toast('Could not switch language'); }
  hideLoad();
}

/* ---------- PPT (best effort) ---------- */
// NOTE: PPTXjs only understands the legacy JSZip v2 *synchronous* API
// (it calls zip.file(name).asText() internally). Loading JSZip v3 from a
// generic CDN breaks every import immediately, since v3 is promise-based
// and has no .asText(). We must load PPTXjs's own bundled jszip.min.js
// (which is pinned to v2), plus its other required helper scripts, in the
// exact order its docs specify.
let pptReady=false;
async function ensurePPT(){
  if(pptReady)return;
  showLoad('Preparing slides engine…');
  const PPTXJS_BASE='https://cdn.jsdelivr.net/gh/meshesha/PPTXjs@master';
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  // Must be PPTXjs's own jszip.min.js (JSZip v2) — NOT v3, and NOT the cdnjs build.
  await loadScript(PPTXJS_BASE+'/js/jszip.min.js');
  await loadScript(PPTXJS_BASE+'/js/filereader.js');
  await loadScript(PPTXJS_BASE+'/js/d3.min.js');
  const nvCss=document.createElement('link');nvCss.rel='stylesheet';nvCss.href=PPTXJS_BASE+'/css/nv.d3.min.css';document.head.appendChild(nvCss);
  await loadScript(PPTXJS_BASE+'/js/nv.d3.min.js');
  await loadScript(PPTXJS_BASE+'/js/dingbat.js');
  const css=document.createElement('link');css.rel='stylesheet';css.href=PPTXJS_BASE+'/css/pptxjs.css';document.head.appendChild(css);
  await loadScript(PPTXJS_BASE+'/js/pptxjs.js');
  await loadScript(PPTXJS_BASE+'/js/divs2slides.js');
  pptReady=true;
}
function until(fn,ms){return new Promise((res,rej)=>{const t0=Date.now();(function chk(){if(fn())return res();if(Date.now()-t0>ms)return rej(new Error('timeout'));setTimeout(chk,150);})();});}
async function importPPT(f){
  try{
    await ensurePPT();
    showLoad('Rendering slides…');
    const url=URL.createObjectURL(f);
    const holder=document.createElement('div');holder.style.cssText='position:fixed;left:-99999px;top:0;width:1280px;background:#fff;';holder.id='sb-pptx';document.body.appendChild(holder);
    window.$(holder).pptxToHtml({pptxFileUrl:url,slidesScale:'100%',slideMode:false,keyBoardShortCut:false});
    await until(()=>holder.querySelectorAll('.slide').length>0,12000);
    await new Promise(r=>setTimeout(r,700));
    const slides=[...holder.querySelectorAll('.slide')]; const out=[];
    for(let i=0;i<slides.length;i++){showLoad(`Capturing slide ${i+1} of ${slides.length}…`);
      const c=await window.html2canvas(slides[i],{scale:1.4,backgroundColor:'#fff',logging:false});
      out.push({src:c.toDataURL('image/jpeg',0.85),w:c.width,h:c.height});}
    holder.remove();URL.revokeObjectURL(url);
    if(out.length){addDocPages(out);toast(`Loaded ${out.length} slides`);}else throw new Error('no slides');
  }catch(err){console.error(err);toast('Couldn’t render this PPT here — convert it to PDF for best results');}
  hideLoad();
}

/* ---------- add document pages ---------- */
function addDocPages(list){
  if(!list.length)return; pushUndo();
  const replaceable = pages.length===1 && cur===0 && page().objs.length===0 && page().bg.type!=='image';
  let startIndex;
  if(replaceable){ page().bg={type:'image',src:list[0].src,w:list[0].w,h:list[0].h}; page().autofit=true; ensureImg(list[0].src);
    startIndex=0; list.slice(1).forEach((d,i)=>{const p=newPage();p.bg={type:'image',src:d.src,w:d.w,h:d.h};p.autofit=true;ensureImg(d.src);pages.push(p);}); }
  else{ list.forEach(d=>{const p=newPage();p.bg={type:'image',src:d.src,w:d.w,h:d.h};p.autofit=true;ensureImg(d.src);pages.push(p);});
    startIndex=pages.length-list.length; }
  cur=startIndex; fitView(); pages[cur].view={...view}; updatePageLbl(); render();
}
// Recomputes the view so an imported page (PDF/PPTX image) fits fully and
// centred inside whatever screen space is currently available — phone,
// tablet, desktop, portrait or landscape, windowed or fullscreen.
function fitView(){
  const pg=page(); if(pg.bg.type!=='image'){view={scale:1,x:0,y:0};return;}
  const w=cv.clientWidth,h=cv.clientHeight; const m=0.94;
  let s,x,y;
  if(pg.fitWidth){
    // Quiz slides: every slide shares the same 1280px width, but a
    // question that overflows at a big font size gets extra height
    // (stretched bottom) instead of a smaller font. Scaling by width only
    // keeps that width — and the on-screen text size — identical across
    // every question; only the page's visible height differs, with any
    // overflow extending below rather than shrinking the page to fit.
    s=w*m/pg.bg.w;
    x=(w-pg.bg.w*s)/2;
    y=Math.max((h-h*m)/2, (h-pg.bg.h*s)/2);
  } else {
    s=Math.min(w*m/pg.bg.w, h*m/pg.bg.h);
    x=(w-pg.bg.w*s)/2; y=(h-pg.bg.h*s)/2;
  }
  view={scale:s, x, y};
  pg.autofit=true; // mark this page as "fit to screen" so resize/rotate/fullscreen keep it fitted
}
// Any manual zoom or pan on the current page takes it out of auto-fit mode,
// so a later resize won't silently snap their view back to fit.
function leaveAutofit(){ const pg=page(); if(pg) pg.autofit=false; }

/* ============================== export ============================== */
function download(blobOrUrl,name){const a=document.createElement('a');a.download=name;a.href=(blobOrUrl instanceof Blob)?URL.createObjectURL(blobOrUrl):blobOrUrl;document.body.appendChild(a);a.click();a.remove();if(blobOrUrl instanceof Blob)setTimeout(()=>URL.revokeObjectURL(a.href),4000);}
function renderPageToCanvas(pg, view2, W, H){
  const c=document.createElement('canvas');c.width=W;c.height=H;const cc=c.getContext('2d');
  cc.setTransform(view2.scale,0,0,view2.scale,view2.x,view2.y);
  const rect={x:(-view2.x)/view2.scale,y:(-view2.y)/view2.scale,w:W/view2.scale,h:H/view2.scale};
  // local drawBackground using cc, but our drawBackground reads global view for linewidth scale; emulate:
  const savedView=view; view=view2; drawBackground(cc,pg,rect); for(const o of pg.objs)drawObj(cc,o); view=savedView;
  return c;
}
function pageExport(pg){
  if(pg.bg.type==='image') return renderPageToCanvas(pg,{scale:1,x:0,y:0},pg.bg.w,pg.bg.h);
  const W=cv.clientWidth*2,H=cv.clientHeight*2;
  return renderPageToCanvas(pg,{scale:view.scale*2,x:view.x*2,y:view.y*2},W,H);
}
function exportPNG(){const c=pageExport(page());c.toBlob(b=>download(b,`smartboard-page-${cur+1}.png`),'image/png');toast('Image saved');}
async function exportPDF(){
  try{showLoad('Building PDF…');
    if(!window.jspdf)await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const {jsPDF}=window.jspdf; let pdf=null;
    for(let i=0;i<pages.length;i++){showLoad(`Adding page ${i+1}…`);
      const c=pageExport(pages[i]); const w=c.width,h=c.height; const orient=w>=h?'l':'p';
      if(!pdf)pdf=new jsPDF({orientation:orient,unit:'pt',format:[w,h]});
      else pdf.addPage([w,h],orient);
      pdf.addImage(c.toDataURL('image/jpeg',0.85),'JPEG',0,0,w,h);
    }
    pdf.save('smartboard.pdf');toast('PDF exported');
  }catch(e){console.error(e);toast('PDF export failed');}
  hideLoad();
}
function saveBoard(){const blob=new Blob([serAll()],{type:'application/json'});download(blob,'board.smartboard');toast('Board saved');}
function openBoard(f){const r=new FileReader();r.onload=()=>{try{undoStack=[];redoStack=[];loadAll(r.result);updateUndo();updatePageLbl();fitView?.();view=page().view||view;render();toast('Board loaded');}catch(e){toast('Invalid board file');}};r.readAsText(f);}

/* ============================== screen shade ============================== */
const shade=$('#sb-shade'); let shadeH=0;
function toggleShade(){const on=shade.classList.toggle('on');$('#sb-shadebtn').classList.toggle('active',on);if(on){shadeH=Math.round(wrap.clientHeight*0.55);shade.style.height=shadeH+'px';}}
(function(){let drag=false;const grip=shade.querySelector('.grip');
  grip.addEventListener('pointerdown',e=>{drag=true;grip.setPointerCapture(e.pointerId);e.stopPropagation();});
  grip.addEventListener('pointermove',e=>{if(!drag)return;shadeH=Math.max(0,Math.min(wrap.clientHeight,e.clientY-wrap.getBoundingClientRect().top));shade.style.height=shadeH+'px';});
  grip.addEventListener('pointerup',()=>drag=false);
})();

/* ============================== AI chatbot panel ============================== */
const webEl=$('#sb-web');
const chatLog=$('#sb-chat-log'), chatEmpty=$('#sb-chat-empty'), chatInput=$('#sb-chat-input'), chatSend=$('#sb-chat-send');
const aiDot=$('#sb-ai-dot'), aiStatusline=$('#sb-ai-statusline');
const aiModal=$('#sb-ai-settings'), aiKeyInput=$('#sb-ai-key'), aiModelInput=$('#sb-ai-model');
const aiKeyHelp=$('#sb-ai-keyhelp'), aiStatusEl=$('#sb-ai-status');

// Storage is namespaced per-embed (in case a page hosts more than one board),
// using an identity that stays the SAME across page reloads/closes so saved
// AI settings are never lost. Preference order:
//   1. an explicit id the page author put on the host element
//   2. the host's position among all smartboard embeds on the page (stable
//      across reloads as long as the surrounding page markup doesn't change)
//   3. (last resort, e.g. host injected with no siblings to index by) a
//      random id — written onto the element as a real attribute so that if
//      the same DOM node persists (SPA route changes, etc.) the key stays
//      put for the rest of that session at least.
(function assignStableHostId(){
  if(host.id) return; // page author already gave it a real id — use as-is
  var saved=host.getAttribute('data-sb-instance');
  if(saved){ host.id=saved; return; }
  var all=document.querySelectorAll('.smartboard-embed, [data-smartboard]');
  var idx=Array.prototype.indexOf.call(all,host);
  var stableId = all.length<=1 ? 'sb-embed-solo' : (idx>-1 ? ('sb-embed-'+idx) : ('sb-'+Math.random().toString(36).slice(2,9)));
  host.id=stableId;
  host.setAttribute('data-sb-instance',stableId);
})();
const LS_KEY='smartboard-ai-'+host.id;

const PROVIDERS={
  openai:{
    label:'OpenAI', defaultModel:'gpt-4o-mini',
    keyHelp:'Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a>',
    keyPlaceholder:'sk-…',
    async send(messages,key,model){
      const r=await fetch('https://api.openai.com/v1/chat/completions',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
        body:JSON.stringify({model:model||'gpt-4o-mini',max_completion_tokens:220,temperature:0.4,messages})
      });
      const data=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error((data&&data.error&&data.error.message)||('HTTP '+r.status));
      return (data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||'';
    }
  },
  gemini:{
    label:'Gemini', defaultModel:'gemini-2.5-flash',
    keyHelp:'Get a key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a>',
    keyPlaceholder:'AIza…',
    async send(messages,key,model){
      const m=model||'gemini-2.5-flash';
      const sys=messages.find(x=>x.role==='system');
      const turns=messages.filter(x=>x.role!=='system').map(x=>({role:x.role==='assistant'?'model':'user',parts:[{text:x.content}]}));
      const body={contents:turns,generationConfig:{maxOutputTokens:220,temperature:0.4}};
      if(sys) body.systemInstruction={parts:[{text:sys.content}]};
      const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(m)+':generateContent',{
        method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':key}, body:JSON.stringify(body)
      });
      const data=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error((data&&data.error&&data.error.message)||('HTTP '+r.status));
      const cand=data.candidates&&data.candidates[0];
      const parts=cand&&cand.content&&cand.content.parts;
      return (parts&&parts.map(p=>p.text||'').join(''))||'';
    }
  },
  deepseek:{
    label:'DeepSeek', defaultModel:'deepseek-v4-flash',
    keyHelp:'Get a key at <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener">platform.deepseek.com/api_keys</a>',
    keyPlaceholder:'sk-…',
    async send(messages,key,model){
      const r=await fetch('https://api.deepseek.com/chat/completions',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
        body:JSON.stringify({model:model||'deepseek-v4-flash',max_tokens:220,temperature:0.4,messages})
      });
      const data=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error((data&&data.error&&data.error.message)||('HTTP '+r.status));
      return (data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||'';
    }
  }
};

const EDU_SYSTEM_PROMPT='You are a friendly, encouraging study assistant built into a classroom smartboard. '+
  'Only help with educational content: explaining concepts, schoolwork, homework guidance, study questions, and '+
  'subjects students learn in school (maths, science, history, languages, etc). If asked about anything outside '+
  'education (e.g. unrelated personal advice, current events gossip, generating harmful content), politely decline '+
  'and steer back to learning. Always keep your reply to about 100 words or fewer: be concise, clear, and well '+
  'organised, using short sentences or a brief list when helpful.';

function loadAISettings(){
  try{ const raw=localStorage.getItem(LS_KEY); if(raw) return JSON.parse(raw); }catch(_){}
  return {};
}
function saveAISettings(s){ try{ localStorage.setItem(LS_KEY, JSON.stringify(s)); return true; }catch(_){ return false; } }
let storageAvailable=true;
(function probeStorage(){
  try{ const t='__sb_probe__'; localStorage.setItem(t,'1'); localStorage.removeItem(t); }
  catch(_){ storageAvailable=false; }
})();

let aiSettings=loadAISettings(); // { provider, keys:{openai,gemini,deepseek}, models:{...} }
aiSettings.keys=aiSettings.keys||{};
aiSettings.models=aiSettings.models||{};
let activeProvider=aiSettings.provider||'openai';
let chatHistory=[]; // {role:'user'|'assistant', content}
let aiBusy=false;

function currentKey(p){ return (aiSettings.keys&&aiSettings.keys[p])||''; }
function currentModel(p){ return (aiSettings.models&&aiSettings.models[p])||PROVIDERS[p].defaultModel; }
function isConnected(p){ return !!currentKey(p); }

function refreshStatusline(){
  const p=PROVIDERS[activeProvider];
  if(isConnected(activeProvider)){
    aiDot.classList.remove('off'); aiStatusline.textContent=p.label+' connected';
  }else{
    aiDot.classList.add('off'); aiStatusline.textContent='No AI connected';
  }
  qWrap.querySelectorAll('.sb-chip').forEach(c=>c.classList.toggle('active',c.dataset.provider===activeProvider));
}
const qWrap=$('#sb-web-quick');
qWrap.querySelectorAll('.sb-chip').forEach(c=>{
  c.addEventListener('click',()=>{ activeProvider=c.dataset.provider; aiSettings.provider=activeProvider; saveAISettings(aiSettings); refreshStatusline(); });
});

/* ---- chat transcript rendering ---- */
function scrollChatToEnd(){ chatLog.scrollTop=chatLog.scrollHeight; }
function addMsg(role,text,opts){
  opts=opts||{};
  chatEmpty.style.display='none';
  const el=document.createElement('div');
  el.className='sb-msg '+(role==='user'?'user':(role==='sys'?'sys':'bot'))+(opts.err?' err':'');
  el.textContent=text;
  if(opts.meta){ const m=document.createElement('span'); m.className='sb-msg-meta'; m.textContent=opts.meta; el.appendChild(m); }
  chatLog.appendChild(el); scrollChatToEnd();
  return el;
}
function showTyping(){
  const el=document.createElement('div'); el.className='sb-typing'; el.id='sb-typing-ind';
  el.innerHTML='<i></i><i></i><i></i>'; chatLog.appendChild(el); scrollChatToEnd(); return el;
}
function hideTyping(){ const el=$('#sb-typing-ind'); if(el) el.remove(); }

function autosizeChatInput(){ chatInput.style.height='auto'; chatInput.style.height=Math.min(90,chatInput.scrollHeight)+'px'; }
chatInput.addEventListener('input',autosizeChatInput);
chatInput.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChat(); } });
chatSend.addEventListener('click',sendChat);

async function sendChat(){
  const text=chatInput.value.trim();
  if(!text||aiBusy) return;
  if(!isConnected(activeProvider)){
    addMsg('sys','Connect '+PROVIDERS[activeProvider].label+' in AI settings (gear icon) before chatting.');
    openAISettings(); return;
  }
  chatInput.value=''; autosizeChatInput();
  addMsg('user',text);
  chatHistory.push({role:'user',content:text});
  // keep a short rolling window so requests stay small
  const trimmed=chatHistory.slice(-8);
  aiBusy=true; chatSend.disabled=true; showTyping();
  try{
    const provider=PROVIDERS[activeProvider];
    const messages=[{role:'system',content:EDU_SYSTEM_PROMPT}, ...trimmed];
    const reply=await provider.send(messages, currentKey(activeProvider), currentModel(activeProvider));
    hideTyping();
    const clean=(reply||'').trim()||'(No response received.)';
    addMsg('assistant',clean,{meta:provider.label});
    chatHistory.push({role:'assistant',content:clean});
  }catch(err){
    hideTyping();
    console.error('AI chat error',err);
    addMsg('assistant','Sorry — the request to '+PROVIDERS[activeProvider].label+' failed: '+(err&&err.message?err.message:'unknown error')+'. Check your API key and network/CORS settings in AI settings.',{err:true});
  }finally{
    aiBusy=false; chatSend.disabled=false;
  }
}

/* ---- panel open/close ---- */
function toggleWeb(){ const open=webEl.classList.toggle('open'); $('#sb-webbtn').classList.toggle('active',open); if(open){ refreshStatusline(); chatInput.focus(); } }
$('#sb-web-close').addEventListener('click',toggleWeb);
/* draggable chat panel */
(function(){const head=$('#sb-web-head');let d=false,sx,sy,ox,oy;
  head.addEventListener('pointerdown',e=>{if(e.target.closest('input,button'))return;d=true;sx=e.clientX;sy=e.clientY;ox=webEl.offsetLeft;oy=webEl.offsetTop;webEl.style.right='auto';head.setPointerCapture(e.pointerId);});
  head.addEventListener('pointermove',e=>{if(!d)return;webEl.style.left=(ox+e.clientX-sx)+'px';webEl.style.top=(oy+e.clientY-sy)+'px';});
  head.addEventListener('pointerup',()=>d=false);
})();

/* ---- AI settings modal ---- */
let modalProvider=activeProvider;
function paintModalProvider(){
  $('#sb-ai-providers').querySelectorAll('.sb-ai-provider-btn').forEach(b=>b.classList.toggle('active',b.dataset.provider===modalProvider));
  const p=PROVIDERS[modalProvider];
  aiKeyInput.value=currentKey(modalProvider);
  aiKeyInput.placeholder=p.keyPlaceholder;
  aiModelInput.value=currentModel(modalProvider);
  aiKeyHelp.innerHTML=p.keyHelp;
  aiStatusEl.textContent=''; aiStatusEl.className='sb-ai-status';
}
function openAISettings(){ modalProvider=activeProvider; paintModalProvider(); aiModal.classList.add('open'); }
function closeAISettings(){ aiModal.classList.remove('open'); }
$('#sb-ai-settingsbtn').addEventListener('click',openAISettings);
$('#sb-ai-close').addEventListener('click',closeAISettings);
aiModal.addEventListener('pointerdown',e=>{ if(e.target===aiModal) closeAISettings(); });
$('#sb-ai-providers').querySelectorAll('.sb-ai-provider-btn').forEach(b=>{
  b.addEventListener('click',()=>{ modalProvider=b.dataset.provider; paintModalProvider(); });
});
let keyVisible=false;
$('#sb-ai-eye').addEventListener('click',()=>{ keyVisible=!keyVisible; aiKeyInput.type=keyVisible?'text':'password'; });
$('#sb-ai-save').addEventListener('click',()=>{
  const key=aiKeyInput.value.trim();
  const model=aiModelInput.value.trim()||PROVIDERS[modalProvider].defaultModel;
  if(!key){ aiStatusEl.textContent='Paste an API key first.'; aiStatusEl.className='sb-ai-status bad'; return; }
  aiSettings.keys[modalProvider]=key;
  aiSettings.models[modalProvider]=model;
  aiSettings.provider=modalProvider;
  activeProvider=modalProvider;
  const persisted=saveAISettings(aiSettings);
  refreshStatusline();
  if(persisted){
    aiStatusEl.textContent=PROVIDERS[modalProvider].label+' connected ✓ (saved in this browser)';
    aiStatusEl.className='sb-ai-status ok';
    setTimeout(closeAISettings,900);
  }else{
    aiStatusEl.textContent='Connected for this session, but this browser blocked saving (private/incognito mode?) — you\'ll need to re-enter the key after closing this tab.';
    aiStatusEl.className='sb-ai-status bad';
  }
});
$('#sb-ai-clear').addEventListener('click',()=>{
  delete aiSettings.keys[modalProvider];
  saveAISettings(aiSettings);
  aiKeyInput.value='';
  refreshStatusline();
  aiStatusEl.textContent=PROVIDERS[modalProvider].label+' key removed.';
  aiStatusEl.className='sb-ai-status';
});
refreshStatusline();



/* ============================== timer ============================== */
const timerEl=$('#sb-timer'),tT=$('#sb-timer-t'); let tSec=0,tRun=false,tInt=null;
function fmt(s){const m=Math.floor(s/60),x=s%60;return String(m).padStart(2,'0')+':'+String(x).padStart(2,'0');}
function toggleTimer(){const o=timerEl.classList.toggle('open');$('#sb-timerbtn').classList.toggle('active',o);}
$('#sb-timer-close').addEventListener('click',toggleTimer);
$('#sb-timer-start').addEventListener('click',e=>{tRun=!tRun;e.target.textContent=tRun?'Pause':'Start';e.target.style.background=tRun?'var(--accent)':'var(--good)';
  if(tRun){tInt=setInterval(()=>{tSec++;tT.textContent=fmt(tSec);},1000);}else clearInterval(tInt);});
$('#sb-timer-reset').addEventListener('click',()=>{clearInterval(tInt);tRun=false;tSec=0;tT.textContent='00:00';$('#sb-timer-start').textContent='Start';$('#sb-timer-start').style.background='var(--good)';});

/* ============================== keyboard ============================== */
let spaceDown=false;
host.addEventListener('keydown',e=>{
  if(e.target===ta||e.target===chatInput||e.target===aiKeyInput||e.target===aiModelInput)return;
  if(e.key===' '){spaceDown=true;cv.style.cursor='grab';}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}
  if(e.ctrlKey||e.metaKey)return;
  const map={p:'pen',h:'marker',e:'eraser',s:'shape',t:'text',v:'select',l:'laser',o:'spotlight'};
  const k=e.key.toLowerCase();
  // Shift+<letter> is reserved (e.g. Shift+H toggles toolbars below) — don't
  // also let it fall through to the plain-letter tool shortcuts.
  if(map[k] && !e.shiftKey){setTool(map[k]);const btn=dock.querySelector(`[data-tool="${map[k]}"]`);if(btn){dock.querySelectorAll('.sb-tool').forEach(b=>{if(b.dataset.tool)b.classList.remove('active')});btn.classList.add('active');}}
  if((e.key==='Delete'||e.key==='Backspace')&&selection){pushUndo();page().objs=page().objs.filter(o=>o!==selection);selection=null;render();}
  if(e.key==='='||e.key==='+'){zoomBy(1.15);}
  if(e.key==='-'){zoomBy(1/1.15);}
  if(e.key==='0'){fitView();render();}
  if(e.key==='ArrowRight')switchPage(cur+1);
  if(e.key==='ArrowLeft')switchPage(cur-1);
});
host.addEventListener('keyup',e=>{if(e.key===' '){spaceDown=false;cv.style.cursor=tool==='select'?'default':'crosshair';}});
function zoomBy(f){leaveAutofit();const w=cv.clientWidth/2,h=cv.clientHeight/2;const ns=Math.max(.2,Math.min(8,view.scale*f));view.x=w-(w-view.x)*(ns/view.scale);view.y=h-(h-view.y)*(ns/view.scale);view.scale=ns;render();}

/* ============================== helpers ============================== */
let toastT;
function toast(m){toastEl.textContent=m;toastEl.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>toastEl.classList.remove('show'),2200);}
function showLoad(m){loadTxt.textContent=m||'Loading…';loadEl.classList.add('show');}
function hideLoad(){loadEl.classList.remove('show');}

/* ============================== toolbar hide/show (double-tap) ============================== */
// Inject the "double-tap to restore" hint pill into the board app layer
(function(){
  const hintEl = document.createElement('div');
  hintEl.id = 'sb-ui-hint';
  hintEl.textContent = 'Double-tap canvas to show toolbars';
  $('#sb-app').appendChild(hintEl);
})();

let uiHidden = false;

function toggleUI(){
  uiHidden = !uiHidden;
  // Enable animation after first toggle so the initial render has no flash
  root.classList.add('sb-ui-anim-ready');
  root.classList.toggle('sb-ui-hidden', uiHidden);
  toast(uiHidden ? 'Toolbars hidden — double-tap to restore' : 'Toolbars visible');
}

// --- Double-tap detection (zero-latency, retroactive cancel) ---
// Every tap is allowed through to the drawing logic immediately — no delay,
// no synthetic re-dispatch. On confirmed double-tap we retroactively undo
// whatever the first tap committed (a dot or in-progress stroke).
//
// Tap 1: draw normally. Record undo-stack length so we can roll back.
// Tap 2 (within _DT_MS + _DT_PX): it's a double-tap.
//   • If tap-1 committed a dot (undoStack grew), pop that undo entry and
//     restore the previous state — the dot disappears silently.
//   • Also null out `live` to cancel any in-progress stroke from tap 2.
//   • Suppress tap-2 from reaching drawing logic via stopImmediatePropagation.
//   • Toggle the toolbars.

const _DT_MS = 320;   // max ms between tap 1 and tap 2
const _DT_PX = 24;    // max px of movement between taps

let _dtArmed    = false;   // waiting for tap 2
let _dtFirstPt  = null;    // screen coords of tap 1
let _dtUndoLen  = 0;       // undoStack.length just before tap 1 drew

function _onDtPointerDown(e){
  // Pen input and multi-touch are never part of double-tap detection
  if(e.pointerType === 'pen') return;
  if(pointers.size > 1){ _dtArmed = false; return; }

  const cx = e.clientX, cy = e.clientY;

  if(_dtArmed){
    const moved = _dtFirstPt ? Math.hypot(cx - _dtFirstPt.x, cy - _dtFirstPt.y) : 0;
    if(moved <= _DT_PX){
      // ✅ Double-tap confirmed
      _dtArmed = false;

      // Cancel tap-2 stroke before it starts
      e.stopImmediatePropagation();
      live = null;

      // Roll back the dot that tap-1 may have committed
      // undoStack grows by 1 when a stroke is pushed; if it did, pop it.
      if(undoStack.length > _dtUndoLen){
        // Discard the extra undo entry — restores the canvas to pre-tap-1
        const snapshot = undoStack.pop();
        // loadAll restores pages/objects; we do NOT push to redoStack
        // (this wasn't a user undo, it's an invisible cancel)
        try{ loadAll(snapshot); }catch(_){ }
        updateUndo(); render();
      }

      toggleUI();
      return;
    }
    // Moved too far — not a double-tap; arm again for next attempt
    _dtArmed = false;
  }

  // Arm: record state just before this tap draws
  _dtArmed   = true;
  _dtFirstPt = { x: cx, y: cy };
  _dtUndoLen = undoStack.length;

  // Auto-disarm if no second tap arrives within the window
  clearTimeout(_onDtPointerDown._t);
  _onDtPointerDown._t = setTimeout(function(){ _dtArmed = false; }, _DT_MS);
}

cv.addEventListener('pointerdown', _onDtPointerDown, true);

// Keyboard shortcut: backtick ` or Shift+H to toggle toolbars
host.addEventListener('keydown', function(e){
  if(e.target === ta || e.target === chatInput || e.target === aiKeyInput || e.target === aiModelInput) return;
  if(e.key === '`' || (e.key === 'H' && e.shiftKey)){
    e.preventDefault();
    toggleUI();
  }
}, true);

/* ============================== boot ============================== */
resize(); updatePageLbl(); updateUndo(); setTool('pen');
// expose minimal API for embedders
var _api={ open:()=>pickFile(), addPage:()=>$('#sb-addpage').click(), root:root, host:host };
window.Smartboard=window.Smartboard||{};window.Smartboard.open=_api.open;window.Smartboard.addPage=_api.addPage;(window.Smartboard._instances=window.Smartboard._instances||[]).push(_api);
  /* ==================== end engine ==================== */
}

function init(){
  ensureCSS();
  var nodes = document.querySelectorAll('.smartboard-embed, [data-smartboard]');
  for(var i=0;i<nodes.length;i++){ boot(nodes[i]); }
}

if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', init); }
else { init(); }

window.Smartboard = window.Smartboard || {};
window.Smartboard.mount = function(el){ if(typeof el==='string') el=document.querySelector(el); boot(el); };
window.Smartboard.init = init;
})();
