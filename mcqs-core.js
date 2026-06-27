// ---- Lucide safety guard ----
// The lucide CDN script can fail to load (network/CDN hiccup) or not be
// ready yet. Without this, every `lucide.createIcons()` call throws a
// ReferenceError and halts the rest of the script. We install a safe
// stub if the global is missing, and retry once lucide actually loads.
(function ensureLucide() {
    function noopCreateIcons() {}
    if (typeof window.lucide === 'undefined' || typeof window.lucide.createIcons !== 'function') {
        const stub = { createIcons: noopCreateIcons, _isStub: true };
        window.lucide = stub;
        // Poll briefly for the real library, then render once it arrives.
        let tries = 0;
        const timer = setInterval(function () {
            tries++;
            // Real lucide replaces window.lucide with its own object.
            if (window.lucide && window.lucide !== stub
                && typeof window.lucide.createIcons === 'function') {
                clearInterval(timer);
                try { window.lucide.createIcons(); } catch (e) {}
            } else if (tries > 50) {
                clearInterval(timer); // give up after ~10s
            }
        }, 200);
    }
})();

lucide.createIcons();

// ==================== EDITOR BASE-FILE LOADER ====================
// Google Drive support was removed; the editor now loads its Base
// JSON from a local file or from GitHub only.
let editorDriveFile = null;          // kept null — Drive removed
// GitHub-linked base file: { repo, branch, path, name, sha }. `var` so
// earlier local-load code can reference it safely.
var editorGitHubFile = null;

// Shared: load a parsed JSON object as the editor's Base file.
// Used by local upload and GitHub. Does NOT set any link; the caller
// links the appropriate source afterwards.
function loadEditorBaseData(data, fileName) {
    if (!isValidAimcqJSON(data)) {
        showToast('Invalid JSON', "File doesn't look like aimcq format (missing 'posts' array).", 'error');
        return false;
    }
    editorBaseData = data;
    editorBaseFileName = fileName || 'questions.json';
    editorComputeLangs();   // resolve languages from this file's language_code
    editorDeleteSet.clear();
    editorImportSet.clear();
    try { _expandedBase.clear(); _expandedImport.clear(); _cardLang = {}; } catch(e) {}
    editorExportData = null;
    activeImportSourceIdx = 0;
    currentViewTab = 'base';

    document.getElementById('editor-base-file-name').textContent =
        `\u2713 ${editorBaseFileName} \u2014 ${data.posts.length} questions`;
    document.getElementById('editor-base-file-name').classList.add('text-blue-700','font-bold');
    var _editorPromptEl = document.getElementById('editor-prompt');
    if (_editorPromptEl) _editorPromptEl.classList.add('hidden');
    document.getElementById('editor-workspace').classList.remove('hidden');
    document.getElementById('editor-export-result').classList.add('hidden');
    const _vtbBase = document.getElementById('view-tab-btn-base');
    if (_vtbBase) _vtbBase.className = 'view-tab-btn active';
    const _vtbImport = document.getElementById('view-tab-btn-import');
    if (_vtbImport) _vtbImport.className = 'view-tab-btn';
    const _vpBase = document.getElementById('view-panel-base');
    if (_vpBase) _vpBase.classList.remove('hidden');
    const _vpImport = document.getElementById('view-panel-import');
    if (_vpImport) _vpImport.classList.add('hidden');
    const _liveBadge = document.getElementById('live-update-badge');
    if (_liveBadge) _liveBadge.classList.remove('hidden');
    document.getElementById('editor-filter').innerHTML =
        `<option value="all">All</option><option value="to-delete">To Delete</option>`;

    editorApplyLanguageUI();
    renderEditorWorkspace();
    return true;
}

// ---- No-op stubs (Google Drive removed) ----
// These keep older call-sites harmless without surgically editing each one.
function showEditorDriveLink() {}
function refreshEditorDriveButtons() {}
function editorUnlinkDrive() {}
function deliverDriveFileToEditor() {}
function deliverDriveFileToFigures() {}
function driveUpdateUI() {}
function driveOpenPicker() {}
function driveIsConnected() { return false; }
function figShowDriveLink() {}
function refreshFigDriveButtons() {}
function figUnlinkDrive() {}


// ==================== TABS ====================
function switchTab(tab) {
    const tabs = ['split','combine','quizbuilder','editor','figures','builder'];
    tabs.forEach(t => {
        document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab);
        const btn = document.getElementById(`tab-btn-${t}`);
        btn.className = btn.className.replace(/tab-active|tab-inactive/g, '').trim();
        btn.className += t === tab ? ' tab-active' : ' tab-inactive';
        btn.className += ' flex-1 py-4 text-center transition-colors flex items-center justify-center gap-2 whitespace-nowrap px-3';
    });
}

// ==================== TOAST ====================
let toastTimeout;
function showToast(title, message, type = 'info') {
    const toast = document.getElementById('toast');
    document.getElementById('toast-title').textContent = title;
    document.getElementById('toast-msg').textContent = message;
    const icon = document.getElementById('toast-icon');
    icon.setAttribute('data-lucide', type === 'error' ? 'alert-circle' : type === 'success' ? 'check-circle' : 'info');
    icon.className = `w-5 h-5 mt-0.5 flex-shrink-0 ${type === 'error' ? 'text-red-400' : type === 'success' ? 'text-green-400' : 'text-blue-400'}`;
    lucide.createIcons();
    toast.classList.remove('translate-y-20','opacity-0');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.add('translate-y-20','opacity-0'), 4000);
}

// ==================== STATE ====================
let splitSourceFile = null, splitSourceData = null, generatedSplitChunks = [];
let combineFilesList = [], combinedDataResult = null;

// Editor state
let editorBaseData = null;         // parsed base JSON
let editorBaseFileName = '';
let editorImportSources = [];      // [{filename, data}]
let editorDeleteSet = new Set();   // indices (base) to delete
let editorImportSet = new Set();   // composite keys to import
let editorExportData = null;

const COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16'];

// ==================== UTILITIES ====================
function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(aimcqCanonicalizeExport(data), null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

function isValidAimcqJSON(data) {
    return data && typeof data === 'object' && Array.isArray(data.posts);
}

/* ====================================================================
   STANDARD AIMCQ EXPORT SHAPE (canonicalization)
   --------------------------------------------------------------------
   Inputs may carry EXTRA tags (e.g. `_aimcq_seo_robots`) and keys in any
   order — those are accepted on import and kept in memory so every tool
   keeps working. But every JSON we EXPORT (download, GitHub commit, ZIP,
   live/inline preview) is run through these helpers so the output matches
   the agreed standard format EXACTLY: a fixed key order, only the known
   keys, and nothing extra. This is applied uniformly across Split,
   Combine, Quiz/Frontend Builder, Question Editor and Figure Updater.
   ==================================================================== */
var AIMCQ_POST_KEY_ORDER = [
    'id', 'post_author', 'post_date', 'post_title', 'post_content',
    'post_status', 'post_type', 'meta_input', 'taxonomies', 'embedded_media'
];
var AIMCQ_META_KEY_ORDER = [
    '_aimcq_options', '_aimcq_explanation', '_aimcq_title_hi',
    '_aimcq_question_content_hi', '_aimcq_options_hi',
    '_aimcq_correct_answers', '_aimcq_explanation_hi'
];

// One option object → exactly { text, image } in that order (extras dropped).
function aimcqCanonicalizeOption(opt) {
    if (!opt || typeof opt !== 'object') return { text: '', image: '' };
    return {
        text: opt.text != null ? opt.text : '',
        image: opt.image != null ? opt.image : ''
    };
}

// Which language is the PRIMARY one (its content lives in the base fields:
// post_title, post_content, _aimcq_options, _aimcq_explanation).
var AIMCQ_PRIMARY_LANG = 'EN';
// SECONDARY languages keep their content in suffixed translation fields.
// Map: language code → { base field : its translation field }. When a quiz
// is reduced to a single SECONDARY language, that language's content is
// promoted into the base fields. Add future secondary languages here.
var AIMCQ_SECONDARY_FIELDS = {
    HI: {
        post_title:         '_aimcq_title_hi',
        post_content:       '_aimcq_question_content_hi',
        _aimcq_options:     '_aimcq_options_hi',
        _aimcq_explanation: '_aimcq_explanation_hi'
    }
};

// Whether to keep the Hindi translation fields (`_aimcq_*_hi`).
// They only belong in a BILINGUAL quiz (English primary + Hindi secondary),
// i.e. more than one language AND Hindi present. A single-language quiz
// (01EN or 01HI) carries its text in the primary fields only, with no
// translation fields. With no language info we keep them (safe default).
function aimcqMetaKeepHindi(langCodes) {
    if (!Array.isArray(langCodes)) return true;
    return langCodes.length > 1 && langCodes.indexOf('HI') !== -1;
}

function aimcqHasText(v) { return v != null && String(v).trim() !== ''; }

// meta_input → only the known keys, in the standard order. Drops extras
// such as `_aimcq_seo_robots`. For single-language quizzes the Hindi
// translation fields are omitted entirely (see aimcqMetaKeepHindi). When
// `promoteLang` names a secondary language (e.g. 'HI'), its translation
// content is promoted into the base options/explanation before the
// translation fields are dropped.
function aimcqCanonicalizeMeta(meta, langCodes, promoteLang) {
    meta = (meta && typeof meta === 'object') ? meta : {};
    var keepHi = aimcqMetaKeepHindi(langCodes);
    var map = promoteLang ? AIMCQ_SECONDARY_FIELDS[promoteLang] : null;
    var out = {};

    var optsSrc = (map && Array.isArray(meta[map._aimcq_options]) && meta[map._aimcq_options].length)
        ? meta[map._aimcq_options] : meta._aimcq_options;
    out._aimcq_options = Array.isArray(optsSrc) ? optsSrc.map(aimcqCanonicalizeOption) : [];

    var explSrc = (map && aimcqHasText(meta[map._aimcq_explanation]))
        ? meta[map._aimcq_explanation] : meta._aimcq_explanation;
    out._aimcq_explanation = explSrc != null ? explSrc : '';

    if (keepHi) {
        out._aimcq_title_hi = meta._aimcq_title_hi != null ? meta._aimcq_title_hi : '';
        out._aimcq_question_content_hi = meta._aimcq_question_content_hi != null ? meta._aimcq_question_content_hi : '';
        out._aimcq_options_hi = Array.isArray(meta._aimcq_options_hi)
            ? meta._aimcq_options_hi.map(aimcqCanonicalizeOption) : [];
    }
    out._aimcq_correct_answers = Array.isArray(meta._aimcq_correct_answers)
        ? meta._aimcq_correct_answers.map(Number) : [0];
    if (keepHi) {
        out._aimcq_explanation_hi = meta._aimcq_explanation_hi != null ? meta._aimcq_explanation_hi : '';
    }
    return out;
}

// One post → standard key order, only the known keys (extras dropped).
// `promoteLang` (a secondary language code) promotes that language's
// translated title/content into the base post fields.
function aimcqCanonicalizePost(post, langCodes, promoteLang) {
    if (!post || typeof post !== 'object') return post;
    var meta0 = (post.meta_input && typeof post.meta_input === 'object') ? post.meta_input : {};
    var map = promoteLang ? AIMCQ_SECONDARY_FIELDS[promoteLang] : null;
    var out = {};
    if ('id' in post) out.id = post.id;
    out.post_author  = post.post_author != null ? post.post_author : 1;
    out.post_date    = post.post_date != null ? post.post_date : '';
    out.post_title   = (map && aimcqHasText(meta0[map.post_title]))
        ? meta0[map.post_title] : (post.post_title != null ? post.post_title : '');
    out.post_content = (map && aimcqHasText(meta0[map.post_content]))
        ? meta0[map.post_content] : (post.post_content != null ? post.post_content : '');
    out.post_status  = post.post_status != null ? post.post_status : 'publish';
    out.post_type    = post.post_type != null ? post.post_type : 'question';
    out.meta_input   = aimcqCanonicalizeMeta(post.meta_input, langCodes, promoteLang);
    out.taxonomies   = (post.taxonomies && typeof post.taxonomies === 'object') ? post.taxonomies : {};
    out.embedded_media = Array.isArray(post.embedded_media) ? post.embedded_media : [];
    return out;
}

/* ====================================================================
   LANGUAGE DETECTION (extensible, multi-language ready)
   --------------------------------------------------------------------
   A quiz's languages are described by a compact `language_code` stored on
   each taxonomy term, e.g.:
       "01EN"   → 1 language : English only
       "01HI"   → 1 language : Hindi only
       "02ENHI" → 2 languages: English + Hindi
   Format = a 2-digit count followed by N two-letter language codes.
   To add a new language later, add ONE entry to AIMCQ_LANG_REGISTRY below
   (e.g. BN, TA, TE) — every helper, label and the canonical export pick it
   up automatically. The frontend can read the resolved languages to render
   its language toggle / labels.
   ==================================================================== */
var AIMCQ_LANG_REGISTRY = {
    EN: { code: 'EN', label: 'English', native: 'English',  toggle: 'EN'  },
    HI: { code: 'HI', label: 'Hindi',   native: 'हिन्दी',    toggle: 'हिं' }
    // Future languages — just add here, e.g.:
    // BN: { code: 'BN', label: 'Bengali', native: 'বাংলা',   toggle: 'বাং' },
    // TA: { code: 'TA', label: 'Tamil',   native: 'தமிழ்',   toggle: 'த'   },
};

// Look up one 2-letter code; unknown codes degrade gracefully to themselves.
function aimcqLangInfo(code) {
    var c = String(code || '').toUpperCase();
    return AIMCQ_LANG_REGISTRY[c] || { code: c, label: c, native: c, toggle: c };
}

// ['EN','HI'] → "02ENHI"  (2-digit count + concatenated codes)
function aimcqBuildLanguageCode(codes) {
    var list = Array.isArray(codes) ? codes : [];
    var n = list.length;
    return (n < 10 ? '0' + n : '' + n) + list.join('');
}

// ['EN','HI'] → "English and Hindi" ; ['HI'] → "Hindi"
function aimcqLanguageLabel(codes) {
    var names = (Array.isArray(codes) ? codes : []).map(function (c) { return aimcqLangInfo(c).label; });
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

// Parse a language_code string (tolerant of whitespace, case, missing count).
//   "02ENHI " → { valid:true, count:2, codes:['EN','HI'],
//                 languages:[{...}], label:'English and Hindi',
//                 normalizedCode:'02ENHI' }
function aimcqParseLanguageCode(code) {
    var raw = (code == null ? '' : String(code)).trim().toUpperCase();
    var letters = raw.replace(/^\d+/, '').replace(/[^A-Z]/g, ''); // drop count + non-letters
    var codes = [];
    for (var i = 0; i + 2 <= letters.length; i += 2) codes.push(letters.slice(i, i + 2));
    var seen = {};
    codes = codes.filter(function (c) { if (seen[c]) return false; seen[c] = 1; return true; });
    return {
        valid: codes.length > 0,
        count: codes.length,
        codes: codes,
        languages: codes.map(aimcqLangInfo),
        label: aimcqLanguageLabel(codes),
        normalizedCode: aimcqBuildLanguageCode(codes)
    };
}

// Fallback when no explicit code exists: infer from post content.
// English is the base; Hindi is flagged when any *_hi field carries text.
function aimcqDetectLanguagesFromPosts(data) {
    var hasEn = false, hasHi = false;
    var posts = (data && Array.isArray(data.posts)) ? data.posts : [];
    posts.forEach(function (p) {
        var m = (p && p.meta_input) || {};
        if ((p && ((p.post_content || '').trim() || (p.post_title || '').trim())) ||
            (m._aimcq_explanation || '').trim() ||
            (Array.isArray(m._aimcq_options) && m._aimcq_options.some(function (o) { return o && (o.text || '').trim(); }))) {
            hasEn = true;
        }
        if ((m._aimcq_title_hi || '').trim() || (m._aimcq_question_content_hi || '').trim() ||
            (m._aimcq_explanation_hi || '').trim() ||
            (Array.isArray(m._aimcq_options_hi) && m._aimcq_options_hi.some(function (o) { return o && (o.text || '').trim(); }))) {
            hasHi = true;
        }
    });
    var codes = [];
    if (hasEn) codes.push('EN');
    if (hasHi) codes.push('HI');
    if (!codes.length) codes.push('EN'); // sensible default
    return codes;
}

// Resolve the languages for a whole export object.
// Priority: an explicit term `language_code` wins; otherwise infer from posts.
function aimcqResolveLanguages(data) {
    var explicit = '';
    var terms = (data && Array.isArray(data.terms)) ? data.terms : [];
    terms.forEach(function (t) {
        if (!explicit && t && t.language_code != null && String(t.language_code).trim()) {
            explicit = t.language_code;
        }
    });
    if (explicit) {
        var parsed = aimcqParseLanguageCode(explicit);
        if (parsed.valid) return parsed;
    }
    var codes = aimcqDetectLanguagesFromPosts(data);
    return {
        valid: codes.length > 0,
        count: codes.length,
        codes: codes,
        languages: codes.map(aimcqLangInfo),
        label: aimcqLanguageLabel(codes),
        normalizedCode: aimcqBuildLanguageCode(codes)
    };
}

// One taxonomy term → standard key order
// { taxonomy, language, language_code, name, slug }, extras dropped.
// `language`/`language_code` are normalized (trimmed, count recomputed) from
// the term's own code when present, otherwise filled from the resolved quiz
// languages so older files gain correct metadata. `parent` is kept (after
// slug) only when non-empty, so a taxonomy hierarchy is never silently lost.
function aimcqCanonicalizeTerm(term, resolvedLang) {
    if (!term || typeof term !== 'object') return term;
    var out = { taxonomy: term.taxonomy != null ? term.taxonomy : '' };

    var parsed = (term.language_code != null && String(term.language_code).trim())
        ? aimcqParseLanguageCode(term.language_code)
        : (resolvedLang && resolvedLang.valid ? resolvedLang : null);

    if (parsed && parsed.valid) {
        out.language = parsed.label;
        out.language_code = parsed.normalizedCode;
    } else {
        if (term.language != null) out.language = term.language;
        if (term.language_code != null) out.language_code = String(term.language_code).trim();
    }

    out.name = term.name != null ? term.name : '';
    out.slug = term.slug != null ? term.slug : '';
    if (term.parent != null && term.parent !== '') out.parent = term.parent;
    return out;
}

// Full export object → canonical. Leaves non-aimcq shapes untouched, and
// preserves the wrapper keys (version, export_type, terms) plus any extra
// top-level keys (e.g. quiz_title) after `posts`.
function aimcqCanonicalizeExport(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.posts)) return data;
    var out = {};
    var resolvedLang = aimcqResolveLanguages(data);
    var codes = (resolvedLang && resolvedLang.codes) ? resolvedLang.codes : null;
    // When the quiz is reduced to a single SECONDARY language, promote that
    // language's translated content into the base fields.
    var promoteLang = (codes && codes.length === 1 && AIMCQ_SECONDARY_FIELDS[codes[0]])
        ? codes[0] : null;
    if ('version' in data) out.version = data.version;
    if ('export_type' in data) out.export_type = data.export_type;
    if ('terms' in data) out.terms = Array.isArray(data.terms)
        ? data.terms.map(function (t) { return aimcqCanonicalizeTerm(t, resolvedLang); })
        : data.terms;
    out.posts = data.posts.map(function (p) { return aimcqCanonicalizePost(p, codes, promoteLang); });
    Object.keys(data).forEach(function (k) {
        if (k !== 'version' && k !== 'export_type' && k !== 'terms' && k !== 'posts' && !(k in out)) {
            out[k] = data[k];
        }
    });
    return out;
}

// Expose the language utilities on the public MCQTool namespace so the
// frontend / other scripts can reuse them (e.g. MCQTool.detectLanguages(data)).
try {
    if (typeof window !== 'undefined') {
        window.MCQTool = window.MCQTool || {};
        window.MCQTool.languages       = AIMCQ_LANG_REGISTRY;
        window.MCQTool.parseLanguageCode = aimcqParseLanguageCode;
        window.MCQTool.buildLanguageCode = aimcqBuildLanguageCode;
        window.MCQTool.languageLabel     = aimcqLanguageLabel;
        window.MCQTool.detectLanguages   = aimcqResolveLanguages;
        window.MCQTool.canonicalize      = aimcqCanonicalizeExport;
        // Force a dataset to a given language mode, then canonicalize so the
        // output matches that mode exactly (e.g. switching to '01EN' strips
        // the Hindi translation fields). Accepts a code string ("01EN",
        // "02ENHI") or an array of codes (['EN'], ['EN','HI']).
        window.MCQTool.setLanguages = function (data, codeOrCodes) {
            if (!data || !Array.isArray(data.posts)) return data;
            var codes = Array.isArray(codeOrCodes)
                ? codeOrCodes.map(function (c) { return String(c).toUpperCase(); })
                : aimcqParseLanguageCode(codeOrCodes).codes;
            var code = aimcqBuildLanguageCode(codes);
            var label = aimcqLanguageLabel(codes);
            var clone = JSON.parse(JSON.stringify(data));
            (clone.terms || []).forEach(function (t) {
                if (t && typeof t === 'object') { t.language = label; t.language_code = code; }
            });
            return aimcqCanonicalizeExport(clone);
        };
        // Convenience wrappers.
        window.MCQTool.toEnglishOnly = function (data) { return window.MCQTool.setLanguages(data, '01EN'); };
        window.MCQTool.toHindiOnly   = function (data) { return window.MCQTool.setLanguages(data, '01HI'); };
        window.MCQTool.toBilingual   = function (data) { return window.MCQTool.setLanguages(data, '02ENHI'); };
    }
} catch (e) {}

function stripHtmlTags(str) {
    if (!str) return '';
    return String(str).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
    return escaped.replace(re, '<mark>$1</mark>');
}

// ==================== SPLIT LOGIC ====================
const splitInput = document.getElementById('split-file');
const splitDropzone = document.getElementById('split-dropzone');
const splitFileNameDisplay = document.getElementById('split-file-name');

['dragenter','dragover','dragleave','drop'].forEach(ev => {
    splitDropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false);
    document.getElementById('combine-dropzone').addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false);
});
['dragenter','dragover'].forEach(ev => splitDropzone.addEventListener(ev, () => splitDropzone.classList.add('drag-active')));
['dragleave','drop'].forEach(ev => splitDropzone.addEventListener(ev, () => splitDropzone.classList.remove('drag-active')));
splitDropzone.addEventListener('drop', e => { if(e.dataTransfer.files[0]) handleSplitFileSelection(e.dataTransfer.files[0]); });
splitInput.addEventListener('change', e => { if(e.target.files[0]) handleSplitFileSelection(e.target.files[0]); });

function handleSplitFileSelection(file) {
    if (!file.name.endsWith('.json')) { showToast("Invalid File","Please select a JSON file.","error"); return; }
    splitSourceFile = file;
    splitFileNameDisplay.textContent = file.name;
    splitFileNameDisplay.classList.add('text-blue-600','font-bold');
    const reader = new FileReader();
    reader.onload = e => {
        try {
            splitSourceData = JSON.parse(e.target.result);
            if (!isValidAimcqJSON(splitSourceData)) throw new Error("Missing 'posts' array.");
            showToast("File Loaded", `Found ${splitSourceData.posts.length} questions.`, "success");
        } catch(err) { splitSourceData = null; showToast("Parse Error", err.message, "error"); }
    };
    reader.readAsText(file);
}

document.getElementById('btn-split').addEventListener('click', () => {
    if (!splitSourceData) { showToast("No Data","Upload a valid JSON first.","error"); return; }
    const chunkSize = parseInt(document.getElementById('split-chunk-size').value, 10);
    if (!chunkSize || chunkSize < 1) { showToast("Invalid Size","Must be at least 1.","error"); return; }
    if (!splitSourceData.posts.length) { showToast("Empty File","No questions to split.","error"); return; }
    generatedSplitChunks = [];
    let part = 1;
    const base = splitSourceFile.name.replace('.json','');
    for (let i = 0; i < splitSourceData.posts.length; i += chunkSize) {
        const posts = splitSourceData.posts.slice(i, i + chunkSize);
        generatedSplitChunks.push({
            filename: `${base}_part${part}.json`,
            data: { version: splitSourceData.version||"1.7.0", export_type: splitSourceData.export_type||"single", terms: splitSourceData.terms||[], posts },
            count: posts.length
        });
        part++;
    }
    renderSplitResults();
    showToast("Success", `Split into ${generatedSplitChunks.length} files.`, "success");
});

function renderSplitResults() {
    const container = document.getElementById('split-results-container');
    const list = document.getElementById('split-file-list');
    document.getElementById('split-count').textContent = generatedSplitChunks.length;
    list.innerHTML = '';
    generatedSplitChunks.forEach((chunk, i) => {
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-3 border border-gray-200 rounded-xl bg-white hover:border-blue-300 transition-colors";
        item.innerHTML = `
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0 font-bold text-sm">#${i+1}</div>
                <div class="min-w-0">
                    <p class="text-sm font-semibold text-gray-800 truncate">${escapeHtml(chunk.filename)}</p>
                    <p class="text-xs text-gray-500">${chunk.count} questions</p>
                </div>
            </div>
            <button class="dl-single ml-2 p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0" data-idx="${i}">
                <i data-lucide="download" class="w-4 h-4"></i>
            </button>`;
        list.appendChild(item);
    });
    lucide.createIcons();
    container.classList.remove('hidden');
    document.querySelectorAll('.dl-single').forEach(btn => {
        btn.addEventListener('click', e => {
            const chunk = generatedSplitChunks[e.currentTarget.getAttribute('data-idx')];
            downloadJSON(chunk.data, chunk.filename);
        });
    });
}

document.getElementById('btn-download-all').addEventListener('click', async () => {
    if (!generatedSplitChunks.length) return;
    const btn = document.getElementById('btn-download-all');
    const orig = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Zipping...`; lucide.createIcons();
    try {
        const zip = new JSZip();
        generatedSplitChunks.forEach(c => zip.file(c.filename, JSON.stringify(aimcqCanonicalizeExport(c.data), null, 4)));
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `${splitSourceFile.name.replace('.json','')}_split_files.zip`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        showToast("Downloaded","ZIP created successfully.","success");
    } catch(e) { showToast("ZIP Error","Failed to create ZIP.","error"); }
    finally { btn.innerHTML = orig; lucide.createIcons(); }
});

// ==================== COMBINE LOGIC ====================
const combineInput = document.getElementById('combine-files');
const combineDropzone = document.getElementById('combine-dropzone');
['dragenter','dragover'].forEach(ev => combineDropzone.addEventListener(ev, () => combineDropzone.classList.add('drag-active')));
['dragleave','drop'].forEach(ev => combineDropzone.addEventListener(ev, () => combineDropzone.classList.remove('drag-active')));
combineDropzone.addEventListener('drop', e => { if(e.dataTransfer.files?.length) handleCombineFileSelection(e.dataTransfer.files); });
combineInput.addEventListener('change', e => { if(e.target.files.length) handleCombineFileSelection(e.target.files); });

function handleCombineFileSelection(fileList) {
    combineFilesList = Array.from(fileList).filter(f => f.name.endsWith('.json'));
    if (!combineFilesList.length) { showToast("No JSON Files","Select valid .json files.","error"); return; }
    document.getElementById('combine-files-name').textContent = `${combineFilesList.length} files selected`;
    document.getElementById('combine-files-name').classList.add('text-indigo-600','font-bold');
    const listEl = document.getElementById('combine-file-list');
    listEl.innerHTML = '';
    combineFilesList.forEach(f => {
        const b = document.createElement('span');
        b.className = "inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200";
        b.textContent = f.name;
        listEl.appendChild(b);
    });
    document.getElementById('combine-file-preview').classList.remove('hidden');
    document.getElementById('combine-results-container').classList.add('hidden');
    combinedDataResult = null;
}

document.getElementById('btn-combine').addEventListener('click', async () => {
    if (combineFilesList.length < 2) { showToast("Insufficient Files","Select at least 2 files.","error"); return; }
    const btn = document.getElementById('btn-combine');
    btn.disabled = true; btn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Processing...`; lucide.createIcons();
    try {
        const parsed = await Promise.all(combineFilesList.map(file => new Promise((res,rej) => {
            const r = new FileReader();
            r.onload = e => { try { const j = JSON.parse(e.target.result); if(!isValidAimcqJSON(j)) rej(new Error(`${file.name} invalid.`)); res(j); } catch(err){ rej(new Error(`Failed to parse ${file.name}`)); } };
            r.onerror = () => rej(new Error(`Failed to read ${file.name}`));
            r.readAsText(file);
        })));
        const termsMap = new Map();
        let posts = [];
        parsed.forEach((fd, i) => {
            if(i===0){ }
            (fd.terms||[]).forEach(t => { if(t?.slug) termsMap.set(t.slug, t); });
            posts = posts.concat(fd.posts);
        });
        combinedDataResult = { version: parsed[0].version||"1.7.0", export_type: parsed[0].export_type||"single", terms: Array.from(termsMap.values()), posts };
        document.getElementById('combine-results-container').classList.remove('hidden');
        document.getElementById('combine-stats').textContent = `Merged ${parsed.length} files containing ${posts.length} total questions and ${termsMap.size} distinct terms.`;
        showToast("Combine Successful","Ready to download.","success");
    } catch(err) { showToast("Combine Error", err.message,"error"); }
    finally { btn.disabled = false; btn.innerHTML = `<i data-lucide="combine" class="w-5 h-5"></i> Combine JSONs`; lucide.createIcons(); }
});

document.getElementById('btn-download-combined').addEventListener('click', () => {
    if (!combinedDataResult) return;
    downloadJSON(combinedDataResult, `combined_quiz_data_${Date.now()}.json`);
});

// ==================== EDITOR LOGIC ====================

// --- Base file load ---
const editorBaseDropzone = document.getElementById('editor-base-dropzone');
const editorBaseInput = document.getElementById('editor-base-file');

