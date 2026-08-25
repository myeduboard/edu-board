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
        `\u2713 ${editorBaseFileName} \u2014 ${aimcqCountLabel(data.posts)}`;
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
    const tabs = ['split','combine','quizbuilder','editor','figures','extractor','builder'];
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
    aimcqWarnPassageIssues(data, filename);
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
/* --------------------------------------------------------------------
   PASSAGE SUPPORT (reading-comprehension groups)
   --------------------------------------------------------------------
   An aimcq bundle can contain `post_type: "passage"` posts plus normal
   questions that link to them via meta keys:
       question →  _aimcq_is_passage_question : "yes"
                   _aimcq_passage_id          : "<passage post id>"
       passage  →  _aimcq_passage_content_hi, _aimcq_passage_display_title_en,
                   _aimcq_passage_display_title_hi,
                   _aimcq_passage_translation_custom_prompt
   These keys MUST survive every export, otherwise the aimcq engine can
   no longer link questions to their passage and the passage box silently
   disappears on the rendered quiz. The canonicalizers below therefore
   preserve them explicitly (they are NOT "extras" like _aimcq_seo_robots).
   -------------------------------------------------------------------- */
var AIMCQ_QUESTION_PASSAGE_KEYS = ['_aimcq_is_passage_question', '_aimcq_passage_id'];
var AIMCQ_PASSAGE_META_KEYS = [
    '_aimcq_passage_content_hi', '_aimcq_passage_translation_custom_prompt',
    '_aimcq_passage_display_title_en', '_aimcq_passage_display_title_hi'
];

function aimcqIsPassagePost(post) {
    return !!post && post.post_type === 'passage';
}
function aimcqIsPassageQuestion(post) {
    if (!post || post.post_type === 'passage') return false;
    var m = post.meta_input || {};
    return m._aimcq_is_passage_question === 'yes' || aimcqHasText(m._aimcq_passage_id);
}
function aimcqGetPassageId(post) {
    var m = (post && post.meta_input) || {};
    return m._aimcq_passage_id != null ? String(m._aimcq_passage_id) : '';
}

