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

// 支持预览卡片的代码块语言及默认标题
var PREVIEW_LANGS = { html: 'HTML 预览', mermaid: 'Mermaid 图表', svg: 'SVG 图像' };

// 水合完成前预览区的占位文案
var PREVIEW_LOADING_TEXT = { html: '预览加载中…', mermaid: '图表渲染中…', svg: '图像渲染中…' };

// 从 HTML 源码中提取 <title> 作为卡片标题
function extractHtmlTitle(code) {
    var match = /<title[^>]*>([^<]*)<\/title>/i.exec(code);
    return match ? match[1].trim() : '';
}

// 生成预览卡片骨架：只含安全占位结构，iframe/图像在水合阶段注入
// 默认预览态（无 show-code），水合前显示「渲染中…」占位，避免先闪代码再切换
function buildPreviewCard(lang, code) {
    var title = lang === 'html' ? (extractHtmlTitle(code) || PREVIEW_LANGS[lang]) : PREVIEW_LANGS[lang];
    return '<div class="code-preview-card" data-code-lang="' + escapeAttr(lang) + '">'
        + '<div class="code-preview-header">'
        + '<button class="code-preview-toggle" type="button" aria-expanded="true" title="折叠/展开">'
        + '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        + '</button>'
        + '<span class="code-preview-title">' + escapeHtml(title) + '</span>'
        + '<div class="code-preview-actions">'
        + '<button class="code-preview-menu-btn" type="button" aria-haspopup="true" aria-expanded="false" title="更多操作">'
        + '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="3" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="13" cy="8" r="1.3" fill="currentColor"/></svg>'
        + '</button>'
        + '<div class="code-preview-menu" role="menu">'
        + '<button class="code-preview-option" type="button" role="menuitem" data-action="toggle-view">查看预览</button>'
        + '<button class="code-preview-option" type="button" role="menuitem" data-action="copy">复制代码</button>'
        + '<button class="code-preview-option" type="button" role="menuitem" data-action="download">下载</button>'
        // 保存为图片仅 mermaid 图表提供：把渲染出的 SVG 栅格化为 PNG
        + (lang === 'mermaid' ? '<button class="code-preview-option" type="button" role="menuitem" data-action="save-image">保存为图片</button>' : '')
        + '</div>'
        + '</div>'
        + '</div>'
        + '<div class="code-preview-body">'
        + '<div class="code-preview-stage"><div class="code-preview-loading">' + escapeHtml(PREVIEW_LOADING_TEXT[lang] || '渲染中…') + '</div></div>'
        + '<pre class="code-preview-source"><code class="hljs language-' + escapeAttr(lang) + '">' + escapeHtml(code) + '</code></pre>'
        + '</div>'
        + '</div>';
}

export function configureMarkdown() {
    var markedApi = getMarked();
    if (!markedApi) return;

    var markedRenderer = new markedApi.Renderer();
    markedRenderer.html = function (obj) {
        var html = (typeof obj === 'string') ? obj : (obj.raw || obj.text || '');
        return escapeHtml(String(html || ''));
    };

    // marked 12 的 Renderer.code 仍是字符串签名 (code, infostring, escaped)，同时兼容对象签名
    markedRenderer.code = function (obj, infostring) {
        var code = (typeof obj === 'string') ? obj : (obj.text || '');
        var rawLang = (typeof obj === 'string') ? String(infostring || '') : (obj.lang || '');
        // infostring 可能带围栏附加信息（如 ```java {1,2}），只取第一个词作为语言
        var lang = rawLang.trim().split(/\s+/)[0] || '';
        // 流式期间 lang 可能是半截单词，精确匹配才会升级为预览卡片
        var previewLang = lang && PREVIEW_LANGS[lang.toLowerCase()] ? lang.toLowerCase() : '';
        if (previewLang) return buildPreviewCard(previewLang, code);

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