['dragenter','dragover','dragleave','drop'].forEach(ev => editorBaseDropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
['dragenter','dragover'].forEach(ev => editorBaseDropzone.addEventListener(ev, () => editorBaseDropzone.classList.add('drag-active')));
['dragleave','drop'].forEach(ev => editorBaseDropzone.addEventListener(ev, () => editorBaseDropzone.classList.remove('drag-active')));
editorBaseDropzone.addEventListener('drop', e => { if(e.dataTransfer.files[0]) loadEditorBase(e.dataTransfer.files[0]); });
editorBaseInput.addEventListener('change', e => { if(e.target.files[0]) loadEditorBase(e.target.files[0]); });

function loadEditorBase(file) {
    if (!file.name.toLowerCase().endsWith('.json')) {
        showToast("Invalid File", "Please select a .json file.", "error");
        return;
    }
    const reader = new FileReader();
    reader.onerror = () => showToast("Read Error", "Could not read the file.", "error");
    reader.onload = e => {
        // Step 1: parse the JSON.
        let data;
        try {
            data = JSON.parse(e.target.result);
        } catch (err) {
            showToast("Parse Error",
                "This file isn't valid JSON. " + (err.message || ''), "error");
            return;
        }
        // Step 2: validate the shape.
        if (!isValidAimcqJSON(data)) {
            showToast("Invalid JSON",
                "File doesn't look like aimcq format (missing 'posts' array).", "error");
            return;
        }
        // Step 3: load into the editor (render errors are reported separately).
        try {
            editorBaseData = data;
            editorBaseFileName = file.name;
            editorComputeLangs();   // resolve languages from this file's language_code
            editorDeleteSet.clear();
            editorImportSet.clear();
            try { _expandedBase.clear(); _expandedImport.clear(); _cardLang = {}; } catch(e) {}
            editorExportData = null;
            activeImportSourceIdx = 0;
            currentViewTab = 'base';
            // A local file replaces any GitHub-linked base — unlink silently.
            if (typeof editorGitHubFile !== 'undefined' && editorGitHubFile) {
                editorGitHubFile = null;
                if (typeof editorShowGitHubLink === 'function') editorShowGitHubLink();
            }
            const nameEl = document.getElementById('editor-base-file-name');
            if (nameEl) {
                nameEl.textContent = `\u2713 ${file.name} \u2014 ${data.posts.length} questions`;
                nameEl.classList.add('text-blue-700','font-bold');
            }
            const prompt = document.getElementById('editor-prompt');
            if (prompt) prompt.classList.add('hidden');
            document.getElementById('editor-workspace').classList.remove('hidden');
            document.getElementById('editor-export-result').classList.add('hidden');
            const baseBtn = document.getElementById('view-tab-btn-base');
            if (baseBtn) baseBtn.className = 'view-tab-btn active';
            document.getElementById('view-panel-base').classList.remove('hidden');
            const importPanel = document.getElementById('view-panel-import');
            if (importPanel) importPanel.classList.add('hidden');
            const liveBadge = document.getElementById('live-update-badge');
            if (liveBadge) liveBadge.classList.remove('hidden');
            document.getElementById('editor-filter').innerHTML =
                '<option value="all">All</option><option value="to-delete">To Delete</option>';
            editorApplyLanguageUI();
            renderEditorWorkspace();
            if (typeof refreshEditorGitHubButtons === 'function') refreshEditorGitHubButtons();
            showToast("Base Loaded", `${data.posts.length} questions ready.`, "success");
        } catch (err) {
            console.error('Editor render error:', err);
            showToast("Editor Error",
                "The file loaded but the editor could not display it: " +
                (err.message || String(err)), "error");
        }
    };
    reader.readAsText(file);
}

// --- Import sources load ---
const editorImportDropzone = document.getElementById('editor-import-dropzone');
const editorImportInput = document.getElementById('editor-import-files');

// Import Sources was removed from the Question Editor. These elements
// no longer exist — guard so the wiring is harmless if they're absent.
if (editorImportDropzone && editorImportInput) {
    ['dragenter','dragover','dragleave','drop'].forEach(ev => editorImportDropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
    ['dragenter','dragover'].forEach(ev => editorImportDropzone.addEventListener(ev, () => editorImportDropzone.classList.add('drag-active')));
    ['dragleave','drop'].forEach(ev => editorImportDropzone.addEventListener(ev, () => editorImportDropzone.classList.remove('drag-active')));
    editorImportDropzone.addEventListener('drop', e => { if(e.dataTransfer.files?.length) loadImportSources(e.dataTransfer.files); });
    editorImportInput.addEventListener('change', e => { if(e.target.files.length) loadImportSources(e.target.files); });
}

function loadImportSources(fileList) {
    const files = Array.from(fileList).filter(f => f.name.endsWith('.json'));
    if (!files.length) { showToast("No JSON files","Please select valid .json files.","error"); return; }

    let loaded = 0;
    const newSources = [];
    files.forEach(file => {
        const r = new FileReader();
        r.onload = e => {
            try {
                const data = JSON.parse(e.target.result);
                if (isValidAimcqJSON(data)) {
                    newSources.push({ filename: file.name, data });
                }
            } catch {}
            loaded++;
            if (loaded === files.length) {
                // Append (avoid duplicates by filename)
                const existing = new Set(editorImportSources.map(s => s.filename));
                newSources.forEach(s => { if (!existing.has(s.filename)) editorImportSources.push(s); });
                renderImportBadges();
                updateTabCounts();
                if (editorBaseData) {
                    // Auto-switch to import tab to show what was loaded
                    switchViewTab('import');
                }
                showToast("Sources Loaded", `${editorImportSources.length} import source(s) loaded.`, "success");
            }
        };
        r.readAsText(file);
    });
}

function renderImportBadges() {
    // Import Sources UI removed from the Question Editor — no-op.
    const el = document.getElementById('editor-import-file-badges');
    if (el) el.classList.add('hidden');
}

// ==================== EDITOR VIEW TABS ====================
let currentViewTab = 'base';        // 'base' | 'import'
let activeImportSourceIdx = 0;      // which import source is shown in import tab
let livePreviewVisible = false;

function switchViewTab(tab) {
    // Import Sources removed — the editor only has the base view now.
    currentViewTab = 'base';
    const baseBtn = document.getElementById('view-tab-btn-base');
    if (baseBtn) baseBtn.className = 'view-tab-btn active';
    const basePanel = document.getElementById('view-panel-base');
    if (basePanel) basePanel.classList.remove('hidden');
    const importPanel = document.getElementById('view-panel-import');
    if (importPanel) importPanel.classList.add('hidden');
    const liveBadge = document.getElementById('live-update-badge');
    if (liveBadge) liveBadge.classList.remove('hidden');

    const filterSel = document.getElementById('editor-filter');
    if (filterSel) {
        const prevVal = filterSel.value;
        filterSel.innerHTML = '<option value="all">All</option><option value="to-delete">To Delete</option>';
        filterSel.value = (prevVal === 'to-delete') ? 'to-delete' : 'all';
    }
    renderEditorWorkspace();
}

function onImportSourceSelectorChange() { /* Import Sources removed */ }

function toggleLivePreview() {
    livePreviewVisible = !livePreviewVisible;
    document.getElementById('live-json-preview-box').classList.toggle('hidden', !livePreviewVisible);
    document.getElementById('live-preview-btn-label').textContent = livePreviewVisible ? 'Hide Live JSON' : 'Show Live JSON';
    if (livePreviewVisible) updateLiveJsonPreview();
}

function syntaxHighlightJSON(json) {
    if (typeof json !== 'string') json = JSON.stringify(json, null, 2);
    return json
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
            if (/^"/.test(m)) {
                return /:$/.test(m)
                    ? `<span class="json-key">${m}</span>`
                    : `<span class="json-str">${m}</span>`;
            }
            if (/true|false/.test(m)) return `<span class="json-bool">${m}</span>`;
            if (/null/.test(m)) return `<span class="json-null">${m}</span>`;
            return `<span class="json-num">${m}</span>`;
        });
}

function updateLiveJsonPreview() {
    if (!livePreviewVisible || !editorBaseData) return;
    const retainedPosts = editorBaseData.posts.filter((_, idx) => !editorDeleteSet.has(idx));
    const importedPosts = [];
    editorImportSet.forEach(key => {
        const [si, pidx] = key.split(':').map(Number);
        const src = editorImportSources[si];
        if (src && src.data.posts[pidx]) importedPosts.push(src.data.posts[pidx]);
    });
    const previewData = {
        version: editorBaseData.version || "1.7.0",
        export_type: editorBaseData.export_type || "single",
        terms: editorBaseData.terms || [],
        posts: [...retainedPosts, ...importedPosts]
    };
    const previewEl = document.getElementById('base-live-json-preview');
    const metaEl = document.getElementById('live-json-meta');
    metaEl.textContent = `${previewData.posts.length} questions · ${editorDeleteSet.size} deleted · ${importedPosts.length} imported`;
    // Show summary of first ~3 posts + ellipsis to avoid giant DOM.
    // Canonicalize so the preview matches the exported file exactly.
    const canonicalPreview = aimcqCanonicalizeExport(previewData);
    const summarized = { ...canonicalPreview, posts: canonicalPreview.posts.slice(0, 3) };
    let jsonStr = JSON.stringify(summarized, null, 2);
    if (previewData.posts.length > 3) {
        jsonStr = jsonStr.replace(/\](\s*)$/, `  // ...${previewData.posts.length - 3} more questions\n]$1`);
    }
    previewEl.innerHTML = syntaxHighlightJSON(jsonStr);
}

// --- Toolbar wiring ---
document.getElementById('editor-search').addEventListener('input', renderEditorWorkspace);
document.getElementById('editor-filter').addEventListener('change', renderEditorWorkspace);

document.getElementById('btn-select-all-del').addEventListener('click', () => {
    getVisibleBaseIndices().forEach(i => editorDeleteSet.add(i));
    renderEditorWorkspace();
});
document.getElementById('btn-deselect-all-del').addEventListener('click', () => {
    editorDeleteSet.clear();
    renderEditorWorkspace();
});

// ---- Front-view toolbar controls ----
document.getElementById('btn-expand-all').addEventListener('click', () => {
    // Expand all currently visible cards in the active panel
    if (currentViewTab === 'base') {
        _visibleBaseIndices.forEach(i => _expandedBase.add(i));
    } else {
        _visibleImportKeys.forEach(k => _expandedImport.add(k));
    }
    renderEditorWorkspace();
});
document.getElementById('btn-collapse-all').addEventListener('click', () => {
    _expandedBase.clear();
    _expandedImport.clear();
    renderEditorWorkspace();
});
document.getElementById('editor-default-lang').addEventListener('change', (e) => {
    if (!editorIsBilingual()) return;   // single-language: nothing to switch
    _defaultLang = e.target.value === 'hi' ? 'hi' : 'en';
    // Clear per-card overrides so the new default takes effect everywhere
    _cardLang = {};
    renderEditorWorkspace();
});

let _visibleBaseIndices = [];
let _visibleImportKeys = [];
function getVisibleBaseIndices() { return [..._visibleBaseIndices]; }
function getVisibleImportKeys() { return [..._visibleImportKeys]; }

// ---- FRONT VIEW state ----
let _expandedBase = new Set();          // base indices currently expanded
let _expandedImport = new Set();        // composite keys currently expanded
let _cardLang = {};                     // per-card language override (key: 'b:idx' or 'i:si:pidx')
let _defaultLang = 'en';                // default display language

/* ====================================================================
   EDITOR LANGUAGE MODEL (driven by the file's language_code)
   --------------------------------------------------------------------
   _editorLangs       : display languages present, e.g. ['en'], ['hi'],
                        ['en','hi'] — resolved from the file's term
                        language_code (falls back to content detection).
   _editorLangSlots   : where each language's content lives in THIS file:
                        'primary' (post_content/_aimcq_options/_aimcq_explanation)
                        or 'secondary' (the _aimcq_*_hi fields). In a single-
                        language file the sole language always occupies the
                        primary fields, so 01HI reads Hindi from the primary
                        fields, not from _hi.
   ==================================================================== */
let _editorLangs = ['en'];
let _editorLangSlots = { en: 'primary' };

// Resolve the loaded file's languages and decide which field-slot holds each.
function editorComputeLangs() {
    var codes = ['EN'];
    try {
        var r = aimcqResolveLanguages(editorBaseData);
        if (r && r.codes && r.codes.length) codes = r.codes;
    } catch (e) {}
    _editorLangs = codes.map(function (c) { return String(c).toLowerCase(); });
    if (_editorLangs.length > 1) {
        _editorLangSlots = { en: 'primary', hi: 'secondary' };
    } else if (_editorLangs[0] === 'hi') {
        _editorLangSlots = { hi: 'primary' };
    } else {
        _editorLangSlots = { en: 'primary' };
    }
    _defaultLang = _editorLangs[0] || 'en';
    _cardLang = {};
}

function editorIsBilingual() { return _editorLangs.length > 1; }

// Which field-slot ('primary'|'secondary') holds the given display language.
function editorSlotForLang(lang) {
    if (_editorLangSlots && _editorLangSlots[lang]) return _editorLangSlots[lang];
    return lang === 'hi' ? 'secondary' : 'primary';
}

// Read {question, options, explanation} from a post for a given field-slot.
function editorReadSlot(post, slot) {
    const meta = post.meta_input || {};
    if (slot === 'secondary') {
        return {
            question: meta._aimcq_question_content_hi || meta._aimcq_title_hi || '',
            options: Array.isArray(meta._aimcq_options_hi) ? meta._aimcq_options_hi : [],
            explanation: meta._aimcq_explanation_hi || ''
        };
    }
    return {
        question: post.post_content || post.post_title || '',
        options: Array.isArray(meta._aimcq_options) ? meta._aimcq_options : [],
        explanation: meta._aimcq_explanation || ''
    };
}

// Short label for a display language (used on the single-language flag).
function editorLangLabel(lang) {
    try {
        var info = aimcqLangInfo(String(lang).toUpperCase());
        return info.toggle || info.code;
    } catch (e) { return lang === 'hi' ? 'हिं' : 'EN'; }
}

// Show/hide the front-view default-language selector based on the file.
function editorApplyLanguageUI() {
    var sel = document.getElementById('editor-default-lang');
    if (sel) {
        if (editorIsBilingual()) {
            sel.style.display = '';
            sel.value = (_defaultLang === 'hi') ? 'hi' : 'en';
        } else {
            // Single language → nothing to switch between.
            sel.style.display = 'none';
        }
    }
}

// Sanitize rendered HTML from user JSON (strip scripts + on* handlers + javascript: URLs)
function qfvSanitizeHtml(html) {
    if (!html) return '';
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html);
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT);
    const toRemove = [];
    let node;
    while (node = walker.nextNode()) {
        const tag = node.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed') {
            toRemove.push(node);
            continue;
        }
        // Strip on* handlers and javascript: URLs
        [...node.attributes].forEach(attr => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) node.removeAttribute(attr.name);
            if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
                node.removeAttribute(attr.name);
            }
        });
    }
    toRemove.forEach(n => n.remove());
    return tpl.innerHTML;
}

// Highlight a search query inside already-rendered HTML
function qfvHighlightInHtml(html, query) {
    if (!query) return html;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while (node = walker.nextNode()) textNodes.push(node);
    textNodes.forEach(tn => {
        const parent = tn.parentNode;
        if (!parent) return;
        const tag = parent.tagName ? parent.tagName.toLowerCase() : '';
        if (tag === 'mark' || tag === 'script' || tag === 'style') return;
        const txt = tn.nodeValue;
        if (!re.test(txt)) { re.lastIndex = 0; return; }
        re.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let lastIdx = 0;
        let m;
        while ((m = re.exec(txt)) !== null) {
            if (m.index > lastIdx) frag.appendChild(document.createTextNode(txt.slice(lastIdx, m.index)));
            const mark = document.createElement('mark');
            mark.textContent = m[0];
            frag.appendChild(mark);
            lastIdx = m.index + m[0].length;
        }
        if (lastIdx < txt.length) frag.appendChild(document.createTextNode(txt.slice(lastIdx)));
        parent.replaceChild(frag, tn);
    });
    return tpl.innerHTML;
}

// Render math inside all .qfv-card elements in a container
function qfvRenderMathIn(container) {
    if (!container) return;
    container.querySelectorAll('.qfv-q-preview, .qfv-opt-text, .qfv-explain').forEach(el => renderKatex(el));
}

// Get display fields for a post based on language
function qfvGetDisplayFields(post, lang) {
    const meta = post.meta_input || {};
    const slot = editorSlotForLang(lang);
    const chosen = editorReadSlot(post, slot);
    const correct = Array.isArray(meta._aimcq_correct_answers) ? meta._aimcq_correct_answers.map(Number) : [0];
    // If this slot has no options but the primary slot does, fall back so a
    // bilingual card with missing HI options still renders option text.
    if ((!chosen.options || !chosen.options.length)) {
        const prim = editorReadSlot(post, 'primary');
        if (prim.options && prim.options.length) chosen.options = prim.options;
    }
    // hasHi reflects whether a Hindi *secondary* translation exists (used only
    // to decide the per-card toggle in bilingual mode).
    const hasHi = !!(meta._aimcq_question_content_hi || meta._aimcq_title_hi ||
        meta._aimcq_explanation_hi ||
        (Array.isArray(meta._aimcq_options_hi) && meta._aimcq_options_hi.some(o => o && (o.text || o.image))));
    return { ...chosen, correct, hasHi, lang };
}

// --- Main render dispatcher ---
function renderEditorWorkspace() {
    if (!editorBaseData) return;
    updateTabCounts();
    if (currentViewTab === 'base') {
        renderBasePanel();
    } else {
        renderImportPanel();
    }
    updateEditorStats();
    updateLiveJsonPreview();
}

function updateTabCounts() {
    const baseTotal = editorBaseData ? editorBaseData.posts.length : 0;
    document.getElementById('view-tab-base-count').textContent = baseTotal;
    const ic = document.getElementById('view-tab-import-count');
    if (ic) ic.textContent = '';
}

// ---- FRONT VIEW card builder ----
function buildQfvCard(opts) {
    // opts: { kind: 'base'|'import', idx (base) OR si/pidx (import), post, search, isSelected, color }
    const { kind, post, search, isSelected } = opts;
    const cardKey = kind === 'base' ? `b:${opts.idx}` : `i:${opts.si}:${opts.pidx}`;
    const bilingual = editorIsBilingual();
    const soleLang = _editorLangs[0] || 'en';
    const lang = bilingual ? (_cardLang[cardKey] || _defaultLang) : soleLang;
    const disp = qfvGetDisplayFields(post, lang);
    const expanded = (kind === 'base')
        ? _expandedBase.has(opts.idx)
        : _expandedImport.has(`${opts.si}:${opts.pidx}`);

    let qHtml = qfvSanitizeHtml(disp.question || '');
    if (search) qHtml = qfvHighlightInHtml(qHtml, search);

    const card = document.createElement('div');
    card.className = 'qfv-card';
    if (isSelected && kind === 'base') card.classList.add('selected');
    if (isSelected && kind === 'import') card.classList.add('importing');
    if (expanded) card.classList.add('expanded');
    card.dataset.cardKey = cardKey;

    // ---- Header ----
    const head = document.createElement('div');
    head.className = 'qfv-head';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'qfv-checkbox' + (kind === 'import' ? ' imp' : '');
    checkbox.checked = isSelected;
    checkbox.title = kind === 'base' ? 'Mark for deletion' : 'Mark for import';
    if (kind === 'base') {
        checkbox.setAttribute('data-type', 'base');
        checkbox.setAttribute('data-idx', opts.idx);
    } else {
        checkbox.setAttribute('data-type', 'import');
        checkbox.setAttribute('data-si', opts.si);
        checkbox.setAttribute('data-pidx', opts.pidx);
    }
    head.appendChild(checkbox);

    const titleWrap = document.createElement('div');
    titleWrap.className = 'qfv-title-wrap';

    // Badges
    const badgesRow = document.createElement('div');
    badgesRow.className = 'qfv-badges';
    const numBadge = document.createElement('span');
    numBadge.className = 'qfv-num-badge' + (kind === 'import' ? ' imp' : '');
    numBadge.style.cssText = (kind === 'import' && opts.color)
        ? `color:#fff;background:${opts.color};border-color:${opts.color}`
        : '';
    numBadge.textContent = kind === 'base' ? `Q #${opts.idx + 1}` : `Src ${opts.si+1} · #${opts.pidx+1}`;
    badgesRow.appendChild(numBadge);

    if (isSelected && kind === 'base') {
        const b = document.createElement('span');
        b.className = 'qfv-status-badge qfv-status-del';
        b.innerHTML = '<i data-lucide="trash-2" class="w-3 h-3"></i> To Delete';
        badgesRow.appendChild(b);
    }
    if (isSelected && kind === 'import') {
        const b = document.createElement('span');
        b.className = 'qfv-status-badge qfv-status-imp';
        b.innerHTML = '<i data-lucide="plus-circle" class="w-3 h-3"></i> To Import';
        badgesRow.appendChild(b);
    }

    // Language flag & toggle — only show a toggle when the file is bilingual.
    if (bilingual) {
        const toggle = document.createElement('div');
        toggle.className = 'qfv-lang-toggle';
        toggle.innerHTML = `
            <button type="button" class="qfv-lang-btn ${lang==='en'?'active':''}" data-lang="en">EN</button>
            <button type="button" class="qfv-lang-btn hi ${lang==='hi'?'active':''}" data-lang="hi">हिं</button>
        `;
        toggle.querySelectorAll('.qfv-lang-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const newLang = btn.getAttribute('data-lang');
                _cardLang[cardKey] = newLang;
                // Re-render just this card
                const fresh = buildQfvCard({ ...opts });
                card.replaceWith(fresh);
                qfvRenderMathIn(fresh.parentElement || document);
            });
        });
        badgesRow.appendChild(toggle);
    } else {
        // Single-language file → a static flag labelled with that language.
        const flag = document.createElement('span');
        flag.className = 'qfv-lang-flag' + (soleLang === 'hi' ? ' hi' : '');
        flag.textContent = editorLangLabel(soleLang);
        badgesRow.appendChild(flag);
    }
    titleWrap.appendChild(badgesRow);

    // Question preview (clamped until expanded)
    const qPreview = document.createElement('div');
    qPreview.className = 'qfv-q-preview';
    qPreview.innerHTML = qHtml || '<em class="text-gray-400">(no question text)</em>';
    titleWrap.appendChild(qPreview);

    head.appendChild(titleWrap);

    // Actions: expand + edit
    const actions = document.createElement('div');
    actions.className = 'qfv-actions';
    if (kind === 'base') {
        const editBtn = document.createElement('button');
        editBtn.className = 'qfv-edit-btn';
        editBtn.innerHTML = '<i data-lucide="pencil" class="w-3 h-3"></i> Edit';
        editBtn.title = 'Edit this question';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openQEditor(opts.idx);
        });
        actions.appendChild(editBtn);
    }
    const expandBtn = document.createElement('button');
    expandBtn.className = 'qfv-icon-btn';
    expandBtn.title = expanded ? 'Collapse' : 'Expand to see options & explanation';
    expandBtn.innerHTML = '<i data-lucide="chevron-down" class="w-4 h-4"></i>';
    actions.appendChild(expandBtn);
    head.appendChild(actions);

    card.appendChild(head);

    // ---- Body (options + explanation) — rendered only when expanded ----
    if (expanded) {
        const body = document.createElement('div');
        body.className = 'qfv-body';

        // Options
        if (disp.options && disp.options.length) {
            const opts_ = document.createElement('div');
            opts_.className = 'qfv-opts';
            disp.options.forEach((opt, oi) => {
                if (!opt) return;
                const isCorrect = disp.correct.includes(oi);
                const row = document.createElement('div');
                row.className = 'qfv-opt' + (isCorrect ? ' correct' : '');
                let text = qfvSanitizeHtml(opt.text || '');
                if (search) text = qfvHighlightInHtml(text, search);
                const imgHtml = opt.image
                    ? `<img src="${escapeHtml(opt.image)}" alt="" onerror="this.style.display='none'">`
                    : '';
                row.innerHTML = `
                    <span class="qfv-opt-letter">${OPTION_LETTERS[oi] || (oi+1)}</span>
                    <div class="qfv-opt-text">${text || '<em class="text-gray-400">(empty)</em>'} ${imgHtml}</div>
                    ${isCorrect ? '<i data-lucide="check-circle-2" class="w-4 h-4 qfv-opt-check"></i>' : ''}
                `;
                opts_.appendChild(row);
            });
            body.appendChild(opts_);
        } else {
            const empty = document.createElement('div');
            empty.className = 'text-xs text-gray-400 italic py-2';
            empty.textContent = '(no options defined)';
            body.appendChild(empty);
        }

        // Explanation
        if (disp.explanation && String(disp.explanation).trim()) {
            const ex = document.createElement('div');
            ex.className = 'qfv-explain';
            const langLabel = disp.lang === 'hi' ? 'व्याख्या' : 'Explanation';
            let exHtml = qfvSanitizeHtml(disp.explanation);
            if (search) exHtml = qfvHighlightInHtml(exHtml, search);
            ex.innerHTML = `
                <div class="qfv-explain-label"><i data-lucide="lightbulb" class="w-3 h-3"></i> ${langLabel}</div>
                <div>${exHtml}</div>
            `;
            body.appendChild(ex);
        }

        card.appendChild(body);
    }

    // Click on head (but not interactive children) toggles expand
    head.addEventListener('click', (e) => {
        if (e.target.closest('.qfv-checkbox, .qfv-edit-btn, .qfv-lang-toggle, input, button')) return;
        toggleQfvExpand(kind, opts, card);
    });
    expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleQfvExpand(kind, opts, card);
    });

    return card;
}

function toggleQfvExpand(kind, opts, card) {
    if (kind === 'base') {
        const idx = opts.idx;
        if (_expandedBase.has(idx)) _expandedBase.delete(idx);
        else _expandedBase.add(idx);
    } else {
        const key = `${opts.si}:${opts.pidx}`;
        if (_expandedImport.has(key)) _expandedImport.delete(key);
        else _expandedImport.add(key);
    }
    // Rebuild this card in place
    const fresh = buildQfvCard(opts);
    card.replaceWith(fresh);
    lucide.createIcons();
    qfvRenderMathIn(fresh.parentElement || document);
}

// ---- BASE PANEL ----
function renderBasePanel() {
    const search = document.getElementById('editor-search').value.toLowerCase().trim();
    const filter = document.getElementById('editor-filter').value;
    const list = document.getElementById('editor-question-list-base');
    const emptyMsg = document.getElementById('editor-empty-msg-base');
    list.innerHTML = '';
    _visibleBaseIndices = [];
    let anyVisible = false;

    editorBaseData.posts.forEach((post, idx) => {
        // Searchable haystack: question text + options + explanation, across both langs
        const meta = post.meta_input || {};
        const haystackParts = [
            post.post_content || '', post.post_title || '',
            meta._aimcq_question_content_hi || '', meta._aimcq_title_hi || '',
            meta._aimcq_explanation || '', meta._aimcq_explanation_hi || '',
            ...(Array.isArray(meta._aimcq_options) ? meta._aimcq_options.map(o => o?.text || '') : []),
            ...(Array.isArray(meta._aimcq_options_hi) ? meta._aimcq_options_hi.map(o => o?.text || '') : []),
        ];
        const haystack = stripHtmlTags(haystackParts.join(' ')).toLowerCase();
        if (search && !haystack.includes(search)) return;
        if (filter === 'to-delete' && !editorDeleteSet.has(idx)) return;

        _visibleBaseIndices.push(idx);
        anyVisible = true;

        const card = buildQfvCard({
            kind: 'base',
            idx,
            post,
            search,
            isSelected: editorDeleteSet.has(idx),
        });
        list.appendChild(card);
    });

    lucide.createIcons();
    emptyMsg.classList.toggle('hidden', anyVisible);
    attachBaseCheckboxListeners();
    qfvRenderMathIn(list);
}

// ---- IMPORT PANEL ----
// ---- IMPORT PANEL (Import Sources removed — no-op) ----
function renderImportPanel() {
    // The 'Imported JSON' panel was removed from the Question Editor.
    const list = document.getElementById("editor-question-list-import");
    if (list) list.innerHTML = '';
    _visibleImportKeys = [];
}

function attachBaseCheckboxListeners() {
    document.querySelectorAll('#editor-question-list-base .qfv-checkbox').forEach(cb => {
        cb.addEventListener('change', e => {
            const idx = parseInt(e.target.getAttribute('data-idx'));
            if (e.target.checked) editorDeleteSet.add(idx);
            else editorDeleteSet.delete(idx);

            // Rebuild this card in place so the badge + border state update cleanly
            const card = e.target.closest('.qfv-card');
            if (card) {
                const fresh = buildQfvCard({
                    kind: 'base',
                    idx,
                    post: editorBaseData.posts[idx],
                    search: document.getElementById('editor-search').value.toLowerCase().trim(),
                    isSelected: editorDeleteSet.has(idx),
                });
                card.replaceWith(fresh);
                lucide.createIcons();
                qfvRenderMathIn(fresh.parentElement || document);
            }

            updateEditorStats();
            updateTabCounts();
            updateLiveJsonPreview();
        });
        // Prevent head's click-to-expand when clicking the checkbox
        cb.addEventListener('click', e => e.stopPropagation());
    });
}