// One option object → { text, image[, image_width, image_height] } in that
// order (other extras dropped). The figure-dimension keys are preserved
// whenever present on the source option so exported options keep their
// saved image size instead of falling back to the tool's default on
// reimport.
function aimcqCanonicalizeOption(opt) {
    if (!opt || typeof opt !== 'object') return { text: '', image: '' };
    var out = {
        text: opt.text != null ? opt.text : '',
        image: opt.image != null ? opt.image : ''
    };
    if (opt.image_width != null) out.image_width = String(opt.image_width);
    if (opt.image_height != null) out.image_height = String(opt.image_height);
    return out;
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
function aimcqCanonicalizeMeta(meta, langCodes, promoteLang, postType) {
    meta = (meta && typeof meta === 'object') ? meta : {};
    var keepHi = aimcqMetaKeepHindi(langCodes);
    var map = promoteLang ? AIMCQ_SECONDARY_FIELDS[promoteLang] : null;
    var out = {};

    // ---- PASSAGE POSTS: emit the passage meta shape and stop. ----
    // A passage post carries its text in post_title/post_content and its
    // Hindi/translation variants + display titles in the passage keys.
    // It has no options/answers of its own.
    if (postType === 'passage') {
        AIMCQ_PASSAGE_META_KEYS.forEach(function (k) {
            out[k] = meta[k] != null ? meta[k] : '';
        });
        out._aimcq_explanation = meta._aimcq_explanation != null ? meta._aimcq_explanation : '';
        if (keepHi) {
            out._aimcq_title_hi = meta._aimcq_title_hi != null ? meta._aimcq_title_hi : '';
            out._aimcq_question_content_hi = meta._aimcq_question_content_hi != null ? meta._aimcq_question_content_hi : '';
            out._aimcq_explanation_hi = meta._aimcq_explanation_hi != null ? meta._aimcq_explanation_hi : '';
        }
        return out;
    }

    var optsSrc = (map && Array.isArray(meta[map._aimcq_options]) && meta[map._aimcq_options].length)
        ? meta[map._aimcq_options] : meta._aimcq_options;
    out._aimcq_options = Array.isArray(optsSrc) ? optsSrc.map(aimcqCanonicalizeOption) : [];

    var explSrc = (map && aimcqHasText(meta[map._aimcq_explanation]))
        ? meta[map._aimcq_explanation] : meta._aimcq_explanation;
    out._aimcq_explanation = explSrc != null ? explSrc : '';

    // ---- QUESTION → PASSAGE LINKAGE: always preserved when present. ----
    // Without these two keys the aimcq engine cannot attach the question to
    // its reading passage, so the passage box is never displayed.
    if (meta._aimcq_is_passage_question === 'yes' || aimcqHasText(meta._aimcq_passage_id)) {
        out._aimcq_is_passage_question = meta._aimcq_is_passage_question === 'yes' ? 'yes' : 'yes';
        out._aimcq_passage_id = meta._aimcq_passage_id != null ? String(meta._aimcq_passage_id) : '';
    }

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
    var isPassage = post.post_type === 'passage';
    var map = promoteLang ? AIMCQ_SECONDARY_FIELDS[promoteLang] : null;
    var out = {};
    if ('id' in post) out.id = post.id;
    out.post_author  = post.post_author != null ? post.post_author : 1;
    out.post_date    = post.post_date != null ? post.post_date : '';
    if (isPassage) {
        // Passage posts carry the passage text itself in post_title/post_content.
        // When promoting to Hindi-only, prefer the passage's Hindi content field.
        var hiPassage = (promoteLang === 'HI' && aimcqHasText(meta0._aimcq_passage_content_hi))
            ? meta0._aimcq_passage_content_hi : null;
        out.post_title   = hiPassage != null ? hiPassage : (post.post_title != null ? post.post_title : '');
        out.post_content = hiPassage != null ? hiPassage : (post.post_content != null ? post.post_content : '');
    } else {
        out.post_title   = (map && aimcqHasText(meta0[map.post_title]))
            ? meta0[map.post_title] : (post.post_title != null ? post.post_title : '');
        out.post_content = (map && aimcqHasText(meta0[map.post_content]))
            ? meta0[map.post_content] : (post.post_content != null ? post.post_content : '');
    }
    out.post_status  = post.post_status != null ? post.post_status : 'publish';
    out.post_type    = post.post_type != null ? post.post_type : 'question';
    out.meta_input   = aimcqCanonicalizeMeta(post.meta_input, langCodes, promoteLang, out.post_type);
    out.taxonomies   = (post.taxonomies && typeof post.taxonomies === 'object') ? post.taxonomies : {};
    out.embedded_media = Array.isArray(post.embedded_media) ? post.embedded_media : [];
    return out;
}

/* --------------------------------------------------------------------
   PASSAGE INTEGRITY CHECK
   --------------------------------------------------------------------
   Returns an array of human-readable warning strings for a bundle:
     - questions that link to a passage id that is not in the bundle
       (the aimcq engine can never show their passage box), and
     - passage posts that no question links to (dead weight; the engine
       will never display them).
   Called at export time so the user is told BEFORE uploading a JSON
   that would render without its passage.
   -------------------------------------------------------------------- */
function aimcqValidatePassages(data) {
    var warnings = [];
    if (!data || !Array.isArray(data.posts)) return warnings;
    var passageIds = {};
    data.posts.forEach(function (p) {
        if (aimcqIsPassagePost(p) && p.id != null) passageIds[String(p.id)] = true;
    });
    var linkedTo = {};
    var broken = {};
    data.posts.forEach(function (p) {
        if (!aimcqIsPassageQuestion(p)) return;
        var pid = aimcqGetPassageId(p);
        if (!pid) { warnings.push('Question id ' + p.id + ' is marked as a passage question but has no _aimcq_passage_id.'); return; }
        if (passageIds[pid]) linkedTo[pid] = true;
        else { broken[pid] = broken[pid] || []; broken[pid].push(p.id); }
    });
    Object.keys(broken).forEach(function (pid) {
        warnings.push('Questions ' + broken[pid].join(', ') + ' link to passage id ' + pid
            + ' but that passage post is NOT in this file — the passage will not display in the quiz.');
    });
    Object.keys(passageIds).forEach(function (pid) {
        if (!linkedTo[pid]) warnings.push('Passage id ' + pid + ' has no linked questions in this file and will never be shown.');
    });
    return warnings;
}

// Toast any passage warnings for a bundle about to be exported/committed.
function aimcqWarnPassageIssues(data, context) {
    try {
        var ws = aimcqValidatePassages(data);
        if (ws.length && typeof showToast === 'function') {
            showToast('Passage Warning' + (context ? ' — ' + context : ''), ws.join(' '), 'error');
        }
        return ws;
    } catch (e) { return []; }
}

// Count helper: "25 questions + 1 passage" style label for toasts/stats.
function aimcqCountLabel(posts) {
    var q = 0, p = 0;
    (posts || []).forEach(function (x) { if (aimcqIsPassagePost(x)) p++; else q++; });
    return p ? (q + ' questions + ' + p + ' passage' + (p > 1 ? 's' : '')) : (q + ' questions');
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
            showToast("File Loaded", `Found ${aimcqCountLabel(splitSourceData.posts)}.`, "success");
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

    /* ---- PASSAGE-AWARE SPLIT ----
       A passage post and every question linked to it must land in the SAME
       output file, otherwise the aimcq engine cannot show the passage box.
       We first bucket posts into indivisible groups (a passage + its linked
       questions = one group; every other post = its own group), then fill
       chunks group-by-group. `chunkSize` counts QUESTIONS (passage posts
       ride along for free). A chunk may exceed chunkSize only when a single
       passage group is bigger than chunkSize — splitting it would break it. */
    const posts = splitSourceData.posts;
    const passageGroups = {};   // passage id -> group array (shared reference)
    const groupOrder = [];      // groups in first-appearance order
    posts.forEach(p => {
        let pid = null;
        if (aimcqIsPassagePost(p) && p.id != null) pid = String(p.id);
        else if (aimcqIsPassageQuestion(p)) pid = aimcqGetPassageId(p) || null;
        if (pid) {
            if (!passageGroups[pid]) { passageGroups[pid] = []; groupOrder.push(passageGroups[pid]); }
            passageGroups[pid].push(p);
        } else {
            groupOrder.push([p]);
        }
    });
    const questionCount = g => g.reduce((n, p) => n + (aimcqIsPassagePost(p) ? 0 : 1), 0);

    let chunkPosts = [], chunkQ = 0;
    const flush = () => {
        if (!chunkPosts.length) return;
        generatedSplitChunks.push({
            filename: `${base}_part${part}.json`,
            data: { version: splitSourceData.version||"1.7.0", export_type: splitSourceData.export_type||"single", terms: splitSourceData.terms||[], posts: chunkPosts },
            count: chunkQ
        });
        part++; chunkPosts = []; chunkQ = 0;
    };
    groupOrder.forEach(g => {
        const gq = questionCount(g);
        if (chunkQ > 0 && chunkQ + gq > chunkSize) flush();
        chunkPosts = chunkPosts.concat(g);
        chunkQ += gq;
        if (chunkQ >= chunkSize) flush();
    });
    flush();

    renderSplitResults();
    showToast("Success", `Split into ${generatedSplitChunks.length} files (passages kept with their questions).`, "success");
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
                nameEl.textContent = `\u2713 ${file.name} \u2014 ${aimcqCountLabel(data.posts)}`;
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
            showToast("Base Loaded", `${aimcqCountLabel(data.posts)} ready.`, "success");
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

    // ---- Passage badges: make passage posts and their linked questions
    // visually distinct so users don't unknowingly break the group. ----
    if (aimcqIsPassagePost(post)) {
        const pb = document.createElement('span');
        pb.className = 'qfv-status-badge';
        pb.style.cssText = 'background:#f3e8ff;color:#7c3aed;border:1px solid #ddd6fe;';
        pb.innerHTML = '<i data-lucide="book-open" class="w-3 h-3"></i> Passage' + (post.id != null ? ` (id ${post.id})` : '');
        badgesRow.appendChild(pb);
    } else if (aimcqIsPassageQuestion(post)) {
        const pb = document.createElement('span');
        pb.className = 'qfv-status-badge';
        pb.style.cssText = 'background:#ede9fe;color:#6d28d9;border:1px solid #ddd6fe;';
        pb.innerHTML = '<i data-lucide="link" class="w-3 h-3"></i> Passage Q → ' + escapeHtml(aimcqGetPassageId(post));
        badgesRow.appendChild(pb);
    }

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

            // ---- Keep passage groups consistent on delete/undelete. ----
            // Deleting a passage post orphans its questions (the engine can
            // then never show the passage), so the whole group moves together:
            //   - toggle a PASSAGE post  -> its linked questions follow;
            //   - toggle a PASSAGE QUESTION -> if it was the last remaining
            //     linked question, the (now-useless) passage post follows too,
            //     and undeleting a question brings the passage post back.
            const post = editorBaseData.posts[idx];
            const affected = [];
            if (post && aimcqIsPassagePost(post) && post.id != null) {
                const pid = String(post.id);
                editorBaseData.posts.forEach((p, i) => {
                    if (i !== idx && aimcqIsPassageQuestion(p) && aimcqGetPassageId(p) === pid) {
                        if (e.target.checked ? !editorDeleteSet.has(i) : editorDeleteSet.has(i)) {
                            if (e.target.checked) editorDeleteSet.add(i); else editorDeleteSet.delete(i);
                            affected.push(i);
                        }
                    }
                });
                if (affected.length) {
                    showToast('Passage Group', (e.target.checked
                        ? `Passage deleted — its ${affected.length} linked question(s) were marked for deletion too.`
                        : `Passage restored — its ${affected.length} linked question(s) were restored too.`), 'success');
                }
            } else if (post && aimcqIsPassageQuestion(post)) {
                const pid = aimcqGetPassageId(post);
                let passageIdx = -1, liveLinked = 0;
                editorBaseData.posts.forEach((p, i) => {
                    if (aimcqIsPassagePost(p) && String(p.id) === pid) passageIdx = i;
                    else if (i !== idx && aimcqIsPassageQuestion(p) && aimcqGetPassageId(p) === pid && !editorDeleteSet.has(i)) liveLinked++;
                });
                if (passageIdx !== -1) {
                    if (e.target.checked && liveLinked === 0 && !editorDeleteSet.has(passageIdx)) {
                        editorDeleteSet.add(passageIdx); affected.push(passageIdx);
                        showToast('Passage Group', 'Last linked question deleted — the passage post was marked for deletion too.', 'success');
                    } else if (!e.target.checked && editorDeleteSet.has(passageIdx)) {
                        editorDeleteSet.delete(passageIdx); affected.push(passageIdx);
                        showToast('Passage Group', 'Passage question restored — its passage post was restored too.', 'success');
                    }
                }
            }
            // Re-render the whole panel if the toggle cascaded to other cards.
            if (affected.length) {
                renderBasePanel();
                updateEditorStats();
                updateTabCounts();
                updateLiveJsonPreview();
                return;
            }

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
        'qx-en-question':    'Extracted question text…',
        'qx-en-explanation': 'Explanation / solution steps…',
        'qx-hi-question':    'निकाला गया प्रश्न…',
        'qx-hi-explanation': 'व्याख्या / हल के चरण…',
    };
    // Passage mode uses indexed prefixes (qx-en0-…, qx-hi2-…); strip the index
    // so those editors inherit the same placeholders as the single-question ones.
    const placeholder = placeholders[field]
        || placeholders[String(field).replace(/^qx-(en|hi)\d+-/, 'qx-$1-')]
        || '';
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
      <div class="re-toolbar re-toolbar-blogger">
        <button type="button" class="re-tool-btn" data-cmd="undo" title="Undo (Ctrl+Z)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 015 5v1a5 5 0 01-5 5h-4"/></svg>
        </button>
        <button type="button" class="re-tool-btn" data-cmd="redo" title="Redo (Ctrl+Y)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 00-5 5v1a5 5 0 005 5h4"/></svg>
        </button>
        <div class="re-tool-sep"></div>
        <select class="re-font-select re-bar-select" title="Font">
          <option value="">Font</option>
          <option value="Arial, sans-serif">Arial</option>
          <option value="Courier New, monospace">Courier</option>
          <option value="Georgia, serif">Georgia</option>
          <option value="Helvetica, sans-serif">Helvetica</option>
          <option value="Times New Roman, serif">Times</option>
          <option value="Trebuchet MS, sans-serif">Trebuchet</option>
          <option value="Verdana, sans-serif">Verdana</option>
        </select>
        <select class="re-size-select re-bar-select" title="Font size">
          <option value="">Size</option>
          <option value="1">Smallest</option>
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
          <option value="7">Largest</option>
        </select>
        <select class="re-heading-select re-bar-select" title="Paragraph / Heading">
          <option value="div">Normal</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
          <option value="h4">Minor heading</option>
          <option value="p">Paragraph</option>
          <option value="blockquote">Quote</option>
        </select>
        <div class="re-tool-sep"></div>
        <button type="button" class="re-tool-btn" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" class="re-tool-btn" data-cmd="italic" title="Italic (Ctrl+I)"><i style="font-style:italic">I</i></button>
        <button type="button" class="re-tool-btn" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
        <button type="button" class="re-tool-btn" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
        <div class="re-color-wrap">
          <button type="button" class="re-tool-btn re-color-btn re-fore-btn" title="Text colour">
            <span class="re-color-A">A</span><span class="re-color-bar re-fore-bar" style="background:#dc2626"></span>
          </button>
          <div class="re-color-dropdown re-fore-drop hidden"></div>
        </div>
        <div class="re-color-wrap">
          <button type="button" class="re-tool-btn re-color-btn re-back-btn" title="Text background colour">
            <span class="re-color-A" style="background:#fde047;border-radius:2px;padding:0 2px;">A</span><span class="re-color-bar re-back-bar" style="background:#fde047"></span>
          </button>
          <div class="re-color-dropdown re-back-drop hidden"></div>
        </div>
        <div class="re-tool-sep"></div>
        <button type="button" class="re-tool-btn" data-cmd="superscript" title="Superscript" style="font-size:10px;letter-spacing:-0.5px">X²</button>
        <button type="button" class="re-tool-btn" data-cmd="subscript" title="Subscript" style="font-size:10px;letter-spacing:-0.5px">X₂</button>
        <div class="re-tool-sep"></div>
        <button type="button" class="re-tool-btn re-tool-link" title="Insert / edit link">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
        </button>
        <button type="button" class="re-tool-btn re-tool-image" title="Insert image URL">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </button>
        <button type="button" class="re-tool-btn re-tool-table" title="Insert table">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
        </button>
        <div class="re-tool-sep"></div>
        <button type="button" class="re-tool-btn" data-cmd="justifyLeft" title="Align left">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="14" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
        </button>
        <button type="button" class="re-tool-btn" data-cmd="justifyCenter" title="Align centre">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
        </button>
        <button type="button" class="re-tool-btn" data-cmd="justifyRight" title="Align right">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
        </button>
        <button type="button" class="re-tool-btn" data-cmd="justifyFull" title="Justify">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div class="re-tool-sep"></div>
        <button type="button" class="re-tool-btn" data-cmd="insertOrderedList" title="Numbered list">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4" stroke-linecap="round"/><path d="M4 10h2" stroke-linecap="round"/><path d="M4 14h1.5a.5.5 0 010 1H4a.5.5 0 000 1h2" stroke-linecap="round"/></svg>
        </button>
        <button type="button" class="re-tool-btn" data-cmd="insertUnorderedList" title="Bulleted list">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/></svg>
        </button>
        <div class="re-tool-sep"></div>
        <button type="button" class="re-tool-btn" data-cmd="removeFormat" title="Remove formatting">
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

    // --- Heading / paragraph select (includes Quote like Blogger) ---
    const headingSelect = toolbar.querySelector('.re-heading-select');
    headingSelect.addEventListener('change', () => {
        compose.focus();
        document.execCommand('formatBlock', false, headingSelect.value);
        updateToolbarState(toolbar, compose);
    });

    // --- Font family & size (Blogger-style) ---
    const fontSelect = toolbar.querySelector('.re-font-select');
    if (fontSelect) fontSelect.addEventListener('change', () => {
        if (!fontSelect.value) return;
        compose.focus();
        try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
        document.execCommand('fontName', false, fontSelect.value);
        fontSelect.value = '';
    });
    const sizeSelect = toolbar.querySelector('.re-size-select');
    if (sizeSelect) sizeSelect.addEventListener('change', () => {
        if (!sizeSelect.value) return;
        compose.focus();
        document.execCommand('fontSize', false, sizeSelect.value);
        sizeSelect.value = '';
    });

    // --- Text colour / highlight colour (Blogger-style palette grid) ---
    const RE_PALETTE = [
        '#000000','#444444','#666666','#999999','#cccccc','#eeeeee','#f3f3f3','#ffffff',
        '#ff0000','#ff9900','#ffff00','#00ff00','#00ffff','#0000ff','#9900ff','#ff00ff',
        '#e06666','#f6b26b','#ffd966','#93c47d','#76a5af','#6fa8dc','#8e7cc3','#c27ba0',
        '#cc0000','#e69138','#f1c232','#6aa84f','#45818e','#3d85c6','#674ea7','#a64d79',
        '#990000','#b45309','#bf9000','#38761d','#134f5c','#0b5394','#351c75','#741b47',
    ];
    function wireColorPicker(btnSel, dropSel, barSel, cmd) {
        const btn = toolbar.querySelector(btnSel);
        const drop = toolbar.querySelector(dropSel);
        const bar = toolbar.querySelector(barSel);
        if (!btn || !drop) return;
        drop.innerHTML = RE_PALETTE.map(c =>
            `<button type="button" class="re-swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')
            + `<div class="re-swatch-footer"><input type="color" class="re-swatch-custom" title="Custom colour"><span>Custom</span>`
            + (cmd !== 'foreColor' ? `<button type="button" class="re-swatch-none">None</button>` : '') + `</div>`;
        const apply = (color) => {
            drop.classList.add('hidden');
            compose.focus();
            try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
            document.execCommand(cmd, false, color);
            if (bar) bar.style.background = color === 'transparent' ? '#e5e7eb' : color;
            updateToolbarState(toolbar, compose);
        };
        btn.addEventListener('mousedown', e => {
            e.preventDefault();
            document.querySelectorAll('.re-color-dropdown').forEach(d => { if (d !== drop) d.classList.add('hidden'); });
            drop.classList.toggle('hidden');
        });
        drop.querySelectorAll('.re-swatch').forEach(sw =>
            sw.addEventListener('mousedown', e => { e.preventDefault(); apply(sw.getAttribute('data-color')); }));
        const custom = drop.querySelector('.re-swatch-custom');
        if (custom) custom.addEventListener('change', () => apply(custom.value));
        const none = drop.querySelector('.re-swatch-none');
        if (none) none.addEventListener('mousedown', e => { e.preventDefault(); apply('transparent'); });
    }
    wireColorPicker('.re-fore-btn', '.re-fore-drop', '.re-fore-bar', 'foreColor');
    wireColorPicker('.re-back-btn', '.re-back-drop', '.re-back-bar', 'hiliteColor');
    document.addEventListener('click', e => {
        if (!e.target.closest || !e.target.closest('.re-color-wrap')) {
            wrap.querySelectorAll('.re-color-dropdown').forEach(d => d.classList.add('hidden'));
        }
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
// Blogger-style structured HTML source: block tags on their own lines with
// 2-space indentation, one line per <br>, short leaf blocks kept compact.
// Attribute-carrying <span>s (colours/fonts from the toolbar) and <br> line
// structure are PRESERVED — only editing junk (bare wrappers, &nbsp;) is
// normalised away.
const RE_BLOCK_TAGS = 'p|div|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|blockquote|figure|figcaption|pre|section|article';

function formatHtmlSource(html) {
    if (!html) return '';
    let src = String(html)
        .replace(/<div><br\s*\/?><\/div>/gi, '<br>')
        .replace(/<span>([\s\S]*?)<\/span>/gi, '$1')            // only attribute-less spans
        .replace(/&nbsp;/gi, ' ');
    // Unwrap contenteditable's bare <div> line wrappers into <br> lines
    // (attribute-carrying divs are left untouched). Loop for nesting.
    for (let i = 0; i < 6; i++) {
        const next = src.replace(/<div>([\s\S]*?)<\/div>/gi, '$1<br>');
        if (next === src) break;
        src = next;
    }
    src = src.replace(/(?:\s*<br\s*\/?>\s*)+$/i, '').trim();    // no trailing blank lines
    return prettyHtmlSource(src);
}

function prettyHtmlSource(src) {
    if (!src) return '';
    const B = '(?:' + RE_BLOCK_TAGS + ')';
    let t = src
        .replace(new RegExp('\\s*(<' + B + '(?=[\\s>])[^>]*>)', 'gi'), '\n$1')
        .replace(new RegExp('(<' + B + '(?=[\\s>])[^>]*>)\\s*(?=<)', 'gi'), '$1\n')
        .replace(new RegExp('\\s*(</' + B + '>)', 'gi'), '\n$1')
        .replace(new RegExp('(</' + B + '>)\\s*', 'gi'), '$1\n')
        .replace(/(<br\s*\/?>)\s*/gi, '$1\n');

    const lines = t.split('\n').map(l => l.trim()).filter(l => l !== '');
    const openRe = new RegExp('^<' + B + '(?=[\\s>])', 'i');
    const closeRe = new RegExp('^</' + B + '>', 'i');
    const selfContained = new RegExp('^<(' + B + ')(?=[\\s>])[^>]*>[\\s\\S]*</\\1>$', 'i');

    let depth = 0;
    const indented = [];
    for (const line of lines) {
        if (closeRe.test(line)) depth = Math.max(0, depth - 1);
        indented.push('  '.repeat(depth) + line);
        if (openRe.test(line) && !selfContained.test(line)) depth++;
    }

    // Compact short leaf blocks (content may contain inline tags like <b>):
    //   <li> / <b>x</b> y / </li>  →  <li><b>x</b> y</li>
    //   <td>text / </td>           →  <td>text</td>
    const blockish = new RegExp('</?' + B + '(?=[\\s>/])', 'i');
    const out = [];
    for (let i = 0; i < indented.length; i++) {
        const a = indented[i], b = indented[i + 1], c = indented[i + 2];
        const at = a.trim();
        if (b !== undefined && c !== undefined) {
            const bt = b.trim(), ct = c.trim();
            const m = at.match(new RegExp('^<(' + B + ')(?=[\\s>])[^>]*>$', 'i'));
            if (m && ct.toLowerCase() === '</' + m[1].toLowerCase() + '>' &&
                !blockish.test(bt) && !/^<br/i.test(bt) &&
                (at.length + bt.length + ct.length) <= 90) {
                out.push(a + bt + ct);
                i += 2;
                continue;
            }
        }
        if (b !== undefined) {
            const bt = b.trim();
            const m2 = at.match(new RegExp('^<(' + B + ')(?=[\\s>])[^>]*>', 'i'));
            if (m2) {
                const rest = at.slice(at.indexOf('>') + 1);
                if (rest && !blockish.test(rest) &&
                    bt.toLowerCase() === '</' + m2[1].toLowerCase() + '>' &&
                    (at.length + bt.length) <= 90) {
                    out.push(a + bt);
                    i += 1;
                    continue;
                }
            }
        }
        out.push(a);
    }
    return out.join('\n');
}

function updateToolbarState(toolbar, compose) {
    ['bold','italic','underline','strikeThrough','superscript','subscript',
     'insertUnorderedList','insertOrderedList'].forEach(cmd => {
        const btn = toolbar.querySelector(`[data-cmd="${cmd}"]`);
        if (!btn) return;
        let on = false;
        try { on = document.queryCommandState && document.queryCommandState(cmd); } catch (e) {}
        btn.classList.toggle('active', !!on);
    });
    // Sync heading select (Blogger option set)
    const sel = toolbar.querySelector('.re-heading-select');
    if (sel) {
        let block = 'div';
        try {
            block = ((document.queryCommandValue && document.queryCommandValue('formatBlock')) || 'div')
                .toLowerCase().replace(/^<|>$/g, '') || 'div';
        } catch (e) {}
        sel.value = ['h2','h3','h4','p','blockquote'].includes(block) ? block : 'div';
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
    if (typeof qeAiOnModalOpen === 'function') qeAiOnModalOpen(enOptions.length);
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
        `\u2713 ${figState.fileName} \u2014 ${aimcqCountLabel(data.posts)}`;
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
    showToast('JSON Loaded', `${aimcqCountLabel(data.posts)} ready for figure updates.`, 'success');
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
        pos: 'auto',   // where the figure sits in the question text
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
        const aiBadge = (filled && slot.aiGenerated)
            ? '<span class="fig-slot-ai" title="This figure was generated by the AI figure model"><i data-lucide="sparkles" class="w-3 h-3"></i> AI</span>'
            : '';
        el.innerHTML = `
            <div class="fig-slot-label">${FIG_SLOT_LABELS[key]}</div>
            ${filled
                ? `<img src="${escapeAttr(src)}" class="fig-slot-preview" alt="" onerror="this.style.display='none'">`
                : `<div class="fig-slot-placeholder"><i data-lucide="image" class="w-7 h-7"></i></div>`}
            ${statusBadge}
            ${aiBadge}
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

    const aiOn = !!(document.getElementById('fig-ai-gen') || {}).checked;

    const store = (blob, natW, natH, aiGenerated) => {
        if (slot.localUrl) { try { URL.revokeObjectURL(slot.localUrl); } catch (e) {} }
        slot.blob = blob;
        slot.localUrl = URL.createObjectURL(blob);
        slot.url = '';
        slot.uploaded = false;
        slot.aiGenerated = !!aiGenerated;
        slot.ar = natW > 0 && natH > 0 ? (natW / natH) : (FIG_IMG_DEFAULT_W / FIG_IMG_DEFAULT_H);
        slot.w = natW;
        slot.h = natH;
        figRenderSlots();
        figRenderPreview();
        showToast(aiGenerated ? 'Figure generated' : 'Cropped',
            `${FIG_SLOT_LABELS[key]} ${aiGenerated ? 'reproduced by AI' : 'cropped'} at ${natW}\u00d7${natH}px. ` +
            'Resize if needed, then "Apply" to upload.',
            'success');
    };

    if (!aiOn) {
        canvas.toBlob(blob => {
            if (!blob) { showToast('Crop failed', 'Could not capture the crop.', 'error'); return; }
            store(blob, canvas.width || FIG_IMG_DEFAULT_W, canvas.height || FIG_IMG_DEFAULT_H, false);
        }, 'image/webp', 0.95);
        return;
    }

    // AI figure generation: reproduce ONLY the figure from this crop, then
    // set it into the slot (still local — Apply uploads it like any crop).
    figSlotSetBusy(key, true, 'Generating…');
    const b64 = canvas.toDataURL('image/webp', 0.95).split(',')[1];
    figGenerateFigureImage(b64).then(im => {
        const blob = figB64ToBlob(im.data, im.mime);
        const dataUrl = 'data:' + im.mime + ';base64,' + im.data;
        figImgNaturalSize(dataUrl).then(dim => {
            figSlotSetBusy(key, false);
            store(blob, dim.w, dim.h, true);
        });
    }).catch(err => {
        figSlotSetBusy(key, false);
        showToast('AI figure failed', (err.message || String(err)) +
            ' — turn off "AI figure generator" to crop this figure directly instead.', 'error');
    });
}

// Natural pixel size of a data-URL image (for slot W/H defaults).
function figImgNaturalSize(dataUrl) {
    return new Promise(resolve => {
        const fallback = { w: FIG_IMG_DEFAULT_W, h: FIG_IMG_DEFAULT_H };
        try {
            const im = new Image();
            const t = setTimeout(() => resolve(fallback), 1500);
            im.onload = () => { clearTimeout(t); resolve({ w: im.naturalWidth || fallback.w, h: im.naturalHeight || fallback.h }); };
            im.onerror = () => { clearTimeout(t); resolve(fallback); };
            im.src = dataUrl;
        } catch (e) { resolve(fallback); }
    });
}

// Show a busy state on one slot's crop button while AI generates.
function figSlotSetBusy(key, busy, label) {
    const grid = document.getElementById('fig-slots-grid');
    if (!grid) return;
    const btn = grid.querySelector(`.fig-slot-btn-crop[data-key="${key}"]`);
    if (!btn) return;
    if (busy) {
        btn.dataset.orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i> ${label || 'Working…'}`;
    } else {
        btn.disabled = false;
        if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
    }
    try { lucide.createIcons(); } catch (e) {}
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
    if (figState.continuous) { figRenderPdfContinuous(num); return; }
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

// Continuous mode: stack page `startNum` and the following pages onto ONE
// tall canvas so a figure/question that spills onto the next page can be
// cropped in a single selection. A dashed line marks each page boundary.
function figRenderPdfContinuous(startNum) {
    if (!figState.pdfDoc) return;
    figState.srcType = 'pdf';
    figState.imgBitmap = null;
    figState.rendering = true;
    const canvas = document.getElementById('fig-pdf-canvas');
    const ctx = canvas.getContext('2d');
    const scroll = document.getElementById('fig-pdf-scroll');
    const containerWidth = Math.max(scroll.clientWidth - 4, 200);
    const RASTER = 2.5;
    const total = figState.pdfDoc.numPages;
    const span = Math.max(1, figState.contSpan || 2);
    const last = Math.min(total, startNum + span - 1);
    const nums = [];
    for (let n = startNum; n <= last; n++) nums.push(n);

    Promise.all(nums.map(n => figState.pdfDoc.getPage(n))).then(pages => {
        let maxUnscaledW = 0;
        pages.forEach(pg => { maxUnscaledW = Math.max(maxUnscaledW, pg.getViewport({ scale: 1 }).width); });
        figState.fitScale = containerWidth / maxUnscaledW;
        const vps = pages.map(pg => pg.getViewport({ scale: figState.fitScale * RASTER }));
        const gap = Math.round(14 * RASTER);
        const totalW = Math.max.apply(null, vps.map(v => v.width));
        const totalH = vps.reduce((s, v) => s + v.height, 0) + gap * (vps.length - 1);
        canvas.width = totalW;
        canvas.height = totalH;
        figState.fitDispW = totalW / RASTER;
        figState.fitDispH = totalH / RASTER;
        if (figState.cropper) { figState.cropper.destroy(); figState.cropper = null; }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, totalW, totalH);

        let y = 0;
        const renderNext = (i) => {
            if (i >= pages.length) {
                figState.rendering = false;
                figApplyZoom();
                if (figState.cropMode) figEnableCropper();
                if (figState.pendingPage !== null) {
                    const p = figState.pendingPage;
                    figState.pendingPage = null;
                    figRenderPdfPage(p);
                }
                return;
            }
            const vp = vps[i];
            ctx.save();
            ctx.translate(0, y);
            pages[i].render({ canvasContext: ctx, viewport: vp }).promise.then(() => {
                ctx.restore();
                if (i < pages.length - 1) {
                    const sepY = y + vp.height + gap / 2;
                    ctx.save();
                    ctx.strokeStyle = '#cbd5e1';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([10, 8]);
                    ctx.beginPath(); ctx.moveTo(0, sepY); ctx.lineTo(totalW, sepY); ctx.stroke();
                    ctx.restore();
                }
                y += vp.height + gap;
                renderNext(i + 1);
            });
        };
        renderNext(0);
    });

    document.getElementById('fig-cur-page').textContent = last > startNum ? (startNum + '\u2013' + last) : String(startNum);
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
        const step = 1;
        if (figState.pdfDoc && figState.pageNum < figState.pdfDoc.numPages) {
            figState.pageNum = Math.min(figState.pdfDoc.numPages, figState.pageNum + step);
            figQueuePdfPage(figState.pageNum);
        }
    });
    const figContToggle = document.getElementById('fig-continuous');
    if (figContToggle) figContToggle.addEventListener('change', () => {
        figState.continuous = !!figContToggle.checked;
        if (figState.pdfDoc) figQueuePdfPage(figState.pageNum);
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
    if (typeof figUpdateHostChip === 'function') { try { figUpdateHostChip(); } catch (e) {} }
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
        let blob = await new Promise(res => canvas.toBlob(res, 'image/webp', 0.95));
        let fileName = `mcq-crop-${Date.now()}.webp`;
        let mime = 'image/webp';

        // Optional AI figure generation: reproduce ONLY the figure from the
        // crop with the image-output model, then upload that instead.
        const aiOn = !!(document.getElementById('fig-ai-gen') || {}).checked;
        if (aiOn) {
            btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Generating figure...';
            lucide.createIcons();
            const b64 = canvas.toDataURL('image/webp', 0.95).split(',')[1];
            const im = await figGenerateFigureImage(b64);   // {mime, data}
            mime = im.mime;
            const ext = /png/.test(mime) ? 'png' : /jpe?g/.test(mime) ? 'jpg' : /webp/.test(mime) ? 'webp' : 'png';
            fileName = `mcq-fig-${Date.now()}.${ext}`;
            blob = figB64ToBlob(im.data, mime);
            btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Uploading...';
            lucide.createIcons();
        }

        const url = await figUploadImage(blob, fileName, mime);
        result.classList.remove('hidden');
        result.innerHTML = `
            <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-green-700">${aiOn ? 'Figure generated &amp; uploaded!' : 'Uploaded!'}</span>
                <input type="text" value="${escapeAttr(url)}" readonly
                    class="flex-1 min-w-[200px] gd-input text-[11px]" onclick="this.select()">
                <a href="${escapeAttr(url)}" target="_blank" class="gd-link">Open</a>
            </div>`;
        showToast('Uploaded', aiOn ? 'AI figure committed to GitHub and served via jsDelivr.' : 'Image committed to GitHub and served via jsDelivr.', 'success');
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
        ? figBuildImgTag(qSrc, qSlot.w, qSlot.h) : '', !!qSrc,
        qSlot ? qSlot.pos : undefined);

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
// `pos` chooses WHERE the figure goes:
//   'auto' (default) — replace [image here] placeholder, else replace the
//                      existing aimcq figure, else append at the end.
//   'start' | 'end'  — force the figure to the start / end of the text.
//   <number N>       — insert after the question's Nth line/segment
//                      (0-based; segments as computed by figSplitQSegments).
function figApplyImageToText(text, imgTag, hasImg, pos) {
    if (!text) return hasImg ? imgTag : text;
    let out = text;
    if (!hasImg || !imgTag) {
        // Just strip placeholders
        return out.replace(FIG_PLACEHOLDER_RE_G, '').trim();
    }
    if (pos === undefined || pos === null || pos === 'auto') {
        const imgRe = new RegExp('<img[^>]*class=["\\\']?[^"\\\']*' + FIG_IMG_CLASS + '[^>]*>', 'i');
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
    // Explicit position: work on the CLEANED text (placeholders and any
    // previously-inserted aimcq figure removed) so re-applying at a new
    // position moves the figure instead of duplicating it.
    const clean = figCleanQText(out);
    if (pos === 'start') {
        return (imgTag + clean).trim();
    }
    if (pos === 'end') {
        return (clean + (clean.trim().endsWith('>') ? '' : '<br>') + imgTag).trim();
    }
    // Numeric: insert after segment N.
    const segs = figSplitQSegments(clean);
    if (!segs.length) return imgTag;
    const n = Math.max(0, Math.min(parseInt(pos, 10) || 0, segs.length - 1));
    return (segs.slice(0, n + 1).join('') + imgTag + segs.slice(n + 1).join('')).trim();
}

// Remove [image here: ...] placeholders and any existing aimcq figure
// <img> from a question text — the neutral base for positional insertion.
function figCleanQText(text) {
    const imgReG = new RegExp('<img[^>]*class=["\\\']?[^"\\\']*' + FIG_IMG_CLASS + '[^>]*>', 'ig');
    return String(text || '')
        .replace(imgReG, '')
        .replace(FIG_PLACEHOLDER_RE_G, '')
        .trim();
}

// Split question HTML into insertable line/segments at block boundaries
// (</p>, </div>, </li>, </tr>, <br>), keeping each delimiter attached to
// the segment it ends. Markup-only fragments (e.g. bare <br><br>) are
// glued to the neighbouring segment so every listed segment has visible
// text — these are the "lines" offered in the position picker.
function figSplitQSegments(html) {
    const parts = String(html || '').split(/(<\/p>|<\/div>|<\/li>|<\/tr>|<br\s*\/?>)/i);
    const segs = [];
    let carry = '';
    for (let i = 0; i < parts.length; i += 2) {
        const chunk = parts[i] || '';
        const delim = parts[i + 1] || '';
        const raw = carry + chunk + delim;
        carry = '';
        if (!raw) continue;
        if (stripHtmlTags(chunk).trim() === '') {
            // No visible text in this fragment — attach it to the previous
            // segment (trailing <br>s) or carry it into the next (leading markup).
            if (segs.length) segs[segs.length - 1] += raw;
            else carry = raw;
        } else {
            segs.push(raw);
        }
    }
    if (carry) {
        if (segs.length) segs[segs.length - 1] += carry;
        else if (carry.trim()) segs.push(carry);
    }
    return segs;
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
        post.post_content = figApplyImageToText(post.post_content || '', imgTag, true, qSlot.pos);
        post.post_title = stripHtmlTags(post.post_content).slice(0, 120) || post.post_title;

        // Hindi content mirror (same line position, clamped to its own lines)
        if (meta._aimcq_question_content_hi) {
            meta._aimcq_question_content_hi =
                figApplyImageToText(meta._aimcq_question_content_hi, imgTag, true, qSlot.pos);
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

// ---- File-type support: every GitHub picker instance (Editor, Quiz
// Builder, Figure Updater — they share this one modal) browses, uploads,
// and deletes PDF, image & HTML files in addition to JSON. JSON is parsed
// and delivered into whichever tab opened the picker; the other types
// aren't question data, so their CDN link is copied instead. ----
const GH_EDITOR_EXTRA_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'html', 'htm'];
const GH_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

function ghSupportsExtraTypes() {
    // PDF/image/HTML browse-upload-delete support applies to every GitHub
    // picker instance (Editor, Quiz Builder, Figure Updater) — they all
    // share this one modal.
    return true;
}
// Classify a filename into a display "kind": json | pdf | image | html | other.
function ghFileKind(name) {
    const ext = (String(name).split('.').pop() || '').toLowerCase();
    if (ext === 'json') return 'json';
    if (ext === 'pdf') return 'pdf';
    if (GH_IMAGE_EXTS.indexOf(ext) !== -1) return 'image';
    if (ext === 'html' || ext === 'htm') return 'html';
    return 'other';
}
function ghFileIconFor(kind) {
    return kind === 'json' ? 'file-json' :
           kind === 'pdf'  ? 'file-text' :
           kind === 'image' ? 'image' :
           kind === 'html' ? 'file-code-2' : 'file';
}
function ghFileColorFor(kind) {
    return kind === 'json' ? 'text-blue-500' :
           kind === 'pdf'  ? 'text-red-500' :
           kind === 'image' ? 'text-emerald-500' :
           kind === 'html' ? 'text-orange-500' : 'text-gray-400';
}
function ghMimeFor(kind, name) {
    if (kind === 'pdf') return 'application/pdf';
    if (kind === 'html') return 'text/html';
    if (kind === 'json') return 'application/json';
    if (kind === 'image') {
        const ext = (String(name).split('.').pop() || '').toLowerCase();
        return ext === 'svg' ? 'image/svg+xml' :
               ext === 'png' ? 'image/png' :
               (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' :
               ext === 'gif' ? 'image/gif' :
               ext === 'webp' ? 'image/webp' : 'application/octet-stream';
    }
    return 'application/octet-stream';
}
// Is this filename browsable/loadable in the current picker context?
// JSON, PDF, image & HTML are all browsable in every picker instance.
function ghFileIsBrowsable(name) {
    const ext = (String(name).split('.').pop() || '').toLowerCase();
    if (ext === 'json') return true;
    return ghSupportsExtraTypes() && GH_EDITOR_EXTRA_EXTS.indexOf(ext) !== -1;
}

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
        chip.innerHTML = `<i data-lucide="${ghFileIconFor(ghFileKind(r.name))}" class="w-3 h-3 flex-shrink-0"></i>` +
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

// Open the GitHub picker modal for a given tab ('figures' | 'editor' | 'quizbuilder').
// All three targets share this one modal, and all three now browse, upload,
// and delete JSON, PDF, image & HTML files — JSON is delivered into the
// tab that opened the picker; other types have their CDN link copied.
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

    const extra = ghSupportsExtraTypes();
    document.getElementById('fig-gh-picker-list').innerHTML =
        '<div class="p-8 text-center text-gray-400 text-sm">' +
        'Enter a folder and click <b>Browse</b> to list its ' +
        (extra ? 'JSON, PDF, image &amp; HTML files' : 'JSON files') + '.</div>';
    document.getElementById('fig-gh-picker-loc').textContent = 'Repository contents';
    ghSetCredsStatus(
        ghJsonCreds.repo && ghJsonCreds.token
            ? `Saved: ${ghJsonCreds.repo}@${ghJsonCreds.branch}.` : '', '');

    // File-path box + footer hint reflect what this picker can browse.
    const pickFileIn = document.getElementById('fig-gh-pick-file');
    if (pickFileIn) pickFileIn.placeholder = extra
        ? 'Exact file path, e.g. quizzes/physics.json or figures/diagram.png'
        : 'Exact file path, e.g. quizzes/physics.json';
    const footerHint = document.getElementById('fig-gh-footer-hint');
    if (footerHint) footerHint.innerHTML = extra
        ? 'Files load via the GitHub API. JSON loads straight into the tool; the <b>CDN</b> button (or clicking a PDF/image/HTML row) copies its jsDelivr link.'
        : 'Files load via the GitHub API. The <b>CDN</b> button copies a file\'s jsDelivr link.';

    // Upload tab: JSON, PDF, image & HTML are all accepted for every target.
    const upFile = document.getElementById('fig-gh-up-file');
    if (upFile) upFile.accept = extra ? '.json,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.html,.htm' : '.json';
    const upLabel = document.getElementById('fig-gh-up-label');
    if (upLabel) upLabel.textContent = extra ? 'File to upload (JSON, PDF, image, or HTML)' : 'JSON file to upload';
    const upDesc = document.getElementById('fig-gh-up-desc');
    if (upDesc) upDesc.textContent = extra
        ? 'Commit a new file into the repository — JSON, PDF, image, or HTML — into an existing folder or a brand-new one (the folder is created automatically). Publish a quiz file or an attachment, then load or copy its link from the Browse tab.'
        : 'Commit a new JSON file into the repository — into an existing folder or a brand-new one (the folder is created automatically). Use this to publish a quiz file, then load it from the Browse tab.';

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
        // Folders first, then browsable files (JSON, PDF, image & HTML).
        // Other file types are ignored.
        const folders = items.filter(x => x.type === 'dir')
            .sort((a, b) => a.name.localeCompare(b.name));
        const jsons = items.filter(x => x.type === 'file' && ghFileIsBrowsable(x.name))
            .sort((a, b) => a.name.localeCompare(b.name));

        if (!folders.length && !jsons.length) {
            list.innerHTML = '<div class="p-6 text-center text-gray-400 text-sm">' +
                (ghSupportsExtraTypes()
                    ? 'No folders or supported files (JSON, PDF, image, HTML) here.'
                    : 'No folders or .json files here.') + '</div>';
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
                `<span class="gd-file-row-dl" title="Download this folder as a ZIP">` +
                '<i data-lucide="download" class="w-3 h-3"></i></span>' +
                `<span class="gd-file-row-del" title="Permanently delete this folder and ALL files inside it from GitHub">` +
                '<i data-lucide="trash-2" class="w-3 h-3"></i></span>' +
                '<i data-lucide="chevron-right" class="w-3.5 h-3.5 text-gray-300"></i>';
            // Download folder as ZIP — does NOT navigate into it.
            row.querySelector('.gd-file-row-dl').addEventListener('click', e => {
                e.stopPropagation();
                ghBrowseDownloadFolder(repo, branch, f.path, f.name, e.currentTarget);
            });
            // Delete folder (two-step inline confirm) — does NOT navigate.
            row.querySelector('.gd-file-row-del').addEventListener('click', e => {
                e.stopPropagation();
                ghBrowseDeleteFolder(repo, branch, f, e.currentTarget);
            });
            // Clicking the rest of the row navigates into the folder.
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
            const kind = ghFileKind(f.name);
            const isJson = kind === 'json';
            row.innerHTML = `<i data-lucide="${ghFileIconFor(kind)}" class="w-4 h-4 ${ghFileColorFor(kind)} flex-shrink-0"></i>` +
                `<span class="gd-file-row-name">${escapeHtml(f.name)}</span>` +
                `<span class="gd-file-row-cdn" title="Copy jsDelivr CDN link">` +
                '<i data-lucide="link" class="w-3 h-3"></i> CDN</span>' +
                `<span class="gd-file-row-dl" title="Download this file">` +
                '<i data-lucide="download" class="w-3 h-3"></i></span>' +
                `<span class="gd-file-row-del" title="Permanently delete this file from GitHub">` +
                '<i data-lucide="trash-2" class="w-3 h-3"></i></span>' +
                (isJson
                    ? '<span class="gd-file-row-load">Load</span>'
                    : '<span class="gd-file-row-load" title="Copy the jsDelivr CDN link for this file">Use</span>');
            // Copy-CDN: copies the link, does NOT load the file.
            row.querySelector('.gd-file-row-cdn').addEventListener('click', e => {
                e.stopPropagation();
                ghCopyToClipboard(cdnUrl, 'jsDelivr CDN link');
            });
            // Download: saves the file as-is (no canonicalization), does NOT load it.
            row.querySelector('.gd-file-row-dl').addEventListener('click', e => {
                e.stopPropagation();
                ghBrowseDownloadFile(repo, branch, f.path, f.name, e.currentTarget);
            });
            // Delete: two-step inline confirm, then permanently removes from GitHub.
            row.querySelector('.gd-file-row-del').addEventListener('click', e => {
                e.stopPropagation();
                ghBrowseDeleteFile(repo, branch, f, e.currentTarget);
            });
            if (isJson) {
                // Clicking the rest of the row (or "Load") loads the JSON into the tool.
                row.querySelector('.gd-file-row-load').addEventListener('click', e => {
                    e.stopPropagation();
                    figGitHubLoadFile(repo, branch, f.path, f.name);
                });
                row.addEventListener('click', () => figGitHubLoadFile(repo, branch, f.path, f.name));
            } else {
                // PDF / image / HTML — there's nothing to "load" as question data,
                // so the row's main action copies its CDN link instead.
                row.querySelector('.gd-file-row-load').addEventListener('click', e => {
                    e.stopPropagation();
                    ghCopyToClipboard(cdnUrl, 'jsDelivr CDN link');
                });
                row.addEventListener('click', () => ghCopyToClipboard(cdnUrl, 'jsDelivr CDN link'));
            }
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
    if (!path || !ghFileIsBrowsable(path)) {
        showToast('Bad path', 'Enter a path ending in .json, .pdf, an image, or .html', 'error');
        return;
    }
    figGitHubLoadFile(repo, branch, path, path.split('/').pop());
}

// Fetch a file from GitHub. JSON is parsed and delivered into the tab that
// opened the picker (Editor / Quiz Builder / Figure Updater). PDF, image &
// HTML files aren't parseable question data, so their jsDelivr CDN link is
// copied to the clipboard instead.
async function figGitHubLoadFile(repo, branch, path, name) {
    if (ghFileKind(name) !== 'json') {
        const ghFile = { repo, branch, path, name };
        ghAddRecent(ghFile);
        ghCopyToClipboard(ghJsonCdnUrl(repo, branch, path), 'jsDelivr CDN link for "' + name + '"');
        figGitHubClosePicker();
        return;
    }
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

/* --------------------------------------------------------------------
   BROWSE-TAB ROW ACTIONS: Download + permanent Delete  (v1.3)
   -------------------------------------------------------------------- */

// Fetch a repo file's raw text via the contents API (works for private
// repos through figGitHubHeaders; falls back to download_url for >1 MB).
async function ghFetchFileText(repo, branch, path) {
    const url = `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}` +
        `?ref=${encodeURIComponent(branch)}`;
    const resp = await fetch(url, { headers: figGitHubHeaders() });
    if (!resp.ok) {
        let msg = 'HTTP ' + resp.status;
        try { const j = await resp.json(); msg = j.message || msg; } catch (e) {}
        throw new Error(msg);
    }
    const meta = await resp.json();
    if (Array.isArray(meta) || meta.type !== 'file') throw new Error('That path is not a file.');
    if (meta.encoding === 'base64' && meta.content) {
        const bin = atob(meta.content.replace(/\n/g, ''));
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
    }
    if (meta.download_url) {
        const dl = await fetch(meta.download_url);
        return await dl.text();
    }
    throw new Error('File content is empty or unsupported.');
}

// Download a browsed file AS-IS (byte-faithful text, no canonicalization,
// nothing is loaded into any tab).
async function ghBrowseDownloadFile(repo, branch, path, name, btnEl) {
    const origHTML = btnEl ? btnEl.innerHTML : '';
    if (btnEl) { btnEl.innerHTML = '<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i>'; lucide.createIcons(); }
    try {
        const kind = ghFileKind(name);
        let blob;
        if (kind === 'pdf' || kind === 'image') {
            // Binary-safe fetch — text decoding would corrupt these bytes.
            const bytes = await ghFetchFileBytes(repo, branch, path);
            blob = new Blob([bytes], { type: ghMimeFor(kind, name) });
        } else {
            const text = await ghFetchFileText(repo, branch, path);
            blob = new Blob([text], { type: ghMimeFor(kind, name) });
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        showToast('Downloaded', `"${name}" saved to your device.`, 'success');
    } catch (err) {
        showToast('Download failed', err.message || String(err), 'error');
    } finally {
        if (btnEl) { btnEl.innerHTML = origHTML; lucide.createIcons(); }
    }
}

// Two-step inline confirm + permanent delete for a browsed file.
// First click arms the button (turns into "Sure?"; auto-disarms after 4 s);
// second click within that window deletes the file from the repository,
// unlinks it if it is the currently linked Editor/Figures file, and
// refreshes the listing.
function ghBrowseDeleteFile(repo, branch, f, btnEl) {
    if (!btnEl) return;
    if (!ghJsonCreds.token) {
        showToast('Token required', 'Deleting needs a GitHub token (repo scope). Open the Credentials tab.', 'error');
        if (typeof ghSwitchTab === 'function') ghSwitchTab('creds');
        return;
    }
    // Step 1: arm.
    if (!btnEl.classList.contains('confirm')) {
        btnEl.classList.add('confirm');
        btnEl.innerHTML = '<i data-lucide="alert-triangle" class="w-3 h-3"></i> Sure?';
        btnEl.title = 'Click again to PERMANENTLY delete "' + f.name + '" from ' + repo + '@' + branch;
        lucide.createIcons();
        btnEl.__ghDelTimer = setTimeout(function () {
            btnEl.classList.remove('confirm');
            btnEl.innerHTML = '<i data-lucide="trash-2" class="w-3 h-3"></i>';
            btnEl.title = 'Permanently delete this file from GitHub';
            lucide.createIcons();
        }, 4000);
        return;
    }
    // Step 2: execute.
    clearTimeout(btnEl.__ghDelTimer);
    btnEl.classList.remove('confirm');
    btnEl.innerHTML = '<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i>';
    lucide.createIcons();
    (async function () {
        try {
            await ghDeleteSingleFile(repo, branch, f.path, f.sha, f.name);
            showToast('Deleted', '"' + f.name + '" permanently removed from ' + repo + '@' + branch + '.', 'success');
            // If the deleted file is the currently linked GitHub file of the
            // Editor or Figure Updater, unlink it so later "Update on GitHub"
            // commits don't fail against a missing file.
            var same = function (l) {
                return l && l.repo === repo && l.branch === branch && l.path === f.path;
            };
            if (typeof editorGitHubFile !== 'undefined' && same(editorGitHubFile)
                && typeof editorUnlinkGitHub === 'function') editorUnlinkGitHub();
            if (typeof figState !== 'undefined' && same(figState.githubFile)
                && typeof figUnlinkGitHub === 'function') figUnlinkGitHub();
            await figGitHubBrowse();   // refresh the listing
        } catch (err) {
            showToast('Delete failed', err.message || String(err), 'error');
            btnEl.innerHTML = '<i data-lucide="trash-2" class="w-3 h-3"></i>';
            lucide.createIcons();
        }
    })();
}

// Fetch a repo file's RAW BYTES (binary-safe — needed so non-text assets
// like images inside a folder survive a folder→ZIP download intact).
async function ghFetchFileBytes(repo, branch, path) {
    const url = `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}` +
        `?ref=${encodeURIComponent(branch)}`;
    const resp = await fetch(url, { headers: figGitHubHeaders() });
    if (!resp.ok) {
        let msg = 'HTTP ' + resp.status;
        try { const j = await resp.json(); msg = j.message || msg; } catch (e) {}
        throw new Error(msg);
    }
    const meta = await resp.json();
    if (Array.isArray(meta) || meta.type !== 'file') throw new Error('That path is not a file.');
    if (meta.encoding === 'base64' && meta.content) {
        const bin = atob(meta.content.replace(/\n/g, ''));
        return Uint8Array.from(bin, c => c.charCodeAt(0));
    }
    if (meta.download_url) {
        const dl = await fetch(meta.download_url);
        return new Uint8Array(await dl.arrayBuffer());
    }
    throw new Error('File content is empty or unsupported.');
}

// Download an entire repo folder (recursively) as a ZIP. Files keep their
// paths relative to the folder. Nothing is loaded into any tab.
async function ghBrowseDownloadFolder(repo, branch, folderPath, folderName, btnEl) {
    const origHTML = btnEl ? btnEl.innerHTML : '';
    const setBtn = html => { if (btnEl) { btnEl.innerHTML = html; lucide.createIcons(); } };
    setBtn('<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i>');
    try {
        const files = await ghCollectFolderFiles(repo, branch, folderPath);
        if (!files.length) { showToast('Empty folder', 'No files found inside "' + folderName + '".', 'error'); return; }
        const zip = new JSZip();
        let done = 0, failed = 0;
        for (const f of files) {
            try {
                const bytes = await ghFetchFileBytes(repo, branch, f.path);
                // Path inside the zip: relative to the downloaded folder.
                const rel = f.path.startsWith(folderPath + '/')
                    ? f.path.slice(folderPath.length + 1) : f.name;
                zip.file(folderName + '/' + rel, bytes);
            } catch (e) { failed++; console.warn('Could not fetch', f.path, e.message); }
            done++;
            setBtn('<span style="font-size:10px;font-weight:700;">' + done + '/' + files.length + '</span>');
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = folderName + '.zip';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        showToast(failed ? 'Downloaded (partial)' : 'Downloaded',
            failed ? (done - failed) + ' file(s) zipped, ' + failed + ' failed.'
                   : '"' + folderName + '.zip" (' + files.length + ' file(s)) saved to your device.',
            failed ? 'error' : 'success');
    } catch (err) {
        showToast('Download failed', err.message || String(err), 'error');
    } finally {
        setBtn(origHTML);
    }
}

// Two-step inline confirm + permanent delete of a folder AND everything in
// it. Same arm/auto-disarm pattern as the single-file delete; the second
// click deletes every file (with progress on the button), unlinks any
// linked Editor/Figures file that lived inside the folder, and refreshes.
function ghBrowseDeleteFolder(repo, branch, f, btnEl) {
    if (!btnEl) return;
    if (!ghJsonCreds.token) {
        showToast('Token required', 'Deleting needs a GitHub token (repo scope). Open the Credentials tab.', 'error');
        if (typeof ghSwitchTab === 'function') ghSwitchTab('creds');
        return;
    }
    if (!btnEl.classList.contains('confirm')) {
        btnEl.classList.add('confirm');
        btnEl.innerHTML = '<i data-lucide="alert-triangle" class="w-3 h-3"></i> Sure?';
        btnEl.title = 'Click again to PERMANENTLY delete folder "' + f.name + '" and ALL files inside it from ' + repo + '@' + branch;
        lucide.createIcons();
        btnEl.__ghDelTimer = setTimeout(function () {
            btnEl.classList.remove('confirm');
            btnEl.innerHTML = '<i data-lucide="trash-2" class="w-3 h-3"></i>';
            btnEl.title = 'Permanently delete this folder and ALL files inside it from GitHub';
            lucide.createIcons();
        }, 4000);
        return;
    }
    clearTimeout(btnEl.__ghDelTimer);
    btnEl.classList.remove('confirm');
    const setBtn = html => { btnEl.innerHTML = html; lucide.createIcons(); };
    setBtn('<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i>');
    (async function () {
        try {
            const files = await ghCollectFolderFiles(repo, branch, f.path);
            if (!files.length) {
                showToast('Empty folder', 'Folder appears empty — nothing to delete.', 'error');
                await figGitHubBrowse();
                return;
            }
            let deleted = 0, failed = 0;
            for (const file of files) {
                try {
                    await ghDeleteSingleFile(repo, branch, file.path, file.sha, file.name);
                    deleted++;
                } catch (e) { console.warn('Could not delete', file.path, e.message); failed++; }
                setBtn('<span style="font-size:10px;font-weight:700;">' + (deleted + failed) + '/' + files.length + '</span>');
            }
            showToast(failed ? 'Partial delete' : 'Folder deleted',
                failed ? deleted + ' file(s) deleted, ' + failed + ' failed.'
                       : 'Folder "' + f.name + '" and ' + deleted + ' file(s) permanently removed from ' + repo + '@' + branch + '.',
                failed ? 'error' : 'success');
            // Unlink Editor/Figures files that lived inside the deleted folder.
            var inside = function (l) {
                return l && l.repo === repo && l.branch === branch
                    && (l.path === f.path || (l.path || '').indexOf(f.path + '/') === 0);
            };
            if (typeof editorGitHubFile !== 'undefined' && inside(editorGitHubFile)
                && typeof editorUnlinkGitHub === 'function') editorUnlinkGitHub();
            if (typeof figState !== 'undefined' && inside(figState.githubFile)
                && typeof figUnlinkGitHub === 'function') figUnlinkGitHub();
            await figGitHubBrowse();
        } catch (err) {
            showToast('Delete failed', err.message || String(err), 'error');
            setBtn('<i data-lucide="trash-2" class="w-3 h-3"></i>');
        }
    })();
}

// Shared: commit raw base64 content (any file type) to GitHub via the
// Contents API (creates or updates). `file` = { repo, branch, path, name,
// sha }. Returns the new sha. Used directly for PDF/image/HTML uploads,
// and internally by ghCommitJsonFile below.
async function ghCommitRawFile(file, base64Content, commitMessage) {
    if (!ghJsonCreds.token) {
        throw new Error('A GitHub token is required to commit. Open the GitHub picker ' +
            'and enter a Personal Access Token (repo scope).');
    }
    const apiUrl = `https://api.github.com/repos/${file.repo}/contents/${encodeURI(file.path)}`;
    const body = {
        message: commitMessage || ('Update ' + file.name),
        content: base64Content,
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

// Shared: commit a JS object as a JSON file to GitHub (creates or updates).
// `file` = { repo, branch, path, name, sha }. Returns the new sha.
async function ghCommitJsonFile(file, dataObj, commitMessage) {
    const json = JSON.stringify(aimcqCanonicalizeExport(dataObj), null, 2);
    aimcqWarnPassageIssues(dataObj, file && file.name);
    // base64-encode the UTF-8 content (handles Hindi and all Unicode).
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    const content = btoa(bin);
    return ghCommitRawFile(file, content, commitMessage);
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
        // Force-purge jsDelivr so the updated figures JSON is live immediately.
        btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Purging CDN...';
        lucide.createIcons();
        try {
            await jsdelivrPurgeFile(f.repo, f.branch, f.path);
            showToast('Saved & Live on CDN', `Committed to ${f.repo}@${f.branch} — ${f.path}. jsDelivr cache purged — changes are live NOW.`, 'success');
        } catch (purgeErr) {
            showToast('Saved to GitHub (purge failed)', `Commit succeeded, but: ${purgeErr.message || purgeErr}`, 'info');
        }
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
let ghUploadRaw = null;         // { content: base64 } staged for a PDF/image/HTML upload

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
    ghUploadRaw = null;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('fig-gh-up-folder', '');
    set('fig-gh-up-name', '');
    const fn = document.getElementById('fig-gh-up-filename');
    if (fn) {
        fn.textContent = ghSupportsExtraTypes()
            ? 'Click or drag a .json, .pdf, image, or .html file here'
            : 'Click or drag a .json file here';
        fn.classList.remove('text-green-700', 'font-bold');
    }
    ghSetUploadStatus('', '');
}

// Stage a parsed JSON object for upload, with a suggested file name.
function ghStageUpload(data, suggestedName) {
    ghUploadData = data;
    ghUploadRaw = null;
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

// Stage a raw (binary-safe, base64) file — PDF, image, or HTML — for upload.
// These commit as-is, with no JSON parsing or canonicalization.
function ghStageUploadRaw(base64, suggestedName) {
    ghUploadRaw = { content: base64 };
    ghUploadData = null;
    const fn = document.getElementById('fig-gh-up-filename');
    if (fn) {
        const kb = Math.max(1, Math.ceil(base64.length * 0.75 / 1024));
        fn.textContent = '\u2713 ' + suggestedName + ' \u2014 ~' + kb + ' KB ready';
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
    if (!ghUploadData && !ghUploadRaw) {
        ghSetUploadStatus(
            ghSupportsExtraTypes()
                ? 'Choose a file (JSON, PDF, image, or HTML) — or use the loaded JSON — first.'
                : 'Choose a JSON file (or use the loaded JSON) first.', 'err');
        return;
    }
    let folder = (document.getElementById('fig-gh-up-folder').value || '').trim()
        .replace(/^\/+|\/+$/g, '');
    let name = (document.getElementById('fig-gh-up-name').value || '').trim()
        .replace(/^\/+/, '');
    if (!name) { ghSetUploadStatus('Enter a file name.', 'err'); return; }
    if (ghUploadRaw) {
        if (!/\.[a-z0-9]+$/i.test(name)) {
            ghSetUploadStatus('Include a file extension, e.g. figure.png or notes.pdf.', 'err');
            return;
        }
    } else if (!/\.json$/i.test(name)) {
        name += '.json';
    }
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
        const sha = ghUploadRaw
            ? await ghCommitRawFile(newFile, ghUploadRaw.content, 'Add file — ' + name)
            : await ghCommitJsonFile(newFile, ghUploadData, 'Add MCQ JSON — ' + name);
        newFile.sha = sha;

        ghSetUploadStatus('\u2713 Uploaded to ' + c.repo + '@' + c.branch + ' — ' + path, 'ok');
        showToast('Uploaded', ghUploadRaw ? 'File committed to GitHub.' : 'New JSON committed to GitHub.', 'success');
        ghAddRecent(newFile);

        // Optionally load it straight into the tool.
        const loadAfter = document.getElementById('fig-gh-up-loadafter');
        if (loadAfter && loadAfter.checked) {
            if (ghUploadRaw) {
                // PDF/image/HTML — nothing to "load" as question data;
                // copy its CDN link instead so it can be pasted in.
                ghCopyToClipboard(ghJsonCdnUrl(c.repo, c.branch, path), 'jsDelivr CDN link for "' + name + '"');
            } else if (ghPickerTarget === 'editor') {
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
        const isJson = /\.json$/i.test(file.name);
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const isExtra = ghSupportsExtraTypes() && GH_EDITOR_EXTRA_EXTS.indexOf(ext) !== -1;
        if (!isJson && !isExtra) {
            ghSetUploadStatus(
                ghSupportsExtraTypes()
                    ? 'Please choose a .json, .pdf, image, or .html file.'
                    : 'Please choose a .json file.', 'err');
            return;
        }
        if (isJson) {
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
            return;
        }
        // PDF / image / HTML — read binary-safe as base64 for a direct commit.
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = String(reader.result).split(',')[1] || '';
            ghStageUploadRaw(base64, file.name);
        };
        reader.onerror = () => ghSetUploadStatus('Could not read the file.', 'err');
        reader.readAsDataURL(file);
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
            const delKind = ghFileKind(f.name);
            row.innerHTML =
                '<i data-lucide="' + ghFileIconFor(delKind) + '" class="w-4 h-4 ' + ghFileColorFor(delKind) + ' flex-shrink-0"></i>' +
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
        // Force-purge the jsDelivr cache so the committed change is served
        // immediately on the existing CDN URL (no ~12h propagation wait).
        btn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Purging CDN cache...';
        lucide.createIcons();
        try {
            await jsdelivrPurgeFile(editorGitHubFile.repo, editorGitHubFile.branch, editorGitHubFile.path);
            showToast('Saved & Live on CDN',
                `Committed to ${editorGitHubFile.repo}@${editorGitHubFile.branch} — ${editorGitHubFile.path}. jsDelivr cache purged — changes are live NOW.`,
                'success');
        } catch (purgeErr) {
            showToast('Saved to GitHub (purge failed)',
                `Commit succeeded, but: ${purgeErr.message || purgeErr}`,
                'info');
        }
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



/* ====================================================================
   BOOT BEACON + GITHUB PICKER RESILIENCE  (v1.3)
   --------------------------------------------------------------------
   1. Logs a version line so you can verify in DevTools which core the
      CDN actually served. If you do NOT see this line in the console,
      the file on the CDN is stale, truncated, or failed to execute —
      that is why inline onclick handlers (like the GitHub buttons) do
      nothing.
   2. Explicitly exposes the GitHub picker functions on window and adds
      addEventListener bindings for the three "Load from GitHub"
      buttons, so the picker opens even in environments that block
      inline onclick handlers (strict CSP). Opening/closing the modal is
      idempotent, so double-firing alongside the inline handler is safe.
   ==================================================================== */
(function () {
    try {
        if (typeof figGitHubOpenPicker === 'function') {
            window.figGitHubOpenPicker  = figGitHubOpenPicker;
            window.figGitHubClosePicker = figGitHubClosePicker;
        }
        var bind = function (id, target) {
            var el = document.getElementById(id);
            if (el && !el.__mcqsGhBound && typeof figGitHubOpenPicker === 'function') {
                el.__mcqsGhBound = true;
                el.addEventListener('click', function () { figGitHubOpenPicker(target); });
            }
        };
        bind('editor-btn-load-github', 'editor');
        bind('qb-btn-load-github', 'quizbuilder');
        bind('fig-btn-load-github', undefined);
        var closeBtnModal = document.getElementById('fig-gh-picker-modal');
        if (closeBtnModal && typeof figGitHubClosePicker === 'function') {
            var backdrop = closeBtnModal.querySelector('.gd-modal-backdrop');
            if (backdrop && !backdrop.__mcqsGhBound) {
                backdrop.__mcqsGhBound = true;
                backdrop.addEventListener('click', figGitHubClosePicker);
            }
        }
        if (window.console && console.info) {
            console.info('[mcqs-tool] core v2.9.3 (extractor: optional Hindi-language explanation for non-Hindi questions) loaded OK — GitHub picker ready.');
        }
    } catch (e) {
        if (window.console && console.error) {
            console.error('[mcqs-tool] boot check failed:', e && e.message);
        }
    }
})();

// ============================================================
// ============ AI QUESTION UPDATE (GEMINI API) ===============
// ============================================================
// Settings live in the Question Editor tab; the analysis runs
// inside the per-question edit modal. Flow:
//   1. User saves a Gemini API key (localStorage only).
//   2. In the edit modal, "Analyze Question" sends the question,
//      options, the currently-marked answer, an OPTIONAL user-
//      suggested option, and the pre-existing explanation (as a
//      format template) to Gemini.
//   3. Gemini independently solves the question, cross-checks the
//      marked answer, verifies the user's suggestion (if any) and
//      drafts a new explanation that replicates the pre-existing
//      explanation's exact HTML format.
//   4. Nothing touches the data until the user clicks Apply, and
//      even then it only fills the modal — "Save Changes" commits.

const AI_GEMINI_CFG_KEY = 'aimcq_gemini_cfg';
let aiCfg = { key: '', model: 'gemini-2.5-flash' };
let qeAiLast = null;          // last analysis result for the open question
let qeAiBusy = false;

// ---------- config persistence ----------
function aiLoadCfg() {
    try {
        const raw = localStorage.getItem(AI_GEMINI_CFG_KEY);
        if (raw) {
            const c = JSON.parse(raw);
            if (c && typeof c === 'object') {
                aiCfg.key   = c.key   || '';
                aiCfg.model = c.model || 'gemini-2.5-flash';
            }
        }
    } catch (e) {}
    aiSyncSettingsUI();
    aiUpdateStatusChips();
}

function aiPersistCfg() {
    try { localStorage.setItem(AI_GEMINI_CFG_KEY, JSON.stringify(aiCfg)); } catch (e) {}
}

function aiConfigured() { return !!(aiCfg.key && aiCfg.key.trim()); }

function aiEffectiveModel() { return (aiCfg.model || 'gemini-2.5-flash').trim(); }

// ---------- settings UI ----------
function aiToggleSettings() {
    const body = document.getElementById('ai-settings-body');
    const chev = document.getElementById('ai-settings-chevron');
    if (!body) return;
    const open = body.classList.toggle('hidden');
    if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
    if (!open) aiSyncSettingsUI();
}

function aiSyncSettingsUI() {
    const keyEl = document.getElementById('ai-api-key');
    const modelEl = document.getElementById('ai-model');
    const customEl = document.getElementById('ai-model-custom');
    if (!keyEl || !modelEl) return;
    keyEl.value = aiCfg.key || '';
    const preset = ['gemini-2.5-flash','gemini-2.5-pro','gemini-2.0-flash','gemini-1.5-flash'];
    if (preset.includes(aiCfg.model)) {
        modelEl.value = aiCfg.model;
        if (customEl) { customEl.classList.add('hidden'); customEl.value = ''; }
    } else {
        modelEl.value = 'custom';
        if (customEl) { customEl.classList.remove('hidden'); customEl.value = aiCfg.model || ''; }
    }
}

function aiToggleKeyVisibility() {
    const keyEl = document.getElementById('ai-api-key');
    const eye = document.getElementById('ai-key-eye');
    if (!keyEl) return;
    const show = keyEl.type === 'password';
    keyEl.type = show ? 'text' : 'password';
    if (eye) { eye.setAttribute('data-lucide', show ? 'eye-off' : 'eye'); lucide.createIcons(); }
}

function aiReadSettingsForm() {
    const keyEl = document.getElementById('ai-api-key');
    const modelEl = document.getElementById('ai-model');
    const customEl = document.getElementById('ai-model-custom');
    const key = keyEl ? aiSanitizeKey(keyEl.value) : '';
    let model = modelEl ? modelEl.value : 'gemini-2.5-flash';
    if (model === 'custom') model = (customEl && customEl.value.trim()) || 'gemini-2.5-flash';
    return { key, model };
}

function aiSaveSettings() {
    const { key, model } = aiReadSettingsForm();
    if (!key) { showToast('API Key Missing', 'Paste your Gemini API key first.', 'error'); return; }
    aiCfg.key = key;
    aiCfg.model = model;
    aiPersistCfg();
    aiUpdateStatusChips();
    showToast('AI Settings Saved', `Gemini model: ${model}. Key stored in this browser only.`, 'success');
}

function aiClearSettings() {
    aiCfg = { key: '', model: 'gemini-2.5-flash' };
    try { localStorage.removeItem(AI_GEMINI_CFG_KEY); } catch (e) {}
    aiSyncSettingsUI();
    aiUpdateStatusChips();
    const res = document.getElementById('ai-test-result');
    if (res) res.textContent = '';
    showToast('AI Settings Cleared', 'Gemini API key removed from this browser.', 'info');
}

function aiUpdateStatusChips() {
    const on = aiConfigured();
    [['ai-settings-status', on ? `Ready · ${aiEffectiveModel()}` : 'Not configured'],
     ['qe-ai-status',       on ? `Ready · ${aiEffectiveModel()}` : 'Not configured — see AI settings in Editor tab']]
    .forEach(([id, label]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = label;
        el.classList.toggle('on', on);
        el.classList.toggle('off', !on);
    });
    const btn = document.getElementById('qe-ai-analyze-btn');
    if (btn) btn.disabled = !on || qeAiBusy;
}

async function aiTestConnection() {
    const { key, model } = aiReadSettingsForm();
    const res = document.getElementById('ai-test-result');
    if (!key) { if (res) { res.textContent = 'Enter a key first.'; res.style.color = '#dc2626'; } return; }
    if (res) { res.textContent = 'Testing…'; res.style.color = '#6b7280'; }
    try {
        const out = await aiGeminiRequest('Reply with exactly: OK', { key, model, plainText: true });
        if (res) {
            const ok = /OK/i.test(out || '');
            res.textContent = ok ? `✓ Connected (${model})` : '✓ Reached API (unexpected reply)';
            res.style.color = '#059669';
        }
    } catch (err) {
        if (res) { res.textContent = '✗ ' + aiFriendlyError(err); res.style.color = '#dc2626'; }
    }
}

// ---------- Gemini transport ----------
// Strip characters that commonly sneak into pasted keys (quotes, spaces,
// newlines, zero-width chars) — a top cause of "invalid/rejected key" errors.
function aiSanitizeKey(k) {
    return String(k || '').replace(/["'`\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '');
}

async function aiGeminiRequest(prompt, opts) {
    opts = opts || {};
    const key = aiSanitizeKey(opts.key || aiCfg.key);
    const model = opts.model || aiEffectiveModel();
    // Auth via the x-goog-api-key header (Google's recommended method) —
    // avoids query-param edge cases and keeps the key out of URLs/logs.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    // Multimodal support: opts.imageB64 (+ opts.imageMime) attaches an image
    // part before the text prompt — used by the Question Extractor.
    // opts.imagesB64 (array) attaches MULTIPLE image parts in order — used
    // when a single question spans several crops (e.g. continues on the next
    // page, or the same question in another language on the next page).
    const userParts = [];
    const mime = opts.imageMime || 'image/webp';
    if (Array.isArray(opts.imagesB64) && opts.imagesB64.length) {
        opts.imagesB64.forEach(b64 => {
            if (b64) userParts.push({ inline_data: { mime_type: mime, data: b64 } });
        });
    } else if (opts.imageB64) {
        userParts.push({ inline_data: { mime_type: mime, data: opts.imageB64 } });
    }
    userParts.push({ text: prompt });

    const body = {
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: opts.plainText
            ? { temperature: 0 }
            : { temperature: 0.2, responseMimeType: 'application/json' }
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
        },
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        let detail = '', reason = '', gstatus = '';
        try {
            const j = await resp.json();
            if (j.error) {
                detail = j.error.message || '';
                gstatus = j.error.status || '';
                // details[].reason carries the precise cause, e.g.
                // API_KEY_INVALID, SERVICE_DISABLED, API_KEY_HTTP_REFERRER_BLOCKED
                (j.error.details || []).forEach(d => {
                    if (d && d.reason && !reason) reason = d.reason;
                });
            }
        } catch (e) {}
        const err = new Error(detail || `HTTP ${resp.status}`);
        err.status = resp.status;
        err.reason = reason || gstatus;
        throw err;
    }

    const data = await resp.json();
    const cand = data.candidates && data.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const text = parts.map(p => p.text || '').join('');
    if (!text) {
        const block = (data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason);
        throw new Error(block ? `Empty response (${block})` : 'Empty response from Gemini');
    }
    return text;
}

function aiParseJson(text) {
    let t = String(text || '').trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
    // If extra prose sneaks in, grab the outermost JSON object.
    if (t[0] !== '{') {
        const s = t.indexOf('{'), e = t.lastIndexOf('}');
        if (s !== -1 && e > s) t = t.slice(s, e + 1);
    }
    return JSON.parse(t);
}

function aiFriendlyError(err) {
    const msg = (err && err.message) || 'Unknown error';
    const reason = (err && err.reason) || '';

    // Targeted guidance based on Google's precise error reason.
    if (/API_KEY_INVALID/i.test(reason) || (err && err.status === 400 && /API key/i.test(msg))) {
        return 'This API key is invalid. Re-copy the FULL key from https://aistudio.google.com/app/apikey (watch for missing characters or extra spaces/quotes).';
    }
    if (/API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED|API_KEY_ANDROID_APP_BLOCKED|API_KEY_IOS_APP_BLOCKED/i.test(reason)) {
        return 'This key has application restrictions (website/IP/app) that block this page. In Google Cloud Console → APIs & Services → Credentials, open the key and set "Application restrictions" to "None" — or create an unrestricted key in AI Studio.';
    }
    if (/SERVICE_DISABLED/i.test(reason)) {
        return 'The "Generative Language API" is disabled for this key\'s Google Cloud project. Enable it in Cloud Console, or simply create the key at https://aistudio.google.com/app/apikey (AI Studio keys work out of the box).';
    }
    if (/API_KEY_SERVICE_BLOCKED/i.test(reason)) {
        return 'This key is not allowed to call the Generative Language API (API restrictions on the key). Edit the key\'s "API restrictions" to include the Generative Language API, or create a fresh key in AI Studio.';
    }
    if (err && (err.status === 401 || err.status === 403)) {
        return 'API key rejected (HTTP ' + err.status + (reason ? ' · ' + reason : '') + '). Common causes for free-tier keys: (1) key created in Google Cloud without the Generative Language API enabled — create it at https://aistudio.google.com/app/apikey instead; (2) key has website/IP restrictions — set restrictions to "None"; (3) key was deleted/regenerated. Google says: ' + msg;
    }
    if (err && err.status === 404) return 'Model not found — pick another model in AI settings.';
    if (err && err.status === 429) return 'Rate limit / quota exceeded — wait a moment and retry.';
    if (/FAILED_PRECONDITION/i.test(reason) || /User location is not supported/i.test(msg)) {
        return 'Google reports your region is not supported for the free Gemini API tier with this key. Google says: ' + msg;
    }
    if (/Failed to fetch|NetworkError/i.test(msg)) return 'Network error — check your connection (or an ad-blocker blocking googleapis.com).';
    return msg;
}

// ---------- HTML → analysable plain text ----------
function aiHtmlToPlain(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    div.querySelectorAll('img').forEach(img => {
        img.replaceWith(document.createTextNode(' [FIGURE: ' + (img.getAttribute('alt') || 'image') + '] '));
    });
    div.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')));
    div.querySelectorAll('p,div,li,tr,h1,h2,h3,h4').forEach(el => el.append(document.createTextNode('\n')));
    return (div.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
}

// ---------- modal lifecycle ----------
function qeAiOnModalOpen(optionCount) {
    qeAiLast = null;
    qeAiBusy = false;
    const err = document.getElementById('qe-ai-error');
    const result = document.getElementById('qe-ai-result');
    if (err) { err.classList.add('hidden'); err.textContent = ''; }
    if (result) result.classList.add('hidden');
    qeAiSetBusy(false);

    // Populate the optional user-suggestion dropdown (A, B, C, …)
    const sel = document.getElementById('qe-ai-suggest');
    if (sel) {
        sel.innerHTML = '<option value="">None — let AI decide independently</option>';
        for (let i = 0; i < (optionCount || 0); i++) {
            const letter = OPTION_LETTERS[i] || String(i + 1);
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = `Option (${letter}) — I think this is correct`;
            sel.appendChild(o);
        }
    }
    aiUpdateStatusChips();
}

function qeAiSetBusy(busy) {
    qeAiBusy = busy;
    const btn = document.getElementById('qe-ai-analyze-btn');
    const label = document.getElementById('qe-ai-analyze-label');
    if (!btn) return;
    btn.disabled = busy || !aiConfigured();
    if (label) label.innerHTML = busy
        ? '<span class="qe-ai-spinner"></span> Analyzing…'
        : 'Analyze Question';
}

// ---------- collect the LIVE state of the modal ----------
function qeAiCollect() {
    const q = {
        question: getReValue('en-question'),
        explanation: getReValue('en-explanation'),
        options: [],
        marked: 0,
        bilingual: editorIsBilingual(),
        // The primary panel holds the file's sole language for single-language
        // files (which may be Hindi!) and English for bilingual files.
        primaryLang: editorIsBilingual() ? 'en' : ((typeof _editorLangs !== 'undefined' && _editorLangs[0]) || 'en'),
        hi: null
    };
    document.querySelectorAll('#qe-en-options .opt-editor-wrap').forEach(w => {
        q.options.push(w.querySelector('.opt-compose').innerHTML);
    });
    const checked = document.querySelector('input[name="qe-correct-en"]:checked');
    q.marked = checked ? parseInt(checked.value) : 0;

    if (q.bilingual) {
        q.hi = {
            question: getReValue('hi-question'),
            explanation: getReValue('hi-explanation'),
            options: []
        };
        document.querySelectorAll('#qe-hi-options .opt-editor-wrap').forEach(w => {
            q.hi.options.push(w.querySelector('.opt-compose').innerHTML);
        });
    }
    return q;
}

// ---------- prompt ----------
// LaTeX notation rule shared by every AI prompt in the tool. Applies to
// math AND non-math content (chemistry, geography, GK, units, dates...):
// all sub/superscripts and degree symbols go through KaTeX-renderable LaTeX.
const AI_LATEX_NOTATION_RULE =
    'NOTATION — LaTeX for scripts & degrees (critical, applies to BOTH math and non-math content): ' +
    'ALL superscripts, subscripts and degree symbols MUST be written as LaTeX inside $...$ delimiters, wherever they occur — in the question text, in every option, and throughout the explanation — regardless of subject (mathematics, physics, chemistry, biology, geography, general knowledge). ' +
    'Examples: powers/exponents $x^2$, $10^{-3}$, $2^n$; units $m^2$, $cm^3$, $km^2$, $m/s^2$; chemical formulas $H_2O$, $CO_2$, $C_6H_{12}O_6$; ions/charges $Na^+$, $Ca^{2+}$, $SO_4^{2-}$; isotopes/mass numbers $^{235}U$, $^{14}C$; angles, temperatures and coordinates $45^\\circ$, $90^\\circ$, $30^\\circ C$, $-5^\\circ C$, $23.5^\\circ N$, $82.5^\\circ E$; indexed terms $a_n$, $x_1$, $v_0$. ' +
    'Scripts longer than one character need braces: $10^{-3}$ (not $10^-3$), $SO_4^{2-}$, $C_6H_{12}O_6$. ' +
    'NEVER use raw Unicode superscript/subscript/degree characters (\u00b2 \u00b3 \u2070 \u2075 \u2081 \u2082 \u207a \u207b \u00b0 \u00bd etc.) and NEVER use HTML <sub>/<sup> tags for any of these — convert every occurrence (including ones printed that way in the source image/text) into the LaTeX form. ' +
    'Ordinary words like "degree"/"degrees" written out with no numeric value stay as plain text.';

// Shared instruction for how thorough the generated explanation must be.
// "detailed" is written for weak students: teach, don't just state.
function aiDetailInstruction(level, pName) {
    if (level === 'concise') {
        return 'EXPLANATION DEPTH: keep the explanation brief and to the point — 2-4 sentences covering only the essential reasoning.';
    }
    if (level === 'detailed') {
        return 'EXPLANATION DEPTH (critical — DETAILED teaching mode): the explanation must be thorough enough that a WEAK student meeting this topic for the first time can fully follow it. Do NOT give a short, to-the-point answer. Requirements: '
            + '(1) briefly define/recall the key concept, term, or formula involved and WHY it applies to this question, in simple language; '
            + '(2) show EVERY intermediate step of the working — never skip a calculation, substitution, or logical link, even trivial ones; '
            + '(3) after each step, add a short plain-language reason for what was done and why; '
            + '(4) end by clearly restating the final answer/value and, where genuinely helpful, add one line about the most common mistake or confusion on such questions; '
            + '(5) target roughly 120-300 words (longer for multi-step numerical problems) — a 2-3 sentence explanation is NOT acceptable in this mode; '
            + `(6) keep the language simple and encouraging, entirely in ${pName}, with all math in LaTeX ($...$). `
            + 'This depth requirement works together with (not instead of) the step-by-step and no-option-reference rules.';
    }
    return '';   // standard — no extra depth instruction
}

// Shared, standardized explanation format used for EVERY AI-generated
// explanation in the Question Editor. This deliberately REPLACES whatever
// format a pre-existing explanation used (plain text, <br>-separated
// lines, etc.) so that all explanations — old and freshly regenerated —
// converge on one professional, structured HTML shape: proper heading
// hierarchy, real paragraphs, lists, and tables (only where genuinely
// tabular). The tool's own rich-text editor uses h2/h3/h4 for
// Heading/Subheading/Minor heading, so the AI is told to use that same
// vocabulary (h3 for section headings, h4 for minor/step headings) for
// consistency with what an editor would produce by hand.
function aiExplanationFormatInstruction(pName) {
    return 'EXPLANATION FORMAT (critical — ALWAYS use this structure; this OVERRIDES and REPLACES any pre-existing explanation\'s formatting): '
        + 'build "explanation_html" as clean, semantic HTML using proper heading hierarchy, paragraphs, lists and tables — NEVER as a single block of text, and NEVER using <br> tags to fake paragraph, section, or step breaks (a <br> is only acceptable for a genuine mid-sentence line wrap inside one <p> or table cell, and is normally not needed at all). '
        + 'If a pre-existing explanation is shown below, treat it ONLY as background on which facts/substance are already correct or already covered — completely ignore and discard its tags, layout, and structure; do not imitate its formatting in any way, even partially. '
        + 'Allowed tags only: <h3> for main section headings, <h4> for minor/sub headings (including individual step headings), <p> for prose paragraphs, <ul>/<ol> with <li> for lists, <b>/<i> for emphasis inside text, and a full <table><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table> for genuinely tabular data (e.g. comparing several values/quantities side by side) — add a table ONLY when the content is naturally tabular, not for ordinary prose. '
        + 'MANDATORY CLASSIFICATION GATE — answer this BEFORE writing anything: "Does answering this specific question require ME to actually perform a numeric calculation using a formula/equation (e.g. arithmetic, algebra, a physics/chemistry numeric computation, a stated numeric derivation)?" '
        + 'If the honest answer is NO — this covers general knowledge, general studies, biology, history, geography, civics/polity, current affairs, English/language, reasoning-without-arithmetic, and ALSO purely conceptual/theoretical/definitional maths, physics, or chemistry questions that only ask you to recall/identify/define something rather than calculate it — then you are in BRANCH B, and Branch B is the DEFAULT for most questions in this tool. '
        + 'If the honest answer is YES — you actually have to compute a numeric result — then you are in BRANCH A. When in doubt, or if you are not certain a real calculation is required, choose BRANCH B. '
        + 'BRANCH B (the default — use this unless the gate above is clearly YES): a <h3>Key Concept</h3> heading and any <h4>Step ...</h4> heading are FORBIDDEN — do not write them, not even one. Use exactly these three sections, in this order: (b1) an <h3>Correct Answer Explanation</h3> heading with <p> paragraphs (and a <ul>/<table> only if genuinely useful) that state the correct answer\'s substance and justify it conceptually; (b2) an <h3>Incorrect Options Analysis</h3> section — SKIP this section entirely (do not write its heading) if the options are CODE-TYPE rather than content-type (see CODE-TYPE OPTIONS EXCEPTION below); otherwise, for each of the OTHER (incorrect) options, one short <p> (or one <li> inside a single <ul>, one item per option) that names that option\'s own content/value directly and explains concretely why it is wrong or does not fit the question — refer to it ONLY by its actual text/value, never by its letter/label; (b3) an <h3>Important Points</h3> section with genuinely useful, closely-related facts for quick revision, formatted as a <ul>/<ol> or — where the facts are naturally parallel/comparable — a <table>. For example, for a question on the highest peak of a state, list the highest peaks of the other major states/regions in a table (columns like State | Peak | Height); for a formula-based conceptual question, list related formulas/units/constants; for a historical-date question, list a short related timeline of nearby events; for a classification question, list the other members of that classification. Keep this section genuinely informative and exam-useful, not filler. '
        + 'CODE-TYPE OPTIONS EXCEPTION (part of Branch B): some questions — "arrange in correct order", "arrange in sequence", "match List-I with List-II", "select the correct code", assertion-reason (A/R) questions, "which of the statements above is/are correct" — give options that are just numeric/letter CODES referring back to the items already named in the question stem (e.g. "3, 1, 4, 2", "A-ii, B-iv, C-i, D-iii", "1 and 3 only", "(a) A, B, C are correct"), NOT independent, meaningful pieces of content in their own right. Detect this whenever the options themselves contain no real-world substance beyond numbers/letters/positions. For such questions: '
        + '— SKIP (b2) "Incorrect Options Analysis" completely (do not write that heading at all) — there is nothing substantive to analyze in a wrong code/order/pairing on its own. '
        + '— In (b1) "Correct Answer Explanation", justify the correct code/order/pairing directly — briefly explain WHY each item belongs at its position (e.g. why each date falls where it does in the sequence, or why each List-I entry matches its List-II counterpart), still without ever naming the option letter/code itself. '
        + '— In (b3) "Important Points", do NOT merely restate or re-explain the same items already given in the question — instead ADD genuinely NEW, closely related facts that were NOT already listed in the question, for quick revision. Example: if the question already lists World Earth Day, World Ozone Day, World Wetlands Day and International Day for Biological Diversity, the Important Points section should list OTHER National/International Days related to the same theme (environment) that are NOT already in the question — with their dates — as a <ul> or a <table> (columns like Day | Date), giving the reader new information rather than a recap. '
        + 'This exception applies ONLY to the (b2) skip and the (b3) new-facts requirement — (b1) Correct Answer Explanation is still always required. '
        + 'BRANCH A (ONLY for a question that genuinely requires a numeric calculation): an "Incorrect Options Analysis" heading and an "Important Points" heading are FORBIDDEN here — do not write them. Use exactly these two sections, in order — (a1) a short <h3>Key Concept</h3> section (1-2 <p> sentences naming/recalling the concept, formula, or law this question depends on); (a2) an <h3>Step-by-Step Solution</h3> heading with one <h4>Step 1: ...</h4>, <h4>Step 2: ...</h4>, etc. minor-heading per step (each with its own <p> working directly beneath it, plus a <ul>/<table> only if it genuinely clarifies that step), ending with a closing <h4>Final Answer</h4> heading whose <p> states the resulting value. The step-by-step working and final answer are the complete explanation for this branch. '
        + 'SELF-CHECK before finalizing: if the explanation contains a "Key Concept" or "Step N" heading, re-confirm the question truly required a numeric calculation — if not, DELETE those headings and rewrite using Branch B instead. If the explanation contains "Incorrect Options Analysis" or "Important Points" headings alongside step headings, that is an ERROR — remove one pair or the other so only one branch\'s sections remain. If the question\'s options are code-type (per the exception above) and the explanation still contains an "Incorrect Options Analysis" heading, DELETE it. If the "Important Points" section merely repeats items already given in the question instead of adding new related facts, REWRITE it with genuinely new information. '
        + 'Never place an <h4> without its <h3> "Step-by-Step Solution" parent from Branch A, and never omit or reorder the sections required by whichever branch applies. '
        + 'All heading text (including "Correct Answer Explanation", "Incorrect Options Analysis", "Important Points", "Key Concept", "Step", "Final Answer") must be translated into ' + pName + ' (the question\'s own language), matching the rest of the explanation.';
}

// Shared instruction: forces the step-by-step structure from
// aiExplanationFormatInstruction() to actually be used (rather than being
// left optional) when the "step-by-step for math" toggle is on. Applies
// ONLY when the question is numerical/mathematical/quantitative in nature
// (calculations, formulas, equations, numerical reasoning, physics/chem/
// math problems) — plain factual or conceptual questions are unaffected.
function aiStepsInstruction(pName) {
    return `STEP-BY-STEP MATH SOLUTIONS (when applicable): re-apply the MANDATORY CLASSIFICATION GATE above. If — and ONLY if — the honest answer is YES (the question genuinely requires you to perform a numeric calculation), use BRANCH A (Key Concept + Step-by-Step Solution ONLY, no "Incorrect Options Analysis" / "Important Points"): one <h4>Step N: ...</h4> minor-heading per step (translate "Step" into ${pName} if ${pName} is not English) with that step's own <p> beneath it, never skipping a calculation, substitution, or logical link, ending with a closing <h4>Final Answer</h4> heading and <p> stating the resulting value/answer. Keep all math in LaTeX ($...$). If the honest answer is NO — including for conceptual/factual/definitional questions and questions that only recall a formula/law without computing a number — do NOT force artificial steps or a "Key Concept" heading; use BRANCH B (Correct Answer Explanation + Incorrect Options Analysis + Important Points) instead. This toggle does not override the classification gate — it only controls how thorough Branch A's steps are when Branch A genuinely applies.`;
}

function qeAiBuildPrompt(q, suggestIdx, wantSteps, detailLevel) {
    const L = i => OPTION_LETTERS[i] || String(i + 1);
    // Human-readable name of the primary content language. For a bilingual
    // file the primary side is English; for a single-language file it is the
    // file's sole language (e.g. HINDI for a Hindi-only paper).
    const P_NAMES = { en: 'ENGLISH', hi: 'HINDI' };
    const pName = P_NAMES[q.primaryLang] || String(q.primaryLang || 'en').toUpperCase();
    const lines = [];

    lines.push('You are an expert exam-question reviewer and subject-matter solver.');
    lines.push('Your job: independently solve the multiple-choice question below, then cross-check whether the currently marked correct option is REALLY correct. Be careful and rigorous — do not assume the marked answer is right.');
    lines.push('');
    lines.push(`THE QUESTION'S CONTENT LANGUAGE IS ${pName}. All generated explanation content must be in the question's own language — never translate it to another language.`);
    lines.push('');
    lines.push(AI_LATEX_NOTATION_RULE);
    lines.push('');
    lines.push('QUESTION (plain text; may contain LaTeX between $...$ / \\(...\\) and [FIGURE: ...] placeholders):');
    lines.push(aiHtmlToPlain(q.question) || '(empty)');
    lines.push('');
    lines.push('OPTIONS:');
    q.options.forEach((o, i) => lines.push(`(${L(i)}) ${aiHtmlToPlain(o) || '(empty)'}`));
    lines.push('');
    lines.push(`CURRENTLY MARKED CORRECT OPTION: (${L(q.marked)})  [0-based index ${q.marked}]`);

    if (suggestIdx !== null && suggestIdx !== undefined) {
        lines.push('');
        lines.push(`USER SUGGESTION: The user suspects option (${L(suggestIdx)}) [0-based index ${suggestIdx}] is the true correct answer.`);
        lines.push('Explicitly evaluate this suggestion against your own independent solution and report a verdict in "user_suggestion_verdict" (state clearly whether the user is right or wrong, and why in 1-3 sentences). The user suggestion is a hypothesis to check — do NOT blindly adopt it.');
    }

    lines.push('');
    if ((q.explanation || '').trim()) {
        lines.push('PRE-EXISTING EXPLANATION (raw HTML, FOR CONTENT REFERENCE ONLY — its formatting must NOT be reused, see FORMAT RULE below):');
        lines.push('-----BEGIN EXPLANATION HTML-----');
        lines.push(q.explanation);
        lines.push('-----END EXPLANATION HTML-----');
        lines.push('');
        lines.push(`Your new explanation ("explanation_html") MUST be written entirely in ${pName} — the SAME language as the question — and MUST correctly justify the truly correct answer.`);
        lines.push(aiExplanationFormatInstruction(pName));
        lines.push('NO OPTION LETTER LABELS (critical): never mention option letters or labels (A/B/C/D), the word "option" / "विकल्प", or phrases like "Correct Answer: (X)" / "सही उत्तर: (X)" / "Option B is right" / "the other options are wrong" ANYWHERE in the explanation — including inside the "Incorrect Options Analysis" section. Refer to every answer, correct or incorrect, only by its actual text/value/content. If the pre-existing explanation above contains any letter-based option references or per-option elimination parts, rewrite them as substance-based statements (naming each option\'s actual text/value instead of its letter) inside the new structured format.');
        if (wantSteps) lines.push(aiStepsInstruction(pName));
        const detailInstr = aiDetailInstruction(detailLevel, pName);
        if (detailInstr) lines.push(detailInstr);
    } else {
        lines.push(`PRE-EXISTING EXPLANATION: (none).`);
        lines.push(aiExplanationFormatInstruction(pName));
        lines.push('NO OPTION LETTER LABELS (critical): never mention option letters or labels (A/B/C/D), the word "option" / "विकल्प", or phrases like "Correct Answer: (X)" / "सही उत्तर: (X)" anywhere in the explanation — including inside the "Incorrect Options Analysis" section. Refer to every answer, correct or incorrect, only by its actual text/value/content.');
        if (wantSteps) lines.push(aiStepsInstruction(pName));
        const detailInstr2 = aiDetailInstruction(detailLevel, pName);
        if (detailInstr2) lines.push(detailInstr2);
    }

    if (q.bilingual && q.hi) {
        lines.push('');
        lines.push('THIS IS A BILINGUAL (English + Hindi) QUESTION. Hindi version:');
        lines.push('QUESTION (HINDI): ' + (aiHtmlToPlain(q.hi.question) || '(empty)'));
        q.hi.options.forEach((o, i) => lines.push(`(${L(i)}) [HI] ${aiHtmlToPlain(o) || '(empty)'}`));
        if ((q.hi.explanation || '').trim()) {
            lines.push('PRE-EXISTING HINDI EXPLANATION (raw HTML, FOR CONTENT REFERENCE ONLY — its formatting must NOT be reused). "explanation_html_hi" MUST be written entirely in HINDI and MUST follow the SAME structured EXPLANATION FORMAT given above (h3 section headings, h4 step/minor headings, p/ul/ol/table — headings translated into Hindi), completely ignoring this sample\'s own tags/structure. The same NO OPTION LETTER LABELS rule applies: no option letters (A/B/C/D), no \u0935\u093f\u0915\u0932\u094d\u092a/"option" mentions, no "\u0938\u0939\u0940 \u0909\u0924\u094d\u0924\u0930: (X)"-style lines — state and justify the actual answer substance in Hindi instead:');
            lines.push('-----BEGIN HINDI EXPLANATION HTML-----');
            lines.push(q.hi.explanation);
            lines.push('-----END HINDI EXPLANATION HTML-----');
            if (wantSteps) lines.push(aiStepsInstruction('HINDI'));
            { const d = aiDetailInstruction(detailLevel, 'HINDI'); if (d) lines.push('For "explanation_html_hi": ' + d); }
        } else {
            lines.push('PRE-EXISTING HINDI EXPLANATION: (none). Produce "explanation_html_hi" written entirely in Hindi, following the SAME structured EXPLANATION FORMAT given above (h3 section headings, h4 step/minor headings, p/ul/ol/table, headings translated into Hindi), with the same NO OPTION LETTER LABELS rule (no option letters, no विकल्प/"option" mentions).');
            if (wantSteps) lines.push(aiStepsInstruction('HINDI'));
            { const d = aiDetailInstruction(detailLevel, 'HINDI'); if (d) lines.push('For "explanation_html_hi": ' + d); }
        }
    }

    lines.push('');
    lines.push('TASK:');
    lines.push('1. Solve the question yourself from first principles BEFORE looking at the marked answer.');
    lines.push('2. Decide the truly correct option (0-based index). If a [FIGURE] is essential and missing, reason from the text as best you can and lower your confidence.');
    lines.push('3. Compare your answer with the currently marked option.');
    lines.push(q.bilingual
        ? '4. Write the new explanation(s) per the EXPLANATION FORMAT and NO OPTION LETTER LABELS rules above — English explanation in English, Hindi explanation in Hindi, BOTH using the same structured h3/h4/p/ul/ol/table format (never the pre-existing sample\'s own formatting), and neither mentioning option letters/labels. (Option letters MAY still appear in "reasoning" and "user_suggestion_verdict" — the restriction applies only to the explanation HTML fields.)'
        : `4. Write the new explanation per the EXPLANATION FORMAT and NO OPTION LETTER LABELS rules above — entirely in ${pName}, using the structured h3/h4/p/ul/ol/table format (never the pre-existing sample's own formatting), with no option letters/labels mentioned. (Option letters MAY still appear in "reasoning" and "user_suggestion_verdict" — the restriction applies only to the explanation HTML field.)`);
    lines.push('');
    lines.push('Respond with ONLY a single JSON object (no markdown fences, no commentary):');
    lines.push('{');
    lines.push('  "correct_index": <0-based integer>,');
    lines.push('  "is_marked_correct": <true|false>,');
    lines.push('  "confidence": "high" | "medium" | "low",');
    lines.push(`  "reasoning": "<2-5 sentence plain-text summary, written in ${q.bilingual ? 'ENGLISH' : pName}, of how you solved it and, if the marked answer is wrong, why>",`);
    if (suggestIdx !== null && suggestIdx !== undefined)
        lines.push('  "user_suggestion_verdict": "<verdict on the user\'s suggested option>",');
    lines.push(`  "explanation_html": "<new explanation in ${pName} as an HTML string>"` + (q.bilingual ? ',' : ''));
    if (q.bilingual)
        lines.push('  "explanation_html_hi": "<new Hindi explanation as an HTML string>"');
    lines.push('}');

    return lines.join('\n');
}

// ---------- analyze ----------
async function qeAiAnalyze() {
    if (qeAiBusy) return;
    const errBox = document.getElementById('qe-ai-error');
    const resultBox = document.getElementById('qe-ai-result');
    if (errBox) { errBox.classList.add('hidden'); errBox.textContent = ''; }

    if (!aiConfigured()) {
        if (errBox) {
            errBox.textContent = 'Gemini API is not configured. Close this modal and open "AI Question Update (Gemini API)" settings in the Question Editor tab.';
            errBox.classList.remove('hidden');
        }
        return;
    }

    const q = qeAiCollect();
    if (!q.options.length) {
        if (errBox) { errBox.textContent = 'This question has no options to analyze.'; errBox.classList.remove('hidden'); }
        return;
    }

    const sel = document.getElementById('qe-ai-suggest');
    const suggestIdx = (sel && sel.value !== '') ? parseInt(sel.value) : null;
    const wantSteps = !!(document.getElementById('qe-ai-steps') || {}).checked;
    const detailLevel = (document.getElementById('qe-ai-detail') || {}).value || 'detailed';

    qeAiSetBusy(true);
    if (resultBox) resultBox.classList.add('hidden');

    try {
        const raw = await aiGeminiRequest(qeAiBuildPrompt(q, suggestIdx, wantSteps, detailLevel));
        const parsed = aiParseJson(raw);

        let ci = parseInt(parsed.correct_index);
        if (isNaN(ci) || ci < 0 || ci >= q.options.length) {
            throw new Error('AI returned an invalid correct option index.');
        }
        if (typeof parsed.explanation_html !== 'string' || !parsed.explanation_html.trim()) {
            throw new Error('AI did not return an explanation.');
        }

        qeAiLast = {
            correct_index: ci,
            is_marked_correct: (ci === q.marked),
            confidence: /^(high|medium|low)$/i.test(parsed.confidence || '') ? parsed.confidence.toLowerCase() : 'medium',
            reasoning: String(parsed.reasoning || '').trim(),
            suggestion_idx: suggestIdx,
            user_suggestion_verdict: String(parsed.user_suggestion_verdict || '').trim(),
            explanation_html: parsed.explanation_html,
            explanation_html_hi: (q.bilingual && typeof parsed.explanation_html_hi === 'string') ? parsed.explanation_html_hi : null,
            marked_at_analysis: q.marked,
            bilingual: q.bilingual
        };
        qeAiRenderResult();
    } catch (err) {
        if (errBox) {
            errBox.textContent = 'AI analysis failed: ' + aiFriendlyError(err);
            errBox.classList.remove('hidden');
        }
    } finally {
        qeAiSetBusy(false);
    }
}

function qeAiEsc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function qeAiRenderResult() {
    const r = qeAiLast;
    if (!r) return;
    const L = i => OPTION_LETTERS[i] || String(i + 1);
    const resultBox = document.getElementById('qe-ai-result');
    const verdict = document.getElementById('qe-ai-verdict');
    const sugBox = document.getElementById('qe-ai-suggest-verdict');
    const reasoning = document.getElementById('qe-ai-reasoning');
    const prev = document.getElementById('qe-ai-expl-preview');
    const prevHiWrap = document.getElementById('qe-ai-expl-preview-hi-wrap');
    const prevHi = document.getElementById('qe-ai-expl-preview-hi');

    const confLabel = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' }[r.confidence] || 'Medium confidence';

    if (verdict) {
        if (r.is_marked_correct) {
            verdict.className = 'rounded-xl px-4 py-3 text-sm font-semibold flex items-start gap-2.5 ok';
            verdict.innerHTML =
                `<span class="qe-ai-verdict-chip" style="background:#10b981">✓</span>
                 <span>The marked option <b>(${L(r.marked_at_analysis)})</b> is <b>correct</b>. ${qeAiEsc(confLabel)}.<br>
                 <span class="font-normal text-xs opacity-80">You can still apply the freshly drafted explanation below.</span></span>`;
        } else {
            verdict.className = 'rounded-xl px-4 py-3 text-sm font-semibold flex items-start gap-2.5 bad';
            verdict.innerHTML =
                `<span class="qe-ai-verdict-chip" style="background:#f59e0b">!</span>
                 <span>The marked option <b>(${L(r.marked_at_analysis)})</b> appears to be <b>wrong</b>.
                 AI determines the correct option is <b>(${L(r.correct_index)})</b>. ${qeAiEsc(confLabel)}.<br>
                 <span class="font-normal text-xs opacity-80">Use "Apply Correct Option" to re-mark it — the new explanation below matches option (${L(r.correct_index)}).</span></span>`;
        }
    }

    if (sugBox) {
        if (r.suggestion_idx !== null && r.suggestion_idx !== undefined && r.user_suggestion_verdict) {
            const userRight = r.suggestion_idx === r.correct_index;
            sugBox.classList.remove('hidden');
            sugBox.innerHTML = `<b>${userRight ? '✓' : '✗'} Your suggestion — option (${L(r.suggestion_idx)}):</b> ${qeAiEsc(r.user_suggestion_verdict)}`;
        } else {
            sugBox.classList.add('hidden');
            sugBox.innerHTML = '';
        }
    }

    if (reasoning) reasoning.textContent = r.reasoning || '—';

    if (prev) {
        prev.innerHTML = r.explanation_html;
        try { if (typeof renderKatex === 'function') renderKatex(prev); } catch (e) {}
    }
    if (prevHiWrap && prevHi) {
        if (r.explanation_html_hi) {
            prevHiWrap.classList.remove('hidden');
            prevHi.innerHTML = r.explanation_html_hi;
            try { if (typeof renderKatex === 'function') renderKatex(prevHi); } catch (e) {}
        } else {
            prevHiWrap.classList.add('hidden');
            prevHi.innerHTML = '';
        }
    }

    if (resultBox) resultBox.classList.remove('hidden');
    try { lucide.createIcons(); } catch (e) {}
}

// ---------- apply ----------
function qeAiSetRadio(lang, idx) {
    const radio = document.querySelector(`input[name="qe-correct-${lang}"][value="${idx}"]`);
    if (radio && !radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

function qeAiApply(mode) {
    const r = qeAiLast;
    if (!r) return;
    const L = i => OPTION_LETTERS[i] || String(i + 1);
    let didOption = false, didExpl = false;

    if (mode === 'option' || mode === 'both') {
        qeAiSetRadio('en', r.correct_index);
        if (r.bilingual) qeAiSetRadio('hi', r.correct_index);
        didOption = true;
    }
    if (mode === 'explanation' || mode === 'both') {
        setReValue('en-explanation', r.explanation_html);
        if (r.bilingual && r.explanation_html_hi) setReValue('hi-explanation', r.explanation_html_hi);
        didExpl = true;
    }

    const parts = [];
    if (didOption) parts.push(`correct option → (${L(r.correct_index)})`);
    if (didExpl) parts.push('explanation updated');
    showToast('AI Result Applied', parts.join(', ') + '. Click "Save Changes" to commit.', 'success');
}

// ---------- boot ----------
(function () {
    function initAi() { aiLoadCfg(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAi);
    else initAi();
    // Show/hide the custom model input (delegated — markup may be injected late).
    document.addEventListener('change', function (e) {
        if (e.target && e.target.id === 'ai-model') {
            const customEl = document.getElementById('ai-model-custom');
            if (customEl) customEl.classList.toggle('hidden', e.target.value !== 'custom');
        }
        if (e.target && e.target.id === 'qx-model') {
            const customEl = document.getElementById('qx-model-custom');
            if (customEl) customEl.classList.toggle('hidden', e.target.value !== 'custom');
        }
        if (e.target && e.target.id === 'qx-vision-model') {
            const customEl = document.getElementById('qx-vision-model-custom');
            if (customEl) customEl.classList.toggle('hidden', e.target.value !== 'custom');
        }
        if (e.target && e.target.id === 'qx-gemini-split') {
            qxPools.gemini.split = !!e.target.checked;
            qxPoolPersist();
            const visRow = document.getElementById('qx-vision-row');
            if (visRow) visRow.classList.toggle('hidden',
                !(qxPools.provider === 'deepseek' || (qxPools.provider === 'gemini' && qxPools.gemini.split)));
            qxPoolUpdateChip();
        }
    });
    // The tool's markup is injected after this script runs on some pages;
    // re-sync chips shortly after boot so the settings card reflects storage.
    setTimeout(function () { try { aiLoadCfg(); } catch (e) {} }, 800);
})();

// ============================================================
// ============ jsDelivr CDN CACHE PURGE ======================
// ============================================================
// jsDelivr caches GitHub files aggressively (up to 12h for branch
// URLs). After committing a JSON to GitHub we force-purge the CDN
// so the change is served IMMEDIATELY on the same URL. We purge
// both URL forms that readers might use:
//     https://cdn.jsdelivr.net/gh/{repo}@{branch}/{path}   (pinned)
//     https://cdn.jsdelivr.net/gh/{repo}/{path}            (default branch)
// The purge endpoint mirrors the CDN path:
//     https://purge.jsdelivr.net/gh/{repo}@{branch}/{path}

async function jsdelivrPurgeFile(repo, branch, path) {
    const enc = encodeURI(path);
    const targets = [
        `https://purge.jsdelivr.net/gh/${repo}@${branch}/${enc}`,
        `https://purge.jsdelivr.net/gh/${repo}/${enc}`,
    ];
    const results = await Promise.allSettled(targets.map(u =>
        fetch(u, { method: 'GET', cache: 'no-store' }).then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json().catch(() => ({}));
        })
    ));
    const okCount = results.filter(r => r.status === 'fulfilled').length;
    if (!okCount) {
        const firstErr = results[0] && results[0].reason;
        throw new Error('CDN purge failed — ' + ((firstErr && firstErr.message) || 'purge service unreachable') +
            '. The commit is saved; the CDN will refresh on its own within ~12h, or retry "Purge CDN cache".');
    }
    return { purged: okCount, total: targets.length };
}

// Purge with button busy-state + toasts. Used by the manual buttons.
async function ghPurgeCdnWithUi(file, btn, label) {
    if (!file || !file.path) {
        showToast('No GitHub file', 'Load a JSON from GitHub first.', 'error');
        return;
    }
    let origHTML = null;
    if (btn) {
        origHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Purging…';
        lucide.createIcons();
    }
    try {
        await jsdelivrPurgeFile(file.repo, file.branch, file.path);
        showToast('CDN Cache Purged', `${label || file.path} — jsDelivr will now serve the latest version immediately.`, 'success');
    } catch (err) {
        showToast('CDN Purge Failed', err.message || String(err), 'error');
    } finally {
        if (btn && origHTML !== null) {
            btn.disabled = false;
            btn.innerHTML = origHTML;
            lucide.createIcons();
        }
    }
}

// Manual purge buttons (Editor tab + Figure Updater link rows).
function editorPurgeCdn(btn) {
    ghPurgeCdnWithUi(typeof editorGitHubFile !== 'undefined' ? editorGitHubFile : null, btn, 'Editor JSON');
}
function figPurgeCdn(btn) {
    ghPurgeCdnWithUi((typeof figState !== 'undefined' && figState.githubFile) ? figState.githubFile : null, btn, 'Figures JSON');
}

// ============================================================
// ===== IMAGE HOSTING SETTINGS DROPDOWN (Figure Updater) =====
// ============================================================
// Collapsible card + status chip for the GitHub+jsDelivr image
// hosting config — same pattern as the AI (Gemini) settings card.

function figToggleHosting() {
    const body = document.getElementById('fig-host-body');
    const chev = document.getElementById('fig-host-chevron');
    if (!body) return;
    const nowHidden = body.classList.toggle('hidden');
    if (chev) chev.style.transform = nowHidden ? '' : 'rotate(180deg)';
    try { lucide.createIcons(); } catch (e) {}
}

function figHostingConfigured() {
    const c = (typeof figState !== 'undefined' && figState.github) || {};
    return !!(c.repo && c.token);
}

function figUpdateHostChip() {
    const chip = document.getElementById('fig-host-status-chip');
    if (!chip) return;
    const ok = figHostingConfigured();
    const c = (typeof figState !== 'undefined' && figState.github) || {};
    chip.textContent = ok ? `Ready · ${c.repo}@${c.branch || 'main'}` : 'Not configured';
    chip.classList.toggle('on', ok);
    chip.classList.toggle('off', !ok);
}

(function bootFigHostChip() {
    function init() { figUpdateHostChip(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    // Config loads from localStorage during boot; re-sync shortly after.
    setTimeout(function () { try { figUpdateHostChip(); } catch (e) {} }, 800);
})();

// ============================================================
// ========= QUESTION FIGURE POSITION PICKER ==================
// ============================================================
// Lets the user place the question figure ANYWHERE between the
// question's lines (like exam papers where the diagram sits
// mid-question) instead of always at the end. Shown whenever the
// question slot holds an image; the live preview follows instantly.

function figRenderQPosPicker() {
    const panel = document.getElementById('fig-qpos-panel');
    const box = document.getElementById('fig-qpos-options');
    if (!panel || !box) return;

    const qSlot = figState.slots && figState.slots.q;
    const show = !!(qSlot && figSlotHasImage(qSlot) && figState.selectedIdx !== null && figState.data);
    panel.classList.toggle('hidden', !show);
    if (!show) { box.innerHTML = ''; return; }

    if (qSlot.pos === undefined) qSlot.pos = 'auto';

    const post = figState.data.posts[figState.selectedIdx];
    const clean = figCleanQText(post.post_content || post.post_title || '');
    const segs = figSplitQSegments(clean);
    const cur = String(qSlot.pos);

    const item = (val, label, sub) => {
        const active = cur === String(val);
        return `<label class="fig-qpos-item ${active ? 'active' : ''}">
            <input type="radio" name="fig-qpos" value="${val}" ${active ? 'checked' : ''}>
            <span class="fig-qpos-lbl">${label}</span>
            ${sub ? `<span class="fig-qpos-seg">${sub}</span>` : ''}
        </label>`;
    };

    let html = item('auto', 'Auto', 'replace [image here] placeholder / existing figure — else at the end');
    html += item('start', 'At the very start', '');
    segs.forEach((s, i) => {
        const t = stripHtmlTags(s).replace(/\s+/g, ' ').trim();
        html += item(i, `After line ${i + 1}`, escapeAttr(t.slice(0, 80)) + (t.length > 80 ? '…' : ''));
    });
    html += item('end', 'At the very end', '');
    box.innerHTML = html;

    box.querySelectorAll('input[name="fig-qpos"]').forEach(r => {
        r.addEventListener('change', () => {
            const v = r.value;
            qSlot.pos = (v === 'auto' || v === 'start' || v === 'end') ? v : parseInt(v, 10);
            box.querySelectorAll('.fig-qpos-item').forEach(l =>
                l.classList.toggle('active', l.querySelector('input').checked));
            figRenderPreview();
        });
    });
}

// Re-render the picker whenever the slots re-render (question selected,
// figure cropped/cleared/applied) — wrap the existing renderer.
(function hookQPosIntoSlots() {
    if (typeof figRenderSlots !== 'function') return;
    const orig = figRenderSlots;
    figRenderSlots = function () {
        orig.apply(this, arguments);
        try { figRenderQPosPicker(); } catch (e) {}
    };
})();

// ============================================================
// ============ QUESTION EXTRACTOR (AI, Gemini) ===============
// ============================================================
// Crop individual questions from an exam PDF/image (Google-Lens
// style), send the crop to Gemini for transcription into question
// + options + correct answer + explanation, review/edit, and save
// into a persistent IndexedDB question bank. The bank survives
// refresh and browser close; records are removed only via the
// Delete buttons. Export produces the standard question JSON.

const qxState = {
    pdfDoc: null, srcType: '', pageNum: 1,
    scale: 1, fitDispW: 0, fitDispH: 0,
    rendering: false, pendingPage: null,
    cropper: null,
    result: null,          // current AI extraction under review
    cropThumb: '',         // small dataURL of the crop (stored with record)
    crops: [],             // queued crops for a multi-part question: [{b64, thumb}]
    busy: false,
};

// ---------- IndexedDB question bank ----------
const QX_DB_NAME = 'aimcq_question_bank';
const QX_DB_VER = 2;
const QX_STORE = 'questions';
const QX_LIB_STORE = 'libraries';
const QX_LIB_DEFAULT = 'general';
const QX_LIB_SEL_KEY = 'aimcq_qx_lib_selection';   // { save, view }

function qxOpenDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(QX_DB_NAME, QX_DB_VER);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(QX_STORE)) {
                db.createObjectStore(QX_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(QX_LIB_STORE)) {
                db.createObjectStore(QX_LIB_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
}

function qxDbOp(mode, fn) {
    return qxOpenDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(QX_STORE, mode);
        const store = tx.objectStore(QX_STORE);
        const out = fn(store);
        tx.oncomplete = () => { db.close(); resolve(out && out.__result !== undefined ? out.__result : undefined); };
        tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB transaction failed')); };
    }));
}

function qxDbPut(rec) { return qxDbOp('readwrite', s => { s.put(rec); }); }
function qxDbDelete(id) { return qxDbOp('readwrite', s => { s.delete(id); }); }
function qxDbClear() { return qxDbOp('readwrite', s => { s.clear(); }); }
function qxDbAll() {
    return qxOpenDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(QX_STORE, 'readonly');
        const req = tx.objectStore(QX_STORE).getAll();
        req.onsuccess = () => { db.close(); resolve(req.result || []); };
        req.onerror = () => { db.close(); reject(req.error); };
    }));
}

// ---------- subject libraries ----------
function qxLibAll() {
    return qxOpenDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(QX_LIB_STORE, 'readonly');
        const req = tx.objectStore(QX_LIB_STORE).getAll();
        req.onsuccess = () => { db.close(); resolve(req.result || []); };
        req.onerror = () => { db.close(); reject(req.error); };
    }));
}
function qxLibOp(fn) {
    return qxOpenDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(QX_LIB_STORE, 'readwrite');
        fn(tx.objectStore(QX_LIB_STORE));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    }));
}
// Ensure the default "General" library exists; returns the full list.
async function qxLibEnsure() {
    let libs = [];
    try { libs = await qxLibAll(); } catch (e) {}
    if (!libs.some(l => l.id === QX_LIB_DEFAULT)) {
        const gen = { id: QX_LIB_DEFAULT, name: 'General', created: new Date().toISOString() };
        try { await qxLibOp(st => st.put(gen)); libs.push(gen); } catch (e) {}
    }
    libs.sort((a, b) => a.id === QX_LIB_DEFAULT ? -1 : b.id === QX_LIB_DEFAULT ? 1 : String(a.name).localeCompare(String(b.name)));
    return libs;
}
function qxLibSelection() {
    try {
        const raw = localStorage.getItem(QX_LIB_SEL_KEY);
        if (raw) { const p = JSON.parse(raw); return { save: p.save || QX_LIB_DEFAULT, view: p.view || 'all' }; }
    } catch (e) {}
    return { save: QX_LIB_DEFAULT, view: 'all' };
}
function qxLibSaveSelection(sel) {
    try { localStorage.setItem(QX_LIB_SEL_KEY, JSON.stringify(sel)); } catch (e) {}
}
async function qxLibCreate() {
    const name = (window.prompt('New library name (subject), e.g. Physics, History, Maths:') || '').trim();
    if (!name) return;
    const libs = await qxLibEnsure();
    if (libs.some(l => l.name.toLowerCase() === name.toLowerCase())) {
        showToast('Library exists', `A library named "${name}" already exists.`, 'error');
        return;
    }
    const id = 'lib-' + Date.now();
    try { await qxLibOp(st => st.put({ id, name, created: new Date().toISOString() })); } catch (e) {
        showToast('Create failed', 'IndexedDB error: ' + (e.message || e), 'error'); return;
    }
    const sel = qxLibSelection();
    sel.save = id;                       // new questions go to the new library
    sel.view = id;                       // and show it right away
    qxLibSaveSelection(sel);
    await qxRenderBank();
    showToast('Library created', `"${name}" — new questions will now be saved there.`, 'success');
}
async function qxLibDeleteCurrent() {
    const sel = qxLibSelection();
    if (sel.view === 'all' || sel.view === QX_LIB_DEFAULT) return;
    const libs = await qxLibEnsure();
    const lib = libs.find(l => l.id === sel.view);
    if (!lib) return;
    let recs = [];
    try { recs = await qxDbAll(); } catch (e) {}
    const inLib = recs.filter(r => (r.library || QX_LIB_DEFAULT) === lib.id);
    if (!window.confirm(`Delete library "${lib.name}" and its ${inLib.length} question${inLib.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try {
        await qxDbOp('readwrite', st => { inLib.forEach(r => st.delete(r.id)); });
        await qxLibOp(st => st.delete(lib.id));
    } catch (e) {}
    if (sel.save === lib.id) sel.save = QX_LIB_DEFAULT;
    sel.view = 'all';
    qxLibSaveSelection(sel);
    await qxRenderBank();
    showToast('Library deleted', `"${lib.name}" and its questions were removed.`, 'info');
}

// ---------- viewer (mirrors the Figure Updater's canvas) ----------
function qxHasSource() { return !!(qxState.pdfDoc || qxState.srcType === 'image'); }

function qxApplyZoom() {
    const canvas = document.getElementById('qx-canvas');
    if (!canvas || !qxHasSource()) return;
    const dispW = Math.max(1, Math.round(qxState.fitDispW * qxState.scale));
    const dispH = Math.max(1, Math.round(qxState.fitDispH * qxState.scale));
    canvas.style.width = dispW + 'px';
    canvas.style.height = dispH + 'px';
    const zv = document.getElementById('qx-zoom-val');
    if (zv) zv.value = Math.round(qxState.scale * 100) + '%';
    if (qxState.cropper) {
        const data = qxState.cropper.getData();
        qxEnableCropper(data);
    }
}

function qxEnableCropper(keepData) {
    const canvas = document.getElementById('qx-canvas');
    if (!canvas || typeof Cropper === 'undefined') return;
    if (qxState.cropper) { qxState.cropper.destroy(); qxState.cropper = null; }
    qxState.cropper = new Cropper(canvas, {
        viewMode: 1, dragMode: 'crop', autoCrop: false,
        movable: false, zoomable: false, rotatable: false, scalable: false,
        background: false, checkCrossOrigin: false,
        ready() { if (keepData) { try { qxState.cropper.setData(keepData); } catch (e) {} } },
    });
}

function qxRenderPdfPage(num) {
    if (!qxState.pdfDoc) return;
    if (qxState.continuous) { qxRenderPdfContinuous(num); return; }
    qxState.srcType = 'pdf';
    qxState.rendering = true;
    const canvas = document.getElementById('qx-canvas');
    const ctx = canvas.getContext('2d');
    qxState.pdfDoc.getPage(num).then(page => {
        const scroll = document.getElementById('qx-pdf-scroll');
        const containerWidth = Math.max(scroll.clientWidth - 4, 200);
        const unscaled = page.getViewport({ scale: 1 });
        const fitScale = containerWidth / unscaled.width;
        const RASTER = 2.5;
        const vp = page.getViewport({ scale: fitScale * RASTER });
        canvas.width = vp.width;
        canvas.height = vp.height;
        qxState.fitDispW = canvas.width / RASTER;
        qxState.fitDispH = canvas.height / RASTER;
        if (qxState.cropper) { qxState.cropper.destroy(); qxState.cropper = null; }
        page.render({ canvasContext: ctx, viewport: vp }).promise.then(() => {
            qxState.rendering = false;
            qxApplyZoom();
            qxEnableCropper();      // crop mode is always ON in the extractor
            if (qxState.pendingPage !== null) {
                const p = qxState.pendingPage;
                qxState.pendingPage = null;
                qxRenderPdfPage(p);
            }
        });
    });
    const cp = document.getElementById('qx-cur-page');
    if (cp) cp.textContent = num;
}

// Continuous mode: render page `startNum` and the following pages stacked
// vertically onto ONE tall canvas, so a single crop selection can span a
// page break. A thin dashed separator marks each page boundary. The number
// of pages stacked is qxState.contSpan (default 2 — current + next).
function qxRenderPdfContinuous(startNum) {
    if (!qxState.pdfDoc) return;
    qxState.srcType = 'pdf';
    qxState.rendering = true;
    const canvas = document.getElementById('qx-canvas');
    const ctx = canvas.getContext('2d');
    const scroll = document.getElementById('qx-pdf-scroll');
    const containerWidth = Math.max(scroll.clientWidth - 4, 200);
    const RASTER = 2.5;
    const total = qxState.pdfDoc.numPages;
    const span = Math.max(1, qxState.contSpan || 2);
    const last = Math.min(total, startNum + span - 1);
    const nums = [];
    for (let n = startNum; n <= last; n++) nums.push(n);

    Promise.all(nums.map(n => qxState.pdfDoc.getPage(n))).then(pages => {
        // Uniform fit-scale from the widest page so columns line up.
        let maxUnscaledW = 0;
        pages.forEach(pg => { maxUnscaledW = Math.max(maxUnscaledW, pg.getViewport({ scale: 1 }).width); });
        const fitScale = containerWidth / maxUnscaledW;
        const vps = pages.map(pg => pg.getViewport({ scale: fitScale * RASTER }));
        const gap = Math.round(14 * RASTER);   // visual gap between pages
        const totalW = Math.max.apply(null, vps.map(v => v.width));
        const totalH = vps.reduce((s, v) => s + v.height, 0) + gap * (vps.length - 1);
        canvas.width = totalW;
        canvas.height = totalH;
        qxState.fitDispW = totalW / RASTER;
        qxState.fitDispH = totalH / RASTER;
        if (qxState.cropper) { qxState.cropper.destroy(); qxState.cropper = null; }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, totalW, totalH);

        // Render each page sequentially at its vertical offset.
        let y = 0;
        const renderNext = (i) => {
            if (i >= pages.length) {
                qxState.rendering = false;
                qxApplyZoom();
                qxEnableCropper();
                if (qxState.pendingPage !== null) {
                    const p = qxState.pendingPage;
                    qxState.pendingPage = null;
                    qxRenderPdfPage(p);
                }
                return;
            }
            const vp = vps[i];
            ctx.save();
            ctx.translate(0, y);
            pages[i].render({ canvasContext: ctx, viewport: vp }).promise.then(() => {
                ctx.restore();
                // dashed page-boundary separator (except after the last page)
                if (i < pages.length - 1) {
                    const sepY = y + vp.height + gap / 2;
                    ctx.save();
                    ctx.strokeStyle = '#cbd5e1';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([10, 8]);
                    ctx.beginPath(); ctx.moveTo(0, sepY); ctx.lineTo(totalW, sepY); ctx.stroke();
                    ctx.restore();
                }
                y += vp.height + gap;
                renderNext(i + 1);
            });
        };
        renderNext(0);
    });

    const cp = document.getElementById('qx-cur-page');
    if (cp) cp.textContent = last > startNum ? (startNum + '\u2013' + last) : String(startNum);
}

function qxRenderImage(file) {
    const canvas = document.getElementById('qx-canvas');
    if (!canvas) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
        const natW = img.naturalWidth || 1, natH = img.naturalHeight || 1;
        canvas.width = natW; canvas.height = natH;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, natW, natH);
        ctx.drawImage(img, 0, 0, natW, natH);
        URL.revokeObjectURL(url);
        const scroll = document.getElementById('qx-pdf-scroll');
        const containerWidth = Math.max(scroll.clientWidth - 4, 200);
        qxState.fitDispW = Math.min(natW, containerWidth);
        qxState.fitDispH = qxState.fitDispW * (natH / natW);
        qxState.srcType = 'image';
        qxState.pdfDoc = null;
        qxState.pageNum = 1;
        if (qxState.cropper) { qxState.cropper.destroy(); qxState.cropper = null; }
        qxApplyZoom();
        qxEnableCropper();
        document.getElementById('qx-cur-page').textContent = '1';
        document.getElementById('qx-total-pages').textContent = '1';
        qxUpdateNav();
    };
    img.onerror = function () {
        URL.revokeObjectURL(url);
        showToast('Image error', 'Could not load that image file.', 'error');
    };
    img.src = url;
}

function qxUpdateNav() {
    const isImg = qxState.srcType === 'image';
    const prev = document.getElementById('qx-prev-page');
    const next = document.getElementById('qx-next-page');
    if (prev) prev.disabled = isImg;
    if (next) next.disabled = isImg;
}

function qxShowWorkspace() {
    document.getElementById('qx-workspace').classList.remove('hidden');
    document.getElementById('qx-source-pick').classList.add('hidden');
}

function qxLoadPdfFile(file) {
    if (typeof pdfjsLib === 'undefined') {
        showToast('PDF engine missing', 'pdf.js failed to load — refresh and try again.', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = e => {
        const docParams = { data: new Uint8Array(e.target.result) };
        if (window.pdfjsWorkerDisabled) docParams.disableWorker = true;
        pdfjsLib.getDocument(docParams).promise.then(doc => {
            qxState.pdfDoc = doc;
            qxState.pageNum = 1;
            qxState.scale = 1;
            document.getElementById('qx-total-pages').textContent = doc.numPages;
            qxShowWorkspace();
            qxUpdateNav();
            qxRenderPdfPage(1);
        }).catch(err => showToast('PDF error', err.message || String(err), 'error'));
    };
    reader.readAsArrayBuffer(file);
}

function qxGetCropCanvas(opts) {
    opts = opts || {};
    if (!qxState.cropper) {
        if (!opts.silent) showToast('No cropper', 'Load a PDF or image first.', 'error');
        return null;
    }
    const data = qxState.cropper.getData(true);
    if (!data || data.width < 2 || data.height < 2) {
        if (!opts.silent) showToast('No selection', 'Drag a box around one complete question first.', 'error');
        return null;
    }
    const out = qxState.cropper.getCroppedCanvas({
        width: Math.round(data.width), height: Math.round(data.height),
        imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    });
    if (!out || !out.width || !out.height) {
        showToast('Invalid crop', 'The crop area is empty.', 'error');
        return null;
    }
    return out;
}

// ---------- multi-crop queue ----------
// A single question sometimes spans more than one crop: it continues on the
// next page, or the same question is printed again in another language further
// down. "Add crop" banks the current selection (letting the user turn the page
// and select more) and "Extract" then sends every banked crop plus the current
// selection to the AI as ONE question.
function qxAddCrop() {
    const crop = qxGetCropCanvas();
    if (!crop) return;
    const b64 = qxScaleCanvas(crop, 1600).toDataURL('image/webp', 0.92).split(',')[1];
    const thumb = qxScaleCanvas(crop, 300).toDataURL('image/jpeg', 0.7);
    qxState.crops.push({ b64, thumb });
    qxRenderCropQueue();
    showToast('Crop added', `${qxState.crops.length} crop${qxState.crops.length > 1 ? 's' : ''} queued. Turn the page / select more, then Extract to combine them into one question.`, 'success');
}

function qxRemoveCrop(idx) {
    if (idx < 0 || idx >= qxState.crops.length) return;
    qxState.crops.splice(idx, 1);
    qxRenderCropQueue();
}

function qxClearCrops() {
    if (!qxState.crops.length) return;
    qxState.crops = [];
    qxRenderCropQueue();
}

function qxRenderCropQueue() {
    const wrap = document.getElementById('qx-crop-queue');
    if (!wrap) return;
    const n = qxState.crops.length;
    if (!n) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
    wrap.classList.remove('hidden');
    let items = '';
    qxState.crops.forEach((c, i) => {
        items += `
        <div class="qx-crop-queue-item" title="Crop ${i + 1}">
            <span class="qx-crop-queue-num">${i + 1}</span>
            <img src="${c.thumb || ''}" alt="crop ${i + 1}">
            <button type="button" class="qx-crop-queue-del" data-idx="${i}" title="Remove this crop"><i data-lucide="x" class="w-3 h-3"></i></button>
        </div>`;
    });
    wrap.innerHTML = `
        <div class="qx-crop-queue-head">
            <span><i data-lucide="layers" class="w-3.5 h-3.5 inline-block -mt-0.5 mr-1"></i>${n} crop${n > 1 ? 's' : ''} queued for one question</span>
            <button type="button" id="qx-crop-clear" class="qx-crop-queue-clear">Clear all</button>
        </div>
        <div class="qx-crop-queue-strip">${items}</div>
        <p class="qx-crop-queue-hint">These will be combined into a single question when you click Extract (the current on-screen selection, if any, is added last).</p>`;
    wrap.querySelectorAll('.qx-crop-queue-del').forEach(b =>
        b.addEventListener('click', () => qxRemoveCrop(parseInt(b.getAttribute('data-idx'), 10))));
    const clr = document.getElementById('qx-crop-clear');
    if (clr) clr.addEventListener('click', qxClearCrops);
    if (window.lucide && lucide.createIcons) { try { lucide.createIcons(); } catch (e) {} }
}

// Downscale a canvas so its longest side <= max (API payload size control).
function qxScaleCanvas(src, max) {
    const ratio = Math.min(1, max / Math.max(src.width, src.height));
    if (ratio >= 1) return src;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * ratio));
    c.height = Math.max(1, Math.round(src.height * ratio));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
}

// ---------- extraction ----------
// Safety net: strip a leading QUESTION-NUMBER prefix that the cropped image
// carried into the stem (e.g. "20.", "Q7)", "Q. 15", "(20)", "प्रश्न 12.").
// The prompt already instructs the model to omit it, but it occasionally
// leaks; this removes only a number prefix at the very start of the field.
// It is deliberately conservative so it never touches legitimate content:
//   - years / long numbers (4+ digits) are left alone;
//   - decimals like "3.14" are left alone (no separator+space follows);
//   - a leading percentage/measurement like "20% of ..." is left alone
//     (no "." / ")" separator right after the number);
//   - only a single prefix at the absolute start (after any opening tag)
//     is removed, so an internal "1./2." statement list is never affected.
function qxStripLeadingQNumber(html) {
    if (!html) return html;
    // Skip any leading opening block/inline tags, then match an optional
    // question word (Q / Que / Ques / Question / प्र / प्रश्न), then the
    // number as either "(n)" or "n." / "n)", then required trailing space.
    const re = /^(\s*(?:<(?:p|div|span|b|i|strong|em)\b[^>]*>\s*)*)(?:(?:Q(?:ues?|uestion)?|प्र(?:श्न)?)\.?\s*(?:\(\s*\d{1,3}\s*\)|\d{1,3})\s*[.):]?(?:&nbsp;|\s)+|(?:\(\s*\d{1,3}\s*\)|\d{1,3}\s*[.):])(?:&nbsp;|\s)+)/i;
    const stripped = html.replace(re, '$1');
    // Guard: never blank out the field — if nothing meaningful remains,
    // the match was probably the whole (short) content, so keep the original.
    if (stripped.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim().length === 0)
        return html;
    return stripped;
}

// Safety net: strip answer-marking artifacts (stray tick/cross/marks) and
// any leaked answer-option text from a question field. The prompt already
// instructs the model to omit these; this cleans up the occasional leak
// without touching legitimate content (tables, figures, statements).
function qxStripArtifacts(html, options) {
    if (!html) return html;
    let out = qxStripLeadingQNumber(html);
    // 1) Remove stray standalone tick/cross/checkbox artifact glyphs that are
    //    not part of normal prose. Only remove when isolated (surrounded by
    //    whitespace/tags/limits), so we never touch a legit × in "2 × 10^3".
    out = out.replace(/(^|[\s>(\[])[\u2713\u2714\u2717\u2718\u2611\u2612\u274c\u2716](?=$|[\s<)\].,])/g, '$1');
    // 2) If the model appended the full option list to the end of the stem as
    //    loose lines, drop a trailing run that exactly matches the options.
    if (Array.isArray(options) && options.length >= 2) {
        const norm = t => String(t).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
        const optSet = options.map(norm).filter(Boolean);
        // split trailing <br>/<p> segments and remove ones equal to an option
        const parts = out.split(/(?:<br\s*\/?>|<\/p>\s*<p>)/i);
        while (parts.length > 1) {
            const tail = norm(parts[parts.length - 1]);
            if (tail && optSet.includes(tail)) { parts.pop(); }
            else break;
        }
        out = parts.join('<br>');
    }
    return out.replace(/(?:\s*<br\s*\/?>\s*)+$/i, '').trim();
}

// "Hindi explanation" mode: the question and its options are transcribed and
// kept in the source language (e.g. English) exactly as printed, but the
// EXPLANATION is written in Hindi and stored in the PRIMARY _aimcq_explanation
// field (matching bank exports where an English question carries a Hindi
// explanation and _aimcq_explanation_hi is left empty).
function qxHindiExplInstruction(detailLevel) {
    const L = [];
    L.push('EXPLANATION LANGUAGE = HINDI (critical, overrides the output language for the explanation ONLY): transcribe the question text and ALL options in their own printed language exactly as instructed above — do NOT translate them — but write "explanation_html" entirely in HINDI (Devanagari). Rules: '
        + '(a) the question and options stay in the source language; ONLY the explanation is Hindi; '
        + '(b) technical/subject terms, proper nouns, and the option wording being justified may appear in their original script inside the Hindi text where that is how they are normally written (e.g. <b>\'Sarcastic\'</b>, Idiom <b>\'Make no bones about it\'</b>) — but the explanatory prose itself must be Hindi; '
        + '(c) keep the same clean HTML structure, step numbering and LaTeX $...$ delimiters as normal; '
        + '(d) the NO OPTION REFERENCES rule still applies — no A/B/C/D labels, no "\u0935\u093f\u0915\u0932\u094d\u092a"/"option" mentions, no "\u0938\u0939\u0940 \u0909\u0924\u094d\u0924\u0930: (X)" lines; state and justify the actual answer substance; '
        + '(e) do NOT also produce an English explanation, and leave "explanation_html_hi" out entirely — the Hindi explanation belongs in "explanation_html".');
    // English-language / grammar / comprehension questions: the metalanguage
    // (grammar terminology) must stay in ENGLISH inside the Hindi prose, the
    // way Hindi-medium English coaching material is actually written —
    // "Direct Speech", "Passive Voice", "Synonym", "Noun Clause", etc.
    L.push('KEEP ENGLISH GRAMMAR TERMINOLOGY IN ENGLISH (critical for English / English Grammar / English Comprehension / vocabulary questions): when the question is about the English language itself, every English grammatical, literary and linguistic TERM must be written in ENGLISH (Latin script) inside the Hindi explanation \u2014 never translated into Hindi and never transliterated into Devanagari. '
        + 'This covers, non-exhaustively: Synonym, Antonym, Homonym, Homophone, Idiom, Phrase, Phrasal Verb, Proverb, Collocation, One Word Substitution, Spelling; '
        + 'Direct Speech, Indirect Speech, Reported Speech, Reporting Verb, Narration; Active Voice, Passive Voice; '
        + 'Noun, Pronoun, Verb, Adverb, Adjective, Preposition, Conjunction, Article, Determiner, Interjection, Modal; '
        + 'Subject, Object, Predicate, Complement, Clause, Main Clause, Subordinate Clause, Noun Clause, Adjective Clause, Adverb Clause, Phrase, Infinitive, Gerund, Participle; '
        + 'Tense and every tense name (Simple Present, Present Continuous, Present Perfect, Simple Past, Past Perfect, Future Perfect, Future Continuous, etc.); '
        + 'Singular, Plural, Countable, Uncountable, Degree of Comparison, Positive/Comparative/Superlative, Subject-Verb Agreement, Concord, Inversion, Conditional, Question Tag, Voice, Mood, Case, Gender, Number, Person (1st/2nd/3rd person); '
        + 'Error Detection, Sentence Improvement, Cloze Test, Para Jumble, Fill in the Blanks, Comprehension, Passage, Prefix, Suffix, Root Word; '
        + 'and verb-form shorthand such as V1, V2, V3, V-ing, s/es, has/have/had + V3. '
        + 'Write them exactly like this: <p>\u092f\u0939\u093e\u0901 <b>\'Caustic\'</b> \u0936\u092c\u094d\u0926 \u0915\u093e <b>Synonym</b> (\u0938\u092e\u093e\u0928\u093e\u0930\u094d\u0925\u0940 \u0936\u092c\u094d\u0926) \u092c\u0924\u093e\u0928\u093e \u0939\u0948\u0964</p> and <p><b>Step 1:</b> Future Perfect \u0915\u093e <b>Passive Voice</b> \u092c\u0928\u093e\u0924\u0947 \u0938\u092e\u092f <b>\'will have + been + V3\'</b> \u0915\u093e \u092a\u094d\u0930\u092f\u094b\u0917 \u0915\u093f\u092f\u093e \u091c\u093e\u0924\u093e \u0939\u0948\u0964</p> \u2014 English term in English, surrounding explanation in Hindi. '
        + 'You MAY add a short Hindi gloss in brackets the FIRST time a term appears (e.g. <b>Synonym</b> (\u0938\u092e\u093e\u0928\u093e\u0930\u094d\u0925\u0940 \u0936\u092c\u094d\u0926), <b>Antonym</b> (\u0935\u093f\u0932\u094b\u092e \u0936\u092c\u094d\u0926)), but the English term must always be present and must lead. '
        + 'NEVER write a bare Hindi replacement such as \u0915\u0930\u094d\u092e\u0935\u093e\u091a\u094d\u092f for Passive Voice, \u092a\u094d\u0930\u0924\u094d\u092f\u0915\u094d\u0937 \u0915\u0925\u0928 for Direct Speech, \u0938\u0902\u091c\u094d\u091e\u093e for Noun, \u0915\u093e\u0932 for Tense, or \u0915\u0930\u094d\u0924\u093e for Subject, and never Devanagari transliterations such as \u0938\u093f\u0928\u094b\u0928\u093f\u092e / \u092a\u0948\u0938\u093f\u0935 \u0935\u0949\u092f\u0938\u0964');
    L.push('QUOTED ENGLISH MATERIAL STAYS IN ENGLISH: any word, option, sentence, sentence-fragment or transformed answer sentence you quote from the question must be reproduced verbatim in English (normally inside <b>...</b> or <i>...</i>) \u2014 e.g. <b>\'The reagents will have been double-checked by the laboratory by dawn.\'</b>. Do NOT translate quoted English material into Hindi; the Hindi is only the connective explanatory prose around it. A short Hindi meaning may follow in brackets when the question is about a word\'s meaning.');
    // Punctuation is load-bearing in English-grammar questions (quotation marks
    // in Direct/Indirect Speech, the "?"/"!" that decides an interrogative or
    // exclamatory sentence, apostrophes in possessives/contractions).
    L.push('PRESERVE PUNCTUATION & SYMBOLS EXACTLY (critical): reproduce every punctuation mark and symbol of quoted English material EXACTLY as it appears \u2014 never drop, add, swap or \"normalise\" one. This includes: '
        + 'double quotation marks (\" \" and the curly \u201c \u201d), single quotation marks / apostrophes (\' \' and the curly \u2018 \u2019 \u2014 including possessives like <i>boy\'s</i> and contractions like <i>didn\'t</i>, <i>don\'t</i>); '
        + 'the exclamation mark (!), question mark (?), full stop (.), comma (,), semicolon (;), colon (:), hyphen (-), en/em dash (\u2013 \u2014), ellipsis (...), slash (/), backslash (\\\\), ampersand (&), asterisk (*), plus (+), equals (=), percent (%), brackets ( ) [ ] { }, and any other symbol printed in the question. '
        + 'Rules: (a) keep them in the SAME position as printed \u2014 in Direct Speech the comma/question mark/exclamation mark goes INSIDE the closing quotation mark, exactly like <b>\"The deadline has been extended by two days,\" said the manager.</b> and <b>\"What a beautiful day!\" he exclaimed.</b>; '
        + '(b) do NOT convert straight quotes to curly quotes or curly to straight \u2014 copy whichever the source uses; '
        + '(c) do NOT replace an English full stop (.) at the end of a quoted ENGLISH sentence with the Hindi danda (\u0964) \u2014 quoted English keeps its own English punctuation, while your surrounding HINDI prose ends with \u0964 as normal; '
        + '(d) when the question turns on a punctuation mark (Direct/Indirect Speech, interrogative vs exclamatory vs assertive sentences, Question Tags, contractions, possessive apostrophes), name and show that mark explicitly in the explanation \u2014 e.g. <p><b>Step 2:</b> Direct Speech \u092e\u0947\u0902 \u0935\u093e\u0915\u094d\u092f \u0915\u094b <b>\" \"</b> (Quotation Marks) \u0915\u0947 \u092d\u0940\u0924\u0930 \u0930\u0916\u093e \u091c\u093e\u0924\u093e \u0939\u0948 \u0914\u0930 \u0905\u0902\u0924 \u092e\u0947\u0902 <b>!</b> (Exclamation Mark) \u0932\u0917\u0924\u093e \u0939\u0948\u0964</p>; '
        + '(e) name such marks in ENGLISH too \u2014 Quotation Marks, Inverted Commas, Apostrophe, Exclamation Mark, Question Mark, Full Stop, Comma, Semicolon, Colon, Hyphen, Dash, Ellipsis, Slash, Backslash \u2014 per the English-terminology rule above; '
        + '(f) if a symbol has special meaning in HTML, write it as the correct entity so it renders literally: &amp; for &, &lt; for <, &gt; for > \u2014 and make sure quotation marks inside the JSON string are escaped properly (\\\\\" ) so the JSON stays valid; '
        + '(g) mathematical/scientific symbols still follow the LaTeX rule ($...$); this punctuation rule is about ordinary text symbols.');
    L.push('STEP LABELS STAY IN ENGLISH: when the explanation is structured as numbered steps, keep the label itself in English as \"<p><b>Step 1:</b> ...</p>\", \"<p><b>Step 2:</b> ...</p>\" \u2014 do NOT translate \"Step\" into \u091a\u0930\u0923/\u0938\u094d\u091f\u0947\u092a. This overrides the general instruction to translate the word \"Step\" into the output language. The step CONTENT is still Hindi.');
    L.push('SECTION LABELS: if you add an extra-information section, label it in English in the usual bank style \u2014 <p><b>Extra Info:</b> ...</p> \u2014 with the content in Hindi.');
    L.push('NON-ENGLISH SUBJECTS: for questions that are NOT about the English language (mathematics, science, history, reasoning, etc.), use normal subject-appropriate Hindi terminology as usual \u2014 this English-terminology rule applies only to English-language/grammar/vocabulary/comprehension questions, plus the universal LaTeX and step-numbering rules.');
    { const d = aiDetailInstruction(detailLevel, 'HINDI'); if (d) L.push('For "explanation_html" (written in Hindi): ' + d); }
    return L;
}

function qxBuildPrompt(langMode, transcript, wantSteps, detailLevel, wantHiExpl) {
    const L = [];
    L.push('You are an expert exam-question transcriber and subject-matter solver.');
    if (transcript) {
        L.push('Below is a raw, exact transcription of ONE multiple-choice question cropped from an exam paper (produced by an OCR/vision step — minor artifacts possible). Reconstruct it faithfully and completely, then solve it.');
        L.push('');
        L.push('-----BEGIN TRANSCRIPTION-----');
        L.push(transcript);
        L.push('-----END TRANSCRIPTION-----');
    } else {
        L.push('The attached image is a crop of ONE multiple-choice question from an exam paper. Transcribe it faithfully and completely, then solve it.');
    }
    L.push('');
    L.push('TRANSCRIPTION RULES:');
    L.push(`- ${transcript ? 'Reconstruct the question text EXACTLY as transcribed (fix only obvious OCR-level artifacts)' : 'Transcribe the question text EXACTLY as printed (fix only obvious OCR-level artifacts)'}. Use minimal clean HTML (<b>, <i>, <br>) — do NOT use <sub>/<sup> tags (see the NOTATION rule below).`);
    L.push('- LINE BREAKS (critical — do NOT copy the image\'s visual word-wrap): only insert a <br> where there is a genuine logical break — a new labeled statement/point (A./B./I./II./1./2. etc.), a distinct sentence that is clearly a separate line/point by the author\'s intent, or a real paragraph break. If a sentence merely wraps to the next visual line in the source because of column/page width, that is NOT a break — join the wrapped words back into ONE continuous line with a single space (do not insert <br>, and do not preserve a line break just because the source image had one there). When in doubt whether a break is logical or just word-wrap, prefer joining the text into one continuous line/sentence over inserting a <br>.');
    L.push('- ' + AI_LATEX_NOTATION_RULE);
    L.push('- Do NOT include the question number / serial number at the START of the question text in ANY form — e.g. "20.", "20)", "(20)", "Q7", "Q.7", "Q7)", "Que 7.", "Question 7:", or Hindi "प्रश्न 7." / "प्र. 7". Begin "question_html" directly with the first real word of the question stem. (This applies ONLY to the leading paper question-number; genuine numbers inside the question — statement lists "1./2.", values, years, units — are kept as printed.)');
    L.push('- QUESTION FIELD vs OPTIONS (critical): the "question_html" field must contain ONLY the question stem/body (the problem statement, any statements/lists/table it refers to, and the [image here] placeholder for a figure). Do NOT put any of the four answer OPTIONS\' text inside the question field — the options belong ONLY in the options array. This applies even when the printed layout places options right under the stem: stop the question text before the first option. (Exception: for match-the-list questions the two Lists are part of the stem/table and DO belong in the question; the four code combinations are the options.)');
    L.push('- IGNORE ANSWER-MARKING ARTIFACTS & HAND MARKS (critical): the crop may contain marks that are NOT part of the printed question — a tick/check (\u2713), cross (\u2717/\u00d7), circle, underline, arrow, tick/cross next to an option, highlighter, or any handwriting / hand-drawn scribble / pen or pencil annotation overlaid on the page. Do NOT transcribe, describe, or reproduce ANY of these marks anywhere (not in the question, options, figure placeholder, or explanation). Transcribe only the original printed text/figure as it was published. You MAY still use such a mark privately as a hint for which option is correct, but never output the mark itself.');
    L.push('- If the question contains a diagram/figure/graph, insert the placeholder [image here: <very short description>] at its exact position in the question text — do not try to describe the figure in full. Do not include any hand-drawn marks/ticks/crosses in that figure description.');
    L.push('- MATCH-THE-LIST / MATCH-THE-COLUMNS / TABLE questions: if the question presents two lists to be matched (e.g. "List-I / List-II", "Column A / Column B", or says "Match the following"), OR already contains a tabular layout, render that matching data as a clean HTML <table> inside the question text at the position where it appears, NOT as loose <br> lines. Rules for the table: '
        + '(a) build a proper <table> with a header row <thead><tr><th>...</th></tr></thead> using the lists own headings (e.g. "List-I (Nuclear Power Plant)" and "List-II (State)"); '
        + '(b) keep each list item TOGETHER in a SINGLE cell exactly as printed, INCLUDING its own label — put "A. Kudankulam" in one cell and "1. Karnataka" in the adjacent cell on the SAME row. Do NOT split the letter/number label into its own separate column, and do NOT create extra columns for the A/B/C/D or 1/2/3/4 markers; '
        + '(c) one matched pair per <tr> (row 1: A. ... | 1. ..., row 2: B. ... | 2. ..., and so on), preserving the printed order; '
        + '(d) if the two lists have unequal length, leave the extra cells empty; '
        + '(e) use minimal clean HTML — <table>, <thead>, <tbody>, <tr>, <th>, <td>, <b>, <br> only (no inline styles, no class attributes; the frontend styles tables itself); '
        + '(f) the four answer OPTIONS of such a question are the code combinations (e.g. "A-2, B-4, C-3, D-1") — put each option as one option string in that compact form, NOT as a table.');
    L.push('- If the question ALREADY contains a table (any tabular data, truth tables, matched lists), reproduce it faithfully as an HTML <table> with the same rows/columns and cell contents (same minimal-HTML rule as above); do not flatten it into <br> lines.');
    L.push('- Transcribe ALL options in order, WITHOUT their labels ("(1)", "(a)", "A." etc.). If an option is a figure, use [image here: <short description>] as that option\'s text.');
    L.push('- PUNCTUATION & SYMBOLS (critical): transcribe every punctuation mark and symbol EXACTLY as printed \u2014 do not drop, add, swap or normalise any of them. Keep double quotation marks (\u0022 \u0022 / \u201c \u201d), single quotes and apostrophes (\u2019 / \u2018, including contractions like <i>didn\u2019t</i> and possessives like <i>boy\u2019s</i>), the exclamation mark (!), question mark (?), full stop, comma, semicolon, colon, hyphen, dash (\u2013 \u2014), ellipsis (...), slash (/), backslash (\\\\), ampersand (&), asterisk (*), and brackets. Do NOT convert straight quotes to curly quotes or vice versa \u2014 copy whichever the source uses. In Direct Speech keep the comma / question mark / exclamation mark INSIDE the closing quotation mark exactly as printed. These marks are often the whole point of the question (Direct/Indirect Speech, punctuation correction, interrogative vs exclamatory sentences, Question Tags), so an option that differs from another ONLY by punctuation must be transcribed with that difference intact. Escape symbols that are special in HTML as entities so they render literally (&amp; for &, &lt; for <, &gt; for >), and escape quotation marks correctly inside the JSON strings so the JSON stays valid.');
    L.push('');
    L.push('ANSWER & EXPLANATION:');
    L.push('- If the paper marks the correct answer, use it. Otherwise SOLVE the question rigorously yourself to determine "correct_index" (0-based).');
    L.push('- Write an explanation justifying the correct answer. It must NOT mention option letters/labels (A/B/C/D), the word "option"/"विकल्प", or phrases like "Correct Answer: (X)" / "सही उत्तर: (X)" — state and justify the answer\'s substance directly. Simple clean HTML: <p><b>concise statement of the answer\'s substance</b></p><p>step-by-step justification</p>.');
    if (wantSteps) {
        L.push('- STEP-BY-STEP MATH SOLUTIONS (when applicable): if — and ONLY if — the question is numerical/mathematical/quantitative (requires a calculation, formula, equation, or step-wise numerical/logical derivation), structure the explanation as clearly numbered steps instead of a dense paragraph: each step on its own line as "<p><b>Step 1:</b> ...</p>", "<p><b>Step 2:</b> ...</p>", etc. (translate "Step" into the output language if not English), ending with a final step stating the resulting value/answer. Keep all math in LaTeX ($...$). For purely conceptual/factual/definitional questions with no calculation involved, do NOT force artificial steps — a normal clean explanation is fine.');
    }
    {
        const d = aiDetailInstruction(detailLevel, 'the output language');
        if (d) L.push('- ' + d + (detailLevel === 'detailed' ? ' For bilingual output, BOTH "explanation_html" and "explanation_html_hi" must meet this depth, each in its own language.' : ''));
    }
    L.push('');
    const hiExplOnly = wantHiExpl && langMode !== 'hi' && langMode !== 'bilingual';
    if (hiExplOnly) { qxHindiExplInstruction(detailLevel).forEach(x => L.push('- ' + x)); L.push(''); }
    if (langMode === 'en') {
        L.push('OUTPUT LANGUAGE: English only ("language":"en") for the question and options. If the image is in another language, translate the question and options faithfully to English.'
            + (hiExplOnly ? ' The EXPLANATION, however, must be in Hindi per the EXPLANATION LANGUAGE rule above. Keep "language":"en" — this does NOT make the output bilingual.' : ''));
    } else if (langMode === 'hi') {
        L.push('OUTPUT LANGUAGE: Hindi only ("language":"hi"). If the image is in another language, translate faithfully to Hindi. Explanation in Hindi.');
    } else if (langMode === 'bilingual') {
        L.push('OUTPUT: BILINGUAL. Fill the base fields in ENGLISH and the _hi fields in HINDI ("language":"bilingual"). If the image contains both languages, transcribe each side from the image; otherwise translate faithfully for the missing side. Explanations in their own language.');
    } else {
        L.push('OUTPUT LANGUAGE: Auto-detect from the image. If the question is in Hindi, output everything in Hindi with "language":"hi"; if English, "language":"en". If BOTH languages are printed, fill base fields in English, _hi fields in Hindi, "language":"bilingual".'
            + (hiExplOnly ? ' Whatever language is detected for the question and options, the EXPLANATION must be written in Hindi per the EXPLANATION LANGUAGE rule above. Report "language" as the QUESTION\'s detected language — do not report "bilingual" merely because the explanation is Hindi.' : ''));
    }
    L.push('');
    L.push('Respond with ONLY a single JSON object (no markdown fences):');
    L.push('{');
    L.push('  "language": "en" | "hi" | "bilingual",');
    L.push('  "question_html": "<question text as HTML>",');
    L.push('  "options": ["option 1", "option 2", ...],');
    L.push('  "correct_index": <0-based integer>,');
    L.push('  "confidence": "high" | "medium" | "low",');
    L.push('  "note": "<1-2 sentences: anything uncertain — unreadable text, figure present, answer solved (not printed), etc. Empty string if nothing.>",');
    L.push(hiExplOnly
        ? '  "explanation_html": "<explanation HTML — written in HINDI (see the EXPLANATION LANGUAGE rule)>",'
        : '  "explanation_html": "<explanation HTML>",');
    L.push('  "question_html_hi": "<Hindi question HTML — ONLY for bilingual>",');
    L.push('  "options_hi": ["..."],');
    L.push(hiExplOnly
        ? '  "explanation_html_hi": "<leave this out / empty — the Hindi explanation goes in \"explanation_html\">"'
        : '  "explanation_html_hi": "<Hindi explanation HTML — ONLY for bilingual>"');
    L.push('}');
    return L.join('\n');
}

// ---------- passage-group prompt ----------
// Passage mode: the crop(s) contain a reading-comprehension PASSAGE (with its
// directions line, e.g. "निर्देश प्रश्न संख्या 12 से 16 के लिए - ...") plus ALL the
// questions that belong to it. One AI call returns the passage and every
// question in a single structured response.
function qxBuildPassagePrompt(langMode, transcript, wantSteps, detailLevel, wantHiExpl) {
    const L = [];
    L.push('You are an expert exam-question transcriber and subject-matter solver.');
    if (transcript) {
        L.push('Below is a raw, exact transcription of a READING-COMPREHENSION GROUP cropped from an exam paper: a directions line, a PASSAGE, and ALL the multiple-choice questions based on that passage (produced by an OCR/vision step — minor artifacts possible). Reconstruct the passage and EVERY question faithfully and completely, then solve each question.');
        L.push('');
        L.push('-----BEGIN TRANSCRIPTION-----');
        L.push(transcript);
        L.push('-----END TRANSCRIPTION-----');
    } else {
        L.push('The attached image(s) are crops of a READING-COMPREHENSION GROUP from an exam paper: a directions line, a PASSAGE, and ALL the multiple-choice questions based on that passage. Transcribe the passage and EVERY question faithfully and completely, then solve each question.');
    }
    L.push('');
    L.push('STRUCTURE RULES:');
    L.push('- DIRECTIONS: the group usually starts with a directions/instruction line (e.g. "निर्देश प्रश्न संख्या 12 से 16 के लिए - निम्नलिखित गद्यांश को ध्यान से पढ़िए..." or "Directions (Q. 12-16): Read the following passage..."). Put that ENTIRE line — including the question-number range — in "directions" EXACTLY as printed, as PLAIN TEXT (no HTML tags).');
    L.push('- PASSAGE: put the full passage body in "passage_content" EXACTLY as printed, as PLAIN TEXT (no HTML tags; keep it as one continuous paragraph unless the source has a genuine paragraph break, in which case separate paragraphs with a single newline). Do NOT include the directions line or any question inside the passage body.');
    L.push('- QUESTIONS: extract EVERY question that belongs to this passage, in printed order, into the "questions" array. Do not skip any, do not merge two questions into one, and do not invent questions that are not printed. If the crop also accidentally includes an unrelated non-passage question, EXCLUDE it.');
    L.push('');
    L.push('TRANSCRIPTION RULES (apply to every question):');
    L.push(`- ${transcript ? 'Reconstruct each question text EXACTLY as transcribed (fix only obvious OCR-level artifacts)' : 'Transcribe each question text EXACTLY as printed (fix only obvious OCR-level artifacts)'}. Use minimal clean HTML (<b>, <i>, <br>) — do NOT use <sub>/<sup> tags (see the NOTATION rule below).`);
    L.push('- LINE BREAKS (critical — do NOT copy the image\'s visual word-wrap): only insert a <br> where there is a genuine logical break. If a sentence merely wraps to the next visual line because of column/page width, join the wrapped words back into ONE continuous line with a single space. When in doubt, join.');
    L.push('- ' + AI_LATEX_NOTATION_RULE);
    L.push('- Do NOT include each question\'s own number / serial number at the START of its "question_html" in ANY form — e.g. "12.", "12)", "(12)", "Q12", "Q.12", "Q12)", "Question 12:", or Hindi "प्रश्न 12." / "प्र. 12". Begin every question with the first real word of its stem. (Genuine numbers inside a question — statement lists "1./2.", values, years, units — are kept. The question-number RANGE still belongs in the "directions" line as instructed above.)');
    L.push('- QUESTION FIELD vs OPTIONS (critical): "question_html" must contain ONLY the question stem — never any of the answer options\' text. The options belong ONLY in the options array.');
    L.push('- IGNORE ANSWER-MARKING ARTIFACTS & HAND MARKS (critical): ticks/checks (\u2713), crosses (\u2717/\u00d7), circles, underlines, arrows, highlighter, and ANY handwriting or hand-drawn scribbles overlaid on the page are NOT part of the printed content — never transcribe, describe, or reproduce them anywhere (passage, questions, options, or explanations). You MAY use such a mark privately as a hint for which option is correct, but never output the mark itself.');
    L.push('- Transcribe ALL options of each question in order, WITHOUT their labels ("(1)", "(a)", "A." etc.).');
    L.push('- PUNCTUATION & SYMBOLS (critical): transcribe every punctuation mark and symbol EXACTLY as printed \u2014 do not drop, add, swap or normalise any of them. Keep double quotation marks (\u0022 \u0022 / \u201c \u201d), single quotes and apostrophes (\u2019 / \u2018, including contractions like <i>didn\u2019t</i> and possessives like <i>boy\u2019s</i>), the exclamation mark (!), question mark (?), full stop, comma, semicolon, colon, hyphen, dash (\u2013 \u2014), ellipsis (...), slash (/), backslash (\\\\), ampersand (&), asterisk (*), and brackets. Do NOT convert straight quotes to curly quotes or vice versa \u2014 copy whichever the source uses. In Direct Speech keep the comma / question mark / exclamation mark INSIDE the closing quotation mark exactly as printed. These marks are often the whole point of the question (Direct/Indirect Speech, punctuation correction, interrogative vs exclamatory sentences, Question Tags), so an option that differs from another ONLY by punctuation must be transcribed with that difference intact. Escape symbols that are special in HTML as entities so they render literally (&amp; for &, &lt; for <, &gt; for >), and escape quotation marks correctly inside the JSON strings so the JSON stays valid. The same applies to the PASSAGE body and the directions line.');
    L.push('');
    L.push('ANSWER & EXPLANATION (for every question):');
    L.push('- If the paper marks the correct answer, use it. Otherwise SOLVE the question rigorously yourself — base the answer on the PASSAGE where the question refers to it — to determine "correct_index" (0-based).');
    L.push('- Write an explanation justifying each correct answer, grounded in the passage where applicable (quote or reference the relevant part of the passage). It must NOT mention option letters/labels (A/B/C/D), the word "option"/"विकल्प", or phrases like "Correct Answer: (X)" — state and justify the answer\'s substance directly. Simple clean HTML: <p><b>concise statement of the answer\'s substance</b></p><p>justification</p>.');
    if (wantSteps) {
        L.push('- STEP-BY-STEP MATH SOLUTIONS: if — and ONLY if — a question is numerical/quantitative, structure its explanation as numbered steps ("<p><b>Step 1:</b> ...</p>" etc., translating "Step" into the output language if not English), keeping all math in LaTeX ($...$). Conceptual questions get a normal explanation.');
    }
    {
        const d = aiDetailInstruction(detailLevel, 'the output language');
        if (d) L.push('- ' + d + (detailLevel === 'detailed' ? ' For bilingual output, BOTH "explanation_html" and "explanation_html_hi" must meet this depth, each in its own language.' : ''));
    }
    L.push('');
    const hiExplOnly = wantHiExpl && langMode !== 'hi' && langMode !== 'bilingual';
    if (hiExplOnly) {
        qxHindiExplInstruction(detailLevel).forEach(x => L.push('- ' + x));
        L.push('- The rule above applies to EVERY question in the "questions" array: each question\'s "explanation_html" must be written in Hindi, while its question text and options stay in the source language. The PASSAGE and its directions are NOT translated either — keep them in the source language and leave "passage_content_hi"/"directions_hi" empty.');
        L.push('');
    }
    if (langMode === 'en') {
        L.push('OUTPUT LANGUAGE: English only ("language":"en") for the passage, questions and options. If the source is in another language, translate them faithfully to English.'
            + (hiExplOnly ? ' Each question\'s EXPLANATION, however, must be in Hindi per the EXPLANATION LANGUAGE rule above. Keep "language":"en".' : ''));
    } else if (langMode === 'hi') {
        L.push('OUTPUT LANGUAGE: Hindi only ("language":"hi"). If the source is in another language, translate faithfully to Hindi.');
    } else if (langMode === 'bilingual') {
        L.push('OUTPUT: BILINGUAL. Fill the base fields in ENGLISH and the _hi fields in HINDI ("language":"bilingual") — for the passage AND every question. If the source contains both languages, transcribe each side; otherwise translate faithfully for the missing side.');
    } else {
        L.push('OUTPUT LANGUAGE: Auto-detect. Hindi source → everything in Hindi with "language":"hi"; English → "language":"en". If BOTH languages are printed, base fields English, _hi fields Hindi, "language":"bilingual".'
            + (hiExplOnly ? ' Whatever language is detected, every question\'s "explanation_html" must be written in Hindi per the EXPLANATION LANGUAGE rule above. Report "language" as the SOURCE\'s detected language — not "bilingual" merely because the explanations are Hindi.' : ''));
    }
    L.push('');
    L.push('Respond with ONLY a single JSON object (no markdown fences):');
    L.push('{');
    L.push('  "language": "en" | "hi" | "bilingual",');
    L.push('  "directions": "<the printed directions/instruction line, plain text>",');
    L.push('  "passage_content": "<the full passage body, plain text>",');
    L.push('  "directions_hi": "<Hindi directions — ONLY for bilingual>",');
    L.push('  "passage_content_hi": "<Hindi passage body — ONLY for bilingual>",');
    L.push('  "confidence": "high" | "medium" | "low",');
    L.push('  "note": "<1-2 sentences: anything uncertain — unreadable text, a question cut off, answer solved (not printed), etc. Empty string if nothing.>",');
    L.push('  "questions": [');
    L.push('    {');
    L.push('      "question_html": "<question text as HTML>",');
    L.push('      "options": ["option 1", "option 2", ...],');
    L.push('      "correct_index": <0-based integer>,');
    L.push(hiExplOnly
        ? '      "explanation_html": "<explanation HTML — written in HINDI (see the EXPLANATION LANGUAGE rule)>",'
        : '      "explanation_html": "<explanation HTML>",');
    L.push('      "question_html_hi": "<Hindi question HTML — ONLY for bilingual>",');
    L.push('      "options_hi": ["..."],');
    L.push(hiExplOnly
        ? '      "explanation_html_hi": "<leave this out / empty — the Hindi explanation goes in \"explanation_html\">"'
        : '      "explanation_html_hi": "<Hindi explanation HTML — ONLY for bilingual>"');
    L.push('    },');
    L.push('    ... one object per question, in printed order ...');
    L.push('  ]');
    L.push('}');
    return L.join('\n');
}

// Validate + normalize the AI's passage-group JSON into qxState.result shape.
function qxParsePassageResult(p, wantHiExpl) {
    const passageContent = String(p.passage_content || '').trim();
    if (!passageContent) throw new Error('AI returned no passage text.');
    if (!Array.isArray(p.questions) || !p.questions.length) throw new Error('AI returned no questions for the passage.');

    const language = (p.language === 'hi' || p.language === 'bilingual') ? p.language : 'en';
    const questions = p.questions.map((q, idx) => {
        if (!q || typeof q.question_html !== 'string' || !q.question_html.trim())
            throw new Error(`Question ${idx + 1} came back without text.`);
        if (!Array.isArray(q.options) || q.options.length < 2)
            throw new Error(`Question ${idx + 1} came back with fewer than 2 options.`);
        let ci = parseInt(q.correct_index);
        if (isNaN(ci) || ci < 0 || ci >= q.options.length) ci = 0;
        const isBi = language === 'bilingual' && Array.isArray(q.options_hi) && q.options_hi.length;
        const enOpts = q.options.map(o => String(o == null ? '' : o));
        const hiOpts = isBi ? q.options_hi.map(o => String(o == null ? '' : o)) : [];
        return {
            question: qxStripArtifacts(String(q.question_html), enOpts),
            options: enOpts,
            correct: ci,
            explanation: String(q.explanation_html || ''),
            hi: isBi ? {
                question: qxStripArtifacts(String(q.question_html_hi || ''), hiOpts),
                options: hiOpts,
                explanation: String(q.explanation_html_hi || ''),
            } : null,
            hiExplMode: !isBi && wantHiExpl && language !== 'hi',
        };
    });

    return {
        type: 'passage',
        language,
        passage: {
            directions: String(p.directions || '').trim(),
            content: passageContent,
            directionsHi: language === 'bilingual' ? String(p.directions_hi || '').trim() : '',
            contentHi: language === 'bilingual' ? String(p.passage_content_hi || '').trim() : '',
        },
        questions,
        confidence: /^(high|medium|low)$/i.test(p.confidence || '') ? p.confidence.toLowerCase() : 'medium',
        note: String(p.note || '').trim(),
    };
}

// Idle label for the Extract button, passage-mode aware.
function qxExtractBtnLabel() {
    return (document.getElementById('qx-passage') || {}).checked
        ? 'Extract Passage + Questions with AI'
        : 'Extract Question with AI';
}

async function qxExtract() {
    if (qxState.busy) return;
    if (!qxPoolActiveKeys().length && !qxPoolConfiguredKeys().length) {
        showToast('Extractor keys missing',
            `No ${QX_PROVIDERS[qxPools.provider].label} keys configured — open "Extractor API Settings" at the top of this tab and add at least one key (or switch provider).`, 'error');
        return;
    }
    // Gather all crops for this question: any queued (from other pages) plus
    // the current on-screen selection, if one is drawn. The queued crops come
    // first so page order is preserved.
    const images = [];
    const thumbs = [];
    qxState.crops.forEach(c => { if (c && c.b64) { images.push(c.b64); thumbs.push(c.thumb || ''); } });

    const crop = qxGetCropCanvas({ silent: qxState.crops.length > 0 });
    if (crop) {
        const apiCanvas = qxScaleCanvas(crop, 1600);
        images.push(apiCanvas.toDataURL('image/webp', 0.92).split(',')[1]);
        thumbs.push(qxScaleCanvas(crop, 300).toDataURL('image/jpeg', 0.7));
    }

    if (!images.length) {
        showToast('No selection', 'Drag a box around the question (or add crops) first.', 'error');
        return;
    }

    // Thumbnail stored with the record — first crop is representative.
    qxState.cropThumb = thumbs[0] || '';

    const langMode = (document.getElementById('qx-lang') || {}).value || 'auto';
    const wantSteps = !!(document.getElementById('qx-steps') || {}).checked;
    const detailLevel = (document.getElementById('qx-detail') || {}).value || 'detailed';
    const passageMode = !!(document.getElementById('qx-passage') || {}).checked;
    // "+ Hindi explanation": keep the question/options/explanation in their own
    // language and ADDITIONALLY produce a Hindi explanation. Only meaningful
    // when the output is not already Hindi / bilingual.
    const wantHiExpl = !!(document.getElementById('qx-hi-expl') || {}).checked
        && langMode !== 'hi' && langMode !== 'bilingual';

    qxState.busy = true;
    const btn = document.getElementById('qx-extract-btn');
    const label = document.getElementById('qx-extract-label');
    if (btn) btn.disabled = true;
    if (label) label.textContent = passageMode ? 'Extracting passage & questions with AI…' : 'Extracting with AI…';

    try {
        const call = await qxRunExtraction(passageMode ? qxBuildPassagePrompt : qxBuildPrompt, langMode, images, wantSteps, detailLevel, wantHiExpl);
        const raw = call.text;
        const p = aiParseJson(raw);

        if (passageMode) {
            qxState.result = qxParsePassageResult(p, wantHiExpl);
            qxRenderReview();
            if (qxState.crops.length) { qxState.crops = []; qxRenderCropQueue(); }
            showToast('Passage extracted', `Passage + ${qxState.result.questions.length} question${qxState.result.questions.length === 1 ? '' : 's'} — review below, then Save to Question Bank.`, 'success');
            return;
        }

        if (typeof p.question_html !== 'string' || !p.question_html.trim()) throw new Error('AI returned no question text.');
        if (!Array.isArray(p.options) || p.options.length < 2) throw new Error('AI returned fewer than 2 options.');
        let ci = parseInt(p.correct_index);
        if (isNaN(ci) || ci < 0 || ci >= p.options.length) ci = 0;

        const isBi = p.language === 'bilingual' && Array.isArray(p.options_hi) && p.options_hi.length;
        const enOpts = p.options.map(o => String(o == null ? '' : o));
        const hiOpts = isBi ? p.options_hi.map(o => String(o == null ? '' : o)) : [];
        qxState.result = {
            language: (p.language === 'hi' || p.language === 'bilingual') ? p.language : 'en',
            question: qxStripArtifacts(String(p.question_html), enOpts),
            options: enOpts,
            correct: ci,
            confidence: /^(high|medium|low)$/i.test(p.confidence || '') ? p.confidence.toLowerCase() : 'medium',
            note: String(p.note || '').trim(),
            explanation: String(p.explanation_html || ''),
            hi: isBi ? {
                question: qxStripArtifacts(String(p.question_html_hi || ''), hiOpts),
                options: hiOpts,
                explanation: String(p.explanation_html_hi || ''),
            } : null,
            // Hindi-explanation-only add-on: no Hindi question/options, just a
            // Hindi explanation that is saved into _aimcq_explanation_hi.
            // Explanation was requested in Hindi while the question stays in
            // its own language. It arrives in the MAIN explanation field, so
            // there is nothing extra to store — just remember the mode for
            // the review/bank labels.
            hiExplMode: !isBi && wantHiExpl && p.language !== 'hi',
        };
        qxRenderReview();
        // Consumed the queued crops — reset for the next question.
        if (qxState.crops.length) { qxState.crops = []; qxRenderCropQueue(); }
        showToast('Question extracted', 'Review the fields below, edit if needed, then Save to Question Bank.', 'success');
    } catch (err) {
        showToast('Extraction failed', aiFriendlyError(err), 'error');
    } finally {
        qxState.busy = false;
        if (btn) btn.disabled = false;
        if (label) label.textContent = qxExtractBtnLabel();
    }
}

// ---------- review UI ----------
function qxEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function qxFieldsHtml(prefix, data, heading) {
    let opts = '';
    data.options.forEach((o, i) => {
        const letter = OPTION_LETTERS[i] || String(i + 1);
        opts += `
        <div class="qx-opt-row" data-prefix="${prefix}">
            <label class="qx-opt-radio" title="Mark as the correct option">
                <input type="radio" name="qx-correct-${prefix}" value="${i}" ${i === data.correct ? 'checked' : ''}>
                <span>${letter}</span>
            </label>
            <input type="text" class="qx-opt-input" value="${qxEsc(o)}">
            <button type="button" class="qx-opt-del" title="Remove this option"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
        </div>`;
    });
    const lang = prefix === 'hi' ? ' data-lang="hi"' : '';
    // In "Hindi explanation" mode the question/options stay in their own
    // language while the single explanation field holds Hindi text — so only
    // the label changes, there is no extra editor.
    const explLabel = data.hiExplMode
        ? 'Explanation <span class="font-normal normal-case text-gray-400">(\u0939\u093f\u0928\u094d\u0926\u0940 \u092e\u0947\u0902 \u2014 saved to _aimcq_explanation)</span>'
        : 'Explanation';
    return `
    ${heading ? `<p class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">${heading}</p>` : ''}
    <label class="qx-lbl">Question</label>
    <div class="rich-editor-wrap" data-field="qx-${prefix}-question"${lang}></div>
    <label class="qx-lbl mt-3">Options <span class="font-normal normal-case text-gray-400">(radio = correct answer)</span></label>
    <div id="qx-${prefix}-opts">${opts}</div>
    <button type="button" class="qx-add-opt" data-prefix="${prefix}"><i data-lucide="plus" class="w-3.5 h-3.5"></i> Add option</button>
    <label class="qx-lbl mt-3">${explLabel}</label>
    <div class="rich-editor-wrap" data-field="qx-${prefix}-explanation"${data.hiExplMode ? ' data-lang="hi"' : lang}></div>`;
}

// Wire option add/remove buttons inside the review panel (delegated per render).
function qxWireOptionRows(review) {
    review.querySelectorAll('.qx-add-opt').forEach(b => b.addEventListener('click', () => {
        const prefix = b.getAttribute('data-prefix');
        const wrap = document.getElementById(`qx-${prefix}-opts`);
        const i = wrap.querySelectorAll('.qx-opt-row').length;
        const letter = OPTION_LETTERS[i] || String(i + 1);
        const div = document.createElement('div');
        div.className = 'qx-opt-row';
        div.setAttribute('data-prefix', prefix);
        div.innerHTML = `
            <label class="qx-opt-radio"><input type="radio" name="qx-correct-${prefix}" value="${i}"><span>${letter}</span></label>
            <input type="text" class="qx-opt-input" value="">
            <button type="button" class="qx-opt-del"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>`;
        wrap.appendChild(div);
        div.querySelector('.qx-opt-del').addEventListener('click', () => { div.remove(); });
        lucide.createIcons();
    }));
    review.querySelectorAll('.qx-opt-del').forEach(b => b.addEventListener('click', () => {
        b.closest('.qx-opt-row').remove();
    }));
}

function qxRenderReview() {
    const r = qxState.result;
    if (!r) return;
    if (r.type === 'passage') { qxRenderPassageReview(); return; }
    const review = document.getElementById('qx-review');
    const fields = document.getElementById('qx-fields');
    const fieldsHi = document.getElementById('qx-fields-hi');
    const thumb = document.getElementById('qx-crop-thumb');
    const note = document.getElementById('qx-ai-note');
    const conf = document.getElementById('qx-confidence');

    if (thumb) thumb.src = qxState.cropThumb || '';
    if (note) note.textContent = r.note ? `AI note: ${r.note}` : '';
    if (conf) {
        const langTag = r.language === 'bilingual' ? 'EN + HI'
            : r.language.toUpperCase() + ((!r.hi && r.hiExplMode) ? ' · HI explanation' : '');
        conf.textContent = `${r.confidence} confidence · ${langTag}`;
        conf.classList.toggle('on', r.confidence === 'high');
        conf.classList.toggle('off', r.confidence !== 'high');
    }

    fields.innerHTML = qxFieldsHtml('en', {
        question: r.question, options: r.options, correct: r.correct,
        explanation: r.explanation,
        hiExplMode: !r.hi && !!r.hiExplMode,
    }, r.hi ? 'English' : '');
    if (r.hi) {
        fieldsHi.classList.remove('hidden');
        fieldsHi.innerHTML = qxFieldsHtml('hi', { question: r.hi.question, options: r.hi.options, correct: r.correct, explanation: r.hi.explanation }, 'हिन्दी (Hindi)');
    } else {
        fieldsHi.classList.add('hidden');
        fieldsHi.innerHTML = '';
    }

    // Rich editors for question & explanation (same editor as the Question
    // Editor tab: formatting toolbar, HTML source view, live KaTeX preview).
    review.querySelectorAll('#qx-fields .rich-editor-wrap, #qx-fields-hi .rich-editor-wrap')
        .forEach(w => buildRichEditor(w));
    setReValue('qx-en-question', r.question || '');
    setReValue('qx-en-explanation', r.explanation || '');
    if (r.hi) {
        setReValue('qx-hi-question', r.hi.question || '');
        setReValue('qx-hi-explanation', r.hi.explanation || '');
    }

    qxWireOptionRows(review);

    review.classList.remove('hidden');
    qxSetReviewMode('preview');   // students-eye view first; Editor is one click away
    lucide.createIcons();
    try { review.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
}

// ---------- passage review ----------
// Renders the whole passage group in one review panel: the passage's
// directions + body (plain-text editors — the aimcq passage format stores
// plain text), then every question with the same rich-editor fields as a
// normal single-question review, all under per-question prefixes en0/hi0/en1…
function qxPassageTextareasHtml(r) {
    const bi = r.language === 'bilingual';
    const block = (suffix, dirVal, bodyVal, heading) => `
        ${heading ? `<p class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 mt-1">${heading}</p>` : ''}
        <label class="qx-lbl">Directions line <span class="font-normal normal-case text-gray-400">(e.g. "निर्देश प्रश्न संख्या 12 से 16 के लिए - …" — stored as the passage title)</span></label>
        <textarea id="qx-passage-dir-${suffix}" class="qx-ta" rows="2">${qxEsc(dirVal)}</textarea>
        <label class="qx-lbl mt-3">Passage text</label>
        <textarea id="qx-passage-body-${suffix}" class="qx-ta" rows="6">${qxEsc(bodyVal)}</textarea>`;
    return `
    <div class="qx-passage-box">
        <p class="qx-passage-box-title"><i data-lucide="book-open-text" class="w-4 h-4 inline-block -mt-0.5 mr-1"></i>Passage</p>
        ${block('en', r.passage.directions, r.passage.content, bi ? 'English' : '')}
        ${bi ? block('hi', r.passage.directionsHi, r.passage.contentHi, 'हिन्दी (Hindi)') : ''}
    </div>`;
}

function qxRenderPassageReview() {
    const r = qxState.result;
    if (!r || r.type !== 'passage') return;
    const review = document.getElementById('qx-review');
    const fields = document.getElementById('qx-fields');
    const fieldsHi = document.getElementById('qx-fields-hi');
    const thumb = document.getElementById('qx-crop-thumb');
    const note = document.getElementById('qx-ai-note');
    const conf = document.getElementById('qx-confidence');

    if (thumb) thumb.src = qxState.cropThumb || '';
    if (note) note.textContent = r.note ? `AI note: ${r.note}` : '';
    if (conf) {
        conf.textContent = `passage · ${r.questions.length} Q · ${r.confidence} confidence · ${r.language === 'bilingual' ? 'EN + HI' : r.language.toUpperCase()}`;
        conf.classList.toggle('on', r.confidence === 'high');
        conf.classList.toggle('off', r.confidence !== 'high');
    }

    // Everything renders into #qx-fields; the separate #qx-fields-hi panel is
    // unused in passage mode (each question carries its own Hindi block).
    fieldsHi.classList.add('hidden');
    fieldsHi.innerHTML = '';

    let html = qxPassageTextareasHtml(r);
    r.questions.forEach((q, i) => {
        html += `
        <div class="qx-passage-q" data-qidx="${i}">
            <p class="qx-passage-q-head">Question ${i + 1} of ${r.questions.length}</p>
            ${qxFieldsHtml('en' + i, { question: q.question, options: q.options, correct: q.correct, explanation: q.explanation, hiExplMode: !q.hi && !!q.hiExplMode }, q.hi ? 'English' : '')}
            ${q.hi ? qxFieldsHtml('hi' + i, { question: q.hi.question, options: q.hi.options, correct: q.correct, explanation: q.hi.explanation }, 'हिन्दी (Hindi)') : ''}
        </div>`;
    });
    fields.innerHTML = html;

    review.querySelectorAll('#qx-fields .rich-editor-wrap').forEach(w => buildRichEditor(w));
    r.questions.forEach((q, i) => {
        setReValue(`qx-en${i}-question`, q.question || '');
        setReValue(`qx-en${i}-explanation`, q.explanation || '');
        if (q.hi) {
            setReValue(`qx-hi${i}-question`, q.hi.question || '');
            setReValue(`qx-hi${i}-explanation`, q.hi.explanation || '');
        }
    });

    qxWireOptionRows(review);

    review.classList.remove('hidden');
    qxSetReviewMode('preview');
    lucide.createIcons();
    try { review.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
}

// ---------- preview / editor mode ----------
// Preview renders the CURRENT (possibly edited) field values exactly the
// way a student sees the question in the quiz frontend — question text,
// lettered options with the correct one highlighted, and the explanation —
// with KaTeX rendering. Edits are kept: the editor fields are only hidden,
// and Preview re-reads them every time it is opened.
function qxSetReviewMode(mode) {
    const fields = document.getElementById('qx-fields');
    const fieldsHi = document.getElementById('qx-fields-hi');
    const prev = document.getElementById('qx-preview-panel');
    const switcher = document.getElementById('qx-review-mode');
    if (!fields || !prev) return;
    const preview = mode === 'preview';
    if (switcher) switcher.querySelectorAll('button').forEach(b =>
        b.classList.toggle('active', b.getAttribute('data-mode') === (preview ? 'preview' : 'editor')));

    if (preview) {
        const r = qxState.result;
        if (r && r.type === 'passage') {
            prev.innerHTML = qxBuildPassagePreviewHtml(r);
        } else {
            const en = qxCollectFields('en');
            const hi = (r && r.hi) ? qxCollectFields('hi') : null;
            prev.innerHTML = qxBuildPreviewHtml(en, hi);
        }
        try { if (typeof renderKatex === 'function') prev.querySelectorAll('.qx-prev-katex').forEach(el => renderKatex(el)); } catch (e) {}
        prev.classList.remove('hidden');
        fields.classList.add('hidden');
        if (fieldsHi) fieldsHi.classList.add('hidden');
    } else {
        prev.classList.add('hidden');
        fields.classList.remove('hidden');
        if (fieldsHi && qxState.result && qxState.result.hi) fieldsHi.classList.remove('hidden');
    }
    qxState.reviewMode = preview ? 'preview' : 'editor';
    try { lucide.createIcons(); } catch (e) {}
}

function qxPreviewSection(data, langLabel) {
    if (!data) return '';
    const opts = data.options
        .map((o, i) => ({ text: o, i }))
        .filter(o => o.text !== '');
    const rows = opts.map((o, shown) => {
        const letter = OPTION_LETTERS[shown] || String(shown + 1);
        const correct = o.i === data.correct;
        return `<div class="qx-prev-opt ${correct ? 'correct' : ''}">
            <span class="qx-prev-letter">${letter}</span>
            <span class="qx-prev-opt-text qx-prev-katex">${o.text}</span>
            ${correct ? '<span class="qx-prev-check">✓ Correct</span>' : ''}
        </div>`;
    }).join('');
    return `
    <div class="qx-prev-section">
        ${langLabel ? `<p class="qx-prev-langlabel">${langLabel}</p>` : ''}
        <div class="qx-prev-q qx-prev-katex">${data.question || '<span class="text-gray-400">(empty question)</span>'}</div>
        <div class="qx-prev-opts">${rows || '<p class="text-xs text-gray-400">(no options)</p>'}</div>
        ${(data.explanation || '').trim() ? `
        <div class="qx-prev-expl">
            <p class="qx-prev-expl-label">Explanation</p>
            <div class="qx-prev-katex">${data.explanation}</div>
        </div>` : ''}
    </div>`;
}

function qxBuildPreviewHtml(en, hi) {
    return qxPreviewSection(en, hi ? 'English' : '')
        + (hi ? '<div class="qx-prev-divider"></div>' + qxPreviewSection(hi, 'हिन्दी (Hindi)') : '');
}

// Passage-group preview: passage box (directions + body, exactly how the quiz
// frontend shows the passage above its questions) followed by every question.
function qxBuildPassagePreviewHtml(r) {
    const pv = qxCollectPassageFields();
    const nl2br = s => qxEsc(s).replace(/\n/g, '<br>');
    const passageBlock = (dir, body, langLabel) => `
        <div class="qx-prev-passage">
            ${langLabel ? `<p class="qx-prev-langlabel">${langLabel}</p>` : ''}
            ${dir ? `<p class="qx-prev-passage-dir">${nl2br(dir)}</p>` : ''}
            <div class="qx-prev-passage-body">${nl2br(body) || '<span class="text-gray-400">(empty passage)</span>'}</div>
        </div>`;
    let html = passageBlock(pv.directions, pv.content, pv.bilingual ? 'English' : '');
    if (pv.bilingual) html += passageBlock(pv.directionsHi, pv.contentHi, 'हिन्दी (Hindi)');
    (r.questions || []).forEach((q, i) => {
        const en = qxCollectFields('en' + i);
        const hi = q.hi ? qxCollectFields('hi' + i) : null;
        html += `<div class="qx-prev-divider"></div><p class="qx-prev-qnum">Question ${i + 1}</p>` + qxBuildPreviewHtml(en, hi);
    });
    return html;
}

// Read the passage textareas back (current, possibly edited values).
function qxCollectPassageFields() {
    const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const r = qxState.result || {};
    const bilingual = r.language === 'bilingual';
    return {
        bilingual,
        directions: val('qx-passage-dir-en'),
        content: val('qx-passage-body-en'),
        directionsHi: bilingual ? val('qx-passage-dir-hi') : '',
        contentHi: bilingual ? val('qx-passage-body-hi') : '',
    };
}

function qxCollectFields(prefix) {
    if (!reRegistry[`qx-${prefix}-question`]) return null;   // fields not built
    const rows = document.querySelectorAll(`#qx-${prefix}-opts .qx-opt-row`);
    const options = [];
    let correct = 0;
    rows.forEach((row, i) => {
        options.push(row.querySelector('.qx-opt-input').value.trim());
        if (row.querySelector('input[type=radio]').checked) correct = i;
    });
    return {
        question: (getReValue(`qx-${prefix}-question`) || '').trim(),
        options,
        correct,
        explanation: getReValue(`qx-${prefix}-explanation`) || '',
    };
}

// ---------- save / bank ----------
function qxPad(n) { return String(n).padStart(2, '0'); }
function qxNowStr() {
    const d = new Date();
    return `${d.getFullYear()}-${qxPad(d.getMonth() + 1)}-${qxPad(d.getDate())} ${qxPad(d.getHours())}:${qxPad(d.getMinutes())}:${qxPad(d.getSeconds())}`;
}

async function qxSaveToBank() {
    const r = qxState.result;
    if (!r) return;
    if (r.type === 'passage') { await qxSavePassageToBank(); return; }
    const en = qxCollectFields('en');
    if (!en || !en.question) { showToast('Question empty', 'The question text cannot be empty.', 'error'); return; }
    const cleanOpts = en.options.filter(o => o !== '');
    if (cleanOpts.length < 2) { showToast('Options missing', 'At least 2 non-empty options are required.', 'error'); return; }
    if (en.correct >= en.options.length || en.options[en.correct] === '') en.correct = en.options.findIndex(o => o !== '');

    const isHiOnly = r.language === 'hi' && !r.hi;
    const hi = r.hi ? qxCollectFields('hi') : null;

    const meta = {
        _aimcq_options: en.options.filter(o => o !== '').map(t => ({ text: t, image: '' })),
        _aimcq_correct_answers: [Math.max(0, en.options.filter((o, i) => o !== '' && i <= en.correct).length - 1)],
        _aimcq_explanation: en.explanation,
    };
    if (hi && hi.question) {
        meta._aimcq_title_hi = stripHtmlTags(hi.question).slice(0, 120);
        meta._aimcq_question_content_hi = hi.question;
        meta._aimcq_options_hi = hi.options.filter(o => o !== '').map(t => ({ text: t, image: '' }));
        meta._aimcq_explanation_hi = hi.explanation;
    }

    const id = Date.now();
    const post = {
        id,
        post_author: 1,
        post_date: qxNowStr(),
        post_title: stripHtmlTags(en.question).slice(0, 120) || 'Extracted question',
        post_content: en.question,
        post_status: 'publish',
        post_type: 'question',
        meta_input: meta,
        taxonomies: {},
        embedded_media: [],
    };

    const saveLib = (document.getElementById('qx-save-lib') || {}).value || qxLibSelection().save || QX_LIB_DEFAULT;
    try {
        await qxDbPut({
            id,
            created: new Date().toISOString(),
            language: isHiOnly ? 'hi' : (hi ? 'bilingual' : r.language),
            thumb: qxState.cropThumb || '',
            library: saveLib,
            post,
        });
    } catch (err) {
        showToast('Save failed', 'IndexedDB error: ' + (err.message || err), 'error');
        return;
    }
    { const sel = qxLibSelection(); sel.save = saveLib; qxLibSaveSelection(sel); }

    qxState.result = null;
    document.getElementById('qx-review').classList.add('hidden');
    await qxRenderBank();
    {
        const libs = await qxLibEnsure();
        const libName = (libs.find(l => l.id === saveLib) || {}).name || 'General';
        showToast('Saved to Question Bank', `Stored in "${libName}" — crop the next question to continue.`, 'success');
    }
}

// Save a whole passage group: one `passage` post + one linked `question` post
// per question, exactly in the aimcq passage format (the same shape the
// Question Editor imports/exports):
//   passage  → post_type "passage", passage text in post_title/post_content,
//              display-title & Hindi-content passage meta keys
//   question → _aimcq_is_passage_question:"yes", _aimcq_passage_id:"<id>"
async function qxSavePassageToBank() {
    const r = qxState.result;
    if (!r || r.type !== 'passage') return;

    const pv = qxCollectPassageFields();
    if (!pv.content) { showToast('Passage empty', 'The passage text cannot be empty.', 'error'); return; }

    // Collect + validate every question before saving anything.
    const collected = [];
    for (let i = 0; i < r.questions.length; i++) {
        const en = qxCollectFields('en' + i);
        if (!en || !en.question) { showToast(`Question ${i + 1} empty`, 'Its question text cannot be empty.', 'error'); return; }
        const cleanOpts = en.options.filter(o => o !== '');
        if (cleanOpts.length < 2) { showToast(`Question ${i + 1} options missing`, 'At least 2 non-empty options are required.', 'error'); return; }
        if (en.correct >= en.options.length || en.options[en.correct] === '') en.correct = en.options.findIndex(o => o !== '');
        const hi = r.questions[i].hi ? qxCollectFields('hi' + i) : null;
        collected.push({ en, hi });
    }

    const isHiOnly = r.language === 'hi';
    const bilingual = r.language === 'bilingual';
    const now = qxNowStr();
    const created = new Date().toISOString();
    const passageId = Date.now();
    const saveLib = (document.getElementById('qx-save-lib') || {}).value || qxLibSelection().save || QX_LIB_DEFAULT;
    const recLang = isHiOnly ? 'hi' : (bilingual ? 'bilingual' : 'en');

    // ---- passage post (matches the standard aimcq passage shape) ----
    const passagePost = {
        id: passageId,
        post_author: 1,
        post_date: now,
        post_title: pv.directions || stripHtmlTags(pv.content).slice(0, 120),
        post_content: pv.content,
        post_status: 'publish',
        post_type: 'passage',
        meta_input: {
            _aimcq_passage_content_hi: bilingual ? pv.contentHi : '',
            _aimcq_passage_translation_custom_prompt: '',
            _aimcq_passage_display_title_en: pv.directions || '',
            _aimcq_passage_display_title_hi: bilingual ? pv.directionsHi : '',
            _aimcq_explanation: '',
        },
        taxonomies: [],
        embedded_media: [],
    };

    // ---- question posts, linked to the passage ----
    const questionRecs = collected.map((c, i) => {
        const { en, hi } = c;
        const meta = {
            _aimcq_options: en.options.filter(o => o !== '').map(t => ({ text: t, image: '' })),
            _aimcq_explanation: en.explanation,
            _aimcq_is_passage_question: 'yes',
            _aimcq_passage_id: String(passageId),
            _aimcq_correct_answers: [Math.max(0, en.options.filter((o, j) => o !== '' && j <= en.correct).length - 1)],
        };
        if (hi && hi.question) {
            meta._aimcq_title_hi = stripHtmlTags(hi.question).slice(0, 120);
            meta._aimcq_question_content_hi = hi.question;
            meta._aimcq_options_hi = hi.options.filter(o => o !== '').map(t => ({ text: t, image: '' }));
            meta._aimcq_explanation_hi = hi.explanation;
        }
        const id = passageId + 1 + i;   // keeps export order: passage first, then its questions
        return {
            id,
            created,
            language: recLang,
            thumb: i === 0 ? (qxState.cropThumb || '') : '',
            library: saveLib,
            passageId,
            post: {
                id,
                post_author: 1,
                post_date: now,
                post_title: stripHtmlTags(en.question).slice(0, 120) || `Passage question ${i + 1}`,
                post_content: en.question,
                post_status: 'publish',
                post_type: 'question',
                meta_input: meta,
                taxonomies: {},
                embedded_media: [],
            },
        };
    });

    try {
        await qxDbPut({
            id: passageId,
            created,
            language: recLang,
            thumb: qxState.cropThumb || '',
            library: saveLib,
            isPassage: true,
            post: passagePost,
        });
        for (const rec of questionRecs) await qxDbPut(rec);
    } catch (err) {
        showToast('Save failed', 'IndexedDB error: ' + (err.message || err), 'error');
        return;
    }
    { const sel = qxLibSelection(); sel.save = saveLib; qxLibSaveSelection(sel); }

    qxState.result = null;
    document.getElementById('qx-review').classList.add('hidden');
    await qxRenderBank();
    {
        const libs = await qxLibEnsure();
        const libName = (libs.find(l => l.id === saveLib) || {}).name || 'General';
        showToast('Passage saved to Question Bank', `Passage + ${questionRecs.length} linked question${questionRecs.length === 1 ? '' : 's'} stored in "${libName}".`, 'success');
    }
}

async function qxRenderBank() {
    const list = document.getElementById('qx-bank-list');
    const countChip = document.getElementById('qx-bank-count');
    if (!list) return;

    const libs = await qxLibEnsure();
    const sel = qxLibSelection();
    if (sel.view !== 'all' && !libs.some(l => l.id === sel.view)) sel.view = 'all';
    if (!libs.some(l => l.id === sel.save)) sel.save = QX_LIB_DEFAULT;
    qxLibSaveSelection(sel);
    const libName = id => (libs.find(l => l.id === id) || {}).name || 'General';

    // Populate both selectors
    const saveSel = document.getElementById('qx-save-lib');
    if (saveSel) {
        saveSel.innerHTML = libs.map(l => `<option value="${l.id}">${qxEsc(l.name)}</option>`).join('');
        saveSel.value = sel.save;
    }
    const viewSel = document.getElementById('qx-lib-view');
    if (viewSel) {
        viewSel.innerHTML = '<option value="all">All libraries</option>' +
            libs.map(l => `<option value="${l.id}">${qxEsc(l.name)}</option>`).join('');
        viewSel.value = sel.view;
    }
    const delLibBtn = document.getElementById('qx-lib-del');
    if (delLibBtn) delLibBtn.classList.toggle('hidden', sel.view === 'all' || sel.view === QX_LIB_DEFAULT);
    const clearLabel = document.getElementById('qx-clear-label');
    if (clearLabel) clearLabel.textContent = sel.view === 'all' ? 'Delete All' : `Delete All in "${libName(sel.view)}"`;

    let recs = [];
    try { recs = await qxDbAll(); } catch (e) {}
    recs.forEach(r => { if (!r.library) r.library = QX_LIB_DEFAULT; });   // v1 records → General
    const shown = sel.view === 'all' ? recs : recs.filter(r => r.library === sel.view);
    shown.sort((a, b) => (a.id || 0) - (b.id || 0));

    if (countChip) {
        const scope = sel.view === 'all' ? `across ${libs.length} librar${libs.length === 1 ? 'y' : 'ies'}` : `in ${libName(sel.view)}`;
        countChip.textContent = `${shown.length} question${shown.length === 1 ? '' : 's'} ${scope}`;
        countChip.classList.toggle('on', shown.length > 0);
        countChip.classList.toggle('off', shown.length === 0);
    }

    if (!shown.length) {
        list.innerHTML = `<p class="text-sm text-gray-400 px-4 py-6 text-center">No questions ${sel.view === 'all' ? 'saved yet' : `in "${qxEsc(libName(sel.view))}" yet`} — crop &amp; extract a question above.</p>`;
        return;
    }

    list.innerHTML = shown.map((rec, i) => {
        const title = qxEsc(stripHtmlTags((rec.post && rec.post.post_title) || '').slice(0, 90));
        // An English/other-language question whose single explanation is Hindi.
        const hiExplOnly = !!(rec.post && rec.post.meta_input
            && !(rec.post.meta_input._aimcq_question_content_hi || '').trim()
            && /[\u0900-\u097F]/.test(rec.post.meta_input._aimcq_explanation || '')
            && !/[\u0900-\u097F]/.test(stripHtmlTags((rec.post.post_content) || '')));
        const langBadge = rec.language === 'bilingual' ? 'EN+HI'
            : (rec.language || 'en').toUpperCase() + (hiExplOnly ? '+HI expl' : '');
        const date = rec.created ? new Date(rec.created).toLocaleString() : '';
        const libBadge = sel.view === 'all' ? `<span class="qx-lib-badge">${qxEsc(libName(rec.library))}</span> · ` : '';
        const isPassage = !!(rec.post && rec.post.post_type === 'passage');
        const passageBadge = isPassage ? '<span class="qx-passage-badge">Passage</span> · '
            : (rec.passageId ? '<span class="qx-passage-badge linked">Passage Q</span> · ' : '');
        const detail = isPassage
            ? `${recs.filter(x => String(x.passageId || '') === String(rec.id)).length} linked questions`
            : `${(rec.post && rec.post.meta_input && rec.post.meta_input._aimcq_options || []).length} options`;
        return `
        <div class="qx-bank-row" data-id="${rec.id}">
            ${rec.thumb ? `<img src="${rec.thumb}" class="qx-bank-thumb" alt="">` : '<div class="qx-bank-thumb qx-bank-thumb-empty"><i data-lucide="file-question" class="w-4 h-4"></i></div>'}
            <div class="qx-bank-main">
                <p class="qx-bank-title"><span class="qx-bank-num">${i + 1}.</span> ${title || '(untitled)'}</p>
                <p class="qx-bank-sub">${libBadge}${passageBadge}${langBadge} · ${detail} · ${qxEsc(date)}</p>
            </div>
            <button type="button" class="qx-bank-del" data-id="${rec.id}" title="Delete this ${isPassage ? 'passage (and its linked questions)' : 'question'} from the bank">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
        </div>`;
    }).join('');

    list.querySelectorAll('.qx-bank-del').forEach(b => b.addEventListener('click', async () => {
        const id = parseInt(b.getAttribute('data-id'), 10);
        const rec = recs.find(x => x.id === id);
        const isPassage = !!(rec && rec.post && rec.post.post_type === 'passage');
        if (isPassage) {
            const linked = recs.filter(x => String(x.passageId || '') === String(id));
            if (!window.confirm(`Delete this passage AND its ${linked.length} linked question${linked.length === 1 ? '' : 's'} from the Question Bank? This cannot be undone.`)) return;
            try {
                await qxDbDelete(id);
                for (const l of linked) await qxDbDelete(l.id);
            } catch (e) {}
        } else {
            if (!window.confirm('Delete this question from the Question Bank? This cannot be undone.')) return;
            try { await qxDbDelete(id); } catch (e) {}
        }
        qxRenderBank();
    }));
    lucide.createIcons();
}

// Language of a set of bank records → term language label + code.
//   all English → English / 01EN;  all Hindi → Hindi / 01HI;
//   any bilingual question, or a mix of EN and HI → Bilingual / 01ENHI.
function qxLangTermInfo(recs) {
    const kinds = new Set(recs.map(r =>
        r.language === 'bilingual' ? 'bi' : (r.language === 'hi' ? 'hi' : 'en')));
    if (kinds.has('bi') || (kinds.has('en') && kinds.has('hi'))) return { language: 'English & Hindi', code: '01ENHI' };
    if (kinds.has('hi')) return { language: 'Hindi', code: '01HI' };
    return { language: 'English', code: '01EN' };
}

function qxSlugify(name) {
    return String(name || '').toLowerCase().trim()
        .replace(/[^a-z0-9\u0900-\u097F]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'library';
}

async function qxExportBank() {
    const libs = await qxLibEnsure();
    const sel = qxLibSelection();
    let recs = [];
    try { recs = await qxDbAll(); } catch (e) {}
    recs.forEach(r => { if (!r.library) r.library = QX_LIB_DEFAULT; });
    const scoped = sel.view === 'all' ? recs : recs.filter(r => r.library === sel.view);
    if (!scoped.length) { showToast('Nothing to export', sel.view === 'all' ? 'Save at least one question before exporting.' : 'This library is empty.', 'error'); return; }
    scoped.sort((a, b) => (a.id || 0) - (b.id || 0));
    const libName = sel.view === 'all' ? 'all' : ((libs.find(l => l.id === sel.view) || {}).name || 'library');
    const slug = String(libName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'library';

    // One term per library represented in the export: taxonomy & name are the
    // library name; language/language_code derived from that library's
    // questions (01EN / 01HI / 01ENHI). Posts reference their library term
    // via taxonomies { "<Library Name>": ["<library-slug>"] }.
    const libIds = [...new Set(scoped.map(r => r.library))];
    const termByLib = {};
    const terms = libIds.map(id => {
        const name = (libs.find(l => l.id === id) || {}).name || 'General';
        const info = qxLangTermInfo(scoped.filter(r => r.library === id));
        const term = {
            taxonomy: name,
            language: info.language,
            language_code: info.code,
            name: name,
            slug: qxSlugify(name),
        };
        termByLib[id] = term;
        return term;
    });

    const data = {
        version: '1.8.0',
        export_type: 'question_bank',
        library: sel.view === 'all' ? undefined : libName,
        terms: terms,
        posts: scoped.map(r => {
            // Passage posts carry no taxonomy (standard shape: empty array);
            // questions reference their library term.
            if (r.post && r.post.post_type === 'passage') {
                return Object.assign({}, r.post, { taxonomies: [] });
            }
            const t = termByLib[r.library];
            return Object.assign({}, r.post, { taxonomies: { [t.taxonomy]: [t.slug] } });
        }),
    };
    if (data.library === undefined) delete data.library;
    downloadJSON(data, `question_bank_${slug}_${Date.now()}.json`);
    const nPass = scoped.filter(r => r.post && r.post.post_type === 'passage').length;
    const nQ = scoped.length - nPass;
    showToast('Exported', `${nQ} question${nQ === 1 ? '' : 's'}${nPass ? ` + ${nPass} passage${nPass === 1 ? '' : 's'}` : ''} from ${sel.view === 'all' ? 'all libraries' : `"${libName}"`} — standard question JSON.`, 'success');
}

// ---------- boot / wiring ----------
(function qxBoot() {
    function wire() {
        const pdfIn = document.getElementById('qx-pdf-file');
        const imgIn = document.getElementById('qx-img-file');
        if (!pdfIn) return;   // markup not present

        pdfIn.addEventListener('change', e => {
            const f = e.target.files[0];
            if (!f) return;
            if (f.type !== 'application/pdf') { showToast('Not a PDF', 'Choose a .pdf file.', 'error'); return; }
            qxLoadPdfFile(f);
            pdfIn.value = '';
        });
        imgIn.addEventListener('change', e => {
            const f = e.target.files[0];
            if (!f) return;
            qxShowWorkspace();
            qxRenderImage(f);
            imgIn.value = '';
        });

        document.getElementById('qx-prev-page').addEventListener('click', () => {
            if (qxState.pageNum > 1) { qxState.pageNum--; qxQueuePage(qxState.pageNum); }
        });
        document.getElementById('qx-next-page').addEventListener('click', () => {
            const step = 1;
            if (qxState.pdfDoc && qxState.pageNum < qxState.pdfDoc.numPages) {
                qxState.pageNum = Math.min(qxState.pdfDoc.numPages, qxState.pageNum + step);
                qxQueuePage(qxState.pageNum);
            }
        });
        const qxContToggle = document.getElementById('qx-continuous');
        if (qxContToggle) qxContToggle.addEventListener('change', () => {
            qxState.continuous = !!qxContToggle.checked;
            if (qxState.pdfDoc) qxQueuePage(qxState.pageNum);   // re-render current page in the new mode
        });
        document.getElementById('qx-zoom-in').addEventListener('click', () => { qxState.scale = Math.min(qxState.scale + 0.25, 6); qxApplyZoom(); });
        document.getElementById('qx-zoom-out').addEventListener('click', () => { qxState.scale = Math.max(qxState.scale - 0.25, 0.25); qxApplyZoom(); });
        document.getElementById('qx-zoom-reset').addEventListener('click', () => { qxState.scale = 1; qxApplyZoom(); });
        document.getElementById('qx-change-file').addEventListener('click', () => {
            if (qxState.cropper) { qxState.cropper.destroy(); qxState.cropper = null; }
            qxState.pdfDoc = null; qxState.srcType = '';
            if (qxState.crops.length) { qxState.crops = []; qxRenderCropQueue(); }
            document.getElementById('qx-workspace').classList.add('hidden');
            document.getElementById('qx-source-pick').classList.remove('hidden');
        });

        document.getElementById('qx-extract-btn').addEventListener('click', qxExtract);
        const addCropBtn = document.getElementById('qx-add-crop-btn');
        if (addCropBtn) addCropBtn.addEventListener('click', qxAddCrop);
        const passageToggle = document.getElementById('qx-passage');
        if (passageToggle) passageToggle.addEventListener('change', () => {
            const label = document.getElementById('qx-extract-label');
            if (label && !qxState.busy) label.textContent = qxExtractBtnLabel();
        });
        // "+ Hindi explanation" is meaningless when the whole output is already
        // Hindi or bilingual — disable it in those modes so the intent is clear.
        const langSel = document.getElementById('qx-lang');
        const syncHiExpl = () => {
            const box = document.getElementById('qx-hi-expl');
            const wrap = document.getElementById('qx-hiexpl-wrap');
            if (!box || !langSel) return;
            const off = langSel.value === 'hi' || langSel.value === 'bilingual';
            box.disabled = off;
            if (wrap) {
                wrap.classList.toggle('opacity-40', off);
                wrap.classList.toggle('cursor-not-allowed', off);
                wrap.title = off
                    ? 'Not applicable: this output mode already produces a Hindi explanation.'
                    : 'Keep the question and options in their own language, but write the explanation in Hindi (saved to the main _aimcq_explanation field).';
            }
        };
        if (langSel) langSel.addEventListener('change', syncHiExpl);
        syncHiExpl();
        document.getElementById('qx-save-btn').addEventListener('click', qxSaveToBank);
        document.getElementById('qx-discard-btn').addEventListener('click', () => {
            qxState.result = null;
            document.getElementById('qx-review').classList.add('hidden');
        });
        document.getElementById('qx-export-btn').addEventListener('click', qxExportBank);
        document.getElementById('qx-clear-btn').addEventListener('click', async () => {
            const sel = qxLibSelection();
            let recs = await qxDbAll().catch(() => []);
            recs.forEach(r => { if (!r.library) r.library = QX_LIB_DEFAULT; });
            const scoped = sel.view === 'all' ? recs : recs.filter(r => r.library === sel.view);
            if (!scoped.length) { showToast('Nothing to delete', 'This view has no questions.', 'info'); return; }
            const libs = await qxLibEnsure();
            const where = sel.view === 'all' ? 'the ENTIRE Question Bank (all libraries)' : `library "${(libs.find(l => l.id === sel.view) || {}).name || ''}"`;
            if (!window.confirm(`Delete ALL ${scoped.length} question${scoped.length === 1 ? '' : 's'} from ${where}? This cannot be undone.`)) return;
            try {
                if (sel.view === 'all') await qxDbClear();
                else await qxDbOp('readwrite', st => { scoped.forEach(r => st.delete(r.id)); });
            } catch (e) {}
            qxRenderBank();
            showToast('Deleted', `${scoped.length} question${scoped.length === 1 ? '' : 's'} removed from ${sel.view === 'all' ? 'all libraries' : 'the library'}.`, 'info');
        });

        // Library controls
        const libNew = document.getElementById('qx-lib-new');
        if (libNew) libNew.addEventListener('click', qxLibCreate);
        const libDel = document.getElementById('qx-lib-del');
        if (libDel) libDel.addEventListener('click', qxLibDeleteCurrent);
        const saveSel = document.getElementById('qx-save-lib');
        if (saveSel) saveSel.addEventListener('change', () => {
            const sel = qxLibSelection(); sel.save = saveSel.value; qxLibSaveSelection(sel);
        });
        const viewSel = document.getElementById('qx-lib-view');
        if (viewSel) viewSel.addEventListener('change', () => {
            const sel = qxLibSelection(); sel.view = viewSel.value; qxLibSaveSelection(sel);
            qxRenderBank();
        });

        qxRenderBank();          // restore persisted bank on load
    }
    function qxQueuePageDef() {}
    window.qxQueuePage = function (num) {
        if (qxState.rendering) qxState.pendingPage = num;
        else qxRenderPdfPage(num);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
    else wire();
    setTimeout(() => { try { if (!document.getElementById('qx-bank-list').__wired) qxRenderBank(); } catch (e) {} }, 900);
})();

// ============================================================
// == EXTRACTOR API POOLS (Gemini + DeepSeek, key rotation) ===
// ============================================================
// The Question Extractor has its OWN API configuration with TWO
// providers — Gemini and DeepSeek — switchable at any time. Each
// provider keeps an independent POOL of keys (one per account).
// Keys are tried in order; a quota/limit error deactivates that
// key for 24 h (daily free-limit reset) and the call automatically
// retries with the next active key, till the last key. Cooldowns
// expire on their own (= the 24 h reset) or via Reactivate.
//
// DeepSeek's API cannot read images, so in DeepSeek mode the crop
// is first transcribed by a Gemini key with a minimal plain-text
// prompt (cheap), and DeepSeek then does the heavy structuring /
// solving / explanation work on the transcription — keeping most
// token usage on the DeepSeek side.

const QX_POOL_LS_KEY = 'aimcq_qx_api_pools';
const QX_POOL_LS_KEY_LEGACY = 'aimcq_qx_gemini_pool';
const QX_LIMIT_COOLDOWN_MS = 24 * 60 * 60 * 1000;   // 24 hours

const QX_PROVIDERS = {
    gemini: {
        label: 'Gemini',
        models: [
            ['gemini-2.5-flash', 'gemini-2.5-flash (recommended for free tier)'],
            ['gemini-2.0-flash', 'gemini-2.0-flash'],
            ['gemini-1.5-flash', 'gemini-1.5-flash'],
            ['gemini-2.5-pro', 'gemini-2.5-pro (low free quota)'],
            ['custom', 'Custom model id…'],
        ],
        defaultModel: 'gemini-2.5-flash',
    },
    deepseek: {
        label: 'DeepSeek',
        models: [
            ['deepseek-v4-flash', 'deepseek-v4-flash (V4 — fast, recommended)'],
            ['deepseek-v4-pro', 'deepseek-v4-pro (V4 — strongest reasoning)'],
            ['deepseek-chat', 'deepseek-chat (V3)'],
            ['deepseek-reasoner', 'deepseek-reasoner (R1 — slower)'],
            ['custom', 'Custom model id…'],
        ],
        defaultModel: 'deepseek-v4-flash',
    },
};

const QX_VISION_MODELS = [
    ['gemma-4-31b-it', 'gemma-4-31b-it (Gemma vision — recommended, separate free quota from Gemini)'],
    ['gemini-2.0-flash', 'gemini-2.0-flash'],
    ['gemini-1.5-flash', 'gemini-1.5-flash'],
    ['gemini-2.5-flash', 'gemini-2.5-flash'],
    ['custom', 'Custom model id…'],
];
const QX_VISION_MODEL_DEFAULT = 'gemma-4-31b-it';

let qxPools = {
    provider: 'gemini',
    visionModel: QX_VISION_MODEL_DEFAULT,   // shared image-reading model (Gemma by default)
    gemini:   { model: 'gemini-2.5-flash', keys: [], split: true },
    deepseek: { model: 'deepseek-v4-flash', keys: [] },
};
// key: { id, label, key, disabledUntil }  — disabledUntil: epoch ms (0 = active)

function qxNormKeys(arr) {
    return Array.isArray(arr) ? arr.filter(k => k && typeof k === 'object').map((k, i) => ({
        id: k.id || ('k' + i + '-' + Date.now()),
        label: k.label || `Key ${i + 1}`,
        key: k.key || '',
        disabledUntil: parseInt(k.disabledUntil, 10) || 0,
    })) : [];
}

function qxPoolLoad() {
    try {
        const raw = localStorage.getItem(QX_POOL_LS_KEY);
        if (raw) {
            const p = JSON.parse(raw);
            if (p && typeof p === 'object') {
                qxPools.provider = (p.provider === 'deepseek') ? 'deepseek' : 'gemini';
                ['gemini', 'deepseek'].forEach(pr => {
                    const src = p[pr] || {};
                    qxPools[pr].model = src.model || QX_PROVIDERS[pr].defaultModel;
                    qxPools[pr].keys = qxNormKeys(src.keys);
                });
                // Shared vision model (migrates the old deepseek.visionModel slot).
                qxPools.visionModel = p.visionModel
                    || (p.deepseek && p.deepseek.visionModel)
                    || QX_VISION_MODEL_DEFAULT;
                // Gemini split pipeline (Gemma vision → Gemini text generation).
                qxPools.gemini.split = (p.gemini && typeof p.gemini.split === 'boolean') ? p.gemini.split : true;
            }
        } else {
            // Migrate the old single-provider (Gemini) pool if present.
            const legacy = localStorage.getItem(QX_POOL_LS_KEY_LEGACY);
            if (legacy) {
                const lp = JSON.parse(legacy);
                if (lp && typeof lp === 'object') {
                    qxPools.gemini.model = lp.model || QX_PROVIDERS.gemini.defaultModel;
                    qxPools.gemini.keys = qxNormKeys(lp.keys);
                    qxPoolPersist();
                }
            }
        }
    } catch (e) {}
    qxPoolRenderKeys();
    qxPoolUpdateChip();
}

function qxPoolPersist() {
    try { localStorage.setItem(QX_POOL_LS_KEY, JSON.stringify(qxPools)); } catch (e) {}
}

function qxActivePool() { return qxPools[qxPools.provider]; }
function qxKeyActive(k) { return !!(k && k.key && (!k.disabledUntil || k.disabledUntil <= Date.now())); }
function qxPoolActiveKeys(provider) { return qxPools[provider || qxPools.provider].keys.filter(qxKeyActive); }
function qxPoolConfiguredKeys(provider) { return qxPools[provider || qxPools.provider].keys.filter(k => k.key); }

function qxFmtCooldown(until) {
    const ms = until - Date.now();
    if (ms <= 0) return 'now';
    const h = Math.floor(ms / 3600000), m = Math.ceil((ms % 3600000) / 60000);
    return (h ? `${h}h ` : '') + `${m}m`;
}

// ---------- settings card UI ----------
function qxToggleApiSettings() {
    const body = document.getElementById('qx-api-body');
    const chev = document.getElementById('qx-api-chevron');
    if (!body) return;
    const nowHidden = body.classList.toggle('hidden');
    if (chev) chev.style.transform = nowHidden ? '' : 'rotate(180deg)';
    if (!nowHidden) qxPoolRenderKeys();
    try { lucide.createIcons(); } catch (e) {}
}

function qxSetProvider(p) {
    if (!QX_PROVIDERS[p]) return;
    qxPools.provider = p;
    qxPoolPersist();
    qxPoolRenderKeys();
    qxPoolUpdateChip();
}

function qxPoolUpdateChip() {
    const chip = document.getElementById('qx-ai-status');
    if (!chip) return;
    const prName = QX_PROVIDERS[qxPools.provider].label;
    const total = qxPoolConfiguredKeys().length;
    const active = qxPoolActiveKeys().length;
    let text, on;
    if (!total) { text = `${prName} · not configured`; on = false; }
    else if (!active) { text = `${prName} · all ${total} keys limit-hit — auto-resets in 24h`; on = false; }
    else {
        const modelInfo = (qxPools.provider === 'gemini' && qxPools.gemini.split)
            ? `${qxPools.visionModel} → ${qxActivePool().model}`
            : qxActivePool().model;
        text = `${prName} · ${active}/${total} keys active · ${modelInfo}`;
        on = true;
    }
    chip.textContent = text;
    chip.classList.toggle('on', on);
    chip.classList.toggle('off', !on);
}

function qxPoolRenderKeys() {
    const list = document.getElementById('qx-keys-list');
    if (!list) return;
    const provider = qxPools.provider;
    const pool = qxActivePool();

    // Provider switch state
    const sw = document.getElementById('qx-provider-switch');
    if (sw) sw.querySelectorAll('button').forEach(b =>
        b.classList.toggle('active', b.getAttribute('data-provider') === provider));

    // Model options for the active provider
    const modelSel = document.getElementById('qx-model');
    const modelCustom = document.getElementById('qx-model-custom');
    if (modelSel) {
        modelSel.innerHTML = QX_PROVIDERS[provider].models
            .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
        const knownModel = QX_PROVIDERS[provider].models.some(m => m[0] === pool.model && m[0] !== 'custom');
        modelSel.value = knownModel ? pool.model : 'custom';
        if (modelCustom) {
            modelCustom.classList.toggle('hidden', knownModel);
            modelCustom.value = knownModel ? '' : (pool.model || '');
        }
    }

    // DeepSeek pipeline note, Gemini split toggle, shared vision-model row
    const dsNote = document.getElementById('qx-deepseek-note');
    if (dsNote) dsNote.classList.toggle('hidden', provider !== 'deepseek');
    const splitRow = document.getElementById('qx-gemini-split-row');
    const splitBox = document.getElementById('qx-gemini-split');
    if (splitRow) splitRow.classList.toggle('hidden', provider !== 'gemini');
    if (splitBox) splitBox.checked = !!qxPools.gemini.split;
    const visRow = document.getElementById('qx-vision-row');
    const showVision = provider === 'deepseek' || (provider === 'gemini' && qxPools.gemini.split);
    if (visRow) visRow.classList.toggle('hidden', !showVision);
    const visSel = document.getElementById('qx-vision-model');
    const visCustom = document.getElementById('qx-vision-model-custom');
    if (visSel) {
        visSel.innerHTML = QX_VISION_MODELS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
        const vm = qxPools.visionModel || QX_VISION_MODEL_DEFAULT;
        const known = QX_VISION_MODELS.some(m => m[0] === vm);
        visSel.value = known ? vm : 'custom';
        if (visCustom) {
            visCustom.classList.toggle('hidden', known);
            visCustom.value = known ? '' : vm;
        }
    }

    if (!pool.keys.length) {
        list.innerHTML = `<p class="text-xs text-gray-400 py-1">No ${QX_PROVIDERS[provider].label} keys yet — click <b>Add API key</b> to add your first key.</p>`;
        return;
    }
    list.innerHTML = pool.keys.map((k, i) => {
        const active = qxKeyActive(k);
        const limited = k.key && !active;
        return `
        <div class="qx-key-row ${limited ? 'limited' : ''}" data-id="${k.id}">
            <span class="qx-key-order">${i + 1}</span>
            <input type="text" class="qx-key-label" data-field="label" value="${qxEsc(k.label)}" placeholder="Account name">
            <input type="password" class="qx-key-input" data-field="key" value="${qxEsc(k.key)}" placeholder="${provider === 'deepseek' ? 'sk-...' : 'AIza...'}" autocomplete="off">
            <span class="qx-key-status ${limited ? 'bad' : (k.key ? 'ok' : '')}">${
                !k.key ? 'empty'
                : limited ? `limit hit · resets in ${qxFmtCooldown(k.disabledUntil)}`
                : 'active'}</span>
            ${limited ? `<button type="button" class="qx-key-btn qx-key-react" data-id="${k.id}" title="Mark active again now"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i></button>` : ''}
            ${k.key ? `<button type="button" class="qx-key-btn qx-key-test" data-id="${k.id}" title="Test this key with a tiny request"><i data-lucide="plug-zap" class="w-3.5 h-3.5"></i></button>` : ''}
            <button type="button" class="qx-key-btn qx-key-del" data-id="${k.id}" title="Remove this key"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </div>`;
    }).join('');

    list.querySelectorAll('.qx-key-row input').forEach(inp => {
        inp.addEventListener('input', () => {
            const row = inp.closest('.qx-key-row');
            const k = pool.keys.find(x => x.id === row.getAttribute('data-id'));
            if (!k) return;
            const field = inp.getAttribute('data-field');
            k[field] = field === 'key' ? aiSanitizeKey(inp.value) : inp.value.trim();
        });
    });
    list.querySelectorAll('.qx-key-del').forEach(b => b.addEventListener('click', () => {
        pool.keys = pool.keys.filter(x => x.id !== b.getAttribute('data-id'));
        qxPoolPersist();
        qxPoolRenderKeys();
        qxPoolUpdateChip();
    }));
    list.querySelectorAll('.qx-key-react').forEach(b => b.addEventListener('click', () => {
        const k = pool.keys.find(x => x.id === b.getAttribute('data-id'));
        if (k) { k.disabledUntil = 0; qxPoolPersist(); qxPoolRenderKeys(); qxPoolUpdateChip(); }
    }));
    list.querySelectorAll('.qx-key-test').forEach(b => b.addEventListener('click', () => {
        qxPoolTestKey(b.getAttribute('data-id'), b);
    }));
    lucide.createIcons();
}

function qxPoolAddKey() {
    const pool = qxActivePool();
    pool.keys.push({
        id: 'k' + Date.now() + '-' + Math.floor(Math.random() * 1e5),
        label: `Account ${pool.keys.length + 1}`,
        key: '',
        disabledUntil: 0,
    });
    qxPoolRenderKeys();
}

function qxPoolSave() {
    const modelSel = document.getElementById('qx-model');
    const modelCustom = document.getElementById('qx-model-custom');
    const pool = qxActivePool();
    if (modelSel && modelSel.value) {
        pool.model = modelSel.value === 'custom'
            ? (modelCustom && modelCustom.value.trim()) || QX_PROVIDERS[qxPools.provider].defaultModel
            : modelSel.value;
    }
    const visSel = document.getElementById('qx-vision-model');
    const visCustom = document.getElementById('qx-vision-model-custom');
    if (visSel) {
        qxPools.visionModel = visSel.value === 'custom'
            ? (visCustom && visCustom.value.trim()) || QX_VISION_MODEL_DEFAULT
            : visSel.value;
    }
    const splitBox = document.getElementById('qx-gemini-split');
    if (splitBox) qxPools.gemini.split = !!splitBox.checked;
    pool.keys = pool.keys.filter(k => k.key || k.label);
    qxPoolPersist();
    qxPoolRenderKeys();
    qxPoolUpdateChip();
    const n = qxPoolConfiguredKeys().length;
    const prName = QX_PROVIDERS[qxPools.provider].label;
    showToast('Extractor API pool saved',
        n ? `${prName}: ${n} key${n === 1 ? '' : 's'} · model ${pool.model}. Keys rotate automatically on limit.`
          : `${prName} pool saved, but no usable keys yet — paste at least one API key.`,
        n ? 'success' : 'info');
}

function qxPoolResetLimits() {
    qxActivePool().keys.forEach(k => { k.disabledUntil = 0; });
    qxPoolPersist();
    qxPoolRenderKeys();
    qxPoolUpdateChip();
    showToast('Limits reset', `All ${QX_PROVIDERS[qxPools.provider].label} keys marked active again.`, 'success');
}

function qxPoolMarkLimited(k) {
    k.disabledUntil = Date.now() + QX_LIMIT_COOLDOWN_MS;
    qxPoolPersist();
    qxPoolRenderKeys();
    qxPoolUpdateChip();
}

function qxIsLimitError(err) {
    if (!err) return false;
    if (err.status === 429) return true;
    if (err.status === 402) return true;   // DeepSeek: insufficient balance
    return /RESOURCE_EXHAUSTED|quota|rate limit|insufficient balance/i.test(err.message || '');
}

// ---------- DeepSeek transport (OpenAI-compatible) ----------
async function aiDeepseekRequest(prompt, opts) {
    opts = opts || {};
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (opts.key || ''),
        },
        body: JSON.stringify({
            model: opts.model || 'deepseek-v4-flash',
            messages: [{ role: 'user', content: prompt }],
            temperature: opts.plainText ? 0 : 0.2,
            ...(opts.plainText ? {} : { response_format: { type: 'json_object' } }),
        }),
    });
    if (!resp.ok) {
        let detail = '';
        try { const j = await resp.json(); detail = (j.error && j.error.message) || ''; } catch (e) {}
        const err = new Error(detail || `HTTP ${resp.status}`);
        err.status = resp.status;
        throw err;
    }
    const data = await resp.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error('Empty response from DeepSeek');
    return text;
}

// ---------- failover call within a provider's pool ----------
async function qxAiCall(prompt, opts, provider) {
    provider = provider || qxPools.provider;
    const prName = QX_PROVIDERS[provider].label;
    const pool = qxPools[provider];
    const candidates = pool.keys.filter(qxKeyActive);
    if (!candidates.length) {
        const configured = pool.keys.filter(k => k.key);
        if (!configured.length) {
            throw new Error(`No ${prName} keys configured in the Extractor API Settings.`);
        }
        const soonest = Math.min(...configured.map(k => k.disabledUntil || 0));
        throw new Error(`All ${configured.length} ${prName} keys have hit their limits. They re-activate automatically — earliest in ${qxFmtCooldown(soonest)} (or use "Reset all limits"${provider !== qxPools.provider ? '' : ', or switch provider'}).`);
    }
    for (const k of candidates) {
        try {
            const useModel = opts.modelOverride || pool.model;
            const text = provider === 'deepseek'
                ? await aiDeepseekRequest(prompt, Object.assign({}, opts, { key: k.key, model: useModel }))
                : await aiGeminiRequest(prompt, Object.assign({}, opts, { key: k.key, model: useModel }));
            return { text, keyUsed: k, provider };
        } catch (err) {
            if (qxIsLimitError(err)) {
                qxPoolMarkLimited(k);
                showToast('API limit hit — switching key',
                    `${prName} key "${k.label}" hit its limit and is deactivated for 24h. Trying the next key…`, 'info');
                continue;
            }
            throw err;
        }
    }
    throw new Error(`All ${prName} keys hit their limits during this call. They re-activate automatically after 24h (or use "Reset all limits").`);
}

// ---------- extraction pipeline (provider-aware) ----------
// Gemini: single multimodal call (image + full prompt).
// DeepSeek: (1) minimal Gemini transcription of the crop, (2) DeepSeek
// receives the transcription and does structuring/solving/explanation.
const QX_TRANSCRIBE_PROMPT =
    'Transcribe ALL text visible in this image EXACTLY, in correct reading order. ' +
    'CRITICAL — do NOT copy the image\'s visual word-wrap: if a sentence merely wraps to the next visual line because of column/page width, join the wrapped words back into ONE continuous line with a single space — do NOT start a new line there. ' +
    'Only start a new line for a GENUINE logical break: a new labeled statement/point (A./B./I./II./1./2. etc.), a clearly separate sentence/point by the author\'s intent, or a real paragraph break. When unsure whether a break is logical or just visual wrapping, join the text into one continuous line instead of breaking it. ' +
    'Write mathematical content as LaTeX between $...$ delimiters — and ALL superscripts, subscripts and degree symbols, in math AND non-math text alike, as LaTeX too: powers $x^2$/$10^{-3}$, units $m^2$/$km^2$, chemical formulas $H_2O$/$CO_2$/$SO_4^{2-}$, ions $Na^+$, isotopes $^{235}U$, degrees/temperatures/coordinates $45^\\circ$/$30^\\circ C$/$23.5^\\circ N$, indexed terms $a_n$. Multi-character scripts need braces ($10^{-3}$). Never output raw Unicode script/degree characters (\u00b2 \u2082 \u00b0 etc.) or <sub>/<sup> tags — convert them to LaTeX. ' +
    'If a diagram/figure/graph appears, write [image here: <very short description>] at its position. ' +
    'If the image contains a TABLE, matched lists (List-I / List-II, Column A / Column B, "Match the following"), or any tabular/grid data, transcribe it as a Markdown table (rows with | pipes and a header separator) so its row/column structure is preserved — keep each list item together with its own label in one cell (e.g. "A. Kudankulam" in one cell, "1. Karnataka" in the next), and do NOT split the A./B. or 1./2. markers into separate columns. ' +
    'IGNORE any marks that are NOT part of the printed question: ticks/check marks (\u2713), crosses (\u2717/\u00d7), circles, underlines, arrows, highlighter, and ANY handwriting or hand-drawn scribbles/annotations overlaid on the page — do NOT transcribe or describe them. Transcribe only the original printed text and figures. ' +
    'Keep the question stem and the answer options clearly separated (transcribe the stem, then the options in order); do not merge option text into the stem. ' +
    'Include a printed/typeset answer key if present (e.g. a typeset "Answer (1)" line), but NOT hand-drawn ticks/crosses/circles/scribbles. Output ONLY the raw transcription — no commentary.';

async function qxGeminiTranscribe(images) {
    const visionModel = qxPools.visionModel || QX_VISION_MODEL_DEFAULT;
    // `images` may be a single base64 string or an array of them. When more
    // than one crop is supplied (a question that continues onto another page,
    // or the same question in a second language), each crop is transcribed on
    // its own and the pieces are joined so the structuring step sees the whole
    // question as one continuous input.
    const list = Array.isArray(images) ? images.filter(Boolean) : [images].filter(Boolean);
    if (!list.length) throw new Error('No crop to transcribe.');

    const transcribeOne = async (b64) => {
        // Prefer the extractor's Gemini pool (with failover); fall back to the
        // Question Editor's Gemini key if the pool is empty. Always uses the
        // dedicated vision model (default: gemma-4-31b-it) — independent of
        // whichever Gemini model is selected for direct Gemini-mode extraction,
        // so it draws on its own free-tier quota.
        if (qxPoolConfiguredKeys('gemini').length) {
            const call = await qxAiCall(QX_TRANSCRIBE_PROMPT,
                { imageB64: b64, imageMime: 'image/webp', plainText: true, modelOverride: visionModel }, 'gemini');
            return call.text;
        }
        if (typeof aiConfigured === 'function' && aiConfigured()) {
            return aiGeminiRequest(QX_TRANSCRIBE_PROMPT,
                { imageB64: b64, imageMime: 'image/webp', plainText: true, model: visionModel });
        }
        throw new Error('DeepSeek mode needs a Gemini-API key for reading the image (DeepSeek has no image input). Add a Gemini key to the extractor pool, or configure the Question Editor\'s AI settings.');
    };

    if (list.length === 1) return transcribeOne(list[0]);

    const parts = [];
    for (let i = 0; i < list.length; i++) {
        const t = await transcribeOne(list[i]);
        parts.push(`--- Crop ${i + 1} of ${list.length} ---\n${(t || '').trim()}`);
    }
    // The pieces belong together — flag that for the structuring step.
    return 'The following transcription comes from MULTIPLE crops of the SAME item (a single question, or a passage group with its questions, continuing across crops/pages — possibly repeated in another language). Treat all crops together as one continuous source.\n\n' + parts.join('\n\n');
}

async function qxRunExtraction(buildPrompt, langMode, images, wantSteps, detailLevel, wantHiExpl) {
    const label = document.getElementById('qx-extract-label');
    // `images` may be a single base64 string or an array (multi-crop question).
    const imgList = Array.isArray(images) ? images.filter(Boolean) : [images].filter(Boolean);
    const multi = imgList.length > 1;
    const emptyMsg = multi
        ? 'Image transcription came back empty — try tighter, clearer crops.'
        : 'Image transcription came back empty — try a tighter, clearer crop.';
    const readLabel = (m) => multi ? `Reading ${imgList.length} crops (${m})…` : `Reading image (${m})…`;

    if (qxPools.provider === 'deepseek') {
        if (label) label.textContent = readLabel(qxPools.visionModel || 'vision model');
        const transcript = await qxGeminiTranscribe(imgList);
        if (!transcript || !transcript.trim()) throw new Error(emptyMsg);
        if (label) label.textContent = 'Structuring with DeepSeek…';
        return qxAiCall(buildPrompt(langMode, transcript.trim(), wantSteps, detailLevel, wantHiExpl), {}, 'deepseek');
    }
    // Gemini provider — split pipeline saves the generation model's vision
    // quota: cheap vision model (Gemma) reads the image, then the selected
    // Gemini model runs TEXT-ONLY for the actual question generation.
    if (qxPools.gemini.split) {
        try {
            if (label) label.textContent = readLabel(qxPools.visionModel);
            const transcript = await qxGeminiTranscribe(imgList);
            if (!transcript || !transcript.trim()) throw new Error(emptyMsg);
            if (label) label.textContent = `Generating (${qxPools.gemini.model})…`;
            return await qxAiCall(buildPrompt(langMode, transcript.trim(), wantSteps, detailLevel, wantHiExpl), {}, 'gemini');
        } catch (err) {
            // Vision model missing/unavailable → fall back to the direct
            // multimodal call so extraction still works.
            if (err && (err.status === 404 || /not found|is not supported|does not support/i.test(err.message || ''))) {
                showToast('Vision model unavailable — using direct call',
                    `"${qxPools.visionModel}" was rejected by the API (${err.message || 'not found'}). Falling back to a single multimodal ${qxPools.gemini.model} call. Fix the vision model id in the Extractor API Settings.`,
                    'info');
                if (label) label.textContent = 'Extracting with AI…';
                return qxAiCall(qxWithMultiHint(buildPrompt, langMode, wantSteps, detailLevel, multi, wantHiExpl), qxImgOpts(imgList), 'gemini');
            }
            throw err;
        }
    }
    return qxAiCall(qxWithMultiHint(buildPrompt, langMode, wantSteps, detailLevel, multi, wantHiExpl), qxImgOpts(imgList), 'gemini');
}

// Build the image opts for a direct multimodal Gemini call from 1..N crops.
function qxImgOpts(imgList) {
    return imgList.length > 1
        ? { imagesB64: imgList, imageMime: 'image/webp' }
        : { imageB64: imgList[0], imageMime: 'image/webp' };
}

// For direct (non-split) multimodal calls there is no transcript to carry the
// "these crops belong together" hint, so prepend it to the prompt instead.
function qxWithMultiHint(buildPrompt, langMode, wantSteps, detailLevel, multi, wantHiExpl) {
    const base = buildPrompt(langMode, undefined, wantSteps, detailLevel, wantHiExpl);
    if (!multi) return base;
    const hint = (buildPrompt === qxBuildPassagePrompt)
        ? 'NOTE: You are given MULTIPLE images that are all crops of the SAME reading-comprehension group — together they contain the directions, the passage, and ALL its questions (continued across pages/columns). Combine ALL images into ONE passage group.\n\n'
        : 'NOTE: You are given MULTIPLE images that are all crops of the SAME single question — it continues across the images (e.g. the question or its options continue on the next page, or the same question appears in another language). Combine ALL images into ONE question.\n\n';
    return hint + base;
}

(function qxPoolBoot() {
    function init() { qxPoolLoad(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    setTimeout(function () { try { qxPoolLoad(); } catch (e) {} }, 850);
    setInterval(function () {
        try {
            qxPoolUpdateChip();
            const body = document.getElementById('qx-api-body');
            if (body && !body.classList.contains('hidden')) qxPoolRenderKeys();
        } catch (e) {}
    }, 60000);
})();

// Test one pool key with a tiny request and show the PRECISE result —
// so a bad key (restrictions, disabled API, typo) is easy to diagnose.
async function qxPoolTestKey(id, btn) {
    const pool = qxActivePool();
    const k = pool.keys.find(x => x.id === id);
    if (!k || !k.key) return;
    const row = btn && btn.closest('.qx-key-row');
    const statusEl = row && row.querySelector('.qx-key-status');
    const prev = statusEl ? statusEl.textContent : '';
    if (statusEl) { statusEl.textContent = 'testing…'; statusEl.className = 'qx-key-status'; }
    try {
        const opts = { key: k.key, model: pool.model, plainText: true };
        const out = qxPools.provider === 'deepseek'
            ? await aiDeepseekRequest('Reply with exactly: OK', opts)
            : await aiGeminiRequest('Reply with exactly: OK', opts);
        if (statusEl) { statusEl.textContent = /OK/i.test(out || '') ? '✓ works' : '✓ reachable'; statusEl.className = 'qx-key-status ok'; }
        showToast('Key OK', `"${k.label}" works with ${pool.model}.`, 'success');
    } catch (err) {
        if (statusEl) { statusEl.textContent = '✗ failed'; statusEl.className = 'qx-key-status bad'; }
        showToast(`Key "${k.label}" failed`, aiFriendlyError(err), 'error');
    }
    setTimeout(() => { try { qxPoolRenderKeys(); } catch (e) {} }, 4000);
}

// ============================================================
// == AI FIGURE GENERATION (Figure Updater tab — optional) ====
// ============================================================
// Lives entirely in the Figure Updater tab. When the "AI figure generator"
// toggle is on, the Quick Crop & Upload action first sends the crop to an
// image-OUTPUT Gemini model (default gemini-3.1-flash-lite-image) that
// reproduces ONLY the figure (graph / circuit / table / diagram) as a
// clean standalone image, then uploads THAT to GitHub → jsDelivr like any
// other crop. Off = the crop itself is uploaded unchanged. Fully manual:
// the user crops the figure region and clicks Crop & Upload.

const FIG_AI_MODELS = [
    ['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-lite-image (recommended)'],
    ['custom', 'Custom image model id…'],
];
const FIG_AI_MODEL_DEFAULT = 'gemini-3.1-flash-lite-image';
const FIG_AI_MODEL_KEY = 'aimcq_fig_ai_model';
let figAiModel = FIG_AI_MODEL_DEFAULT;

const FIG_AI_PROMPT =
    'The attached image is a cropped exam question that contains a figure (diagram, graph, circuit, table, or illustration). ' +
    'Generate an image that reproduces ONLY that figure as a clean standalone image on a plain white background. ' +
    'EXCLUDE everything that is not part of the figure itself: the question text, question number, option labels and option text, printed answer markings, and any watermarks or logos. ' +
    'Reproduce the figure faithfully and completely — same axes and axis labels, curve shapes, circuit components and their values, arrows, table rows/columns, and any text or numbers that belong INSIDE the figure. ' +
    'Do not add titles, captions, borders, or decorations of your own. ' +
    'If several separate figures are present, reproduce the main figure that the question body refers to.';

// Gemini request variant that accepts image parts in the RESPONSE.
async function figAiGeminiImageRequest(prompt, opts) {
    opts = opts || {};
    const key = aiSanitizeKey(opts.key || '');
    const model = opts.model || FIG_AI_MODEL_DEFAULT;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const userParts = [];
    if (opts.imageB64) userParts.push({ inline_data: { mime_type: opts.imageMime || 'image/webp', data: opts.imageB64 } });
    userParts.push({ text: prompt });
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: userParts }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'], temperature: 0.1 },
        }),
    });
    if (!resp.ok) {
        let detail = '', reason = '';
        try {
            const j = await resp.json();
            if (j.error) {
                detail = j.error.message || '';
                (j.error.details || []).forEach(d => { if (d && d.reason && !reason) reason = d.reason; });
                reason = reason || j.error.status || '';
            }
        } catch (e) {}
        const err = new Error(detail || `HTTP ${resp.status}`);
        err.status = resp.status; err.reason = reason;
        throw err;
    }
    const data = await resp.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content &&
        data.candidates[0].content.parts) || [];
    const images = []; let text = '';
    parts.forEach(p => {
        const inl = p.inlineData || p.inline_data;
        if (inl && inl.data) images.push({ mime: inl.mimeType || inl.mime_type || 'image/png', data: inl.data });
        if (p.text) text += p.text;
    });
    return { images, text };
}

