import { escapeAttr, escapeHtml } from './utils/html.js';
import { isLocalFilePath } from './chat/local-file-links.js';

function getMarked() {
    if (window.marked) return window.marked;
    return typeof marked !== 'undefined' ? marked : null;
}

function getHighlightJs() {
    if (window.hljs) return window.hljs;
    return typeof hljs !== 'undefined' ? hljs : null;
}

export function normalizeLinkHref(href) {
    var value = String(href || '').trim();
    if (/^www\./i.test(value)) return 'https://' + value;
    return value;
}

export function isLocalFileLinkHref(href) {
    return isLocalFilePath(href);
}

export function isExternalLinkHref(href) {
    try {
        var url = new URL(href, window.location.href);
        if (url.protocol === 'mailto:' || url.protocol === 'tel:') return true;
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== window.location.origin;
    } catch (_) {
        return false;
    }
}

export function isSafeLinkHref(href) {
    var value = String(href || '').trim();
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return false;
    if (/^(https?:|mailto:|tel:)/i.test(value)) return true;
    if (/^(\/(?!\/)|#|\?|\.\.?\/)/.test(value)) return true;
    return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

export function isSafeImageHref(href) {
    var value = String(href || '').trim();
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return false;
    if (/^https?:/i.test(value)) return true;
    if (/^\/(?!\/)/.test(value)) return true;
    if (/^\.\.?\//.test(value)) return true;
    return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

export function sanitizeRenderedHtml(html) {
    if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
        return window.DOMPurify.sanitize(html, {
            ADD_ATTR: ['target', 'data-local-file-action', 'data-local-file-path', 'data-local-file-bound'],
            FORBID_TAGS: ['style'],
            FORBID_ATTR: ['style'],
        });
    }
    return html;
}

export function renderMarkdown(text) {
    if (!text) return '';

    var markedApi = getMarked();
    try {
        return sanitizeRenderedHtml(markedApi ? markedApi.parse(text) : escapeHtml(String(text)));
    } catch (_) {
        return escapeHtml(String(text));
    }
}

export function configureMarkdown() {
    var markedApi = getMarked();
    if (!markedApi) return;

    var markedRenderer = new markedApi.Renderer();
    markedRenderer.html = function (obj) {
        var html = (typeof obj === 'string') ? obj : (obj.raw || obj.text || '');
        return escapeHtml(String(html || ''));
    };

    markedRenderer.code = function (obj) {
        var code = (typeof obj === 'string') ? obj : (obj.text || '');
        var lang = (typeof obj === 'string') ? '' : (obj.lang || '');
        var headerHtml = '<div class="code-header"><span class="code-lang">' + escapeHtml(lang || 'text') + '</span><button class="code-copy" type="button">复制</button></div>';
        var highlightJs = getHighlightJs();

        if (lang && highlightJs && highlightJs.getLanguage(lang)) {
            try {
                var highlighted = highlightJs.highlight(code, { language: lang }).value;
                return '<pre>' + headerHtml + '<code class="hljs language-' + escapeHtml(lang) + '">' + highlighted + '</code></pre>';
            } catch (_) {
            }
        }
        return '<pre>' + headerHtml + '<code class="hljs">' + escapeHtml(code) + '</code></pre>';
    };

    markedRenderer.image = function (obj) {
        var href = String((typeof obj === 'string') ? obj : (obj.href || '')).trim();
        var title = (typeof obj === 'string') ? '' : (obj.title || '');
        var alt = (typeof obj === 'string') ? '' : (obj.text || '');

        if (href.startsWith('/') && !href.startsWith('/api')) {
            href = window.withApiToken('/api/local-file?path=' + encodeURIComponent(href));
        }
        if (!isSafeImageHref(href)) return escapeHtml(alt || title || '');
        return '<img src="' + escapeAttr(href) + '" alt="' + escapeAttr(alt) + '"'
            + (title ? ' title="' + escapeAttr(title) + '"' : '')
            + ' class="chat-image" />';
    };

    markedRenderer.link = function (obj) {
        var href = normalizeLinkHref((typeof obj === 'string') ? obj : (obj.href || ''));
        var title = (typeof obj === 'string') ? '' : (obj.title || '');
        var text = (typeof obj === 'string') ? escapeHtml(href) : (obj.text || escapeHtml(href));
        if (!href) return text;
        if (isLocalFileLinkHref(href)) {
            return '<button class="local-file-link" type="button" data-local-file-action="reveal"'
                + ' data-local-file-path="' + escapeAttr(href) + '"'
                + ' aria-label="' + escapeAttr(href) + '"'
                + (title ? ' title="' + escapeAttr(title) + '"' : '')
                + '>' + text + '</button>';
        }
        if (!isSafeLinkHref(href)) return text;

        var externalAttrs = isExternalLinkHref(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
        return '<a href="' + escapeAttr(href) + '"'
            + (title ? ' title="' + escapeAttr(title) + '"' : '')
            + externalAttrs + '>' + text + '</a>';
    };

    markedApi.setOptions({
        renderer: markedRenderer,
        gfm: true,
        breaks: true,
    });
}