function attachImportCheckboxListeners() {
    document.querySelectorAll('#editor-question-list-import .qfv-checkbox').forEach(cb => {
        cb.addEventListener('change', e => {
            const si = parseInt(e.target.getAttribute('data-si'));
            const pidx = parseInt(e.target.getAttribute('data-pidx'));
            const key = `${si}:${pidx}`;
            if (e.target.checked) editorImportSet.add(key);
            else editorImportSet.delete(key);

            // Rebuild this card
            const card = e.target.closest('.qfv-card');
            if (card) {
                const src = editorImportSources[si];
                const color = COLORS[si % COLORS.length];
                const fresh = buildQfvCard({
                    kind: 'import',
                    si, pidx,
                    post: src.data.posts[pidx],
                    search: document.getElementById('editor-search').value.toLowerCase().trim(),
                    isSelected: editorImportSet.has(key),
                    color,
                });
                card.replaceWith(fresh);
                lucide.createIcons();
                qfvRenderMathIn(fresh.parentElement || document);
            }

            updateEditorStats();
            updateTabCounts();

            // Update source selector count live
            if (editorImportSources.length > 1) {
                const sel = document.getElementById('import-source-selector');
                editorImportSources.forEach((src, i) => {
                    const opt = sel.options[i];
                    if (opt) {
                        const markedCount = src.data.posts.filter((_, pidx2) => editorImportSet.has(`${i}:${pidx2}`)).length;
                        opt.textContent = `${src.filename} (${src.data.posts.length} Q${markedCount ? ` · ✓${markedCount}` : ''})`;
                    }
                });
                const activeSrc = editorImportSources[activeImportSourceIdx];
                const markedInSrc = activeSrc.data.posts.filter((_, pidx2) => editorImportSet.has(`${activeImportSourceIdx}:${pidx2}`)).length;
                document.getElementById('import-src-q-count').textContent =
                    `${activeSrc.data.posts.length} questions${markedInSrc ? ` · ${markedInSrc} marked` : ''}`;
            } else if (editorImportSources.length === 1) {
                const src = editorImportSources[0];
                const markedCount = src.data.posts.filter((_, pidx2) => editorImportSet.has(`0:${pidx2}`)).length;
                document.getElementById('import-single-source-label').textContent =
                    `${src.filename} — ${src.data.posts.length} questions${markedCount ? ` · ${markedCount} marked to import` : ''}`;
            }
            updateLiveJsonPreview();
        });
        cb.addEventListener('click', e => e.stopPropagation());
    });
}

function updateEditorStats() {
    if (!editorBaseData) return;
    const total = editorBaseData.posts.length;
    const toDelete = editorDeleteSet.size;
    const toImport = editorImportSet.size;
    const finalCount = total - toDelete + toImport;
    document.getElementById('editor-stat-total').textContent = total;
    document.getElementById('editor-stat-selected').textContent = toDelete;
    const si = document.getElementById('editor-stat-import');
    if (si) si.textContent = toImport;
    document.getElementById('editor-stat-final').textContent = finalCount;
}

// --- Apply & Export ---
document.getElementById('btn-apply-export').addEventListener('click', () => {
    if (!editorBaseData) return;

    // Build retained base posts
    const retainedPosts = editorBaseData.posts.filter((_, idx) => !editorDeleteSet.has(idx));

    // Gather import posts
    const importedPosts = [];
    editorImportSet.forEach(key => {
        const [si, pidx] = key.split(':').map(Number);
        const src = editorImportSources[si];
        if (src && src.data.posts[pidx]) importedPosts.push(src.data.posts[pidx]);
    });

    const mergedPosts = [...retainedPosts, ...importedPosts];

    // Merge terms from import sources (for imported questions)
    const termsMap = new Map();
    (editorBaseData.terms || []).forEach(t => { if(t?.slug) termsMap.set(t.slug, t); });
    if (importedPosts.length) {
        // Include terms from sources that had selections
        const usedSources = new Set([...editorImportSet].map(k => parseInt(k.split(':')[0])));
        usedSources.forEach(si => {
            const src = editorImportSources[si];
            if (src) (src.data.terms || []).forEach(t => { if(t?.slug) termsMap.set(t.slug, t); });
        });
    }

    editorExportData = {
        version: editorBaseData.version || "1.7.0",
        export_type: editorBaseData.export_type || "single",
        terms: Array.from(termsMap.values()),
        posts: mergedPosts
    };

    const resultEl = document.getElementById('editor-export-result');
    document.getElementById('editor-export-stats').textContent =
        `${mergedPosts.length} questions total: ${retainedPosts.length} kept from base` +
        (editorDeleteSet.size ? `, ${editorDeleteSet.size} deleted` : '') +
        (importedPosts.length ? `, ${importedPosts.length} imported` : '') + '.';
    resultEl.classList.remove('hidden');
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    refreshEditorDriveButtons();
    if (typeof refreshEditorGitHubButtons === 'function') refreshEditorGitHubButtons();
    showToast("Export Ready!", `${mergedPosts.length} questions. Click download.`, "success");
});

document.getElementById('btn-download-edited').addEventListener('click', () => {
    if (!editorExportData) return;
    const base = editorBaseFileName.replace('.json','');
    downloadJSON(editorExportData, `${base}_edited_${Date.now()}.json`);
});
// ==================== QUESTION EDITOR MODAL ====================

// KaTeX renderer — called after setting innerHTML on any preview area
function renderKatex(el) {
    if (!el) return;
    if (window.renderMathInElement && window._katexReady) {
        try {
            renderMathInElement(el, {
                delimiters: [
                    { left: '$$',   right: '$$',   display: true  },
                    { left: '$',    right: '$',    display: false },
                    { left: '\\[', right: '\\]',  display: true  },
                    { left: '\\(', right: '\\)',  display: false },
                ],
                throwOnError: false,
                strict: false,
            });
        } catch(e) {}
    } else {
        // KaTeX not ready yet — retry once it loads
        const check = setInterval(() => {
            if (window.renderMathInElement && window._katexReady) {
                clearInterval(check);
                renderKatex(el);
            }
        }, 100);
        setTimeout(() => clearInterval(check), 5000);
    }
}

let qEditorIdx = null;
let qEditorLang = 'en';
const OPTION_COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444'];
const OPTION_LETTERS = ['A','B','C','D','E','F','G','H'];

// Registry: field -> { compose, htmlArea, previewArea, mode }
const reRegistry = {};

// ---- Rich Editor Builder ----
const RE_DEFAULT_HEIGHT = 160; // px
let savedLatexSelection = null; // saved Range for latex insertion

const LATEX_DELIMS = {
    'dollar':        { open: '$',    close: '$',    placeholder: 'expr'  },
    'paren':         { open: '\\(', close: '\\)',   placeholder: 'expr'  },
    'bracket':       { open: '\\[', close: '\\]',   placeholder: 'expr'  },
    'double-dollar': { open: '$$',   close: '$$',   placeholder: 'expr'  },
};

function saveSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return sel.getRangeAt(0).cloneRange();
}

function restoreSelection(range) {
    if (!range) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function insertLatex(compose, delim) {
    const d = LATEX_DELIMS[delim];
    if (!d) return;
    const sel = window.getSelection();
    const selectedText = (sel && sel.toString()) || '';

    // Insert as plain text to avoid execCommand HTML mangling
    const inner = selectedText || d.placeholder;
    const text  = d.open + inner + d.close;

    // Use execCommand so it's undoable
    document.execCommand('insertText', false, text);

    // If nothing was selected, place cursor between the delimiters
    if (!selectedText) {
        // Re-select to position caret: move back by close.length chars
        const newSel = window.getSelection();
        if (newSel && newSel.rangeCount) {
            const r = newSel.getRangeAt(0);
            // Walk back in text node
            try {
                const node = r.startContainer;
                const offset = r.startOffset;
                const closeLen = d.close.length;
                r.setStart(node, Math.max(0, offset - closeLen));
                r.collapse(true);
                newSel.removeAllRanges();
                newSel.addRange(r);
            } catch(e) {}
        }
    }
}

function buildRichEditor(wrap) {
    const field = wrap.getAttribute('data-field');
    const isHi  = wrap.getAttribute('data-lang') === 'hi';
    const placeholders = {
        'en-question':    'Question text in English…',
        'en-explanation': 'Explanation / solution steps in English (optional)…',
        'hi-question':    'प्रश्न हिन्दी में…',
        'hi-explanation': 'व्याख्या / हल के चरण हिन्दी में (वैकल्पिक)…',
    };
    const placeholder = placeholders[field] || '';
    const savedH = (reRegistry[field] && reRegistry[field].height) || RE_DEFAULT_HEIGHT;

    wrap.innerHTML = `
      <div class="re-topbar">
        <button type="button" class="re-mode-tab active" data-mode="compose">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          Compose
        </button>
        <button type="button" class="re-mode-tab" data-mode="html">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          HTML <span class="re-mode-badge">source</span>
        </button>
        <button type="button" class="re-mode-tab" data-mode="preview">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Preview
        </button>
        <div class="re-topbar-sep"></div>
        <div class="re-latex-wrap" style="margin:0 6px 0 4px;">
          <button type="button" class="re-latex-toggle" title="Insert LaTeX math encloser">
            <span class="re-latex-toggle-inner">∑ LaTeX</span>
          </button>
          <div class="re-latex-dropdown hidden">
            <div class="re-latex-header">Math Enclosers</div>
            <button type="button" class="re-latex-opt" data-delim="dollar">
              <span class="re-latex-preview">$<em>expr</em>$</span>
              <span class="re-latex-desc">Dollar signs <code>$...$</code></span>
            </button>
            <button type="button" class="re-latex-opt" data-delim="paren">
              <span class="re-latex-preview">\(<em>expr</em>\)</span>
              <span class="re-latex-desc">Parens <code>\(...\)</code></span>
            </button>
            <button type="button" class="re-latex-opt" data-delim="bracket">
              <span class="re-latex-preview">\[<em>expr</em>\]</span>
              <span class="re-latex-desc">Brackets <code>\[...\]</code> — display</span>
            </button>
            <button type="button" class="re-latex-opt" data-delim="double-dollar">
              <span class="re-latex-preview">$$<em>expr</em>$$</span>
              <span class="re-latex-desc">Double dollar <code>$$...$$</code> — display</span>
            </button>
            <div class="re-latex-hint">Select text first to wrap, or click to insert at cursor</div>
          </div>
        </div>
      </div>
      <div class="re-toolbar">
        <select class="re-heading-select" title="Paragraph / Heading">
          <option value="div">Normal</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
          <option value="h5">Heading 5</option>
        </select>
        <div class="re-tool-sep"></div>
        <span class="re-tool-label">FORMAT</span>
        <button type="button" class="re-tool-btn" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" class="re-tool-btn" data-cmd="italic" title="Italic (Ctrl+I)"><i style="font-style:italic">I</i></button>
        <button type="button" class="re-tool-btn" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
        <button type="button" class="re-tool-btn" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
        <div class="re-tool-sep"></div>
        <span class="re-tool-label">SCRIPT</span>
        <button type="button" class="re-tool-btn" data-cmd="superscript" title="Superscript" style="font-size:10px;letter-spacing:-0.5px">X²</button>
        <button type="button" class="re-tool-btn" data-cmd="subscript" title="Subscript" style="font-size:10px;letter-spacing:-0.5px">X₂</button>
        <div class="re-tool-sep"></div>
        <span class="re-tool-label">LIST</span>
        <button type="button" class="re-tool-btn" data-cmd="insertUnorderedList" title="Bullet list">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/></svg>
        </button>
        <button type="button" class="re-tool-btn" data-cmd="insertOrderedList" title="Numbered list">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4" stroke-linecap="round"/><path d="M4 10h2" stroke-linecap="round"/><path d="M4 14h1.5a.5.5 0 010 1H4a.5.5 0 000 1h2" stroke-linecap="round"/></svg>
        </button>
        <div class="re-tool-sep"></div>
        <span class="re-tool-label">INSERT</span>
        <button type="button" class="re-tool-btn re-tool-link" title="Insert / edit link">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
        </button>
        <button type="button" class="re-tool-btn re-tool-table" title="Insert table">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
        </button>
        <button type="button" class="re-tool-btn re-tool-image" title="Insert image URL">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </button>
        <div class="re-tool-sep"></div>
        <button type="button" class="re-tool-btn" data-cmd="removeFormat" title="Clear formatting" style="font-size:10px">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 12h12M4 6h10M8 18h8"/><line x1="19" y1="5" x2="5" y2="19" stroke="#ef4444" stroke-width="2"/></svg>
        </button>
      </div>
      <div class="re-body-area" style="height:${savedH}px">
        <div class="re-compose custom-scrollbar" contenteditable="true" spellcheck="false"
             data-placeholder="${placeholder}" style="height:100%"></div>
        <div class="re-html-wrap hidden">
          <div class="re-html-gutter" id="re-gutter-${field}"></div>
          <div class="re-html-scroll custom-scrollbar">
            <div class="re-html-code" contenteditable="true" spellcheck="false"
                 data-placeholder="HTML source…"
                 id="re-htmlcode-${field}"></div>
          </div>
        </div>
        <div class="re-preview-area custom-scrollbar hidden"></div>
      </div>
      <div class="re-resize-bar" title="Drag to resize"></div>
    `;

    const topbar    = wrap.querySelector('.re-topbar');
    const toolbar   = wrap.querySelector('.re-toolbar');
    const bodyArea  = wrap.querySelector('.re-body-area');
    const compose   = wrap.querySelector('.re-compose');
    const htmlWrap  = wrap.querySelector('.re-html-wrap');
    const htmlCode  = wrap.querySelector('.re-html-code');
    const preview   = wrap.querySelector('.re-preview-area');
    const resizeBar = wrap.querySelector('.re-resize-bar');

    reRegistry[field] = { compose, htmlWrap, htmlCode, preview, bodyArea, mode: 'compose', height: savedH };

    // --- Mode switching ---
    topbar.querySelectorAll('.re-mode-tab').forEach(tab => {
        tab.addEventListener('click', () => switchReMode(field, tab.getAttribute('data-mode'), wrap));
    });

    // --- Heading select ---
    const headingSelect = toolbar.querySelector('.re-heading-select');
    headingSelect.addEventListener('change', () => {
        compose.focus();
        document.execCommand('formatBlock', false, headingSelect.value);
        updateToolbarState(toolbar, compose);
    });

    // --- Toolbar commands ---
    toolbar.querySelectorAll('[data-cmd]').forEach(btn => {
        btn.addEventListener('mousedown', e => {
            e.preventDefault();
            compose.focus();
            document.execCommand(btn.getAttribute('data-cmd'), false, null);
            updateToolbarState(toolbar, compose);
        });
    });

    toolbar.querySelector('.re-tool-link').addEventListener('mousedown', e => {
        e.preventDefault();
        compose.focus();
        const url = prompt('Enter URL:', 'https://');
        if (url) {
            document.execCommand('createLink', false, url);
            compose.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
        }
        updateToolbarState(toolbar, compose);
    });

    toolbar.querySelector('.re-tool-table').addEventListener('mousedown', e => {
        e.preventDefault();
        compose.focus();
        const rows = parseInt(prompt('Rows:', '3') || '0');
        const cols = parseInt(prompt('Columns:', '3') || '0');
        if (!rows || !cols) return;
        let html = '<table><thead><tr>';
        for (let c = 0; c < cols; c++) html += `<th>Header ${c+1}</th>`;
        html += '</tr></thead><tbody>';
        for (let r = 0; r < rows; r++) {
            html += '<tr>' + Array(cols).fill('<td>Cell</td>').join('') + '</tr>';
        }
        html += '</tbody></table><p></p>';
        document.execCommand('insertHTML', false, html);
        updateToolbarState(toolbar, compose);
    });

    toolbar.querySelector('.re-tool-image').addEventListener('mousedown', e => {
        e.preventDefault();
        compose.focus();
        const url = prompt('Image URL:', 'https://');
        if (url) document.execCommand('insertHTML', false, `<img src="${url}" alt="image" style="max-width:100%">`);
    });

    // LaTeX dropdown toggle (lives in topbar, not toolbar)
    const latexToggle = topbar.querySelector('.re-latex-toggle');
    const latexDrop   = topbar.querySelector('.re-latex-dropdown');
    const latexWrap   = topbar.querySelector('.re-latex-wrap');

    latexToggle.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        savedLatexSelection = saveSelection();
        const isHidden = latexDrop.classList.contains('hidden');
        // Close all other open latex dropdowns first
        document.querySelectorAll('.re-latex-dropdown:not(.hidden)').forEach(d => d.classList.add('hidden'));
        if (isHidden) {
            const rect = latexToggle.getBoundingClientRect();
            latexDrop.style.top  = (rect.bottom + 6) + 'px';
            latexDrop.style.left = rect.left + 'px';
            latexDrop.classList.remove('hidden');
        }
    });

    // Option clicks
    topbar.querySelectorAll('.re-latex-opt').forEach(opt => {
        opt.addEventListener('mousedown', e => {
            e.preventDefault();
            e.stopPropagation();
            const delim = opt.getAttribute('data-delim');
            latexDrop.classList.add('hidden');
            compose.focus();
            restoreSelection(savedLatexSelection);
            insertLatex(compose, delim);
            updateToolbarState(toolbar, compose);
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('mousedown', e => {
        if (latexWrap && !latexWrap.contains(e.target)) {
            latexDrop.classList.add('hidden');
        }
    });

    // HTML source: sync back to compose on input + live highlight
    htmlCode.addEventListener('input', () => {
        renderHtmlHighlight(field);
        syncGutter(field);
    });
    htmlCode.addEventListener('scroll', () => syncGutterScroll(field));

    compose.addEventListener('keyup',   () => updateToolbarState(toolbar, compose));
    compose.addEventListener('mouseup', () => updateToolbarState(toolbar, compose));
    compose.addEventListener('input',   () => updateToolbarState(toolbar, compose));

    // --- Resize handle ---
    let isDragging = false, dragStartY = 0, dragStartH = 0;
    resizeBar.addEventListener('mousedown', e => {
        isDragging = true;
        dragStartY = e.clientY;
        dragStartH = bodyArea.offsetHeight;
        resizeBar.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ns-resize';
    });
    document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        const newH = Math.max(80, Math.min(600, dragStartH + (e.clientY - dragStartY)));
        bodyArea.style.height = newH + 'px';
        reRegistry[field].height = newH;
        syncGutter(field);
    });
    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        resizeBar.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    });

    // Touch resize support
    resizeBar.addEventListener('touchstart', e => {
        isDragging = true;
        dragStartY = e.touches[0].clientY;
        dragStartH = bodyArea.offsetHeight;
    }, { passive: true });
    document.addEventListener('touchmove', e => {
        if (!isDragging) return;
        const newH = Math.max(80, Math.min(600, dragStartH + (e.touches[0].clientY - dragStartY)));
        bodyArea.style.height = newH + 'px';
        reRegistry[field].height = newH;
    }, { passive: true });
    document.addEventListener('touchend', () => { isDragging = false; });
}

// ---- HTML Syntax Highlighter ----
function htmlToHighlighted(raw) {
    let out = '';
    let i = 0;
    while (i < raw.length) {
        if (raw[i] === '<') {
            let j = raw.indexOf('>', i);
            if (j === -1) { out += `<span class="hl-punct">${escHtml(raw.slice(i))}</span>`; break; }
            const tag = raw.slice(i, j + 1);
            out += colorTag(tag);
            i = j + 1;
        } else {
            let j = raw.indexOf('<', i);
            if (j === -1) j = raw.length;
            out += colorTextNode(raw.slice(i, j));
            i = j;
        }
    }
    return out;
}

function esc_span(str, cls) {
    return `<span class="${cls}">${escHtml(str)}</span>`;
}
function escHtml(s) {
    // Only escape < and > for tag display; & is already literal in source text
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Escape only < and > — leave & alone so entities aren't double-encoded
function escHtmlSrc(s) {
    return s.replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function colorTextNode(text) {
    if (!text) return '';
    // Highlight HTML entities (e.g. &amp; &lt; &#39;) in amber, rest as plain text
    // Use escHtmlSrc (not escHtml) so & in entity names isn't double-encoded
    return escHtmlSrc(text).replace(/(&[a-zA-Z#0-9]+;)/g,
        m => `<span class="hl-entity">${m}</span>`);
}

function colorTag(tag) {
    // Comment
    if (tag.startsWith('<!--')) {
        return `<span class="hl-comment">${escHtml(tag)}</span>`;
    }
    // Parse: < /? tagname attrs >
    const selfClose = tag.endsWith('/>');
    const closing   = tag.startsWith('</');
    // Extract tag name
    const nameMatch = tag.match(/^<\/?([a-zA-Z][a-zA-Z0-9:-]*)/);
    if (!nameMatch) return `<span class="hl-punct">${escHtml(tag)}</span>`;
    const name = nameMatch[1];

    // Build output piece by piece
    let out = `<span class="hl-punct">${closing ? '&lt;/' : '&lt;'}</span>`;
    out += `<span class="hl-tag">${escHtmlSrc(name)}</span>`;

    // Remaining = attributes portion (strip tag name and brackets)
    let rest = tag.slice(nameMatch[0].length);
    rest = rest.replace(/\/?>$/, '');  // strip trailing /> or >

    // Tokenize attributes: name="value" or name='value' or name or =value
    const attrRe = /\s+([a-zA-Z_:][^\s=/>]*)(?:\s*(=)\s*(?:"([^"]*)"|(\'[^\']*\')|([^\s"'=<>`]+)))?/g;
    let lastIndex = 0;
    let m;
    let attrOut = '';
    while ((m = attrRe.exec(rest)) !== null) {
        if (m.index > lastIndex) attrOut += `<span class="hl-text">${escHtmlSrc(rest.slice(lastIndex, m.index))}</span>`;
        attrOut += ` <span class="hl-attr">${escHtmlSrc(m[1])}</span>`;
        if (m[2]) {
            attrOut += `<span class="hl-eq">=</span>`;
            const val = m[3] !== undefined ? `"${m[3]}"` : m[4] !== undefined ? m[4] : m[5];
            attrOut += `<span class="hl-val">${escHtmlSrc(val)}</span>`;
        }
        lastIndex = m.index + m[0].length;
    }
    if (lastIndex < rest.length) attrOut += `<span class="hl-text">${escHtmlSrc(rest.slice(lastIndex))}</span>`;
    out += attrOut;
    out += `<span class="hl-punct">${selfClose ? '/&gt;' : '&gt;'}</span>`;
    return out;
}

function renderHtmlHighlight(field) {
    const reg = reRegistry[field];
    if (!reg) return;
    const code = reg.htmlCode;

    // Read raw source text directly — textContent gives the literal HTML string
    // (e.g. "<b>A &amp; B</b>") without re-encoding
    const raw = code.textContent || '';

    // Save caret offset in plain-text space
    const sel = window.getSelection();
    let caretOffset = 0;
    if (sel && sel.rangeCount && code.contains(sel.anchorNode)) {
        try {
            const range = sel.getRangeAt(0);
            const pre = range.cloneRange();
            pre.selectNodeContents(code);
            pre.setEnd(range.endContainer, range.endOffset);
            caretOffset = pre.toString().length;
        } catch(e) {}
    }

    code.innerHTML = htmlToHighlighted(raw);
    syncGutter(field);

    // Restore caret into text nodes
    try {
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let node, pos = 0;
        while ((node = walker.nextNode())) {
            const len = node.length;
            if (pos + len >= caretOffset) {
                const r = document.createRange();
                r.setStart(node, Math.min(caretOffset - pos, len));
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
                break;
            }
            pos += len;
        }
    } catch(e) {}
}

// Extract raw text from contenteditable, converting <br>/block divs → \n
function getCodeRawText(el) {
    // Read the raw HTML source string from the syntax-highlighted contenteditable.
    // Each visual line is a text node or wrapped in a child div by the browser.
    // We want the plain-text content (stripped of highlight <span> wrappers) joined without newlines.
    let text = '';
    el.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
        } else if (node.nodeName === 'BR') {
            // bare <br> = line separator in the source
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            text += getCodeRawText(node);
        }
    });
    return text;
}

function syncGutter(field) {
    const reg = reRegistry[field];
    if (!reg || reg.mode !== 'html') return;
    const gutter = document.getElementById(`re-gutter-${field}`);
    if (!gutter) return;
    const raw = reg.htmlCode.textContent || '';
    const lines = raw.split('\n').length;
    gutter.innerHTML = Array.from({length: lines}, (_, i) => `<div>${i + 1}</div>`).join('');
}

function syncGutterScroll(field) {
    const reg = reRegistry[field];
    if (!reg) return;
    const gutter = document.getElementById(`re-gutter-${field}`);
    const scroll = reg.htmlCode.closest('.re-html-scroll');
    if (gutter && scroll) gutter.scrollTop = scroll.scrollTop;
}

// Highlight only the exact selected text in HTML source using its plain-text offset
function highlightSelectionInHtml(codeEl, selectedText, selStartOffset, composeHTML) {
    if (!selectedText || !selectedText.trim()) return;

    // Map the plain-text offset into the HTML source string offset
    // Strategy: walk composeHTML stripping tags to count plain-text chars,
    // stop when we reach selStartOffset, record the HTML source index there.
    const htmlSrc = formatHtmlSource(composeHTML);
    let plainCount = 0;
    let htmlIdx = 0;
    let inTag = false;
    let srcStart = -1;

    for (let i = 0; i < htmlSrc.length; i++) {
        const ch = htmlSrc[i];
        if (ch === '<') { inTag = true; continue; }
        if (ch === '>') { inTag = false; continue; }
        if (inTag) continue;

        if (plainCount === selStartOffset && srcStart === -1) {
            srcStart = i; // found where plain-text offset maps to in HTML source
        }
        plainCount++;
    }

    // Fallback: if offset mapping failed, find first occurrence
    if (srcStart === -1) {
        srcStart = (codeEl.innerText || codeEl.textContent || '').indexOf(selectedText);
    }
    if (srcStart === -1) return;

    // Now find srcStart in the rendered code element's text nodes
    const textNodes = [];
    let pos = 0;
    const walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        textNodes.push({ node, start: pos, end: pos + node.length });
        pos += node.length;
    }

    const srcEnd = srcStart + selectedText.length;
    let firstMark = null;

    for (const tn of textNodes) {
        if (tn.end <= srcStart || tn.start >= srcEnd) continue;
        const localStart = Math.max(0, srcStart - tn.start);
        const localEnd   = Math.min(tn.node.length, srcEnd - tn.start);
        const content    = tn.node.textContent;

        const frag = document.createDocumentFragment();
        if (localStart > 0) frag.appendChild(document.createTextNode(content.slice(0, localStart)));
        const mark = document.createElement('mark');
        mark.className = 'hl-compose-sel';
        mark.textContent = content.slice(localStart, localEnd);
        frag.appendChild(mark);
        if (localEnd < content.length) frag.appendChild(document.createTextNode(content.slice(localEnd)));
        tn.node.parentNode.replaceChild(frag, tn.node);
        if (!firstMark) firstMark = mark;
    }

    if (firstMark) firstMark.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function switchReMode(field, mode, wrap) {
    const reg = reRegistry[field];
    if (!reg) return;
    const { compose, htmlWrap, htmlCode, preview, bodyArea } = reg;
    const toolbar = wrap.querySelector('.re-toolbar');

    // Save selected text AND its start offset in compose's plain text
    let selectedText = '';
    let selStartOffset = -1;
    if (reg.mode === 'compose') {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && compose.contains(sel.anchorNode)) {
            selectedText = sel.toString();
            if (selectedText) {
                // Get character offset of selection start within compose plain text
                try {
                    const range = sel.getRangeAt(0);
                    const pre = range.cloneRange();
                    pre.selectNodeContents(compose);
                    pre.setEnd(range.startContainer, range.startOffset);
                    selStartOffset = pre.toString().length;
                } catch(e) {}
            }
        }
    }

    // Sync leaving mode → save plain HTML text
    if (reg.mode === 'compose') {
        const raw = compose.innerHTML;
        const formatted = formatHtmlSource(raw);
        setHtmlCodeText(htmlCode, formatted);
        renderHtmlHighlight(field);
    } else if (reg.mode === 'html') {
        // Read the raw HTML source text the user typed/edited
        const raw = getCodeRawText(htmlCode);
        // Set as innerHTML so the browser parses entities and tags correctly
        compose.innerHTML = raw;
    }

    reg.mode = mode;

    compose.classList.toggle('hidden', mode !== 'compose');
    htmlWrap.classList.toggle('hidden', mode !== 'html');
    preview.classList.toggle('hidden', mode !== 'preview');
    toolbar.classList.toggle('hidden', mode !== 'compose');

    if (mode === 'html') {
        renderHtmlHighlight(field);
        syncGutter(field);
        if (selectedText.trim()) {
            requestAnimationFrame(() => highlightSelectionInHtml(htmlCode, selectedText, selStartOffset, compose.innerHTML));
        }
        htmlCode.focus();
    }
    if (mode === 'preview') {
        const src = compose.innerHTML || htmlCode.textContent || '';
        preview.innerHTML = src.trim() || '<span style="color:#9ca3af;font-size:13px;font-style:italic">Nothing to preview.</span>';
        renderKatex(preview);
    }
    if (mode === 'compose') compose.focus();

    wrap.querySelectorAll('.re-mode-tab').forEach(t =>
        t.classList.toggle('active', t.getAttribute('data-mode') === mode)
    );
}

// Pretty-print HTML: every tag on its own line with indent tracking
function formatHtmlSource(html) {
    if (!html) return '';
    return html
        .replace(/<div><br\s*\/?><\/div>/gi, '')
        .replace(/<div>([\s\S]*?)<\/div>/gi, '$1')
        .replace(/<br\s*\/?>/gi, '')
        .replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, '$1')
        .replace(/&nbsp;/gi, ' ')
        .trim();
}

function updateToolbarState(toolbar, compose) {
    ['bold','italic','underline','strikeThrough','superscript','subscript',
     'insertUnorderedList','insertOrderedList'].forEach(cmd => {
        const btn = toolbar.querySelector(`[data-cmd="${cmd}"]`);
        if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
    });
    // Sync heading select
    const sel = toolbar.querySelector('.re-heading-select');
    if (sel) {
        const block = document.queryCommandValue('formatBlock').toLowerCase().replace(/^<|>$/g, '') || 'div';
        sel.value = ['h1','h2','h3','h4','h5'].includes(block) ? block : 'div';
    }
}