// Collect usable Gemini keys: the Question Extractor pool first (with
// limit rotation), then the Question Editor's key as a fallback.
function figAiGeminiKeys() {
    const keys = [];
    try {
        if (typeof qxPools !== 'undefined' && qxPools.gemini && qxPools.gemini.keys) {
            qxPools.gemini.keys.filter(k => typeof qxKeyActive === 'function' ? qxKeyActive(k) : k.key)
                .forEach(k => keys.push(k));
        }
    } catch (e) {}
    return keys;
}

async function figGenerateFigureImage(imageB64) {
    const model = figAiModel || FIG_AI_MODEL_DEFAULT;
    const opts = { imageB64, imageMime: 'image/webp', model };
    const poolKeys = figAiGeminiKeys();
    if (poolKeys.length) {
        for (const k of poolKeys) {
            try {
                const out = await figAiGeminiImageRequest(FIG_AI_PROMPT, Object.assign({}, opts, { key: k.key }));
                if (!out.images.length) throw new Error('The image model returned no image' + (out.text ? ' — it said: ' + out.text.slice(0, 160) : '.'));
                return out.images[0];
            } catch (err) {
                if (typeof qxIsLimitError === 'function' && qxIsLimitError(err)) {
                    if (typeof qxPoolMarkLimited === 'function') qxPoolMarkLimited(k);
                    showToast('API limit hit — switching key', `Gemini key "${k.label}" hit its limit (figure model). Trying the next key…`, 'info');
                    continue;
                }
                throw new Error(typeof aiFriendlyError === 'function' ? aiFriendlyError(err) : (err.message || String(err)));
            }
        }
        throw new Error('All Gemini keys hit their limits during figure generation.');
    }
    // Fallback: Question Editor key
    let editorKey = '';
    try { if (typeof aiCfg !== 'undefined') editorKey = aiCfg.key || ''; } catch (e) {}
    if (editorKey) {
        try {
            const out = await figAiGeminiImageRequest(FIG_AI_PROMPT, Object.assign({}, opts, { key: editorKey }));
            if (!out.images.length) throw new Error('The image model returned no image' + (out.text ? ' — it said: ' + out.text.slice(0, 160) : '.'));
            return out.images[0];
        } catch (err) {
            throw new Error(typeof aiFriendlyError === 'function' ? aiFriendlyError(err) : (err.message || String(err)));
        }
    }
    throw new Error('AI figure generation needs a Gemini API key. Add one to the Question Extractor key pool, or configure the Question Editor AI settings.');
}

