import { escapeHtml } from '../utils/html.js';
import { isMacPlatform } from '../utils/platform.js';

// 输入停顿多久后发起搜索请求
var SEARCH_DEBOUNCE_MS = 180;
// 单次搜索返回的最多结果数
var SEARCH_RESULT_LIMIT = 20;
// 关键词为空时展示的最近会话数
var RECENT_SESSION_LIMIT = 8;
// 关闭动画时长，与 session-search.css 的过渡时间一致
var CLOSE_ANIMATION_MS = 160;

// 转义正则特殊字符，用于构造关键词高亮的匹配表达式
function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 转义 HTML 后用 <mark> 包裹关键词（忽略大小写）
function highlightText(text, keyword) {
    var source = String(text || '');
    if (!keyword) return escapeHtml(source);
    var pattern = new RegExp(escapeRegExp(keyword), 'gi');
    var html = '';
    var lastIndex = 0;
    var match;
    while ((match = pattern.exec(source))) {
        html += escapeHtml(source.slice(lastIndex, match.index)) + '<mark>' + escapeHtml(match[0]) + '</mark>';
        lastIndex = match.index + match[0].length;
    }
    return html + escapeHtml(source.slice(lastIndex));
}

// 结果时间：今天显示时分，今年显示月日，更早显示年月日
function formatSessionTime(ts) {
    var value = Number(ts || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    var date = new Date(value);
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    if (date.toDateString() === now.toDateString()) {
        return pad(date.getHours()) + ':' + pad(date.getMinutes());
    }
    if (date.getFullYear() === now.getFullYear()) {
        return (date.getMonth() + 1) + '月' + date.getDate() + '日';
    }
    return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate();
}

// 会话搜索弹窗：按标题与消息内容搜索会话，关键词为空时展示最近会话
export function createSessionSearchController(options) {
    var documentRef = options.documentRef || document;
    var triggerBtn = options.triggerBtn;
    // 是否使用 ⌘K（macOS）作为快捷键，否则使用 Ctrl+K
    var isMac = isMacPlatform(documentRef);
    // 弹窗遮罩元素，未打开时为 null
    var overlay = null;
    // 搜索输入框
    var inputEl = null;
    // 结果列表容器
    var resultsEl = null;
    // 当前展示的会话列表
    var items = [];
    // 键盘选中项下标
    var activeIndex = -1;
    // 输入防抖定时器
    var debounceTimer = null;
    // 请求序号，用于丢弃过期的搜索响应
    var requestSeq = 0;
    // 打开弹窗前的焦点元素，取消搜索时还原
    var previousFocus = null;

    // 弹窗是否处于打开状态
    function isOpen() {
        return !!overlay;
    }

    // 根据项目 ID 取项目名，未归属项目的会话显示「默认工作区」
    function getProjectName(projectId) {
        if (!projectId) return '默认工作区';
        var projects = options.getProjects ? options.getProjects() : [];
        var project = (projects || []).find(function (p) { return p.id === projectId; });
        return project ? project.name : '项目';
    }

    // 同步键盘选中项的高亮，并保证选中项在可视区域内
    function updateActive() {
        if (!resultsEl) return;
        var nodes = resultsEl.querySelectorAll('.session-search-item');
        nodes.forEach(function (node, i) {
            var active = i === activeIndex;
            node.classList.toggle('active', active);
            node.setAttribute('aria-selected', String(active));
            if (active) node.scrollIntoView({ block: 'nearest' });
        });
    }

    // 设置键盘选中项
    function setActive(index) {
        if (index === activeIndex) return;
        activeIndex = index;
        updateActive();
    }

    // 渲染会话列表；list 为空时展示 emptyText
    function renderList(list, keyword, label, emptyText) {
        if (!resultsEl) return;
        items = list;
        activeIndex = list.length ? 0 : -1;
        resultsEl.innerHTML = '';
        if (!list.length) {
            var empty = documentRef.createElement('div');
            empty.className = 'session-search-empty';
            empty.textContent = emptyText;
            resultsEl.appendChild(empty);
            return;
        }
        if (label) {
            var labelEl = documentRef.createElement('div');
            labelEl.className = 'session-search-label';
            labelEl.textContent = label;
            resultsEl.appendChild(labelEl);
        }
        list.forEach(function (item, i) {
            var btn = documentRef.createElement('button');
            btn.type = 'button';
            btn.className = 'session-search-item';
            btn.setAttribute('role', 'option');
            var meta = getProjectName(item.projectId);
            var time = formatSessionTime(item.updatedAt || item.createdAt);
            if (time) meta += ' · ' + time;
            btn.innerHTML = '<div class="session-search-item-head">'
                + '<span class="session-search-item-title">' + highlightText(item.title || '新对话', keyword) + '</span>'
                + '<span class="session-search-item-meta">' + escapeHtml(meta) + '</span>'
                + '</div>'
                + (item.snippet ? '<div class="session-search-item-snippet">' + highlightText(item.snippet, keyword) + '</div>' : '');
            // 用 mousemove 而非 mouseenter：键盘滚动列表时鼠标静止不应抢走选中项
            btn.addEventListener('mousemove', function () {
                setActive(i);
            });
            btn.addEventListener('click', function () {
                openItem(i);
            });
            resultsEl.appendChild(btn);
        });
        updateActive();
    }

    // 关键词为空时展示侧边栏已加载的最近会话
    function renderRecent() {
        var sessions = options.getRecentSessions ? options.getRecentSessions() : [];
        var recent = (sessions || []).slice().sort(function (a, b) {
            return Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0);
        }).slice(0, RECENT_SESSION_LIMIT);
        renderList(recent, '', '最近会话', '暂无会话');
    }

    // 向后端搜索会话，只渲染最新一次请求的结果
    async function runSearch(keyword) {
        var seq = ++requestSeq;
        try {
            var res = await fetch('/api/sessions/search?q=' + encodeURIComponent(keyword) + '&limit=' + SEARCH_RESULT_LIMIT);
            var data = await res.json().catch(function () { return {}; });
            if (seq !== requestSeq || !overlay) return;
            if (!res.ok) throw new Error(data.error || '搜索失败');
            renderList(Array.isArray(data.items) ? data.items : [], keyword, '搜索结果', '没有找到相关会话');
        } catch (e) {
            if (seq !== requestSeq || !overlay) return;
            renderList([], keyword, '', (e && e.message) || '搜索失败');
        }
    }

    // 输入变化：清空时回到最近会话，否则防抖后搜索
    function handleInput() {
        var keyword = inputEl ? inputEl.value.trim() : '';
        clearTimeout(debounceTimer);
        if (!keyword) {
            requestSeq++;
            renderRecent();
            return;
        }
        debounceTimer = setTimeout(function () {
            runSearch(keyword);
        }, SEARCH_DEBOUNCE_MS);
    }

    // 打开选中会话并关闭弹窗
    function openItem(index) {
        var item = items[index];
        if (!item) return;
        close({ restoreFocus: false });
        if (options.openSession) options.openSession(item.id);
    }

    // 弹窗内键盘操作：Esc 关闭，↑/↓ 切换选中，Enter 打开；阻止冒泡避免触发页面级快捷键（如设置页 Esc 关闭）
    function handleKeydown(e) {
        if (e.isComposing) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (!items.length) return;
            var step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((activeIndex + step + items.length) % items.length);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            openItem(activeIndex);
        }
    }

    // 创建弹窗 DOM 并展示最近会话
    function open() {
        if (overlay) {
            inputEl.focus();
            inputEl.select();
            return;
        }
        previousFocus = documentRef.activeElement;
        overlay = documentRef.createElement('div');
        overlay.className = 'session-search-overlay';
        overlay.innerHTML = '<div class="session-search-dialog" role="dialog" aria-modal="true" aria-label="搜索会话">'
            + '<div class="session-search-input-row">'
            + '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">'
            + '<circle cx="6.6" cy="6.6" r="4.6" stroke="currentColor" stroke-width="1.2"/>'
            + '<path d="M10 10l3.2 3.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
            + '</svg>'
            + '<input class="session-search-input" type="text" placeholder="搜索会话标题或消息内容" autocomplete="off" spellcheck="false">'
            + '<span class="session-search-kbd">Esc</span>'
            + '</div>'
            + '<div class="session-search-results" role="listbox"></div>'
            + '</div>';
        inputEl = overlay.querySelector('.session-search-input');
        resultsEl = overlay.querySelector('.session-search-results');
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });
        overlay.addEventListener('keydown', handleKeydown);
        inputEl.addEventListener('input', handleInput);
        documentRef.body.appendChild(overlay);
        renderRecent();
        requestAnimationFrame(function () {
            if (overlay) overlay.classList.add('open');
        });
        inputEl.focus();
    }

    // 关闭弹窗；restoreFocus 为 false 时不还原焦点（打开会话后由会话自己聚焦输入框）
    function close(closeOptions) {
        if (!overlay) return;
        closeOptions = closeOptions || {};
        clearTimeout(debounceTimer);
        requestSeq++;
        var closingOverlay = overlay;
        overlay = null;
        inputEl = null;
        resultsEl = null;
        items = [];
        activeIndex = -1;
        closingOverlay.classList.remove('open');
        setTimeout(function () {
            closingOverlay.remove();
        }, CLOSE_ANIMATION_MS);
        if (closeOptions.restoreFocus !== false && previousFocus && previousFocus.focus) {
            previousFocus.focus();
        }
        previousFocus = null;
    }

    // 全局快捷键 ⌘K / Ctrl+K：切换弹窗
    function handleDocumentKeydown(e) {
        if (e.defaultPrevented || e.isComposing) return;
        var modifier = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
        if (!modifier || e.altKey || e.shiftKey || e.code !== 'KeyK') return;
        e.preventDefault();
        if (isOpen()) close();
        else open();
    }

    // 绑定搜索按钮与全局快捷键
    function bind() {
        if (triggerBtn) {
            triggerBtn.dataset.titlebarShortcut = isMac ? '⌘ K' : 'Ctrl K';
            triggerBtn.addEventListener('click', function () {
                open();
            });
        }
        documentRef.addEventListener('keydown', handleDocumentKeydown);
    }

    return {
        bind: bind,
        close: close,
        isOpen: isOpen,
        open: open,
    };
}