function setHtmlCodeText(htmlCode, text) {
    // Set literal source text into the syntax-highlighted contenteditable
    // Using textContent avoids browser re-encoding entities
    htmlCode.innerHTML = '';
    htmlCode.appendChild(document.createTextNode(text));
}

function getReValue(field) {
    const reg = reRegistry[field];
    if (!reg) return '';
    if (reg.mode === 'html') return reg.htmlCode.textContent || '';
    return reg.compose.innerHTML;
}

function setReValue(field, html) {
    const reg = reRegistry[field];
    if (!reg) return;
    reg.compose.innerHTML = html || '';
    setHtmlCodeText(reg.htmlCode, formatHtmlSource(html || ''));
    renderHtmlHighlight(field);
    if (reg.mode === 'preview') { reg.preview.innerHTML = html || ''; renderKatex(reg.preview); }
}

// ---- Open / Close / Save ----

function openQEditor(idx) {
    qEditorIdx = idx;
    qEditorLang = 'en';
    const post = editorBaseData.posts[idx];
    const meta = post.meta_input || {};
    const bilingual = editorIsBilingual();
    const soleLang = _editorLangs[0] || 'en';

    document.getElementById('qe-q-number').textContent = `#${idx + 1} of ${editorBaseData.posts.length}`;

    // Build rich editors (rebuild each open to reset state)
    document.querySelectorAll('#q-editor-panel .rich-editor-wrap').forEach(wrap => {
        buildRichEditor(wrap);
    });

    const correctAnswers = meta._aimcq_correct_answers || [0];

    // The primary ('en') panel always edits the PRIMARY fields. For a single-
    // language file that is the sole language's content (English OR Hindi);
    // for a bilingual file it is the English side.
    setReValue('en-question',    post.post_content || post.post_title || '');
    setReValue('en-explanation', meta._aimcq_explanation || '');
    const enOptions = meta._aimcq_options || [];
    renderOptionRows('qe-en-options', enOptions, correctAnswers, 'en');

    if (bilingual) {
        setReValue('hi-question',    meta._aimcq_question_content_hi || meta._aimcq_title_hi || '');
        setReValue('hi-explanation', meta._aimcq_explanation_hi || '');
        const hiOptions = meta._aimcq_options_hi || [];
        const hiOpts = hiOptions.length ? hiOptions : enOptions.map(() => ({ text: '', image: '' }));
        renderOptionRows('qe-hi-options', hiOpts, correctAnswers, 'hi');
    }

    editorConfigureQEditorLangUI(bilingual, soleLang);
    switchQEditorLang('en');
    document.getElementById('q-editor-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    lucide.createIcons();
}

// Configure the modal's language tabs + section labels for the current file.
// Bilingual → both tabs (English / हिन्दी). Single → one tab, labelled with
// that language, Hindi panel hidden. (The single editor always uses the
// primary 'en' panel, which holds the sole language's content.)
function editorConfigureQEditorLangUI(bilingual, soleLang) {
    const tabEn = document.getElementById('qe-tab-en');
    const tabHi = document.getElementById('qe-tab-hi');
    const labels = document.querySelectorAll('#qe-panel-en .q-editor-section-label');
    const isHiSingle = !bilingual && soleLang === 'hi';

    if (tabHi) tabHi.style.display = bilingual ? '' : 'none';
    if (tabEn) {
        tabEn.innerHTML = isHiSingle ? '🇮🇳 हिन्दी' : '🇬🇧 English';
        // In single-language mode the lone tab is just a label, not a switch.
        tabEn.style.pointerEvents = bilingual ? '' : 'none';
        tabEn.style.cursor = bilingual ? '' : 'default';
    }
    // Section labels inside the primary panel: [Question, Options, Explanation]
    if (labels && labels.length >= 3) {
        if (isHiSingle) {
            labels[0].textContent = 'प्रश्न (हिन्दी)';
            labels[1].textContent = 'विकल्प (हिन्दी)';
            labels[2].textContent = 'व्याख्या (हिन्दी)';
        } else {
            labels[0].textContent = 'Question (English)';
            labels[1].textContent = 'Options (English)';
            labels[2].textContent = 'Explanation (English)';
        }
    }
}

function renderOptionRows(containerId, options, correctAnswers, lang) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const isHi = lang === 'hi';

    options.forEach((opt, i) => {
        const isCorrect = correctAnswers.includes(i);
        const letter = OPTION_LETTERS[i] || String(i + 1);
        const bgHex = OPTION_COLORS[i % OPTION_COLORS.length];
        const uid = `opt-${lang}-${i}`;

        const row = document.createElement('div');
        row.className = 'option-row';
        row.innerHTML = `
            <div class="option-letter text-white flex-shrink-0 mt-1" style="background:${bgHex}">${letter}</div>
            <div class="opt-editor-wrap ${isHi ? 'hi' : ''}" data-opt-idx="${i}" data-lang="${lang}">
                <!-- Floating mini toolbar -->
                <div class="opt-toolbar">
                    <button type="button" class="opt-tb-btn" data-cmd="bold" title="Bold"><b>B</b></button>
                    <button type="button" class="opt-tb-btn" data-cmd="italic" title="Italic"><i style="font-style:italic">I</i></button>
                    <button type="button" class="opt-tb-btn" data-cmd="underline" title="Underline"><u>U</u></button>
                    <div class="opt-tb-sep"></div>
                    <button type="button" class="opt-tb-btn" data-cmd="superscript" title="Superscript" style="font-size:9.5px;letter-spacing:-0.5px">X²</button>
                    <button type="button" class="opt-tb-btn" data-cmd="subscript" title="Subscript" style="font-size:9.5px;letter-spacing:-0.5px">X₂</button>
                    <div class="opt-tb-sep"></div>
                    <div class="opt-latex-wrap">
                        <button type="button" class="opt-latex-btn" title="Insert LaTeX encloser">∑ LaTeX</button>
                        <div class="opt-latex-drop">
                            <div class="opt-latex-drop-header">Math Enclosers</div>
                            <button type="button" class="opt-latex-item" data-delim="dollar"><span class="opt-latex-item-pre">$<em>expr</em>$</span><span class="opt-latex-item-lbl"><code>$...$</code></span></button>
                            <button type="button" class="opt-latex-item" data-delim="paren"><span class="opt-latex-item-pre">\(<em>expr</em>\)</span><span class="opt-latex-item-lbl"><code>\(...\)</code></span></button>
                            <button type="button" class="opt-latex-item" data-delim="bracket"><span class="opt-latex-item-pre">\[<em>expr</em>\]</span><span class="opt-latex-item-lbl"><code>\[...\]</code></span></button>
                            <button type="button" class="opt-latex-item" data-delim="double-dollar"><span class="opt-latex-item-pre">$$<em>expr</em>$$</span><span class="opt-latex-item-lbl"><code>$$...$$</code></span></button>
                        </div>
                    </div>
                </div>
                <!-- Editable content -->
                <div class="opt-compose" contenteditable="true" spellcheck="false"
                     data-placeholder="${isHi ? `विकल्प ${letter}…` : `Option ${letter}…`}"
                     ${isHi ? 'lang="hi"' : ''}
                ></div>
            </div>
            <label class="flex items-center gap-1.5 cursor-pointer flex-shrink-0 mt-1" title="Mark as correct answer">
                <input type="radio" name="qe-correct-${lang}" class="correct-radio" value="${i}" ${isCorrect ? 'checked' : ''}>
                ${isCorrect ? `<span class="correct-badge">✓ Correct</span>` : `<span class="text-xs text-gray-400 font-medium">Correct?</span>`}
            </label>`;
        container.appendChild(row);

        // Set initial content
        const compose = row.querySelector('.opt-compose');
        compose.innerHTML = opt.text || '';

        // Wire toolbar buttons
        const toolbar = row.querySelector('.opt-toolbar');
        toolbar.querySelectorAll('[data-cmd]').forEach(btn => {
            btn.addEventListener('mousedown', e => {
                e.preventDefault();
                compose.focus();
                document.execCommand(btn.getAttribute('data-cmd'), false, null);
                updateOptToolbarState(toolbar, compose);
            });
        });

        // Update toolbar active states on selection change
        compose.addEventListener('keyup',   () => updateOptToolbarState(toolbar, compose));
        compose.addEventListener('mouseup', () => updateOptToolbarState(toolbar, compose));

        // LaTeX toggle
        const latexBtn  = toolbar.querySelector('.opt-latex-btn');
        const latexDrop = toolbar.querySelector('.opt-latex-drop');
        let savedOptSel = null;

        latexBtn.addEventListener('mousedown', e => {
            e.preventDefault();
            e.stopPropagation();
            savedOptSel = saveSelection();
            const isOpen = latexDrop.classList.contains('open');
            // Close all open dropdowns first
            document.querySelectorAll('.re-latex-dropdown:not(.hidden)').forEach(d => d.classList.add('hidden'));
            document.querySelectorAll('.opt-latex-drop.open').forEach(d => d.classList.remove('open'));
            if (!isOpen) {
                const rect = latexBtn.getBoundingClientRect();
                latexDrop.style.top  = (rect.bottom + 4) + 'px';
                latexDrop.style.left = rect.left + 'px';
                latexDrop.classList.add('open');
            }
        });

        toolbar.querySelectorAll('.opt-latex-item').forEach(item => {
            item.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                latexDrop.classList.remove('open');
                compose.focus();
                restoreSelection(savedOptSel);
                insertLatex(compose, item.getAttribute('data-delim'));
            });
        });

        // Close latex drop on outside click
        document.addEventListener('mousedown', e => {
            if (!toolbar.querySelector('.opt-latex-wrap').contains(e.target)) {
                latexDrop.classList.remove('open');
            }
        });
    });

    // Correct answer radio wiring
    container.querySelectorAll(`input[name="qe-correct-${lang}"]`).forEach(radio => {
        radio.addEventListener('change', () => {
            container.querySelectorAll(`input[name="qe-correct-${lang}"]`).forEach(r => {
                const lbl = r.closest('label').querySelector('span');
                if (r.checked) { lbl.className = 'correct-badge'; lbl.textContent = '✓ Correct'; }
                else { lbl.className = 'text-xs text-gray-400 font-medium'; lbl.textContent = 'Correct?'; }
            });
        });
    });
}

function updateOptToolbarState(toolbar, compose) {
    ['bold','italic','underline','superscript','subscript'].forEach(cmd => {
        const btn = toolbar.querySelector(`[data-cmd="${cmd}"]`);
        if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
    });
}

function escapeAttr(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function switchQEditorLang(lang) {
    if (!editorIsBilingual()) lang = 'en';  // single-language → primary panel only
    qEditorLang = lang;
    document.getElementById('qe-panel-en').classList.toggle('hidden', lang !== 'en');
    document.getElementById('qe-panel-hi').classList.toggle('hidden', lang !== 'hi');
    document.getElementById('qe-tab-en').className = 'q-editor-lang-tab' + (lang === 'en' ? ' active' : '');
    document.getElementById('qe-tab-hi').className = 'q-editor-lang-tab' + (lang === 'hi' ? ' active-hi' : '');
}

function saveQEditor() {
    if (qEditorIdx === null || !editorBaseData) return;
    const post = editorBaseData.posts[qEditorIdx];
    if (!post.meta_input) post.meta_input = {};
    const meta = post.meta_input;

    // English
    const enQ = getReValue('en-question');
    post.post_content = enQ;
    post.post_title   = enQ;
    meta._aimcq_explanation = getReValue('en-explanation');

    document.querySelectorAll('#qe-en-options .opt-editor-wrap').forEach(wrap => {
        const i = parseInt(wrap.getAttribute('data-opt-idx'));
        if (!meta._aimcq_options) meta._aimcq_options = [];
        if (!meta._aimcq_options[i]) meta._aimcq_options[i] = { text: '', image: '' };
        meta._aimcq_options[i].text = wrap.querySelector('.opt-compose').innerHTML;
    });

    const checkedEn = document.querySelector('input[name="qe-correct-en"]:checked');
    if (checkedEn) meta._aimcq_correct_answers = [parseInt(checkedEn.value)];

    if (editorIsBilingual()) {
        // Hindi (secondary translation fields)
        const hiQ = getReValue('hi-question');
        meta._aimcq_title_hi             = hiQ;
        meta._aimcq_question_content_hi  = hiQ;
        meta._aimcq_explanation_hi       = getReValue('hi-explanation');

        document.querySelectorAll('#qe-hi-options .opt-editor-wrap').forEach(wrap => {
            const i = parseInt(wrap.getAttribute('data-opt-idx'));
            if (!meta._aimcq_options_hi) meta._aimcq_options_hi = [];
            if (!meta._aimcq_options_hi[i]) meta._aimcq_options_hi[i] = { text: '', image: '' };
            meta._aimcq_options_hi[i].text = wrap.querySelector('.opt-compose').innerHTML;
        });
    } else {
        // Single-language file: no translation fields should linger.
        delete meta._aimcq_title_hi;
        delete meta._aimcq_question_content_hi;
        delete meta._aimcq_explanation_hi;
        delete meta._aimcq_options_hi;
    }

    closeQEditor();
    renderEditorWorkspace();
    updateLiveJsonPreview();
    showToast('Question Saved', `#${qEditorIdx + 1} updated successfully.`, 'success');
}

function closeQEditor() {
    document.getElementById('q-editor-modal').classList.add('hidden');
    document.body.style.overflow = '';
    qEditorIdx = null;
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeQEditor(); });

// ============================================================
// ============================================================
// ==================== FIGURE UPDATER ========================
// ============================================================
// Ports the WordPress "Manual Figure Updater" into a fully
// client-side workflow:
//  - Render an exam PDF (PDF.js) and crop figures (Cropper.js)
//  - Upload crops to Google Drive (multipart upload + public ACL),
//    producing the same drive.google.com/thumbnail?id=... URLs the
//    aimcq plugin uses
//  - Smart-detect questions with [image here: ...] placeholders
//  - Per-figure width/height (defaults 141 x 130) -> _aimcq_image_*
//  - Live question preview
//  - Save the JSON straight back to the linked Drive file (PATCH)
// ============================================================

const FIG_IMG_DEFAULT_W = 141;
const FIG_IMG_DEFAULT_H = 130;
// CSS class the aimcq theme uses to recognise question figures.
const FIG_IMG_CLASS = 'aimcq-question-image';
const FIG_PLACEHOLDER_RE = /\[image here:[^\]]*\]/i;
const FIG_PLACEHOLDER_RE_G = /\[image here:[^\]]*\]/ig;

// NOTE: declared with `var` (not `const`) on purpose. The Google Drive
// boot sequence (driveLoadClientId -> driveUpdateUI -> refreshFigDriveButtons)
// runs earlier in the script than this line, and `var` is hoisted so an
// early reference yields `undefined` instead of a TDZ ReferenceError.
var figState = {
    data: null,            // parsed aimcq JSON
    fileName: '',
    githubFile: null,      // { repo, branch, path, name, sha } when loaded from GitHub
    pdfDoc: null,
    srcType: null,         // 'pdf' | 'image' | null — what's loaded in the canvas
    imgBitmap: null,       // decoded <img> when an image (not PDF) is loaded
    fitDispW: 0,           // canvas CSS display width at 100% zoom (source-agnostic)
    fitDispH: 0,           // canvas CSS display height at 100% zoom
    pageNum: 1,
    scale: 1.0,            // zoom factor relative to fit-width
    fitScale: 1.0,         // PDF-units -> CSS px at 100% (fits container)
    rendering: false,
    pendingPage: null,
    cropper: null,
    cropMode: false,       // crop mode on/off — no auto crop box
    selectedIdx: null,     // index into data.posts
    previewLang: 'en',
    appliedCount: 0,
    // Image hosting: GitHub + jsDelivr.
    github: { repo: '', branch: 'main', path: '', token: '' },
    // Per-question working slots: { q:{url,w,h}, a:{...}, b, c, d }
    slots: {},
    // Sticky "Resize all options" W/H/AR. Once the user applies a global
    // resize it persists here so re-renders don't reset the inputs; cleared
    // when a new question is selected or figures are applied to the question.
    grSticky: null,
};

const FIG_SLOT_KEYS = ['q', 'a', 'b', 'c', 'd'];
const FIG_SLOT_LABELS = { q: 'Question Figure', a: 'Option A', b: 'Option B', c: 'Option C', d: 'Option D' };
const FIG_OPT_INDEX = { a: 0, b: 1, c: 2, d: 3 };

// ---- PDF.js worker ----
// When the page is opened directly from disk (file:// protocol), the
// browser treats it as an opaque origin and blocks the separate PDF.js
// worker script ("Unsafe attempt to load URL..."). In that case we run
// PDF.js on the main thread instead — slightly slower, but it works.
if (typeof pdfjsLib !== 'undefined') {
    const isFileProtocol = location.protocol === 'file:';
    if (isFileProtocol) {
        // Disable the dedicated worker; PDF.js falls back to the main thread.
        try { pdfjsLib.GlobalWorkerOptions.workerSrc = ''; } catch (e) {}
        try { pdfjsLib.GlobalWorkerOptions.workerPort = null; } catch (e) {}
        if (pdfjsLib.GlobalWorkerOptions) {
            // Some builds honour this flag to skip worker creation entirely.
            try { window.pdfjsWorkerDisabled = true; } catch (e) {}
        }
    } else {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
}

// ==================== JSON LOADING ====================
// Load parsed JSON into the Figure Updater.
//  `source` is optional: { type:'github', file }.
function figLoadJsonData(data, fileName, source) {
    if (!isValidAimcqJSON(data)) {
        showToast('Invalid JSON', "File doesn't look like aimcq format (missing 'posts' array).", 'error');
        return;
    }
    figState.data = data;
    figState.fileName = fileName || 'questions.json';
    // Link to GitHub if loaded from there; otherwise unlinked.
    if (source && source.type === 'github') {
        figState.githubFile = source.file;
    } else {
        figState.githubFile = null;
    }
    figState.selectedIdx = null;
    figState.appliedCount = 0;
    figState.slots = {};

    document.getElementById('fig-json-name').textContent =
        `\u2713 ${figState.fileName} \u2014 ${data.posts.length} questions`;
    document.getElementById('fig-json-name').classList.add('text-indigo-700', 'font-bold');
    document.getElementById('fig-step-pdf').classList.remove('hidden');
    document.getElementById('fig-step-save').classList.remove('hidden');
    document.getElementById('fig-q-editor').classList.add('hidden');
    document.getElementById('fig-applied-count').textContent = '0';

    figShowGitHubLink();
    refreshFigGitHubButtons();
    figPopulateTopics();
    figRenderQuestionList();
    lucide.createIcons();
    showToast('JSON Loaded', `${data.posts.length} questions ready for figure updates.`, 'success');
}

// JSON file input + drag/drop
(function wireFigJsonInput() {
    const input = document.getElementById('fig-json-file');
    const zone = document.getElementById('fig-json-dropzone');
    if (!input || !zone) return;

    function handle(file) {
        if (!file) return;
        if (!/\.json$/i.test(file.name)) {
            showToast('Wrong file', 'Please choose a .json file.', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                figLoadJsonData(data, file.name, null);
            } catch (e) {
                showToast('Parse error', 'Could not parse JSON: ' + e.message, 'error');
            }
        };
        reader.readAsText(file);
    }
    input.addEventListener('change', e => handle(e.target.files[0]));
    ['dragenter','dragover','dragleave','drop'].forEach(ev =>
        zone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
    ['dragenter','dragover'].forEach(ev =>
        zone.addEventListener(ev, () => zone.classList.add('drag-active')));
    ['dragleave','drop'].forEach(ev =>
        zone.addEventListener(ev, () => zone.classList.remove('drag-active')));
    zone.addEventListener('drop', e => handle(e.dataTransfer.files[0]));
})();

// ==================== DRIVE LINK (removed — no-op stubs) ====================
function figShowDriveLink() {}
function figUnlinkDrive() {}
function refreshFigDriveButtons() {}

// ==================== GITHUB JSON LINK ====================
function figShowGitHubLink() {
    const row = document.getElementById('fig-github-link-row');
    if (!row) return;
    const f = figState.githubFile;
    if (f && f.path) {
        row.classList.remove('hidden');
        row.classList.add('flex');
        document.getElementById('fig-github-link-name').textContent =
            `${f.repo}@${f.branch}`;
        document.getElementById('fig-github-link-path').textContent = f.path;
    } else {
        row.classList.add('hidden');
        row.classList.remove('flex');
    }
}

function figUnlinkGitHub() {
    figState.githubFile = null;
    figShowGitHubLink();
    refreshFigGitHubButtons();
    showToast('Unlinked', 'GitHub file unlinked. Saves will no longer commit to it.', 'info');
}

// Copy the jsDelivr CDN link of the Figure Updater's linked GitHub JSON.
function figCopyGitHubCdn() {
    const f = figState.githubFile;
    if (!f || !f.path) {
        showToast('No GitHub file', 'Load a JSON from GitHub first.', 'error');
        return;
    }
    ghCopyToClipboard(ghJsonCdnUrl(f.repo, f.branch, f.path), 'jsDelivr CDN link');
}

function refreshFigGitHubButtons() {
    const btn = document.getElementById('fig-update-github-btn');
    if (!btn) return;
    if (typeof figState === 'undefined' || !figState) { btn.classList.add('hidden'); return; }
    const f = figState.githubFile;
    const ok = !!(f && f.path);
    btn.classList.toggle('hidden', !ok);
    if (ok) {
        document.getElementById('fig-update-github-label').textContent =
            `Update to GitHub (${f.name || f.path})`;
    }
}

// ==================== TOPIC FILTER ====================
function figGetPostTopics(post) {
    const tax = post.taxonomies || {};
    const t = tax.topic;
    if (Array.isArray(t)) return t;
    if (typeof t === 'string' && t) return [t];
    return [];
}

function figPopulateTopics() {
    const sel = document.getElementById('fig-topic-filter');
    if (!sel || !figState.data) return;
    const topics = new Set();
    figState.data.posts.forEach(p => figGetPostTopics(p).forEach(t => topics.add(t)));
    sel.innerHTML = '<option value="">All topics</option>' +
        [...topics].sort().map(t => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join('');
}

// ==================== SMART DETECTION ====================
// A question "needs a figure" if any of its text fields contains an
// [image here: ...] placeholder (question content, hindi content, or
// any option text in either language).
function figPostNeedsFigure(post) {
    const meta = post.meta_input || {};
    const fields = [
        post.post_content || '',
        meta._aimcq_question_content_hi || '',
        meta._aimcq_title_hi || '',
    ];
    (meta._aimcq_options || []).forEach(o => fields.push(o && o.text || ''));
    (meta._aimcq_options_hi || []).forEach(o => fields.push(o && o.text || ''));
    return fields.some(f => FIG_PLACEHOLDER_RE.test(f));
}

// A question "has a figure" if any field already contains an aimcq image
// tag, or any option has an image URL.
function figPostHasFigure(post) {
    const meta = post.meta_input || {};
    const txt = (post.post_content || '') + (meta._aimcq_question_content_hi || '');
    if (txt.indexOf(FIG_IMG_CLASS) !== -1) return true;
    const opts = (meta._aimcq_options || []).concat(meta._aimcq_options_hi || []);
    return opts.some(o => o && o.image);
}

function figRenderQuestionList() {
    const list = document.getElementById('fig-q-list');
    if (!list || !figState.data) return;

    const topic = document.getElementById('fig-topic-filter').value;
    const reupdate = document.getElementById('fig-reupdate-mode').checked;
    const search = document.getElementById('fig-q-search').value.toLowerCase().trim();

    const rows = [];
    figState.data.posts.forEach((post, idx) => {
        if (topic && figGetPostTopics(post).indexOf(topic) === -1) return;
        const needs = figPostNeedsFigure(post);
        const has = figPostHasFigure(post);
        if (!reupdate && !needs) return;       // default: only pending
        const title = stripHtmlTags(post.post_title || post.post_content || '').trim();
        if (search && title.toLowerCase().indexOf(search) === -1) return;
        rows.push({ idx, post, needs, has, title });
    });

    if (!rows.length) {
        list.innerHTML = `<div class="py-8 text-center text-gray-400 text-sm">${
            reupdate ? 'No questions match the filter.' : 'No questions have [image here:] placeholders. Enable Re-update mode to edit any question.'
        }</div>`;
        return;
    }

    list.innerHTML = '';
    rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'fig-q-row' + (figState.selectedIdx === r.idx ? ' active' : '');
        const marker = r.needs
            ? '<span class="fig-q-marker need">Needs figure</span>'
            : (r.has ? '<span class="fig-q-marker has">Has figure</span>' : '');
        row.innerHTML = `
            <span class="fig-q-badge${r.has && !r.needs ? ' done' : ''}">Q #${r.idx + 1}</span>
            <span class="fig-q-text">${escapeHtml(r.title || '(no title)')}</span>
            ${marker}
        `;
        row.addEventListener('click', () => figSelectQuestion(r.idx));
        list.appendChild(row);
    });
}

// Wire list controls
(function wireFigListControls() {
    ['fig-topic-filter','fig-reupdate-mode'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', figRenderQuestionList);
    });
    const s = document.getElementById('fig-q-search');
    if (s) s.addEventListener('input', figRenderQuestionList);
})();

// ==================== QUESTION SELECTION ====================
function figGetExistingImage(post) {
    // Pull an existing question image URL + dimensions out of post_content.
    const meta = post.meta_input || {};
    const m = (post.post_content || '').match(
        new RegExp('<img[^>]*class=["\\\']?[^"\\\']*' + FIG_IMG_CLASS + '[^>]*>', 'i'));
    let url = '';
    if (m) {
        const src = m[0].match(/src=["']([^"']+)["']/i);
        if (src) url = src[1].replace(/&amp;/g, '&');
    }
    const w = parseInt(meta._aimcq_image_width, 10) || 0;
    const h = parseInt(meta._aimcq_image_height, 10) || 0;
    return { url, w, h };
}