function figB64ToBlob(b64, mime) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'image/png' });
}

// AI figure model settings UI (in the Quick Crop & Upload box).
function figAiRenderModel() {
    const sel = document.getElementById('fig-ai-model');
    const custom = document.getElementById('fig-ai-model-custom');
    if (sel) {
        sel.innerHTML = FIG_AI_MODELS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
        const known = FIG_AI_MODELS.some(m => m[0] === figAiModel && m[0] !== 'custom');
        sel.value = known ? figAiModel : 'custom';
        if (custom) { custom.classList.toggle('hidden', known); custom.value = known ? '' : figAiModel; }
    }
}
function figAiSaveModel() {
    const sel = document.getElementById('fig-ai-model');
    const custom = document.getElementById('fig-ai-model-custom');
    if (!sel) return;
    figAiModel = sel.value === 'custom'
        ? (custom && custom.value.trim()) || FIG_AI_MODEL_DEFAULT
        : sel.value;
    try { localStorage.setItem(FIG_AI_MODEL_KEY, figAiModel); } catch (e) {}
}
(function figAiBoot() {
    function init() {
        try { const v = localStorage.getItem(FIG_AI_MODEL_KEY); if (v) figAiModel = v; } catch (e) {}
        const toggle = document.getElementById('fig-ai-gen');
        const row = document.getElementById('fig-ai-model-row');
        const label = document.getElementById('fig-quick-upload-label');
        figAiRenderModel();
        if (toggle) toggle.addEventListener('change', () => {
            if (row) row.classList.toggle('hidden', !toggle.checked);
            if (label) label.textContent = toggle.checked ? 'Generate Figure & Upload' : 'Crop & Upload';
        });
        const sel = document.getElementById('fig-ai-model');
        const custom = document.getElementById('fig-ai-model-custom');
        if (sel) sel.addEventListener('change', () => {
            if (custom) custom.classList.toggle('hidden', sel.value !== 'custom');
            figAiSaveModel();
        });
        if (custom) custom.addEventListener('input', figAiSaveModel);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    setTimeout(init, 850);
})();