function figSelectQuestion(idx) {
    figState.selectedIdx = idx;
    const post = figState.data.posts[idx];
    const meta = post.meta_input || {};

    // Initialise slots from any existing figures so re-update keeps current values.
    // Each slot tracks: url (Drive URL), blob/localUrl (local crop pending upload),
    // uploaded flag, w, h, ar (aspect ratio w/h), lock (maintain AR).
    figReleaseSlotBlobs();
    const slots = {};
    const qImg = figGetExistingImage(post);
    slots.q = {
        url: qImg.url, blob: null, localUrl: '', uploaded: !!qImg.url,
        w: qImg.w || FIG_IMG_DEFAULT_W,
        h: qImg.h || FIG_IMG_DEFAULT_H,
        ar: (qImg.w && qImg.h) ? (qImg.w / qImg.h) : (FIG_IMG_DEFAULT_W / FIG_IMG_DEFAULT_H),
        lock: true,
    };
    ['a','b','c','d'].forEach(k => {
        const oi = FIG_OPT_INDEX[k];
        const opt = (meta._aimcq_options || [])[oi];
        const ow = parseInt(opt && opt.image_width, 10) || 0;
        const oh = parseInt(opt && opt.image_height, 10) || 0;
        const ourl = (opt && opt.image) || '';
        slots[k] = {
            url: ourl, blob: null, localUrl: '', uploaded: !!ourl,
            w: ow || FIG_IMG_DEFAULT_W,
            h: oh || FIG_IMG_DEFAULT_H,
            ar: (ow && oh) ? (ow / oh) : (FIG_IMG_DEFAULT_W / FIG_IMG_DEFAULT_H),
            lock: true,
        };
    });
    figState.slots = slots;
    figState.grSticky = null;   // fresh question -> recapture option dims

    document.getElementById('fig-q-editor').classList.remove('hidden');
    document.getElementById('fig-sel-badge').textContent = `Q #${idx + 1}`;
    document.getElementById('fig-sel-title').textContent =
        stripHtmlTags(post.post_title || post.post_content || '').slice(0, 80) || '(untitled)';

    figRenderSlots();
    figRenderQuestionList();   // refresh active highlight
    figRenderPreview();
    document.getElementById('fig-q-editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ==================== FIGURE SLOTS ====================
// Release object URLs for any local crops to avoid memory leaks.
function figReleaseSlotBlobs() {
    if (!figState.slots) return;
    Object.values(figState.slots).forEach(s => {
        if (s && s.localUrl) { try { URL.revokeObjectURL(s.localUrl); } catch (e) {} }
    });
}

// The image source to show in previews: local crop takes priority over
// the (older) Drive URL so the user sees their latest crop immediately.
function figGetSlotImageSrc(slot) {
    if (!slot) return '';
    return slot.localUrl || slot.url || '';
}

// True if a slot has an image (either a pending local crop or an uploaded one).
function figSlotHasImage(slot) {
    return !!(slot && (slot.localUrl || slot.url));
}

// True if a slot has a local crop that still needs uploading.
function figSlotPending(slot) {
    return !!(slot && slot.blob && !slot.uploaded);
}

// Helper: clamp to a sane positive integer.
function figClampDim(v) {
    v = parseInt(v, 10);
    if (!v || v < 1) return 1;
    if (v > 4000) return 4000;
    return v;
}

// Fit a figure inside a W x H bounding box while strictly preserving its
// aspect ratio (ar = naturalWidth / naturalHeight). Returns the largest
// integer {w, h} with w/h == ar that fits within the box. This guarantees
// the stored dimensions never distort the image, even if the user set
// mismatched W/H with the aspect-ratio lock disabled.
function figFitToBox(boxW, boxH, ar) {
    boxW = figClampDim(boxW);
    boxH = figClampDim(boxH);
    if (!ar || ar <= 0) return { w: boxW, h: boxH };
    // Width-constrained candidate
    let w = boxW, h = Math.round(boxW / ar);
    if (h > boxH) {           // too tall -> constrain by height instead
        h = boxH;
        w = Math.round(boxH * ar);
    }
    return { w: Math.max(1, w), h: Math.max(1, h) };
}

// Apply a dimension change to one slot, honouring the aspect-ratio lock.
function figSetSlotDim(key, dim, value) {
    const slot = figState.slots[key];
    if (!slot) return;
    const v = figClampDim(value);
    if (slot.lock && slot.ar > 0) {
        if (dim === 'w') { slot.w = v; slot.h = Math.max(1, Math.round(v / slot.ar)); }
        else             { slot.h = v; slot.w = Math.max(1, Math.round(v * slot.ar)); }
    } else {
        slot[dim] = v;
        // When unlocked, editing keeps ar in sync with the current box.
        if (slot.w > 0 && slot.h > 0) slot.ar = slot.w / slot.h;
    }
}

function figRenderSlots() {
    const grid = document.getElementById('fig-slots-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // ---- Global option-resize bar (applies to options A–D) ----
    // Capture the W/H of the first option that has a crop & set applied,
    // preferring A, then B, C, D. Once the user has applied a global resize
    // (figState.grSticky), keep those values instead of recapturing — they
    // persist until the figures are applied to the question or another
    // question is selected.
    let firstOptSlot = null;
    for (const k of ['a','b','c','d']) {
        const s = figState.slots[k];
        if (s && figSlotHasImage(s)) { firstOptSlot = s; break; }
    }
    const anyOptFilled = !!firstOptSlot;

    let grW0, grH0, grAR;
    if (figState.grSticky) {
        // Sticky: keep the last applied dimensions.
        grW0 = figState.grSticky.w;
        grH0 = figState.grSticky.h;
        grAR = figState.grSticky.ar > 0 ? figState.grSticky.ar : (grW0 / grH0);
    } else if (firstOptSlot) {
        // Auto-capture the chosen option's current dimensions.
        grW0 = firstOptSlot.w || FIG_IMG_DEFAULT_W;
        grH0 = firstOptSlot.h || FIG_IMG_DEFAULT_H;
        grAR = firstOptSlot.ar > 0 ? firstOptSlot.ar : (grW0 / grH0);
    } else {
        // No option figure yet — bar stays disabled with placeholder values.
        grAR = FIG_IMG_DEFAULT_W / FIG_IMG_DEFAULT_H;
        grW0 = FIG_IMG_DEFAULT_W;
        grH0 = FIG_IMG_DEFAULT_H;
    }
    grW0 = Math.max(1, Math.round(grW0));
    grH0 = Math.max(1, Math.round(grH0));

    const grDis = anyOptFilled ? '' : 'disabled';
    const gr = document.createElement('div');
    gr.className = 'fig-global-resize' + (anyOptFilled ? '' : ' disabled');
    gr.style.gridColumn = '1 / -1';   // span the whole grid
    gr.innerHTML = `
        <span class="fig-gr-label">
            <i data-lucide="ruler" class="w-3.5 h-3.5 text-indigo-600"></i>
            Resize all options
        </span>
        <span style="font-size:11px;color:#64748b">W</span>
        <input type="number" class="fig-size-input" id="fig-gr-w" value="${grW0}" min="1" ${grDis}>
        <span style="font-size:11px;color:#64748b">H</span>
        <input type="number" class="fig-size-input" id="fig-gr-h" value="${grH0}" min="1" ${grDis}>
        <button type="button" class="fig-gr-btn" id="fig-gr-apply" ${grDis}>Apply to A–D</button>
        <span style="font-size:10.5px;color:#94a3b8" id="fig-gr-hint">
            ${anyOptFilled
                ? 'W &amp; H stay proportional \u2014 each option keeps its aspect ratio.'
                : 'Crop &amp; set an option figure first to enable this.'}
        </span>
    `;
    grid.appendChild(gr);

    // ---- Per-slot cards ----
    FIG_SLOT_KEYS.forEach(key => {
        const slot = figState.slots[key] ||
            { url: '', blob: null, localUrl: '', uploaded: false,
              w: FIG_IMG_DEFAULT_W, h: FIG_IMG_DEFAULT_H,
              ar: FIG_IMG_DEFAULT_W / FIG_IMG_DEFAULT_H, lock: true };
        if (!figState.slots[key]) figState.slots[key] = slot;
        const filled = figSlotHasImage(slot);
        const pending = figSlotPending(slot);
        const src = figGetSlotImageSrc(slot);
        const el = document.createElement('div');
        el.className = 'fig-slot' + (filled ? ' filled' : '');
        // Status badge: pending local crop vs. already on Drive.
        const statusBadge = pending
            ? '<span class="fig-slot-status pending"><i data-lucide="clock" class="w-3 h-3"></i> Not uploaded</span>'
            : (filled && slot.uploaded
                ? '<span class="fig-slot-status done"><i data-lucide="cloud-check" class="w-3 h-3"></i> On Drive</span>'
                : '');
        el.innerHTML = `
            <div class="fig-slot-label">${FIG_SLOT_LABELS[key]}</div>
            ${filled
                ? `<img src="${escapeAttr(src)}" class="fig-slot-preview" alt="" onerror="this.style.display='none'">`
                : `<div class="fig-slot-placeholder"><i data-lucide="image" class="w-7 h-7"></i></div>`}
            ${statusBadge}
            <button type="button" class="fig-slot-btn fig-slot-btn-crop" data-key="${key}">
                <i data-lucide="${filled ? 'replace' : 'crop'}" class="w-3 h-3"></i> ${filled ? 'Re-crop' : 'Crop & Set'}
            </button>
            <div class="fig-size-row">
                W <input type="number" class="fig-size-input" data-key="${key}" data-dim="w" value="${slot.w}" min="1">
                H <input type="number" class="fig-size-input" data-key="${key}" data-dim="h" value="${slot.h}" min="1">
                <button type="button" class="fig-lock-btn ${slot.lock ? 'locked' : ''}" data-key="${key}"
                    title="${slot.lock ? 'Aspect ratio locked — W and H scale together' : 'Aspect ratio unlocked — W and H independent'}">
                    <i data-lucide="${slot.lock ? 'lock' : 'lock-open'}" class="w-3 h-3"></i> AR
                </button>
            </div>
            ${filled ? `<span class="fig-slot-clear" data-key="${key}" title="Clear"><i data-lucide="x" class="w-3 h-3"></i></span>` : ''}
        `;
        grid.appendChild(el);
    });

    // ---- Wire: crop buttons ----
    grid.querySelectorAll('.fig-slot-btn-crop').forEach(btn => {
        btn.addEventListener('click', () => figCropIntoSlot(btn.getAttribute('data-key')));
    });

    // ---- Wire: per-slot size inputs (aspect-ratio aware) ----
    grid.querySelectorAll('.fig-size-input[data-key]').forEach(inp => {
        inp.addEventListener('input', () => {
            const key = inp.getAttribute('data-key');
            const dim = inp.getAttribute('data-dim');
            if (!figState.slots[key]) return;
            figSetSlotDim(key, dim, inp.value);
            // Reflect the linked dimension back into its sibling input.
            const slot = figState.slots[key];
            const card = inp.closest('.fig-slot');
            const wIn = card.querySelector('[data-dim="w"]');
            const hIn = card.querySelector('[data-dim="h"]');
            if (document.activeElement !== wIn) wIn.value = slot.w;
            if (document.activeElement !== hIn) hIn.value = slot.h;
            figRenderPreview();
        });
    });

    // ---- Wire: per-slot AR lock toggle ----
    grid.querySelectorAll('.fig-lock-btn[data-key]').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-key');
            const slot = figState.slots[key];
            if (!slot) return;
            slot.lock = !slot.lock;
            if (slot.lock && slot.w > 0 && slot.h > 0) slot.ar = slot.w / slot.h;
            figRenderSlots();
        });
    });

    // ---- Wire: clear buttons ----
    grid.querySelectorAll('.fig-slot-clear').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-key');
            const old = figState.slots[key];
            if (old && old.localUrl) { try { URL.revokeObjectURL(old.localUrl); } catch (e) {} }
            figState.slots[key] = {
                url: '', blob: null, localUrl: '', uploaded: false,
                w: FIG_IMG_DEFAULT_W, h: FIG_IMG_DEFAULT_H,
                ar: FIG_IMG_DEFAULT_W / FIG_IMG_DEFAULT_H, lock: true,
            };
            figRenderSlots();
            figRenderPreview();
        });
    });

    // ---- Wire: global option resize (linked, always aspect-ratio safe) ----
    // The two inputs stay proportional through a single reference ratio:
    // editing width recomputes height, editing height recomputes width, and
    // the result is written straight back into the sibling input.
    const grW = document.getElementById('fig-gr-w');
    const grH = document.getElementById('fig-gr-h');
    if (grW) {
        grW.addEventListener('input', () => {
            const w = figClampDim(grW.value);
            if (grH) grH.value = Math.max(1, Math.round(w / grAR));
        });
    }
    if (grH) {
        grH.addEventListener('input', () => {
            const h = figClampDim(grH.value);
            if (grW) grW.value = Math.max(1, Math.round(h * grAR));
        });
    }

    const grApply = document.getElementById('fig-gr-apply');
    if (grApply) grApply.addEventListener('click', figApplyGlobalOptionSize);

    lucide.createIcons();
}

// Apply a global resize to every option slot A–D that has a figure set.
// Aspect ratio is ALWAYS preserved: the chosen width is applied to each
// option and that option's height is derived from its own aspect ratio, so
// no figure is ever distorted. Width drives; height follows. (The W/H inputs
// are kept proportional in the UI, so setting either one yields this width.)
function figApplyGlobalOptionSize() {
    const w = figClampDim(document.getElementById('fig-gr-w').value);
    const h = figClampDim(document.getElementById('fig-gr-h').value);

    let touched = 0;
    ['a','b','c','d'].forEach(key => {
        const slot = figState.slots[key];
        if (!slot || !figSlotHasImage(slot)) return;   // only resize set options
        const ar = slot.ar > 0 ? slot.ar : (FIG_IMG_DEFAULT_W / FIG_IMG_DEFAULT_H);
        slot.w = w;
        slot.h = Math.max(1, Math.round(w / ar));
        slot.lock = true;            // keep each option's aspect ratio locked
        touched++;
    });

    if (!touched) {
        showToast('No option figures',
            'Crop & set at least one option figure first.', 'error');
        return;
    }

    // Make the applied dimensions sticky so re-renders keep showing them
    // (until the figures are applied to the question / a new question opens).
    figState.grSticky = { w, h, ar: (h > 0 ? w / h : 1) };

    figRenderSlots();
    figRenderPreview();
    showToast('Options resized',
        `Width ${w}px applied to all set options (aspect ratio kept).`, 'success');
}

// Returns a canvas containing exactly the user's crop selection, at the
// true pixel dimensions of the selected area — or null (with a toast) if
// crop mode is off or no area has been selected yet.
function figGetCropCanvas() {
    if (!figState.cropMode || !figState.cropper) {
        showToast('Crop mode off',
            'Click "Enable Crop" in the PDF toolbar, then drag to select an area.', 'error');
        return null;
    }
    // With autoCrop:false, getData() width/height are 0 until the user drags.
    const data = figState.cropper.getData(true);   // rounded
    if (!data || data.width < 2 || data.height < 2) {
        showToast('No selection',
            'Drag on the PDF to select a crop area first.', 'error');
        return null;
    }
    // getData() is in natural (source bitmap) pixels — passing those exact
    // width/height to getCroppedCanvas() yields a 1:1 crop with no scaling.
    const out = figState.cropper.getCroppedCanvas({
        width: Math.round(data.width),
        height: Math.round(data.height),
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
    });
    if (!out || !out.width || !out.height) {
        showToast('Invalid crop', 'The crop area is empty.', 'error');
        return null;
    }
    return out;
}

// Crop the current PDF selection LOCALLY into a slot — no upload yet.
// The cropped image is held as a Blob (slot.blob) with a local preview
// URL (slot.localUrl). It is uploaded only when the user clicks
// "Apply Figures to This Question".
function figCropIntoSlot(key) {
    const canvas = figGetCropCanvas();
    if (!canvas) return;

    const slot = figState.slots[key];
    if (!slot) return;

    // Release any previous local preview URL for this slot.
    if (slot.localUrl) { try { URL.revokeObjectURL(slot.localUrl); } catch (e) {} }

    canvas.toBlob(blob => {
        if (!blob) { showToast('Crop failed', 'Could not capture the crop.', 'error'); return; }

        // Store the crop locally. `url` is cleared so apply knows it
        // still needs uploading.
        slot.blob = blob;
        slot.localUrl = URL.createObjectURL(blob);
        slot.url = '';                 // no hosted URL yet
        slot.uploaded = false;

        // The crop canvas is the EXACT selected area, so its width/height
        // are the true pixel dimensions of what the user selected.
        const natW = canvas.width || FIG_IMG_DEFAULT_W;
        const natH = canvas.height || FIG_IMG_DEFAULT_H;
        slot.ar = natW > 0 && natH > 0 ? (natW / natH) : (FIG_IMG_DEFAULT_W / FIG_IMG_DEFAULT_H);

        // Default display size: use the crop's exact pixel dimensions so
        // "crop exact same dimension of selected area" holds out of the box.
        // The user can still resize afterwards via the slot W/H controls.
        slot.w = natW;
        slot.h = natH;

        figRenderSlots();
        figRenderPreview();
        showToast('Cropped',
            `${FIG_SLOT_LABELS[key]} cropped at ${natW}\u00d7${natH}px (exact selection). ` +
            `Resize if needed, then "Apply" to upload.`,
            'success');
    }, 'image/webp', 0.95);
}

// ==================== PDF RENDERING + CROPPER ====================
(function wireFigPdfInput() {
    const input = document.getElementById('fig-pdf-file');
    if (!input) return;
    input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.type !== 'application/pdf') {
            showToast('Wrong file', 'Please upload a PDF.', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = function () {
            // On file:// the dedicated worker is blocked — run on main thread.
            const docParams = { data: new Uint8Array(this.result) };
            if (location.protocol === 'file:') docParams.disableWorker = true;
            pdfjsLib.getDocument(docParams).promise.then(doc => {
                figState.pdfDoc = doc;
                figState.imgBitmap = null;
                figState.srcType = 'pdf';
                figState.pageNum = 1;
                figState.scale = 1.0;
                figState.cropMode = false;
                document.getElementById('fig-total-pages').textContent = doc.numPages;
                document.getElementById('fig-source-pick').classList.add('hidden');
                document.getElementById('fig-workspace').classList.remove('hidden');
                document.getElementById('fig-img-file').value = '';
                figRenderPdfPage(1);
                figSetCropMode(false);   // start with crop OFF, freely scrollable
            }).catch(err => {
                showToast('PDF error', err.message || 'Could not open PDF.', 'error');
            });
        };
        reader.readAsArrayBuffer(file);
    });
})();

// ---- Image input: load an image into the same crop workspace ----
(function wireFigImageInput() {
    const input = document.getElementById('fig-img-file');
    if (!input) return;
    input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        if (!/^image\//.test(file.type)) {
            showToast('Wrong file', 'Please upload an image file.', 'error');
            return;
        }
        figState.scale = 1.0;
        figState.cropMode = false;
        document.getElementById('fig-source-pick').classList.add('hidden');
        document.getElementById('fig-workspace').classList.remove('hidden');
        document.getElementById('fig-pdf-file').value = '';
        figRenderImage(file);
        figSetCropMode(false);   // start with crop OFF, freely scrollable
    });
})();

// Render a PDF page. The canvas is rasterised once at a high fixed
// resolution; zoom is applied purely via CSS width/height so zooming
// in/out is instant and the scroll container handles overflow.
function figRenderPdfPage(num) {
    if (!figState.pdfDoc) return;
    figState.srcType = 'pdf';
    figState.imgBitmap = null;
    figState.rendering = true;
    const canvas = document.getElementById('fig-pdf-canvas');
    const ctx = canvas.getContext('2d');

    figState.pdfDoc.getPage(num).then(page => {
        const scroll = document.getElementById('fig-pdf-scroll');
        const containerWidth = Math.max(scroll.clientWidth - 4, 200);
        const unscaled = page.getViewport({ scale: 1 });

        // fitScale: CSS px per PDF unit so the page fills the viewport at 100%.
        figState.fitScale = containerWidth / unscaled.width;

        // Rasterise at a generous fixed resolution so the page stays
        // sharp even when zoomed in. Independent of figState.scale.
        const RASTER = 2.5;
        const renderViewport = page.getViewport({ scale: figState.fitScale * RASTER });
        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;

        // Display size at 100% zoom (canvas is RASTER× the on-screen size).
        figState.fitDispW = canvas.width / RASTER;
        figState.fitDispH = canvas.height / RASTER;

        // Destroy any cropper before re-rendering the bitmap.
        if (figState.cropper) { figState.cropper.destroy(); figState.cropper = null; }

        page.render({ canvasContext: ctx, viewport: renderViewport }).promise.then(() => {
            figState.rendering = false;
            figApplyZoom();                 // sets CSS size from figState.scale
            if (figState.cropMode) figEnableCropper();
            if (figState.pendingPage !== null) {
                const p = figState.pendingPage;
                figState.pendingPage = null;
                figRenderPdfPage(p);
            }
        });
    });
    document.getElementById('fig-cur-page').textContent = num;
    figUpdateSourceNav();
}

// Render an uploaded image onto the same canvas the cropper uses. The canvas
// is kept at the image's native resolution so crops are pixel-exact; zoom is
// applied purely via CSS, exactly like the PDF path.
function figRenderImage(file) {
    const canvas = document.getElementById('fig-pdf-canvas');
    if (!canvas) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
        const natW = img.naturalWidth || 1;
        const natH = img.naturalHeight || 1;

        // Canvas at native resolution -> crisp crops at full quality.
        canvas.width = natW;
        canvas.height = natH;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, natW, natH);
        ctx.drawImage(img, 0, 0, natW, natH);
        URL.revokeObjectURL(url);

        // Fit to the viewport width at 100%, but never upscale a small image.
        const scroll = document.getElementById('fig-pdf-scroll');
        const containerWidth = Math.max(scroll.clientWidth - 4, 200);
        figState.fitDispW = Math.min(natW, containerWidth);
        figState.fitDispH = figState.fitDispW * (natH / natW);

        figState.srcType = 'image';
        figState.imgBitmap = img;
        figState.pdfDoc = null;
        figState.pageNum = 1;
        figState.rendering = false;

        if (figState.cropper) { figState.cropper.destroy(); figState.cropper = null; }
        figApplyZoom();
        if (figState.cropMode) figEnableCropper();

        document.getElementById('fig-cur-page').textContent = '1';
        document.getElementById('fig-total-pages').textContent = '1';
        figUpdateSourceNav();
    };
    img.onerror = function () {
        URL.revokeObjectURL(url);
        showToast('Image error', 'Could not load that image file.', 'error');
    };
    img.src = url;
}

// Enable/disable page navigation depending on the loaded source. Images are
// single-"page", so prev/next are disabled for them.
function figUpdateSourceNav() {
    const isImg = figState.srcType === 'image';
    const prev = document.getElementById('fig-prev-page');
    const next = document.getElementById('fig-next-page');
    if (prev) prev.disabled = isImg;
    if (next) next.disabled = isImg;
}

// True when any croppable source (PDF page or image) is loaded.
function figHasSource() {
    return !!(figState.pdfDoc || figState.imgBitmap);
}

// Apply the current zoom level to the canvas via CSS sizing. Works for both
// PDF pages and images — figState.fitDispW/H hold the 100%-zoom display size.
function figApplyZoom() {
    const canvas = document.getElementById('fig-pdf-canvas');
    if (!canvas || !figHasSource()) return;
    const dispW = Math.max(1, Math.round(figState.fitDispW * figState.scale));
    const dispH = Math.max(1, Math.round(figState.fitDispH * figState.scale));
    canvas.style.width = dispW + 'px';
    canvas.style.height = dispH + 'px';
    document.getElementById('fig-zoom-val').value = Math.round(figState.scale * 100) + '%';

    // If crop mode is active, the cropper must track the new size.
    if (figState.cropMode && figState.cropper) {
        const data = figState.cropper.getData();   // preserve selection
        figEnableCropper(data);
    }
}

// Turn on Cropper.js. No auto crop box — the user drags to select.
// `keepData` (optional) restores a previous selection across a rebuild.
function figEnableCropper(keepData) {
    const canvas = document.getElementById('fig-pdf-canvas');
    if (!canvas) return;
    if (figState.cropper) { figState.cropper.destroy(); figState.cropper = null; }
    figState.cropper = new Cropper(canvas, {
        viewMode: 1,
        dragMode: 'crop',       // dragging on the image draws a crop box
        autoCrop: false,        // <-- no auto-selected area
        movable: false, zoomable: false, rotatable: false, scalable: false,
        background: false,
        checkCrossOrigin: false,
        ready() {
            if (keepData) {
                try { figState.cropper.setData(keepData); } catch (e) {}
            }
        },
    });
}

// Turn off Cropper.js — page is freely scrollable/zoomable.
function figDisableCropper() {
    if (figState.cropper) { figState.cropper.destroy(); figState.cropper = null; }
}

// Toggle crop mode on/off and update the menu UI.
function figSetCropMode(on) {
    figState.cropMode = !!on;
    const btn = document.getElementById('fig-crop-toggle');
    const label = document.getElementById('fig-crop-toggle-label');
    const hint = document.getElementById('fig-crop-hint');

    if (figState.cropMode) {
        btn.classList.add('active');
        label.textContent = 'Crop: ON';
        if (hint) hint.innerHTML =
            '<i data-lucide="info" class="w-3 h-3"></i> ' +
            'Crop mode is <b>on</b> — drag on the page to select an area, then use ' +
            '<b>Crop &amp; Set</b> or <b>Crop &amp; Upload</b>.';
        figEnableCropper();
    } else {
        btn.classList.remove('active');
        label.textContent = 'Enable Crop';
        if (hint) hint.innerHTML =
            '<i data-lucide="info" class="w-3 h-3"></i> ' +
            'Crop mode is <b>off</b> — scroll and zoom freely. Click <b>Enable Crop</b> to select an area.';
        figDisableCropper();
    }
    lucide.createIcons();
}

function figQueuePdfPage(num) {
    if (figState.rendering) figState.pendingPage = num;
    else figRenderPdfPage(num);
}

(function wireFigPdfNav() {
    document.getElementById('fig-prev-page').addEventListener('click', () => {
        if (figState.pageNum > 1) { figState.pageNum--; figQueuePdfPage(figState.pageNum); }
    });
    document.getElementById('fig-next-page').addEventListener('click', () => {
        if (figState.pdfDoc && figState.pageNum < figState.pdfDoc.numPages) {
            figState.pageNum++; figQueuePdfPage(figState.pageNum);
        }
    });
    // Zoom in/out just re-applies CSS sizing — instant, scroll handles overflow.
    document.getElementById('fig-zoom-in').addEventListener('click', () => {
        figState.scale = Math.min(figState.scale + 0.25, 6);
        figApplyZoom();
    });
    document.getElementById('fig-zoom-out').addEventListener('click', () => {
        figState.scale = Math.max(figState.scale - 0.25, 0.25);
        figApplyZoom();
    });
    document.getElementById('fig-zoom-reset').addEventListener('click', () => {
        figState.scale = 1.0;
        figApplyZoom();
    });
    // Ctrl/Cmd + mouse wheel zooms the PDF.
    const scrollEl = document.getElementById('fig-pdf-scroll');
    if (scrollEl) {
        scrollEl.addEventListener('wheel', e => {
            if (!(e.ctrlKey || e.metaKey) || !figHasSource()) return;
            e.preventDefault();
            const step = e.deltaY < 0 ? 0.2 : -0.2;
            figState.scale = Math.min(6, Math.max(0.25, figState.scale + step));
            figApplyZoom();
        }, { passive: false });
    }
    // Crop mode toggle.
    document.getElementById('fig-crop-toggle').addEventListener('click', () => {
        figSetCropMode(!figState.cropMode);
    });
    document.getElementById('fig-pdf-change').addEventListener('click', () => {
        figDisableCropper();
        figState.pdfDoc = null;
        figState.imgBitmap = null;
        figState.srcType = null;
        figState.cropMode = false;
        document.getElementById('fig-workspace').classList.add('hidden');
        document.getElementById('fig-source-pick').classList.remove('hidden');
        document.getElementById('fig-pdf-file').value = '';
        document.getElementById('fig-img-file').value = '';
    });
})();

// ==================== IMAGE HOSTING ====================
// Cropped figures are hosted on GitHub + jsDelivr (no rate limits).

const FIG_GH_KEY = 'fig_github_cfg';

// Generic upload entry point used by crop/apply/quick-upload.
// Returns a public jsDelivr image URL.
async function figUploadImage(blob, fileName, mimeType) {
    return figUploadImageToGitHub(blob, fileName);
}

// ---- GitHub + jsDelivr ----
// Commits the image to a GitHub repo via the Contents API, then returns
// a jsDelivr CDN URL (cdn.jsdelivr.net) which has no rate limits and is
// globally cached.
async function figUploadImageToGitHub(blob, fileName) {
    const cfg = figState.github || {};
    if (!cfg.repo || !cfg.token) {
        throw new Error('GitHub hosting is not configured. Open the Image Hosting ' +
            'panel and set a repository + access token.');
    }
    if (!/^[^/\s]+\/[^/\s]+$/.test(cfg.repo.trim())) {
        throw new Error('GitHub repository must be in "owner/repo" format.');
    }

    const repo = cfg.repo.trim();
    const branch = (cfg.branch || 'main').trim();
    const folder = (cfg.path || '').trim().replace(/^\/+|\/+$/g, '');
    const path = (folder ? folder + '/' : '') + fileName;

    // Convert the blob to base64 (GitHub Contents API expects base64).
    const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
            const s = String(r.result);
            resolve(s.slice(s.indexOf(',') + 1));
        };
        r.onerror = () => reject(new Error('Could not read image data.'));
        r.readAsDataURL(blob);
    });

    const apiUrl = `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}`;
    const resp = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': 'Bearer ' + cfg.token,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: 'Add MCQ figure ' + fileName,
            content: base64,
            branch: branch,
        }),
    });

    if (!resp.ok) {
        let msg = 'HTTP ' + resp.status;
        try { const j = await resp.json(); msg = j.message || msg; } catch (e) {}
        if (resp.status === 401) {
            throw new Error('GitHub rejected the token (401). Check the Personal Access Token.');
        }
        if (resp.status === 404) {
            throw new Error('GitHub repo or branch not found (404): ' + repo + '@' + branch +
                '. Check the repository name and that the token can access it.');
        }
        if (resp.status === 422) {
            throw new Error('GitHub upload failed (422) — the file may already exist. ' + msg);
        }
        throw new Error('GitHub upload failed: ' + msg);
    }

    // Build the jsDelivr CDN URL — no rate limits, globally cached.
    // Form: https://cdn.jsdelivr.net/gh/owner/repo@branch/path
    return `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${encodeURI(path)}`;
}

// ==================== IMAGE HOSTING (GitHub config) ====================

// Read the GitHub image-hosting fields into figState.github and persist.
function figReadGitHubInputs() {
    figState.github = {
        repo:   (document.getElementById('fig-gh-repo').value || '').trim(),
        branch: (document.getElementById('fig-gh-branch').value || 'main').trim() || 'main',
        path:   (document.getElementById('fig-gh-path').value || '').trim(),
        token:  (document.getElementById('fig-gh-token').value || '').trim(),
    };
}

function figSaveGitHubConfig() {
    try { localStorage.setItem(FIG_GH_KEY, JSON.stringify(figState.github)); } catch (e) {}
}

function figSetGitHubStatus(msg, kind) {
    const el = document.getElementById('fig-gh-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'text-xs ' + (
        kind === 'ok'  ? 'text-green-700 font-semibold' :
        kind === 'err' ? 'text-red-600 font-semibold' : 'text-amber-700');
}

// Validate the GitHub repo + token by querying the repository.
async function figVerifyGitHubConfig() {
    figReadGitHubInputs();
    const c = figState.github;
    if (!c.repo || !c.token) {
        figSetGitHubStatus('Repository and access token are both required.', 'err');
        return;
    }
    if (!/^[^/\s]+\/[^/\s]+$/.test(c.repo)) {
        figSetGitHubStatus('Repository must be in "owner/repo" format (e.g. myname/mcq-images).', 'err');
        return;
    }
    const btn = document.getElementById('fig-gh-save');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Verifying...';
    lucide.createIcons();
    try {
        const resp = await fetch(`https://api.github.com/repos/${c.repo}`, {
            headers: {
                'Authorization': 'Bearer ' + c.token,
                'Accept': 'application/vnd.github+json',
            },
        });
        if (resp.status === 401) { figSetGitHubStatus('Token rejected (401). Check the Personal Access Token.', 'err'); return; }
        if (resp.status === 404) { figSetGitHubStatus('Repository not found (404). Check the name and token access.', 'err'); return; }
        if (!resp.ok) { figSetGitHubStatus('GitHub returned HTTP ' + resp.status + '.', 'err'); return; }
        const repo = await resp.json();
        const canWrite = repo.permissions && repo.permissions.push;
        figSaveGitHubConfig();
        if (canWrite === false) {
            figSetGitHubStatus('\u26a0 Connected, but the token may lack write access ("public_repo" / "repo" scope).', 'err');
        } else {
            figSetGitHubStatus(`\u2713 Verified \u2014 figures will be committed to ${c.repo}@${c.branch}` +
                `${c.path ? ' /' + c.path : ''} and served via jsDelivr CDN.`, 'ok');
            showToast('GitHub ready', 'Figures will be hosted on GitHub + jsDelivr.', 'success');
        }
    } catch (err) {
        figSetGitHubStatus('Could not reach GitHub: ' + (err.message || String(err)), 'err');
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
        lucide.createIcons();
    }
}

function figClearGitHubConfig() {
    figState.github = { repo: '', branch: 'main', path: '', token: '' };
    try { localStorage.removeItem(FIG_GH_KEY); } catch (e) {}
    ['fig-gh-repo','fig-gh-path','fig-gh-token'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('fig-gh-branch').value = 'main';
    figSetGitHubStatus('GitHub configuration cleared.', '');
    showToast('Cleared', 'GitHub hosting configuration removed.', 'info');
}

// Load any saved GitHub hosting config on boot.
function figLoadHostingConfig() {
    try {
        const raw = localStorage.getItem(FIG_GH_KEY);
        if (raw) {
            const c = JSON.parse(raw);
            figState.github = {
                repo: c.repo || '', branch: c.branch || 'main',
                path: c.path || '', token: c.token || '',
            };
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
            set('fig-gh-repo', figState.github.repo);
            set('fig-gh-branch', figState.github.branch);
            set('fig-gh-path', figState.github.path);
            set('fig-gh-token', figState.github.token);
            if (figState.github.repo && figState.github.token) {
                figSetGitHubStatus(`Saved config for ${figState.github.repo}@${figState.github.branch}.`, 'ok');
            }
        }
    } catch (e) { /* ignore */ }
}

// Wire the GitHub hosting controls.
(function wireFigHostingControls() {
    const ghSave = document.getElementById('fig-gh-save');
    const ghClear = document.getElementById('fig-gh-clear');
    if (ghSave) ghSave.addEventListener('click', figVerifyGitHubConfig);
    if (ghClear) ghClear.addEventListener('click', figClearGitHubConfig);
    ['fig-gh-repo','fig-gh-branch','fig-gh-path','fig-gh-token'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            figReadGitHubInputs();
            figSaveGitHubConfig();
        });
    });
    figLoadHostingConfig();
})();

// ==================== QUICK CROP & UPLOAD ====================
// Returns '' if GitHub image hosting is configured, else an error string.
function figHostReady() {
    const c = figState.github || {};
    if (!c.repo || !c.token) {
        return 'GitHub hosting is not configured. Open the Image Hosting panel ' +
            'above and set a repository and access token.';
    }
    return '';
}

async function figQuickUpload() {
    const canvas = figGetCropCanvas();
    if (!canvas) return;

    const notReady = figHostReady();
    if (notReady) { showToast('Hosting not set up', notReady, 'error'); return; }

    const btn = document.getElementById('fig-quick-upload');
    const result = document.getElementById('fig-quick-result');
    const origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Uploading...';
    lucide.createIcons();

    try {
        const blob = await new Promise(res => canvas.toBlob(res, 'image/webp', 0.95));
        const url = await figUploadImage(blob,
            `mcq-crop-${Date.now()}.webp`, 'image/webp');
        result.classList.remove('hidden');
        result.innerHTML = `
            <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-green-700">Uploaded!</span>
                <input type="text" value="${escapeAttr(url)}" readonly
                    class="flex-1 min-w-[200px] gd-input text-[11px]" onclick="this.select()">
                <a href="${escapeAttr(url)}" target="_blank" class="gd-link">Open</a>
            </div>`;
        showToast('Uploaded', 'Image committed to GitHub and served via jsDelivr.', 'success');
    } catch (err) {
        console.error(err);
        result.classList.remove('hidden');
        result.innerHTML = `<span class="text-red-600 font-semibold">Error:</span> ${escapeHtml(err.message || String(err))}`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHTML;
        lucide.createIcons();
    }
}
(function wireFigQuickUpload() {
    const b = document.getElementById('fig-quick-upload');
    if (b) b.addEventListener('click', figQuickUpload);
})();

// ==================== QUESTION PREVIEW ====================
(function wireFigPreviewLang() {
    const en = document.getElementById('fig-prev-lang-en');
    const hi = document.getElementById('fig-prev-lang-hi');
    function setLang(l) {
        figState.previewLang = l;
        en.style.cssText = l === 'en'
            ? 'background:#e0e7ff;color:#4338ca;border-color:#c7d2fe'
            : 'background:#fff;color:#64748b;border-color:#e5e7eb';
        hi.style.cssText = l === 'hi'
            ? 'background:#e0e7ff;color:#4338ca;border-color:#c7d2fe'
            : 'background:#fff;color:#64748b;border-color:#e5e7eb';
        figRenderPreview();
    }
    if (en) en.addEventListener('click', () => setLang('en'));
    if (hi) hi.addEventListener('click', () => setLang('hi'));
})();

// Build an <img> tag matching the aimcq theme convention.
function figBuildImgTag(url, w, h) {
    const width = parseInt(w, 10) || FIG_IMG_DEFAULT_W;
    const height = parseInt(h, 10) || FIG_IMG_DEFAULT_H;
    return `<img class="${FIG_IMG_CLASS}" src="${escapeAttr(url)}" ` +
        `width="${width}" height="${height}" ` +
        `style="width:${width}px;height:${height}px;max-width:100%;margin:10px 0;border-radius:4px;">`;
}

function figRenderPreview() {
    const box = document.getElementById('fig-preview-box');
    if (!box || figState.selectedIdx === null) return;
    const post = figState.data.posts[figState.selectedIdx];
    const meta = post.meta_input || {};
    const lang = figState.previewLang;

    // Question text
    let qText = lang === 'hi'
        ? (meta._aimcq_question_content_hi || meta._aimcq_title_hi || post.post_content || '')
        : (post.post_content || post.post_title || '');

    // Apply the slotted question figure to the preview. Use the local
    // crop preview if present, else the existing Drive URL.
    const qSlot = figState.slots.q;
    const qSrc = figGetSlotImageSrc(qSlot);
    qText = figApplyImageToText(qText, qSrc
        ? figBuildImgTag(qSrc, qSlot.w, qSlot.h) : '', !!qSrc);

    const correct = Array.isArray(meta._aimcq_correct_answers)
        ? meta._aimcq_correct_answers.map(Number) : [0];

    const baseOpts = lang === 'hi'
        ? (meta._aimcq_options_hi && meta._aimcq_options_hi.length
            ? meta._aimcq_options_hi : meta._aimcq_options)
        : meta._aimcq_options;
    const opts = baseOpts || [];

    let optsHtml = '';
    opts.forEach((opt, i) => {
        const key = ['a','b','c','d'][i];
        const slot = figState.slots[key];
        const letter = OPTION_LETTERS[i] || (i + 1);
        // Prefer the slotted (working) image — local crop or Drive URL —
        // then fall back to the option's own stored image.
        const slotSrc = figGetSlotImageSrc(slot);
        const imgUrl = slotSrc || (opt && opt.image) || '';

        // If this option has an image, it becomes an image-only option:
        // the text is fully replaced by the figure (matches apply behaviour).
        let optText = (opt && opt.text) || '';
        optText = optText.replace(FIG_PLACEHOLDER_RE_G, '').trim();
        if (imgUrl) optText = '';

        let imgHtml = '';
        if (imgUrl) {
            // Compute AR-correct display size — identical to what Apply
            // will store — so the preview matches the published result
            // and the figure is never stretched.
            let dimStyle = 'object-fit:contain;';
            if (slot && slot.w > 0 && slot.h > 0) {
                const ar = slot.ar > 0 ? slot.ar
                    : (slot.w > 0 && slot.h > 0 ? slot.w / slot.h : 1);
                const fit = figFitToBox(slot.w, slot.h, ar);
                dimStyle = `width:${fit.w}px;height:${fit.h}px;object-fit:contain;`;
            } else if (opt && opt.image_width && opt.image_height) {
                // Existing option image with stored dimensions.
                dimStyle = `width:${parseInt(opt.image_width,10)||FIG_IMG_DEFAULT_W}px;` +
                           `height:${parseInt(opt.image_height,10)||FIG_IMG_DEFAULT_H}px;` +
                           `object-fit:contain;`;
            }
            imgHtml = `<img src="${escapeAttr(imgUrl)}" class="fig-preview-opt-img" ` +
                      `style="${dimStyle}" alt="" onerror="this.style.display='none'">`;
        }

        optsHtml += `
            <div class="fig-preview-opt${correct.includes(i) ? ' correct' : ''}">
                <span class="fig-preview-opt-letter">${letter}</span>
                <div class="fig-preview-opt-body">${
                    optText || (imgHtml ? '' : '<em class="text-gray-400">(empty)</em>')
                }${imgHtml}</div>
            </div>`;
    });

    box.innerHTML = `
        <div style="font-weight:600">${qText || '<em class="text-gray-400">(no question text)</em>'}</div>
        ${optsHtml}
    `;
    if (typeof renderKatex === 'function') {
        try { renderKatex(box); } catch (e) {}
    }
}

// Replace a placeholder OR an existing aimcq image in a text body with
// the supplied img tag. If `hasImg` is false, strips placeholders only.
function figApplyImageToText(text, imgTag, hasImg) {
    if (!text) return hasImg ? imgTag : text;
    let out = text;
    const imgRe = new RegExp('<img[^>]*class=["\\\']?[^"\\\']*' + FIG_IMG_CLASS + '[^>]*>', 'i');
    if (!hasImg || !imgTag) {
        // Just strip placeholders
        return out.replace(FIG_PLACEHOLDER_RE_G, '').trim();
    }
    if (FIG_PLACEHOLDER_RE.test(out)) {
        out = out.replace(FIG_PLACEHOLDER_RE, imgTag);
    } else if (imgRe.test(out)) {
        out = out.replace(imgRe, imgTag);
    } else {
        out = out + (out.trim().endsWith('>') ? '' : '<br>') + imgTag;
    }
    // Clean any leftover placeholders
    return out.replace(FIG_PLACEHOLDER_RE_G, '').trim();
}

// ==================== APPLY FIGURES TO QUESTION ====================
// On Apply: first upload any locally-cropped figures to the active
// image host (GitHub+jsDelivr or Google Drive), so the JSON references
// stable public URLs, then write the figures into the question's data.
async function figApplyToQuestion() {
    if (figState.selectedIdx === null) {
        showToast('No question', 'Select a question first.', 'error');
        return;
    }

    // Collect slots that hold an image (local crop or already-uploaded).
    const slotKeys = FIG_SLOT_KEYS.filter(k => figSlotHasImage(figState.slots[k]));
    if (!slotKeys.length) {
        showToast('Nothing to apply', 'Crop at least one figure before applying.', 'error');
        return;
    }

    // Slots with a pending local crop that must be uploaded first.
    const pendingKeys = slotKeys.filter(k => figSlotPending(figState.slots[k]));

    const applyBtn = document.getElementById('fig-apply-btn');
    const origHTML = applyBtn ? applyBtn.innerHTML : '';

    // ---- Upload pending crops to GitHub ----
    if (pendingKeys.length) {
        const notReady = figHostReady();
        if (notReady) { showToast('Hosting not set up', notReady, 'error'); return; }
        if (applyBtn) {
            applyBtn.disabled = true;
            applyBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Uploading figures…';
            lucide.createIcons();
        }
        try {
            let done = 0;
            for (const key of pendingKeys) {
                const slot = figState.slots[key];
                done++;
                if (applyBtn) {
                    applyBtn.innerHTML =
                        `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> ` +
                        `Uploading ${done}/${pendingKeys.length} to GitHub (${FIG_SLOT_LABELS[key]})…`;
                    lucide.createIcons();
                }
                const url = await figUploadImage(
                    slot.blob, `mcq-fig-${key}-${Date.now()}.webp`, 'image/webp');
                slot.url = url;
                slot.uploaded = true;
                // Release the local preview now that we have a hosted URL.
                if (slot.localUrl) { try { URL.revokeObjectURL(slot.localUrl); } catch (e) {} }
                slot.localUrl = '';
                slot.blob = null;
            }
        } catch (err) {
            console.error(err);
            showToast('Upload failed', err.message || String(err), 'error');
            if (applyBtn) { applyBtn.disabled = false; applyBtn.innerHTML = origHTML; lucide.createIcons(); }
            figRenderSlots();
            return;
        }
        if (applyBtn) { applyBtn.disabled = false; applyBtn.innerHTML = origHTML; lucide.createIcons(); }
    }

    // ---- All figures now have public URLs — write them into the JSON ----
    const post = figState.data.posts[figState.selectedIdx];
    if (!post.meta_input) post.meta_input = {};
    const meta = post.meta_input;

    let changed = false;

    // ---- 1. Question figure ----
    const qSlot = figState.slots.q;
    if (qSlot && qSlot.url) {
        const imgTag = figBuildImgTag(qSlot.url, qSlot.w, qSlot.h);
        post.post_content = figApplyImageToText(post.post_content || '', imgTag, true);
        post.post_title = stripHtmlTags(post.post_content).slice(0, 120) || post.post_title;

        // Hindi content mirror
        if (meta._aimcq_question_content_hi) {
            meta._aimcq_question_content_hi =
                figApplyImageToText(meta._aimcq_question_content_hi, imgTag, true);
        }
        // Record dimensions in the meta the theme reads.
        meta._aimcq_image_width = String(qSlot.w || FIG_IMG_DEFAULT_W);
        meta._aimcq_image_height = String(qSlot.h || FIG_IMG_DEFAULT_H);
        changed = true;
    }

    // ---- 2. Option figures ----
    // The theme renders option images from the option's `image` field
    // directly. We set `image`, blank the `text` (image fully replaces
    // text), and store AR-correct `image_width`/`image_height` so the
    // theme never stretches the figure.
    ['a','b','c','d'].forEach(key => {
        const slot = figState.slots[key];
        if (!slot || !slot.url) return;
        const oi = FIG_OPT_INDEX[key];

        // Compute display dimensions that strictly preserve the figure's
        // true aspect ratio, fitted inside the user's chosen W x H box.
        // This guarantees no stretching even if AR was unlocked.
        const dims = figFitToBox(slot.w, slot.h, slot.ar);

        function applyToOptionArray(arr) {
            if (!Array.isArray(arr)) return;
            if (!arr[oi]) arr[oi] = { text: '', image: '' };
            arr[oi].image = slot.url;
            arr[oi].image_width = String(dims.w);
            arr[oi].image_height = String(dims.h);
            // When an option becomes an image option, its text is fully
            // replaced by the image — clear any pre-existing text so the
            // option renders as image-only (no leftover text or placeholder).
            arr[oi].text = '';
        }
        applyToOptionArray(meta._aimcq_options);
        applyToOptionArray(meta._aimcq_options_hi);
        changed = true;
    });

    if (!changed) {
        showToast('Nothing to apply', 'Crop at least one figure before applying.', 'error');
        return;
    }

    // Ensure dimension meta exists even if only options changed.
    if (meta._aimcq_image_width === undefined) meta._aimcq_image_width = String(FIG_IMG_DEFAULT_W);
    if (meta._aimcq_image_height === undefined) meta._aimcq_image_height = String(FIG_IMG_DEFAULT_H);

    figState.appliedCount++;
    figState.grSticky = null;   // applied to question -> recapture next time
    document.getElementById('fig-applied-count').textContent = figState.appliedCount;

    figRenderSlots();
    figRenderQuestionList();
    figRenderPreview();
    showToast('Applied',
        `Figures uploaded & applied to Q #${figState.selectedIdx + 1}. ` +
        `Don't forget to save the JSON.`,
        'success');
}
(function wireFigApply() {
    const b = document.getElementById('fig-apply-btn');
    if (b) b.addEventListener('click', figApplyToQuestion);
})();

// ==================== SAVE ====================
(function wireFigDownload() {
    const b = document.getElementById('fig-download-btn');
    if (b) b.addEventListener('click', () => {
        if (!figState.data) return;
        const base = (figState.fileName || 'questions').replace(/\.json$/i, '');
        downloadJSON(figState.data, `${base}_figures_${Date.now()}.json`);
    });
})();

// ==================== GITHUB JSON: LOAD & UPDATE ====================
// GitHub credentials for JSON files are kept SEPARATE from the image-
// hosting credentials (figState.github) — so quizzes and figures can
// live in different repos or even different GitHub accounts.

const GH_JSON_KEY = 'gh_json_creds';
// Independent credentials store: { repo, branch, token }.
let ghJsonCreds = { repo: '', branch: 'main', token: '' };
// Which tab the picker is serving: 'figures' or 'editor'.
let ghPickerTarget = 'figures';

// Load saved JSON credentials from localStorage on boot.
(function loadGhJsonCreds() {
    try {
        const raw = localStorage.getItem(GH_JSON_KEY);
        if (raw) {
            const c = JSON.parse(raw);
            ghJsonCreds = {
                repo: c.repo || '', branch: c.branch || 'main', token: c.token || '',
            };
        }
    } catch (e) { /* ignore */ }
})();

// Read the picker fields into ghJsonCreds (and persist if "remember" is on).
function ghReadPickerCreds() {
    ghJsonCreds = {
        repo:   (document.getElementById('fig-gh-pick-repo').value || '').trim(),
        branch: (document.getElementById('fig-gh-pick-branch').value || 'main').trim() || 'main',
        token:  (document.getElementById('fig-gh-pick-token').value || '').trim(),
    };
    const remember = document.getElementById('fig-gh-pick-remember');
    if (remember && remember.checked) {
        try { localStorage.setItem(GH_JSON_KEY, JSON.stringify(ghJsonCreds)); } catch (e) {}
    }
}

function ghForgetJsonCreds() {
    ghJsonCreds = { repo: '', branch: 'main', token: '' };
    try { localStorage.removeItem(GH_JSON_KEY); } catch (e) {}
    ['fig-gh-pick-repo','fig-gh-pick-token','fig-gh-pick-path','fig-gh-pick-file'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('fig-gh-pick-branch').value = 'main';
    ghSetCredsStatus('Credentials cleared from this browser.', '');
    showToast('Forgotten', 'Saved GitHub JSON credentials cleared from this browser.', 'info');
}

function ghSetCredsStatus(msg, kind) {
    const el = document.getElementById('fig-gh-creds-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'text-xs ' + (
        kind === 'ok'  ? 'text-green-700 font-semibold' :
        kind === 'err' ? 'text-red-600 font-semibold' : 'text-gray-500');
}

// Verify the repo + token by querying the repository.
async function ghVerifyCreds() {
    ghReadPickerCreds();
    const c = ghJsonCreds;
    if (!/^[^/\s]+\/[^/\s]+$/.test(c.repo)) {
        ghSetCredsStatus('Repository must be in "owner/repo" format.', 'err');
        return;
    }
    const btn = document.getElementById('fig-gh-pick-verify');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Verifying...';
    lucide.createIcons();
    try {
        const resp = await fetch(`https://api.github.com/repos/${c.repo}`, { headers: figGitHubHeaders() });
        if (resp.status === 401) { ghSetCredsStatus('Token rejected (401). Check the access token.', 'err'); return; }
        if (resp.status === 404) { ghSetCredsStatus('Repository not found (404). Check the name / token access.', 'err'); return; }
        if (!resp.ok) { ghSetCredsStatus('GitHub returned HTTP ' + resp.status + '.', 'err'); return; }
        const repo = await resp.json();
        const canWrite = repo.permissions && repo.permissions.push;
        ghReadPickerCreds();   // persist again now that it's valid
        if (canWrite === false) {
            ghSetCredsStatus('\u26a0 Connected, but the token may lack write access (need "repo" scope).', 'err');
        } else {
            ghSetCredsStatus(`\u2713 Verified — ${c.repo}@${c.branch} is ready for load & commit.`, 'ok');
            showToast('GitHub ready', 'JSON credentials verified.', 'success');
        }
    } catch (err) {
        ghSetCredsStatus('Could not reach GitHub: ' + (err.message || String(err)), 'err');
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
        lucide.createIcons();
    }
}

// ---- Recent files ("mentions") ----
const GH_RECENTS_KEY = 'gh_json_recents';
let ghRecents = [];
(function loadGhRecents() {
    try {
        const raw = localStorage.getItem(GH_RECENTS_KEY);
        if (raw) ghRecents = JSON.parse(raw) || [];
    } catch (e) { ghRecents = []; }
})();

// Record a successfully-loaded file at the top of the recents list.
function ghAddRecent(file) {
    const key = `${file.repo}@${file.branch}/${file.path}`;
    ghRecents = ghRecents.filter(r => `${r.repo}@${r.branch}/${r.path}` !== key);
    ghRecents.unshift({ repo: file.repo, branch: file.branch, path: file.path, name: file.name });
    if (ghRecents.length > 12) ghRecents = ghRecents.slice(0, 12);
    try { localStorage.setItem(GH_RECENTS_KEY, JSON.stringify(ghRecents)); } catch (e) {}
}

function ghClearRecents() {
    ghRecents = [];
    try { localStorage.removeItem(GH_RECENTS_KEY); } catch (e) {}
    ghRenderRecents();
}

// Render the recent-file chips ("mentions").
function ghRenderRecents() {
    const wrap = document.getElementById('fig-gh-recents-wrap');
    const box = document.getElementById('fig-gh-recents');
    if (!wrap || !box) return;
    if (!ghRecents.length) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    box.innerHTML = '';
    ghRecents.forEach(r => {
        const chip = document.createElement('div');
        chip.className = 'gh-recent-chip';
        chip.title = `${r.repo}@${r.branch} / ${r.path}`;
        chip.innerHTML = '<i data-lucide="file-json" class="w-3 h-3 flex-shrink-0"></i>' +
            `<span class="gh-recent-name">${escapeHtml(r.name)}</span>`;
        chip.addEventListener('click', () => {
            // Switch creds to that recent's repo/branch and load it.
            document.getElementById('fig-gh-pick-repo').value = r.repo;
            document.getElementById('fig-gh-pick-branch').value = r.branch;
            ghReadPickerCreds();
            figGitHubLoadFile(r.repo, r.branch, r.path, r.name);
        });
        box.appendChild(chip);
    });
    lucide.createIcons();
}

// ---- Modal tab switching ----
function ghSwitchTab(tab) {
    ['browse','upload','delete','creds'].forEach(t => {
        const panel = document.getElementById('ghtab-' + t);
        if (panel) panel.classList.toggle('hidden', t !== tab);
    });
    document.querySelectorAll('.ghtab').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-ghtab') === tab);
    });
    // Show a "set credentials first" hint if repo/token are missing.
    const needCreds = !ghJsonCreds.repo || !ghJsonCreds.token;
    const bw = document.getElementById('fig-gh-browse-norepo');
    const uw = document.getElementById('fig-gh-upload-norepo');
    const dw = document.getElementById('fig-gh-delete-norepo');
    if (bw) bw.classList.toggle('hidden', !(tab === 'browse' && needCreds));
    if (uw) uw.classList.toggle('hidden', !(tab === 'upload' && needCreds));
    if (dw) dw.classList.toggle('hidden', !(tab === 'delete' && needCreds));
    lucide.createIcons();
}

// Open the GitHub picker modal for a given tab ('figures' | 'editor').
function figGitHubOpenPicker(target) {
    const modal = document.getElementById('fig-gh-picker-modal');
    if (!modal) return;
    ghPickerTarget = (target === 'editor' || target === 'quizbuilder') ? target : 'figures';

    const titleEl = document.getElementById('fig-gh-picker-title');
    if (titleEl) titleEl.textContent =
        ghPickerTarget === 'editor'      ? 'GitHub — JSON for the Editor' :
        ghPickerTarget === 'quizbuilder' ? 'GitHub — Source JSON for the Quiz Builder' :
                                           'GitHub — Questions JSON for the Figure Updater';

    // Pre-fill from the independent JSON credentials.
    document.getElementById('fig-gh-pick-repo').value = ghJsonCreds.repo || '';
    document.getElementById('fig-gh-pick-branch').value = ghJsonCreds.branch || 'main';
    document.getElementById('fig-gh-pick-token').value = ghJsonCreds.token || '';
    document.getElementById('fig-gh-pick-path').value = '';
    document.getElementById('fig-gh-pick-file').value = '';
    const _delPath = document.getElementById('fig-gh-del-path');
    const _delExact = document.getElementById('fig-gh-del-exact');
    if (_delPath) _delPath.value = '';
    if (_delExact) _delExact.value = '';
    const _delList = document.getElementById('fig-gh-del-list');
    if (_delList) _delList.innerHTML = '<div class="p-8 text-center text-gray-400 text-sm">Enter a folder and click <b>Browse</b> to list contents.</div>';
    const _delLoc = document.getElementById('fig-gh-del-loc');
    if (_delLoc) _delLoc.textContent = 'Repository contents';
    ghDeleteCancelConfirm();

    document.getElementById('fig-gh-picker-list').innerHTML =
        '<div class="p-8 text-center text-gray-400 text-sm">' +
        'Enter a folder and click <b>Browse</b> to list its JSON files.</div>';
    document.getElementById('fig-gh-picker-loc').textContent = 'Repository contents';
    ghSetCredsStatus(
        ghJsonCreds.repo && ghJsonCreds.token
            ? `Saved: ${ghJsonCreds.repo}@${ghJsonCreds.branch}.` : '', '');

    // Reset upload tab fields.
    ghResetUploadForm();
    ghRenderRecents();
    // Open on Browse unless creds missing — then Credentials.
    ghSwitchTab((ghJsonCreds.repo && ghJsonCreds.token) ? 'browse' : 'creds');
    modal.classList.remove('hidden');
    lucide.createIcons();
}

function figGitHubClosePicker() {
    const modal = document.getElementById('fig-gh-picker-modal');
    if (modal) modal.classList.add('hidden');
}

// Common headers for GitHub API calls using the JSON-specific token.
function figGitHubHeaders() {
    const h = { 'Accept': 'application/vnd.github+json' };
    if (ghJsonCreds.token) h['Authorization'] = 'Bearer ' + ghJsonCreds.token;
    return h;
}

// Build the jsDelivr CDN URL for a JSON file in a GitHub repo — the same
// no-rate-limit, globally-cached delivery used for images.
//   https://cdn.jsdelivr.net/gh/owner/repo@branch/path/file.json
function ghJsonCdnUrl(repo, branch, path) {
    return `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${encodeURI(path)}`;
}

// Copy text to the clipboard with a toast confirmation.
function ghCopyToClipboard(text, label) {
    const done = () => showToast('Copied', (label || 'Link') + ' copied to clipboard.', 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => ghCopyFallback(text, done));
    } else {
        ghCopyFallback(text, done);
    }
}
function ghCopyFallback(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { showToast('Copy failed', 'Select and copy the link manually.', 'error'); }
    document.body.removeChild(ta);
}

// Browse a folder of the repo and list its .json files + subfolders.
async function figGitHubBrowse() {
    ghReadPickerCreds();   // capture repo/branch/token from the picker fields
    const repo = (document.getElementById('fig-gh-pick-repo').value || '').trim();
    const branch = (document.getElementById('fig-gh-pick-branch').value || 'main').trim() || 'main';
    let path = (document.getElementById('fig-gh-pick-path').value || '').trim()
        .replace(/^\/+|\/+$/g, '');
    const list = document.getElementById('fig-gh-picker-list');

    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
        showToast('Bad repo', 'Repository must be in "owner/repo" format.', 'error');
        return;
    }
    document.getElementById('fig-gh-picker-loc').textContent =
        `${repo}@${branch}${path ? ' / ' + path : ''}`;
    list.innerHTML = '<div class="p-8 text-center text-gray-400 text-sm">' +
        '<i data-lucide="loader-2" class="w-6 h-6 mx-auto mb-2 text-gray-300 animate-spin"></i>Loading…</div>';
    lucide.createIcons();

    try {
        const url = `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}` +
            `?ref=${encodeURIComponent(branch)}`;
        const resp = await fetch(url, { headers: figGitHubHeaders() });
        if (!resp.ok) {
            let msg = 'HTTP ' + resp.status;
            try { const j = await resp.json(); msg = j.message || msg; } catch (e) {}
            if (resp.status === 404) msg = 'Repo, branch, or path not found. ' +
                'For private repos, set a token with "repo" scope in Image Hosting.';
            if (resp.status === 401) msg = 'Token rejected. Check the access token in Image Hosting.';
            list.innerHTML = `<div class="p-6 text-center text-red-600 text-sm">${escapeHtml(msg)}</div>`;
            return;
        }
        const items = await resp.json();
        if (!Array.isArray(items)) {
            // A single file path was given instead of a folder.
            list.innerHTML = '<div class="p-6 text-center text-amber-600 text-sm">' +
                'That path is a file, not a folder. Use the "Load a file directly" box below.</div>';
            return;
        }
        // Folders first, then .json files. Other files are ignored.
        const folders = items.filter(x => x.type === 'dir')
            .sort((a, b) => a.name.localeCompare(b.name));
        const jsons = items.filter(x => x.type === 'file' && /\.json$/i.test(x.name))
            .sort((a, b) => a.name.localeCompare(b.name));

        if (!folders.length && !jsons.length) {
            list.innerHTML = '<div class="p-6 text-center text-gray-400 text-sm">' +
                'No folders or .json files here.</div>';
            return;
        }

        list.innerHTML = '';
        // Up-one-level row
        if (path) {
            const up = document.createElement('div');
            up.className = 'gd-file-row';
            const parent = path.split('/').slice(0, -1).join('/');
            up.innerHTML = '<i data-lucide="corner-left-up" class="w-4 h-4 text-gray-400"></i>' +
                '<span class="gd-file-row-name">.. (up one level)</span>';
            up.addEventListener('click', () => {
                document.getElementById('fig-gh-pick-path').value = parent;
                figGitHubBrowse();
            });
            list.appendChild(up);
        }
        folders.forEach(f => {
            const row = document.createElement('div');
            row.className = 'gd-file-row';
            row.innerHTML = '<i data-lucide="folder" class="w-4 h-4 text-amber-500"></i>' +
                `<span class="gd-file-row-name">${escapeHtml(f.name)}</span>` +
                '<i data-lucide="chevron-right" class="w-3.5 h-3.5 text-gray-300"></i>';
            row.addEventListener('click', () => {
                document.getElementById('fig-gh-pick-path').value = f.path;
                figGitHubBrowse();
            });
            list.appendChild(row);
        });
        jsons.forEach(f => {
            const row = document.createElement('div');
            row.className = 'gd-file-row';
            const cdnUrl = ghJsonCdnUrl(repo, branch, f.path);
            row.innerHTML = '<i data-lucide="file-json" class="w-4 h-4 text-blue-500 flex-shrink-0"></i>' +
                `<span class="gd-file-row-name">${escapeHtml(f.name)}</span>` +
                `<span class="gd-file-row-cdn" title="Copy jsDelivr CDN link">` +
                '<i data-lucide="link" class="w-3 h-3"></i> CDN</span>' +
                '<span class="gd-file-row-load">Load</span>';
            // Copy-CDN: copies the link, does NOT load the file.
            row.querySelector('.gd-file-row-cdn').addEventListener('click', e => {
                e.stopPropagation();
                ghCopyToClipboard(cdnUrl, 'jsDelivr CDN link');
            });
            // Clicking the rest of the row loads the file.
            row.querySelector('.gd-file-row-load').addEventListener('click', e => {
                e.stopPropagation();
                figGitHubLoadFile(repo, branch, f.path, f.name);
            });
            row.addEventListener('click', () => figGitHubLoadFile(repo, branch, f.path, f.name));
            list.appendChild(row);
        });
        lucide.createIcons();
    } catch (err) {
        list.innerHTML = `<div class="p-6 text-center text-red-600 text-sm">${
            escapeHtml('Could not reach GitHub: ' + (err.message || String(err)))}</div>`;
    }
}

// Load a file from the "exact path" box.
function figGitHubLoadByPath() {
    ghReadPickerCreds();
    const repo = (document.getElementById('fig-gh-pick-repo').value || '').trim();
    const branch = (document.getElementById('fig-gh-pick-branch').value || 'main').trim() || 'main';
    const path = (document.getElementById('fig-gh-pick-file').value || '').trim()
        .replace(/^\/+/, '');
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
        showToast('Bad repo', 'Repository must be in "owner/repo" format.', 'error');
        return;
    }
    if (!path || !/\.json$/i.test(path)) {
        showToast('Bad path', 'Enter a path ending in .json', 'error');
        return;
    }
    figGitHubLoadFile(repo, branch, path, path.split('/').pop());
}

// Fetch a JSON file from GitHub and load it into the Figure Updater.
async function figGitHubLoadFile(repo, branch, path, name) {
    showToast('Loading…', `Fetching ${name} from GitHub.`, 'info');
    try {
        const url = `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}` +
            `?ref=${encodeURIComponent(branch)}`;
        const resp = await fetch(url, { headers: figGitHubHeaders() });
        if (!resp.ok) {
            let msg = 'HTTP ' + resp.status;
            try { const j = await resp.json(); msg = j.message || msg; } catch (e) {}
            throw new Error(msg);
        }
        const meta = await resp.json();
        if (Array.isArray(meta) || meta.type !== 'file') {
            throw new Error('That path is not a file.');
        }
        // Content is base64; decode it (handles UTF-8 correctly).
        let text;
        if (meta.encoding === 'base64' && meta.content) {
            const bin = atob(meta.content.replace(/\n/g, ''));
            const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
            text = new TextDecoder('utf-8').decode(bytes);
        } else if (meta.download_url) {
            // Large files (>1MB) have no inline content — use download_url.
            const dl = await fetch(meta.download_url);
            text = await dl.text();
        } else {
            throw new Error('File content is empty or unsupported.');
        }
        const data = JSON.parse(text);
        const ghFile = { repo, branch, path, name, sha: meta.sha };

        ghAddRecent(ghFile);          // remember it for the "mentions" list
        figGitHubClosePicker();
        // Route the data to whichever tab opened the picker.
        if (ghPickerTarget === 'editor') {
            deliverGitHubFileToEditor(ghFile, data);
        } else if (ghPickerTarget === 'quizbuilder') {
            deliverGitHubFileToQuizBuilder(ghFile, data);
        } else {
            figLoadJsonData(data, name, { type: 'github', file: ghFile });
            switchTab('figures');
        }
    } catch (err) {
        showToast('Load failed', err.message || String(err), 'error');
    }
}

// Shared: commit a JS object as a JSON file to GitHub (creates or updates).
// `file` = { repo, branch, path, name, sha }. Returns the new sha.
async function ghCommitJsonFile(file, dataObj, commitMessage) {
    if (!ghJsonCreds.token) {
        throw new Error('A GitHub token is required to commit. Open the GitHub picker ' +
            'and enter a Personal Access Token (repo scope).');
    }
    const json = JSON.stringify(aimcqCanonicalizeExport(dataObj), null, 2);
    // base64-encode the UTF-8 content (handles Hindi and all Unicode).
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    const content = btoa(bin);

    const apiUrl = `https://api.github.com/repos/${file.repo}/contents/${encodeURI(file.path)}`;
    const body = {
        message: commitMessage || ('Update ' + file.name),
        content: content,
        branch: file.branch,
    };
    if (file.sha) body.sha = file.sha;   // required when updating an existing file

    const resp = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': 'Bearer ' + ghJsonCreds.token,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        let msg = 'HTTP ' + resp.status;
        try { const j = await resp.json(); msg = j.message || msg; } catch (e) {}
        if (resp.status === 409) msg = 'Conflict — the file changed on GitHub since you loaded it. ' +
            'Reload it from GitHub and re-apply your changes.';
        if (resp.status === 401) msg = 'Token rejected. Open the GitHub picker and check the token.';
        if (resp.status === 404) msg = 'Repo or branch not found, or the token lacks write access.';
        throw new Error(msg);
    }
    const result = await resp.json();
    return (result && result.content && result.content.sha) || file.sha;
}

// Commit the Figure Updater's JSON back to its linked GitHub file.
async function figUpdateToGitHub() {
    if (!figState.data) {
        showToast('Nothing to save', 'Load a JSON first.', 'error');
        return;
    }
    const f = figState.githubFile;
    if (!f || !f.path) {
        showToast('Not linked', 'No GitHub file is linked. Load the JSON from GitHub to enable direct updates.', 'error');
        return;
    }
    const btn = document.getElementById('fig-update-github-btn');
    const origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Updating...';
    lucide.createIcons();
    try {
        f.sha = await ghCommitJsonFile(f, figState.data, 'Update MCQ figures — ' + f.name);
        showToast('Saved to GitHub', `Committed to ${f.repo}@${f.branch} — ${f.path}.`, 'success');
    } catch (err) {
        showToast('Update failed', err.message || String(err), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHTML;
        lucide.createIcons();
    }
}
(function wireFigUpdateGitHub() {
    const b = document.getElementById('fig-update-github-btn');
    if (b) b.addEventListener('click', figUpdateToGitHub);
    const repoIn = document.getElementById('fig-gh-pick-repo');
    const fileIn = document.getElementById('fig-gh-pick-file');
    if (repoIn) repoIn.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); figGitHubBrowse(); }
    });
    if (fileIn) fileIn.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); figGitHubLoadByPath(); }
    });
    const forget = document.getElementById('fig-gh-pick-forget');
    if (forget) forget.addEventListener('click', ghForgetJsonCreds);
    const verify = document.getElementById('fig-gh-pick-verify');
    if (verify) verify.addEventListener('click', ghVerifyCreds);
})();

// ==================== GITHUB: UPLOAD NEW JSON FILE ====================
// Commit a brand-new JSON file into the repo — into an existing folder
// or a new one (folders are created implicitly by the Contents API).
let ghUploadData = null;        // parsed JSON object staged for upload

function ghSetUploadStatus(msg, kind) {
    const el = document.getElementById('fig-gh-up-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'text-xs ' + (
        kind === 'ok'  ? 'text-green-700 font-semibold' :
        kind === 'err' ? 'text-red-600 font-semibold' : 'text-gray-500');
}

function ghResetUploadForm() {
    ghUploadData = null;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('fig-gh-up-folder', '');
    set('fig-gh-up-name', '');
    const fn = document.getElementById('fig-gh-up-filename');
    if (fn) {
        fn.textContent = 'Click or drag a .json file here';
        fn.classList.remove('text-green-700', 'font-bold');
    }
    ghSetUploadStatus('', '');
}

// Stage a parsed JSON object for upload, with a suggested file name.
function ghStageUpload(data, suggestedName) {
    ghUploadData = data;
    const fn = document.getElementById('fig-gh-up-filename');
    if (fn) {
        fn.textContent = '\u2713 ' + suggestedName + ' \u2014 ' +
            (Array.isArray(data.posts) ? data.posts.length + ' questions' : 'JSON ready');
        fn.classList.add('text-green-700', 'font-bold');
    }
    const nameIn = document.getElementById('fig-gh-up-name');
    if (nameIn && !nameIn.value) nameIn.value = suggestedName;
    ghSetUploadStatus('', '');
}

// Perform the upload (create a new file via the Contents API).
async function ghUploadNewFile() {
    ghReadPickerCreds();
    const c = ghJsonCreds;
    if (!/^[^/\s]+\/[^/\s]+$/.test(c.repo) || !c.token) {
        ghSetUploadStatus('Set a repository and token in the Credentials tab first.', 'err');
        ghSwitchTab('creds');
        return;
    }
    if (!ghUploadData) {
        ghSetUploadStatus('Choose a JSON file (or use the loaded JSON) first.', 'err');
        return;
    }
    let folder = (document.getElementById('fig-gh-up-folder').value || '').trim()
        .replace(/^\/+|\/+$/g, '');
    let name = (document.getElementById('fig-gh-up-name').value || '').trim()
        .replace(/^\/+/, '');
    if (!name) { ghSetUploadStatus('Enter a file name.', 'err'); return; }
    if (!/\.json$/i.test(name)) name += '.json';
    const path = (folder ? folder + '/' : '') + name;

    const btn = document.getElementById('fig-gh-up-submit');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Uploading...';
    lucide.createIcons();

    try {
        // Guard: refuse to silently overwrite an existing file.
        const checkUrl = `https://api.github.com/repos/${c.repo}/contents/${encodeURI(path)}` +
            `?ref=${encodeURIComponent(c.branch)}`;
        const check = await fetch(checkUrl, { headers: figGitHubHeaders() });
        if (check.ok) {
            ghSetUploadStatus('A file already exists at ' + path +
                '. Use the Browse tab to load & update it, or choose a different name.', 'err');
            return;
        }

        // Create the file (no sha = create).
        const newFile = { repo: c.repo, branch: c.branch, path: path, name: name, sha: null };
        const sha = await ghCommitJsonFile(newFile, ghUploadData, 'Add MCQ JSON — ' + name);
        newFile.sha = sha;

        ghSetUploadStatus('\u2713 Uploaded to ' + c.repo + '@' + c.branch + ' — ' + path, 'ok');
        showToast('Uploaded', 'New JSON committed to GitHub.', 'success');
        ghAddRecent(newFile);

        // Optionally load it straight into the tool.
        const loadAfter = document.getElementById('fig-gh-up-loadafter');
        if (loadAfter && loadAfter.checked) {
            if (ghPickerTarget === 'editor') {
                deliverGitHubFileToEditor(newFile, ghUploadData);
            } else if (ghPickerTarget === 'quizbuilder') {
                deliverGitHubFileToQuizBuilder(newFile, ghUploadData);
            } else {
                figLoadJsonData(ghUploadData, name, { type: 'github', file: newFile });
                switchTab('figures');
            }
            figGitHubClosePicker();
        }
    } catch (err) {
        ghSetUploadStatus('Upload failed: ' + (err.message || String(err)), 'err');
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
        lucide.createIcons();
    }
}

// Wire the Upload tab.
(function wireGhUpload() {
    const fileIn = document.getElementById('fig-gh-up-file');
    const zone = document.getElementById('fig-gh-up-dropzone');
    const submit = document.getElementById('fig-gh-up-submit');
    const useCurrent = document.getElementById('fig-gh-up-usecurrent');

    function handleFile(file) {
        if (!file) return;
        if (!/\.json$/i.test(file.name)) {
            ghSetUploadStatus('Please choose a .json file.', 'err'); return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                ghStageUpload(data, file.name);
            } catch (e) {
                ghSetUploadStatus('Could not parse JSON: ' + e.message, 'err');
            }
        };
        reader.readAsText(file);
    }
    if (fileIn) fileIn.addEventListener('change', e => handleFile(e.target.files[0]));
    if (zone) {
        ['dragenter','dragover','dragleave','drop'].forEach(ev =>
            zone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
        ['dragenter','dragover'].forEach(ev =>
            zone.addEventListener(ev, () => zone.classList.add('drag-active')));
        ['dragleave','drop'].forEach(ev =>
            zone.addEventListener(ev, () => zone.classList.remove('drag-active')));
        zone.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
    }
    // "Use the JSON currently loaded here" — pulls from whichever tab.
    if (useCurrent) useCurrent.addEventListener('click', () => {
        let data = null, name = '';
        if (ghPickerTarget === 'editor') {
            data = (typeof editorExportData !== 'undefined' && editorExportData)
                ? editorExportData
                : (typeof editorBaseData !== 'undefined' ? editorBaseData : null);
            name = (typeof editorBaseFileName !== 'undefined' && editorBaseFileName) || 'edited.json';
        } else {
            data = figState.data;
            name = figState.fileName || 'questions.json';
        }
        if (!data) {
            ghSetUploadStatus('No JSON is loaded in the tool yet.', 'err');
            return;
        }
        ghStageUpload(data, name);
        ghSetUploadStatus('Using the JSON currently loaded in the tool.', 'ok');
    });
    if (submit) submit.addEventListener('click', ghUploadNewFile);
})();


// ==================== GITHUB: DELETE FILE / FOLDER ====================

// State for the delete confirmation flow.
let _ghDelPendingAction = null;   // { type: 'file'|'folder', repo, branch, path, name, sha? }

function ghSetDeleteStatus(msg, kind) {
    const el = document.getElementById('fig-gh-del-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'text-xs ' + (
        kind === 'ok'  ? 'text-green-700 font-semibold' :
        kind === 'err' ? 'text-red-600 font-semibold'   : 'text-gray-500');
}

async function ghDeleteBrowse() {
    ghReadPickerCreds();
    const repo   = (document.getElementById('fig-gh-pick-repo').value   || '').trim();
    const branch = (document.getElementById('fig-gh-pick-branch').value || 'main').trim() || 'main';
    let   path   = (document.getElementById('fig-gh-del-path').value    || '').trim()
        .replace(/^\/+|\/+$/g, '');
    const list   = document.getElementById('fig-gh-del-list');
    const locEl  = document.getElementById('fig-gh-del-loc');

    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
        showToast('Bad repo', 'Repository must be in "owner/repo" format.', 'error'); return;
    }
    if (locEl) locEl.textContent = repo + '@' + branch + (path ? ' / ' + path : '');
    list.innerHTML = '<div class="p-8 text-center text-gray-400 text-sm">' +
        '<i data-lucide="loader-2" class="w-6 h-6 mx-auto mb-2 text-gray-300 animate-spin"></i>Loading\u2026</div>';
    lucide.createIcons();
    ghSetDeleteStatus('', '');
    ghDeleteCancelConfirm();

    try {
        const url  = 'https://api.github.com/repos/' + repo + '/contents/' + encodeURI(path) +
            '?ref=' + encodeURIComponent(branch);
        const resp = await fetch(url, { headers: figGitHubHeaders() });
        if (!resp.ok) {
            let msg = 'HTTP ' + resp.status;
            try { const j = await resp.json(); msg = j.message || msg; } catch (e) {}
            list.innerHTML = '<div class="p-6 text-center text-red-600 text-sm">' + escapeHtml(msg) + '</div>';
            return;
        }
        const items = await resp.json();
        if (!Array.isArray(items)) {
            list.innerHTML = '<div class="p-6 text-center text-amber-600 text-sm">' +
                'That path is a file. Use the exact-path box to delete it.</div>';
            return;
        }
        const folders = items.filter(x => x.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
        const files   = items.filter(x => x.type === 'file').sort((a, b) => a.name.localeCompare(b.name));

        if (!folders.length && !files.length) {
            list.innerHTML = '<div class="p-6 text-center text-gray-400 text-sm">This folder is empty.</div>';
            return;
        }

        list.innerHTML = '';

        if (path) {
            const up = document.createElement('div');
            up.className = 'gd-file-row';
            const parent = path.split('/').slice(0, -1).join('/');
            up.innerHTML = '<i data-lucide="corner-left-up" class="w-4 h-4 text-gray-400"></i>' +
                '<span class="gd-file-row-name">.. (up one level)</span>';
            up.addEventListener('click', () => {
                document.getElementById('fig-gh-del-path').value = parent;
                ghDeleteBrowse();
            });
            list.appendChild(up);
        }

        folders.forEach(function(f) {
            const row = document.createElement('div');
            row.className = 'gd-file-row';
            row.innerHTML =
                '<i data-lucide="folder" class="w-4 h-4 text-amber-500 flex-shrink-0"></i>' +
                '<span class="gd-file-row-name" style="flex:1">' + escapeHtml(f.name) + '</span>' +
                '<span class="gh-del-folder-btn" style="display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;cursor:pointer;flex-shrink:0" ' +
                  'data-fpath="' + escapeAttr(f.path) + '" data-fname="' + escapeAttr(f.name) + '">' +
                  '<i data-lucide="trash-2" class="w-3 h-3"></i> Delete folder</span>' +
                '<i data-lucide="chevron-right" class="w-3.5 h-3.5 text-gray-300 flex-shrink-0"></i>';
            row.addEventListener('click', function(e) {
                if (e.target.closest('.gh-del-folder-btn')) return;
                document.getElementById('fig-gh-del-path').value = f.path;
                ghDeleteBrowse();
            });
            row.querySelector('.gh-del-folder-btn').addEventListener('click', function(e) {
                e.stopPropagation();
                ghDeleteAskConfirm({ type: 'folder', repo: repo, branch: branch, path: f.path, name: f.name });
            });
            list.appendChild(row);
        });

        files.forEach(function(f) {
            const row = document.createElement('div');
            row.className = 'gd-file-row';
            const isJson = /\.json$/i.test(f.name);
            row.innerHTML =
                '<i data-lucide="' + (isJson ? 'file-json' : 'file') + '" class="w-4 h-4 ' + (isJson ? 'text-blue-500' : 'text-gray-400') + ' flex-shrink-0"></i>' +
                '<span class="gd-file-row-name" style="flex:1">' + escapeHtml(f.name) + '</span>' +
                '<span class="gh-del-file-btn" style="display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;cursor:pointer;flex-shrink:0" ' +
                  'data-fpath="' + escapeAttr(f.path) + '" data-fname="' + escapeAttr(f.name) + '" data-sha="' + escapeAttr(f.sha || '') + '">' +
                  '<i data-lucide="trash-2" class="w-3 h-3"></i> Delete</span>';
            row.querySelector('.gh-del-file-btn').addEventListener('click', function(e) {
                e.stopPropagation();
                ghDeleteAskConfirm({ type: 'file', repo: repo, branch: branch, path: f.path, name: f.name, sha: f.sha });
            });
            list.appendChild(row);
        });

        lucide.createIcons();
    } catch (err) {
        list.innerHTML = '<div class="p-6 text-center text-red-600 text-sm">' +
            escapeHtml('Could not reach GitHub: ' + (err.message || String(err))) + '</div>';
    }
}

function ghDeleteAskConfirm(action) {
    _ghDelPendingAction = action;
    const box = document.getElementById('fig-gh-del-confirm');
    const msg = document.getElementById('fig-gh-del-confirm-msg');
    const btn = document.getElementById('fig-gh-del-confirm-btn');
    if (!box || !msg || !btn) return;
    if (action.type === 'folder') {
        msg.textContent = 'Delete folder "' + action.name + '" and ALL files inside it from ' +
            action.repo + '@' + action.branch + '? This cannot be undone.';
    } else {
        msg.textContent = 'Delete "' + action.name + '" from ' + action.repo + '@' + action.branch +
            '? This cannot be undone.';
    }
    box.classList.remove('hidden');
    btn.onclick = function() { ghDeleteExecute(action); };
    ghSetDeleteStatus('', '');
    lucide.createIcons();
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function ghDeleteCancelConfirm() {
    _ghDelPendingAction = null;
    const box = document.getElementById('fig-gh-del-confirm');
    if (box) box.classList.add('hidden');
}

async function ghDeleteByExactPath() {
    ghReadPickerCreds();
    const repo   = (document.getElementById('fig-gh-pick-repo').value   || '').trim();
    const branch = (document.getElementById('fig-gh-pick-branch').value || 'main').trim() || 'main';
    const path   = (document.getElementById('fig-gh-del-exact').value   || '').trim().replace(/^\/+/, '');
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
        showToast('Bad repo', 'Set a valid repository in Credentials.', 'error'); return;
    }
    if (!path) { ghSetDeleteStatus('Enter a path to delete.', 'err'); return; }
    ghSetDeleteStatus('Checking path\u2026', '');
    try {
        const url  = 'https://api.github.com/repos/' + repo + '/contents/' + encodeURI(path) +
            '?ref=' + encodeURIComponent(branch);
        const resp = await fetch(url, { headers: figGitHubHeaders() });
        if (resp.status === 404) { ghSetDeleteStatus('Path not found in this repository.', 'err'); return; }
        if (!resp.ok) {
            let msg = 'HTTP ' + resp.status;
            try { const j = await resp.json(); msg = j.message || msg; } catch (e) {}
            ghSetDeleteStatus('Error: ' + msg, 'err'); return;
        }
        const meta  = await resp.json();
        const name  = path.split('/').pop();
        const isDir = Array.isArray(meta);
        ghDeleteAskConfirm({
            type: isDir ? 'folder' : 'file', repo: repo, branch: branch,
            path: path, name: name, sha: isDir ? undefined : meta.sha,
        });
    } catch (err) {
        ghSetDeleteStatus('Could not check path: ' + (err.message || String(err)), 'err');
    }
}

async function ghDeleteExecute(action) {
    if (!action) return;
    const btn = document.getElementById('fig-gh-del-confirm-btn');
    const origHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Deleting\u2026'; lucide.createIcons(); }
    ghSetDeleteStatus('', '');
    try {
        if (action.type === 'file') {
            await ghDeleteSingleFile(action.repo, action.branch, action.path, action.sha, action.name);
            ghSetDeleteStatus('\u2713 Deleted "' + action.name + '" from ' + action.repo + '@' + action.branch + '.', 'ok');
            showToast('Deleted', '"' + action.name + '" removed from GitHub.', 'success');
        } else {
            ghSetDeleteStatus('Collecting files in folder\u2026', '');
            const allFiles = await ghCollectFolderFiles(action.repo, action.branch, action.path);
            if (!allFiles.length) {
                ghSetDeleteStatus('Folder appears empty \u2014 nothing to delete.', 'ok');
                ghDeleteCancelConfirm();
                return;
            }
            ghSetDeleteStatus('Deleting ' + allFiles.length + ' file(s)\u2026', '');
            let deleted = 0, failed = 0;
            for (const f of allFiles) {
                try {
                    await ghDeleteSingleFile(action.repo, action.branch, f.path, f.sha, f.name);
                    deleted++;
                    ghSetDeleteStatus('Deleted ' + deleted + '/' + allFiles.length + ' file(s)\u2026', '');
                } catch (e) { console.warn('Could not delete', f.path, e.message); failed++; }
            }
            const statusMsg = failed
                ? 'Deleted ' + deleted + ' file(s); ' + failed + ' could not be deleted.'
                : '\u2713 Folder "' + action.name + '" and ' + deleted + ' file(s) deleted from ' + action.repo + '@' + action.branch + '.';
            ghSetDeleteStatus(statusMsg, failed ? 'err' : 'ok');
            showToast(failed ? 'Partial delete' : 'Folder deleted',
                failed ? deleted + ' deleted, ' + failed + ' failed.' : '"' + action.name + '" and its contents removed.',
                failed ? 'error' : 'success');
        }
        ghDeleteCancelConfirm();
        await ghDeleteBrowse();
    } catch (err) {
        ghSetDeleteStatus('Delete failed: ' + (err.message || String(err)), 'err');
        showToast('Delete failed', err.message || String(err), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = origHTML; lucide.createIcons(); }
    }
}

async function ghDeleteSingleFile(repo, branch, path, sha, name) {
    if (!sha) {
        const infoUrl = 'https://api.github.com/repos/' + repo + '/contents/' + encodeURI(path) +
            '?ref=' + encodeURIComponent(branch);
        const infoResp = await fetch(infoUrl, { headers: figGitHubHeaders() });
        if (!infoResp.ok) throw new Error('Could not fetch sha for ' + path);
        const info = await infoResp.json();
        sha = info.sha;
    }
    const resp = await fetch(
        'https://api.github.com/repos/' + repo + '/contents/' + encodeURI(path),
        {
            method: 'DELETE',
            headers: {
                'Authorization': 'Bearer ' + ghJsonCreds.token,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: 'Delete ' + (name || path), sha: sha, branch: branch }),
        }
    );
    if (!resp.ok) {
        let msg = 'HTTP ' + resp.status;
        try { const j = await resp.json(); msg = j.message || msg; } catch (e) {}
        throw new Error(msg);
    }
}

async function ghCollectFolderFiles(repo, branch, folderPath) {
    const results = [];
    const stack   = [folderPath];
    while (stack.length) {
        const dir  = stack.pop();
        const url  = 'https://api.github.com/repos/' + repo + '/contents/' + encodeURI(dir) +
            '?ref=' + encodeURIComponent(branch);
        const resp = await fetch(url, { headers: figGitHubHeaders() });
        if (!resp.ok) continue;
        const items = await resp.json();
        if (!Array.isArray(items)) continue;
        items.forEach(function(x) {
            if (x.type === 'file')     results.push({ path: x.path, sha: x.sha, name: x.name });
            else if (x.type === 'dir') stack.push(x.path);
        });
    }
    return results;
}

(function wireGhDelete() {
    const pathIn  = document.getElementById('fig-gh-del-path');
    const exactIn = document.getElementById('fig-gh-del-exact');
    if (pathIn)  pathIn.addEventListener('keydown',  function(e) { if (e.key === 'Enter') { e.preventDefault(); ghDeleteBrowse(); } });
    if (exactIn) exactIn.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); ghDeleteByExactPath(); } });
})();

// ==================== EDITOR TAB: GITHUB LOAD & UPDATE ====================
// The Editor tab can load its Base JSON from GitHub and commit the
// edited result straight back, using the same independent JSON creds.
// (editorGitHubFile is declared near editorDriveFile, above.)

// Receive a JSON loaded from GitHub into the Editor tab.
function deliverGitHubFileToEditor(ghFile, data) {
    if (!loadEditorBaseData(data, ghFile.name)) return;
    // Link GitHub; clear Drive (sources are mutually exclusive).
    editorGitHubFile = ghFile;
    editorDriveFile = null;
    editorShowGitHubLink();
    showEditorDriveLink();
    refreshEditorGitHubButtons();
    refreshEditorDriveButtons();
    switchTab('editor');
    showToast('Loaded from GitHub',
        `${data.posts.length} questions. File stays linked — edits can be committed back.`, 'success');
}

function editorShowGitHubLink() {
    const row = document.getElementById('editor-github-link-row');
    if (!row) return;
    if (editorGitHubFile && editorGitHubFile.path) {
        row.classList.remove('hidden');
        row.classList.add('flex');
        document.getElementById('editor-github-link-name').textContent =
            `${editorGitHubFile.repo}@${editorGitHubFile.branch}`;
        document.getElementById('editor-github-link-path').textContent = editorGitHubFile.path;
    } else {
        row.classList.add('hidden');
        row.classList.remove('flex');
    }
}

function editorUnlinkGitHub() {
    editorGitHubFile = null;
    editorShowGitHubLink();
    refreshEditorGitHubButtons();
    showToast('Unlinked', 'GitHub file unlinked. Saves will no longer commit to it.', 'info');
}

// Copy the jsDelivr CDN link of the Editor's linked GitHub JSON.
function editorCopyGitHubCdn() {
    const f = editorGitHubFile;
    if (!f || !f.path) {
        showToast('No GitHub file', 'Load a JSON from GitHub first.', 'error');
        return;
    }
    ghCopyToClipboard(ghJsonCdnUrl(f.repo, f.branch, f.path), 'jsDelivr CDN link');
}

function refreshEditorGitHubButtons() {
    const btn = document.getElementById('btn-update-github');
    if (!btn) return;
    let hasExport = false;
    try { hasExport = !!editorExportData; } catch (e) { hasExport = false; }
    const ok = !!(hasExport && editorGitHubFile && editorGitHubFile.path);
    btn.classList.toggle('hidden', !ok);
    if (ok) {
        document.getElementById('btn-update-github-label').textContent =
            `Update to GitHub (${editorGitHubFile.name || editorGitHubFile.path})`;
        const hint = document.getElementById('editor-drive-update-hint');
        if (hint) hint.classList.remove('hidden');
    }
}

// Commit the editor's exported JSON back to its linked GitHub file.
async function editorUpdateToGitHub() {
    if (!editorExportData) {
        showToast('Export first', 'Generate the edited JSON before updating.', 'error');
        return;
    }
    if (!editorGitHubFile || !editorGitHubFile.path) {
        showToast('Not linked', 'No GitHub file is linked. Load the JSON from GitHub first.', 'error');
        return;
    }
    const btn = document.getElementById('btn-update-github');
    const origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Updating...';
    lucide.createIcons();
    try {
        editorGitHubFile.sha = await ghCommitJsonFile(
            editorGitHubFile, editorExportData,
            'Update MCQ JSON — ' + editorGitHubFile.name);
        showToast('Saved to GitHub',
            `Committed to ${editorGitHubFile.repo}@${editorGitHubFile.branch} — ${editorGitHubFile.path}.`,
            'success');
    } catch (err) {
        showToast('Update failed', err.message || String(err), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHTML;
        lucide.createIcons();
    }
}
(function wireEditorUpdateGitHub() {
    const b = document.getElementById('btn-update-github');
    if (b) b.addEventListener('click', editorUpdateToGitHub);
})();

// ============================================================
// ==================== FRONTEND BUILDER ======================
// ============================================================
// A visual builder for AI MCQs quiz embeds. Produces ready-to-paste
// code for all three embedding methods (inline JSON, single URL,
// multi-file merge) with the basic / professional exam interface.

const fbState = {
    method: '1',          // '1' | '2' | '3'
    iface: 'basic',       // 'basic' | 'professional'
    multiRows: [          // method 3 rows
        { url: '', topic: 'Chapter 1 Title' },
        { url: '', topic: 'Chapter 2 Title' },
    ],
};

// ---- Method selection ----
function fbSetMethod(m) {
    fbState.method = String(m);
    document.querySelectorAll('.fb-method-card').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-method') === fbState.method);
    });
    // Source panels
    document.getElementById('fb-source-inline').classList.toggle('hidden', fbState.method !== '1');
    document.getElementById('fb-source-single').classList.toggle('hidden', fbState.method !== '2');
    document.getElementById('fb-source-multi').classList.toggle('hidden', fbState.method !== '3');
    // Title + default container ID
    const titles = { '1': 'Quiz Source — Inline JSON', '2': 'Quiz Source — JSON URL', '3': 'Quiz Source — Multiple Files' };
    document.getElementById('fb-source-title').textContent = titles[fbState.method];
    const idEl = document.getElementById('fb-container-id');
    if (idEl && /^aimcq-quiz-\d$/.test(idEl.value)) idEl.value = 'aimcq-quiz-' + fbState.method;
    fbGenerate();
}

// ---- Interface selection ----
function fbSetIface(i) {
    fbState.iface = (i === 'professional') ? 'professional' : 'basic';
    document.querySelectorAll('.fb-iface-card').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-iface') === fbState.iface);
    });
    // Show/hide professional-only fields.
    const pro = fbState.iface === 'professional';
    document.querySelectorAll('.fb-pro-only').forEach(el => el.classList.toggle('hidden', !pro));
    const note = document.querySelector('.fb-pro-note');
    if (note) note.classList.toggle('hidden', !pro);
    fbGenerate();
}

// ---- Method 3 multi-file rows ----
function fbRenderMultiRows() {
    const wrap = document.getElementById('fb-multi-rows');
    if (!wrap) return;
    wrap.innerHTML = '';
    fbState.multiRows.forEach((row, i) => {
        const div = document.createElement('div');
        div.className = 'fb-multi-row';
        div.innerHTML = `
            <input type="text" class="fb-input fb-multi-url" data-i="${i}"
                placeholder="https://cdn.jsdelivr.net/gh/USER/REPO@TAG/ch${i + 1}.json"
                value="${escapeAttr(row.url)}" style="flex:2">
            <input type="text" class="fb-input fb-multi-topic" data-i="${i}"
                placeholder="Topic name" value="${escapeAttr(row.topic)}" style="flex:1">
            <button type="button" class="fb-multi-del" data-i="${i}" title="Remove">
                <i data-lucide="x" class="w-3.5 h-3.5"></i>
            </button>
        `;
        wrap.appendChild(div);
    });
    wrap.querySelectorAll('.fb-multi-url').forEach(inp => {
        inp.addEventListener('input', () => {
            fbState.multiRows[+inp.getAttribute('data-i')].url = inp.value;
            fbGenerate();
        });
    });
    wrap.querySelectorAll('.fb-multi-topic').forEach(inp => {
        inp.addEventListener('input', () => {
            fbState.multiRows[+inp.getAttribute('data-i')].topic = inp.value;
            fbGenerate();
        });
    });
    wrap.querySelectorAll('.fb-multi-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = +btn.getAttribute('data-i');
            if (fbState.multiRows.length <= 1) {
                showToast('Keep one', 'At least one file is required.', 'error');
                return;
            }
            fbState.multiRows.splice(i, 1);
            fbRenderMultiRows();
            fbGenerate();
        });
    });
    lucide.createIcons();
}

// ---- Code generation ----
// Indent a multi-line string by `pad` spaces (every line after the first).
function fbIndent(str, pad) {
    const p = ' '.repeat(pad);
    return str.split('\n').map((l, i) => i === 0 ? l : (l ? p + l : l)).join('\n');
}

// Build the settings object literal as formatted JS source.
// Detect the quiz languages from whatever JSON the Frontend Builder has
// in-hand: Method 1's inline JSON textarea, else the loaded Editor/Figures
// data. Returns e.g. ['EN','HI'] or [] when nothing is parseable.
function fbDetectLanguages() {
    var data = null;
    if (fbState.method === '1') {
        var ta = document.getElementById('fb-inline-json');
        var txt = ta && ta.value ? ta.value.trim() : '';
        if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }
    }
    if (!data) {
        try {
            data = (typeof editorExportData !== 'undefined' && editorExportData) ? editorExportData
                 : (typeof editorBaseData !== 'undefined' && editorBaseData) ? editorBaseData
                 : (typeof figState !== 'undefined' && figState && figState.data) ? figState.data
                 : null;
        } catch (e) { data = null; }
    }
    if (!data || !Array.isArray(data.posts)) return [];
    var resolved = aimcqResolveLanguages(data);
    return (resolved && resolved.codes) ? resolved.codes : [];
}

function fbBuildSettings(indent) {
    const val = id => document.getElementById(id);
    const num = id => { const n = parseFloat(val(id).value); return isNaN(n) ? 0 : n; };
    const bool = id => val(id).checked;
    const str = id => (val(id).value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // Each entry: { code } for a key:value line, or { comment } for a comment.
    const items = [];
    items.push({ code: `title: "${str('fb-title')}"` });
    items.push({ code: `description: "${str('fb-description')}"` });
    items.push({ code: `timer: ${num('fb-timer')}` });
    items.push({ code: `display_mode: '${val('fb-display-mode').value}'` });
    items.push({ code: `feedback_mode: '${val('fb-feedback-mode').value}'` });
    items.push({ code: `show_explanation: ${bool('fb-show-explanation')}` });
    items.push({ code: `shuffle_questions: ${bool('fb-shuffle-q')}` });
    items.push({ code: `shuffle_options: ${bool('fb-shuffle-o')}` });
    items.push({ code: `quiz_questions: ${num('fb-quiz-questions')}` });
    items.push({ code: `reload_after: ${num('fb-reload-after')}` });

    // Method 3: topic_order from the row topics (if forced).
    if (fbState.method === '3' && document.getElementById('fb-multi-order').checked) {
        const topics = fbState.multiRows
            .map(r => (r.topic || '').trim())
            .filter(Boolean);
        if (topics.length) {
            const arr = topics.map(t => `'${t.replace(/'/g, "\\'")}'`).join(', ');
            items.push({ code: `topic_order: [${arr}]` });
        }
    }

    items.push({ comment: `// 'basic' or 'professional' exam interface` });
    items.push({ code: `exam_interface: '${fbState.iface}'` });
    if (fbState.iface === 'professional') {
        items.push({ code: `marks_per_question: ${num('fb-marks')}` });
        items.push({ code: `negative_marks: ${num('fb-negative')}` });
    }

    // Languages — detected from the source JSON's term `language_code`
    // (e.g. "02ENHI") or inferred from content. Lets the frontend render the
    // right language toggle / labels. Only emitted when we can read the data
    // in-hand (Method 1 inline JSON, or the loaded Editor/Figures data).
    var langCodes = fbDetectLanguages();
    if (langCodes && langCodes.length) {
        const arr = langCodes.map(c => `'${c}'`).join(', ');
        items.push({ comment: `// languages present in this quiz (for language labels/toggle)` });
        items.push({ code: `languages: [${arr}]` });
    }

    // Render: each code line gets a trailing comma except the last code
    // line; comment lines never get a comma.
    const lastCodeIdx = items.reduce((acc, it, i) => it.code ? i : acc, -1);
    const p = ' '.repeat(indent) + '  ';
    const body = items.map((it, i) => {
        if (it.comment) return p + it.comment;
        return p + it.code + (i < lastCodeIdx ? ',' : '');
    }).join('\n');
    return '{\n' + body + '\n' + ' '.repeat(indent) + '}';
}

// Build the <head> block.
function fbBuildHead() {
    const repo = (document.getElementById('fb-engine-repo').value || 'YOUR-USER/aimcq-engine').trim();
    const tag = (document.getElementById('fb-engine-tag').value || '2.0.0').trim();
    return [
        '<!-- AI MCQs Engine — HEAD BLOCK (paste ONCE per site) -->',
        '<link  rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css">',
        `<link  rel="stylesheet" href="https://cdn.jsdelivr.net/gh/${repo}@${tag}/aimcq.css">`,
        '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js"><\/script>',
        '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/contrib/auto-render.min.js"><\/script>',
        '<script defer src="https://unpkg.com/smiles-drawer@2.0.1/dist/smiles-drawer.min.js"><\/script>',
        `<script defer src="https://cdn.jsdelivr.net/gh/${repo}@${tag}/aimcq.js"><\/script>`,
    ].join('\n');
}

// Build the quiz block for the selected method.
function fbBuildQuizBlock() {
    const cid = (document.getElementById('fb-container-id').value || 'aimcq-quiz-1').trim();
    const settings = fbBuildSettings(2);

    if (fbState.method === '1') {
        // Inline JSON via initAimcqQuiz.
        let jsonText = (document.getElementById('fb-inline-json').value || '').trim();
        if (!jsonText) jsonText = '{ /* paste your exported quiz JSON here */ }';
        else {
            // Pretty-print if valid; otherwise leave as-is.
            try { jsonText = JSON.stringify(JSON.parse(jsonText), null, 2); } catch (e) {}
        }
        const jsonIndented = fbIndent(jsonText, 2);
        return [
            `<div id="${cid}"></div>`,
            '<script>',
            "document.addEventListener('DOMContentLoaded', function () {",
            '',
            '  var quizData = ' + jsonIndented + ';',
            '',
            `  window.initAimcqQuiz('${cid}', quizData, ${settings});`,
            '});',
            '<\/script>',
        ].join('\n');
    }

    if (fbState.method === '2') {
        // Single remote JSON via loadAimcqFromDrive.
        const url = (document.getElementById('fb-single-url').value || 'Source JSON Link Here').trim();
        return [
            `<div id="${cid}"></div>`,
            '<script>',
            "document.addEventListener('DOMContentLoaded', function () {",
            `  window.loadAimcqFromDrive('${cid}', {`,
            `    jsonUrl: '${url}',`,
            '    settings: ' + fbIndent(settings, 4),
            '  });',
            '});',
            '<\/script>',
        ].join('\n');
    }

    // Method 3: multiple JSON files.
    const rows = fbState.multiRows.filter(r => (r.url || '').trim() || (r.topic || '').trim());
    const urlEntries = (rows.length ? rows : [{ url: '', topic: 'Chapter 1' }]).map(r => {
        const u = (r.url || '').trim() || 'Source JSON Link Here';
        const t = (r.topic || '').trim() || 'Topic';
        return `    { jsonUrl: '${u}', topic: '${t.replace(/'/g, "\\'")}' }`;
    }).join(',\n');
    return [
        `<div id="${cid}"></div>`,
        '<script>',
        "document.addEventListener('DOMContentLoaded', function () {",
        `  window.loadAimcqFromDrive('${cid}', {`,
        '    jsonUrls: [',
        urlEntries,
        '    ],',
        '    settings: ' + fbIndent(settings, 4),
        '  });',
        '});',
        '<\/script>',
    ].join('\n');
}

// Regenerate the full code output.
function fbGenerate() {
    const includeHead = document.getElementById('fb-include-head').checked;
    const quiz = fbBuildQuizBlock();
    let out = '';
    if (includeHead) {
        out = fbBuildHead() + '\n\n\n' +
            '<!-- QUIZ BLOCK (paste where the quiz should appear) -->\n' + quiz;
    } else {
        out = quiz;
    }
    const codeEl = document.querySelector('#fb-code-output code');
    if (codeEl) codeEl.textContent = out;
}

// ---- Copy buttons ----
function fbCopy(which) {
    let text = '';
    if (which === 'head') text = fbBuildHead();
    else if (which === 'quiz') text = fbBuildQuizBlock();
    else text = (document.querySelector('#fb-code-output code') || {}).textContent || '';
    if (!text) { showToast('Nothing to copy', 'Generate the code first.', 'error'); return; }
    ghCopyToClipboard(text,
        which === 'head' ? 'Head block' : which === 'quiz' ? 'Quiz block' : 'Full code');
}

// ---- Wire the builder ----
(function wireFrontendBuilder() {
    // Method radio cards
    document.querySelectorAll('.fb-method-card').forEach(card => {
        card.addEventListener('click', () => fbSetMethod(card.getAttribute('data-method')));
    });
    // Interface radio cards
    document.querySelectorAll('.fb-iface-card').forEach(card => {
        card.addEventListener('click', () => fbSetIface(card.getAttribute('data-iface')));
    });
    // Every settings input regenerates on change.
    ['fb-container-id','fb-title','fb-description','fb-timer','fb-quiz-questions',
     'fb-reload-after','fb-display-mode','fb-feedback-mode','fb-marks','fb-negative',
     'fb-shuffle-q','fb-shuffle-o','fb-show-explanation','fb-engine-repo','fb-engine-tag',
     'fb-include-head','fb-single-url'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', fbGenerate);
            el.addEventListener('change', fbGenerate);
        }
    });
    // Inline JSON textarea
    const inlineTa = document.getElementById('fb-inline-json');
    if (inlineTa) inlineTa.addEventListener('input', () => {
        const status = document.getElementById('fb-inline-status');
        const v = inlineTa.value.trim();
        if (status) {
            if (!v) { status.textContent = ''; }
            else {
                try {
                    const d = JSON.parse(v);
                    const n = Array.isArray(d.posts) ? d.posts.length : '?';
                    status.textContent = `\u2713 Valid JSON — ${n} questions`;
                    status.className = 'text-[11px] text-green-600 font-semibold';
                } catch (e) {
                    status.textContent = '\u26a0 Not valid JSON yet';
                    status.className = 'text-[11px] text-amber-600';
                }
            }
        }
        fbGenerate();
    });
    // Inline JSON helpers
    const useEditor = document.getElementById('fb-inline-use-editor');
    if (useEditor) useEditor.addEventListener('click', () => {
        const d = (typeof editorExportData !== 'undefined' && editorExportData)
            ? editorExportData
            : (typeof editorBaseData !== 'undefined' ? editorBaseData : null);
        if (!d) { showToast('No JSON', 'Load a file in the JSON Editor tab first.', 'error'); return; }
        inlineTa.value = JSON.stringify(aimcqCanonicalizeExport(d), null, 2);
        inlineTa.dispatchEvent(new Event('input'));
    });
    const useFigures = document.getElementById('fb-inline-use-figures');
    if (useFigures) useFigures.addEventListener('click', () => {
        if (!figState.data) { showToast('No JSON', 'Load a file in the Figure Updater tab first.', 'error'); return; }
        inlineTa.value = JSON.stringify(aimcqCanonicalizeExport(figState.data), null, 2);
        inlineTa.dispatchEvent(new Event('input'));
    });
    const fmtBtn = document.getElementById('fb-inline-format');
    if (fmtBtn) fmtBtn.addEventListener('click', () => {
        try {
            inlineTa.value = JSON.stringify(JSON.parse(inlineTa.value), null, 2);
            inlineTa.dispatchEvent(new Event('input'));
            showToast('Formatted', 'JSON pretty-printed.', 'success');
        } catch (e) {
            showToast('Invalid JSON', 'Could not parse: ' + e.message, 'error');
        }
    });
    // Method 3 add-file
    const addBtn = document.getElementById('fb-multi-add');
    if (addBtn) addBtn.addEventListener('click', () => {
        fbState.multiRows.push({ url: '', topic: 'Chapter ' + (fbState.multiRows.length + 1) + ' Title' });
        fbRenderMultiRows();
        fbGenerate();
    });
    const orderCb = document.getElementById('fb-multi-order');
    if (orderCb) orderCb.addEventListener('change', fbGenerate);
    // Copy buttons
    const cH = document.getElementById('fb-copy-head');
    const cQ = document.getElementById('fb-copy-quiz');
    const cA = document.getElementById('fb-copy-all');
    if (cH) cH.addEventListener('click', () => fbCopy('head'));
    if (cQ) cQ.addEventListener('click', () => fbCopy('quiz'));
    if (cA) cA.addEventListener('click', () => fbCopy('all'));

    // Initial render
    fbRenderMultiRows();
    fbSetMethod('1');
    fbSetIface('basic');
})();

// ============================================================
// ==================== QUIZ BUILDER ==========================
// ============================================================
// Build a new quiz JSON by drag-and-drop of questions from one or
// more source files into a new question list.

const qbState = {
    sources: [],     // [{ filename, data }]
    picked: [],      // [{ srcIdx, postIdx }] — questions in the new quiz
};

// ---- Load source files ----
function qbLoadSources(fileList) {
    const files = Array.from(fileList).filter(f => /\.json$/i.test(f.name));
    if (!files.length) { showToast('No JSON files', 'Please select valid .json files.', 'error'); return; }
    let loaded = 0;
    const fresh = [];
    files.forEach(file => {
        const r = new FileReader();
        r.onload = e => {
            try {
                const data = JSON.parse(e.target.result);
                if (isValidAimcqJSON(data)) fresh.push({ filename: file.name, data });
            } catch (err) { /* skip invalid */ }
            if (++loaded === files.length) {
                const existing = new Set(qbState.sources.map(s => s.filename));
                fresh.forEach(s => { if (!existing.has(s.filename)) qbState.sources.push(s); });
                qbOnSourcesChanged();
                showToast('Sources loaded',
                    `${qbState.sources.length} source file(s) ready.`, 'success');
            }
        };
        r.readAsText(file);
    });
}

// Accept a JSON loaded from GitHub into the Quiz Builder.
function deliverGitHubFileToQuizBuilder(ghFile, data) {
    if (!isValidAimcqJSON(data)) {
        showToast('Invalid JSON', "File doesn't look like aimcq format.", 'error');
        return;
    }
    if (!qbState.sources.some(s => s.filename === ghFile.name)) {
        qbState.sources.push({ filename: ghFile.name, data });
    }
    qbOnSourcesChanged();
    switchTab('quizbuilder');
    showToast('Source loaded', `${data.posts.length} questions from ${ghFile.name}.`, 'success');
}

function qbOnSourcesChanged() {
    // Show workspace once at least one source exists.
    document.getElementById('qb-workspace').classList.toggle('hidden', !qbState.sources.length);
    // Source badges
    const badges = document.getElementById('qb-source-badges');
    if (qbState.sources.length) {
        badges.classList.remove('hidden');
        badges.classList.add('flex');
        badges.innerHTML = '';
        qbState.sources.forEach((src, i) => {
            const color = COLORS[i % COLORS.length];
            const b = document.createElement('span');
            b.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white';
            b.style.background = color;
            b.innerHTML = `<i data-lucide="file-json" class="w-3 h-3"></i> ` +
                `${escapeHtml(src.filename)} (${src.data.posts.length})` +
                `<button data-i="${i}" class="qb-rm-src ml-0.5 opacity-80 hover:opacity-100" title="Remove">\u00d7</button>`;
            badges.appendChild(b);
        });
        document.getElementById('qb-source-name').textContent =
            `${qbState.sources.length} source file(s) loaded`;
        document.querySelectorAll('.qb-rm-src').forEach(btn => {
            btn.addEventListener('click', e => {
                const i = +e.currentTarget.getAttribute('data-i');
                qbState.sources.splice(i, 1);
                // Drop picked questions from that source; reindex the rest.
                qbState.picked = qbState.picked
                    .filter(p => p.srcIdx !== i)
                    .map(p => ({ srcIdx: p.srcIdx > i ? p.srcIdx - 1 : p.srcIdx, postIdx: p.postIdx }));
                qbOnSourcesChanged();
            });
        });
    } else {
        badges.classList.add('hidden');
        document.getElementById('qb-source-name').textContent = 'Click or drag one or more source JSONs here';
    }
    // File filter dropdown
    const filter = document.getElementById('qb-source-file-filter');
    if (filter) {
        const cur = filter.value;
        filter.innerHTML = '<option value="all">All source files</option>' +
            qbState.sources.map((s, i) => `<option value="${i}">${escapeHtml(s.filename)}</option>`).join('');
        if (cur && (cur === 'all' || +cur < qbState.sources.length)) filter.value = cur;
    }
    qbRenderSource();
    qbRenderNew();
    lucide.createIcons();
}

// Short label for a question (used on the cards).
function qbQuestionText(post) {
    let t = (post && post.post_title) || '';
    t = t.replace(/<[^>]+>/g, '').replace(/\$\$?[^$]*\$\$?/g, '[math]').trim();
    return t || '(untitled question)';
}

// ---- Render the SOURCE list ----
function qbRenderSource() {
    const list = document.getElementById('qb-source-list');
    if (!list) return;
    const fileFilter = document.getElementById('qb-source-file-filter').value;
    const search = (document.getElementById('qb-source-search').value || '').toLowerCase().trim();

    if (!qbState.sources.length) {
        list.innerHTML = '<p class="text-center text-gray-400 text-sm py-8">Load a source file to see questions.</p>';
        document.getElementById('qb-source-count').textContent = '0';
        return;
    }
    // Build the visible list of {srcIdx, postIdx}.
    const rows = [];
    qbState.sources.forEach((src, si) => {
        if (fileFilter !== 'all' && +fileFilter !== si) return;
        src.data.posts.forEach((post, pi) => {
            if (search && !qbQuestionText(post).toLowerCase().includes(search)) return;
            rows.push({ si, pi, post });
        });
    });
    document.getElementById('qb-source-count').textContent = rows.length;
    if (!rows.length) {
        list.innerHTML = '<p class="text-center text-gray-400 text-sm py-8">No questions match.</p>';
        return;
    }
    list.innerHTML = '';
    rows.forEach(({ si, pi, post }) => {
        const inQuiz = qbState.picked.some(p => p.srcIdx === si && p.postIdx === pi);
        const color = COLORS[si % COLORS.length];
        const card = document.createElement('div');
        card.className = 'qb-card' + (inQuiz ? ' picked' : '');
        card.draggable = true;
        card.dataset.si = si;
        card.dataset.pi = pi;
        card.innerHTML = `
            <span class="qb-card-dot" style="background:${color}"></span>
            <span class="qb-card-text">${escapeHtml(qbQuestionText(post))}</span>
            <button class="qb-card-add" title="Add to new quiz" ${inQuiz ? 'disabled' : ''}>
                <i data-lucide="${inQuiz ? 'check' : 'plus'}" class="w-3.5 h-3.5"></i>
            </button>`;
        card.addEventListener('dragstart', ev => {
            ev.dataTransfer.setData('text/plain', JSON.stringify({ from: 'source', si, pi }));
            ev.dataTransfer.effectAllowed = 'copy';
        });
        const addBtn = card.querySelector('.qb-card-add');
        if (!inQuiz) addBtn.addEventListener('click', () => qbAdd(si, pi));
        list.appendChild(card);
    });
    lucide.createIcons();
}

// ---- Render the NEW QUIZ list ----
function qbRenderNew() {
    const list = document.getElementById('qb-new-list');
    if (!list) return;
    document.getElementById('qb-new-count').textContent = qbState.picked.length;
    if (!qbState.picked.length) {
        list.innerHTML = '<p id="qb-new-empty" class="text-center text-gray-400 text-sm py-8">' +
            'Your new quiz is empty — drag questions here from the left.</p>';
        return;
    }
    list.innerHTML = '';
    qbState.picked.forEach((p, idx) => {
        const src = qbState.sources[p.srcIdx];
        const post = src && src.data.posts[p.postIdx];
        if (!post) return;
        const color = COLORS[p.srcIdx % COLORS.length];
        const card = document.createElement('div');
        card.className = 'qb-card in-new';
        card.draggable = true;
        card.dataset.idx = idx;
        card.innerHTML = `
            <span class="qb-card-num">${idx + 1}</span>
            <span class="qb-card-dot" style="background:${color}"></span>
            <span class="qb-card-text">${escapeHtml(qbQuestionText(post))}</span>
            <button class="qb-card-rm" title="Remove">
                <i data-lucide="x" class="w-3.5 h-3.5"></i>
            </button>`;
        card.addEventListener('dragstart', ev => {
            ev.dataTransfer.setData('text/plain', JSON.stringify({ from: 'new', idx }));
            ev.dataTransfer.effectAllowed = 'move';
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.querySelector('.qb-card-rm').addEventListener('click', () => {
            qbState.picked.splice(idx, 1);
            qbRenderSource();
            qbRenderNew();
        });
        list.appendChild(card);
    });
    lucide.createIcons();
}

// Add a question to the new quiz (no duplicates).
function qbAdd(si, pi) {
    if (qbState.picked.some(p => p.srcIdx === si && p.postIdx === pi)) return;
    qbState.picked.push({ srcIdx: si, postIdx: pi });
    qbRenderSource();
    qbRenderNew();
}

// Reorder within the new quiz.
function qbMove(from, to) {
    if (from === to) return;
    const item = qbState.picked.splice(from, 1)[0];
    qbState.picked.splice(to, 0, item);
    qbRenderNew();
}

// ---- Build & download the new quiz JSON ----
function qbBuildJson() {
    // Use the first source as the template for top-level fields.
    const base = qbState.sources[0] ? qbState.sources[0].data : {};
    const out = {
        version: base.version || '5',
        export_type: base.export_type || 'aimcq_quiz',
        terms: Array.isArray(base.terms) ? base.terms : [],
        posts: qbState.picked.map(p => qbState.sources[p.srcIdx].data.posts[p.postIdx]),
    };
    const title = (document.getElementById('qb-quiz-title').value || '').trim();
    if (title) out.quiz_title = title;
    return out;
}

// ---- Wire the Quiz Builder ----
(function wireQuizBuilder() {
    const zone = document.getElementById('qb-source-dropzone');
    const input = document.getElementById('qb-source-files');
    if (input) input.addEventListener('change', e => {
        if (e.target.files.length) qbLoadSources(e.target.files);
    });
    if (zone) {
        ['dragenter','dragover','dragleave','drop'].forEach(ev =>
            zone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
        ['dragenter','dragover'].forEach(ev =>
            zone.addEventListener(ev, () => zone.classList.add('drag-active')));
        ['dragleave','drop'].forEach(ev =>
            zone.addEventListener(ev, () => zone.classList.remove('drag-active')));
        zone.addEventListener('drop', e => {
            if (e.dataTransfer.files?.length) qbLoadSources(e.dataTransfer.files);
        });
    }
    // Source filters
    const fileFilter = document.getElementById('qb-source-file-filter');
    const search = document.getElementById('qb-source-search');
    if (fileFilter) fileFilter.addEventListener('change', qbRenderSource);
    if (search) search.addEventListener('input', qbRenderSource);

    // New-quiz list = drop target for source cards + reordering.
    const newList = document.getElementById('qb-new-list');
    if (newList) {
        newList.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            newList.classList.add('qb-drop-active');
        });
        newList.addEventListener('dragleave', () => newList.classList.remove('qb-drop-active'));
        newList.addEventListener('drop', e => {
            e.preventDefault();
            newList.classList.remove('qb-drop-active');
            let payload;
            try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); }
            catch (err) { return; }

            // Figure out the drop position from the card under the cursor.
            const cards = [...newList.querySelectorAll('.qb-card.in-new')];
            let dropIdx = cards.length;
            for (let i = 0; i < cards.length; i++) {
                const r = cards[i].getBoundingClientRect();
                if (e.clientY < r.top + r.height / 2) { dropIdx = i; break; }
            }
            if (payload.from === 'source') {
                if (!qbState.picked.some(p => p.srcIdx === payload.si && p.postIdx === payload.pi)) {
                    qbState.picked.splice(dropIdx, 0, { srcIdx: payload.si, postIdx: payload.pi });
                    qbRenderSource();
                    qbRenderNew();
                }
            } else if (payload.from === 'new') {
                let to = dropIdx;
                if (payload.idx < to) to--;   // account for the removed item
                qbMove(payload.idx, Math.max(0, to));
            }
        });
    }
    // Add all shown
    const addAll = document.getElementById('qb-add-all');
    if (addAll) addAll.addEventListener('click', () => {
        const fileFilterV = document.getElementById('qb-source-file-filter').value;
        const searchV = (document.getElementById('qb-source-search').value || '').toLowerCase().trim();
        let added = 0;
        qbState.sources.forEach((src, si) => {
            if (fileFilterV !== 'all' && +fileFilterV !== si) return;
            src.data.posts.forEach((post, pi) => {
                if (searchV && !qbQuestionText(post).toLowerCase().includes(searchV)) return;
                if (!qbState.picked.some(p => p.srcIdx === si && p.postIdx === pi)) {
                    qbState.picked.push({ srcIdx: si, postIdx: pi });
                    added++;
                }
            });
        });
        qbRenderSource();
        qbRenderNew();
        showToast('Added', `${added} question(s) added to the new quiz.`, 'success');
    });
    // Clear new quiz
    const clearNew = document.getElementById('qb-clear-new');
    if (clearNew) clearNew.addEventListener('click', () => {
        if (!qbState.picked.length) return;
        qbState.picked = [];
        qbRenderSource();
        qbRenderNew();
    });
    // Download
    const dl = document.getElementById('qb-download');
    if (dl) dl.addEventListener('click', () => {
        if (!qbState.picked.length) {
            showToast('Empty quiz', 'Add at least one question first.', 'error');
            return;
        }
        let name = (document.getElementById('qb-filename').value || 'new-quiz.json').trim();
        if (!/\.json$/i.test(name)) name += '.json';
        downloadJSON(qbBuildJson(), name);
        showToast('Downloaded', `${qbState.picked.length} questions exported.`, 'success');
    });
    // Upload to GitHub — stage in the GitHub picker's Upload tab.
    const up = document.getElementById('qb-upload-github');
    if (up) up.addEventListener('click', () => {
        if (!qbState.picked.length) {
            showToast('Empty quiz', 'Add at least one question first.', 'error');
            return;
        }
        figGitHubOpenPicker('quizbuilder');
        ghSwitchTab('upload');
        let name = (document.getElementById('qb-filename').value || 'new-quiz.json').trim();
        if (!/\.json$/i.test(name)) name += '.json';
        ghStageUpload(qbBuildJson(), name);
        ghSetUploadStatus('New quiz staged — pick a folder and click Upload.', 'ok');
    });
})();


