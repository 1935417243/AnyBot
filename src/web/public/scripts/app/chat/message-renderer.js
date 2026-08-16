import { escapeHtml } from '../utils/html.js';
import { enhanceLocalFileLinks } from './local-file-links.js';
import {
    createMessageFileRefs,
    createMessageProjectRefs,
    createMessageSkillRefs,
    getSelectionFallbackText,
    isSelectionOnlyFallback,
    normalizeMessageFileReferences,
    normalizeMessageProjects,
    normalizeMessageSkills,
} from './message-selection.js';

export function createMessageRenderer(config) {
    var USER_MESSAGE_COLLAPSE_LINES = 9;
    var USER_MESSAGE_COLLAPSE_CHARS = 500;

    function clearEmpty() {
        if (config.chatViewEl) config.chatViewEl.classList.remove('chat-view--home');
        if (config.homeHeroEl) config.homeHeroEl.hidden = true;
    }

    function renderAssistantText(content, text) {
        var fullText = String(text || '');
        try {
            content.innerHTML = config.renderMarkdown(fullText);
        } catch (e) {
            content.textContent = fullText;
        }
        enhanceLocalFileLinks(content);
    }

    function showEmptyState() {
        config.messagesEl.innerHTML = '';
        if (config.chatViewEl) config.chatViewEl.classList.add('chat-view--home');
        if (config.homeHeroEl) config.homeHeroEl.hidden = false;
        if (config.onShowHome) config.onShowHome();
    }

    function appendMessage(role, text, attachments, changeReview, opts) {
        opts = opts || {};
        clearEmpty();
        var row = document.createElement('div');
        row.className = 'message-row ' + role;
        var messageSkills = role === 'user' ? normalizeMessageSkills(opts.skills) : [];
        var messageProjects = role === 'user' ? normalizeMessageProjects(opts.projects) : [];
        var messageFileReferences = role === 'user' ? normalizeMessageFileReferences(opts.fileReferences) : [];
        var rawText = String(text || '');
        var visibleText = isSelectionOnlyFallback(rawText, messageSkills, messageProjects, messageFileReferences) ? '' : rawText;

        if (role === 'ai') {
            row.appendChild(createAssistantBubble(text, changeReview, opts));
        } else {
            row.appendChild(createUserBubble(visibleText, attachments, opts, messageSkills, messageProjects, messageFileReferences));
        }

        config.attachMessageMeta(row, {
            createdAt: opts.createdAt,
            copyText: role === 'user' && (messageSkills.length > 0 || messageProjects.length > 0 || messageFileReferences.length > 0)
                ? (visibleText ? getSelectionFallbackText(messageSkills, messageProjects, messageFileReferences) + '\n' + visibleText : getSelectionFallbackText(messageSkills, messageProjects, messageFileReferences))
                : rawText,
        });
        config.messagesEl.appendChild(row);
        config.scrollBottom();
        return row;
    }

    function appendContextCompactDivider(text, opts) {
        opts = opts || {};
        clearEmpty();
        var row = createContextCompactDivider(text, opts);
        config.messagesEl.appendChild(row);
        config.scrollBottom();
        return row;
    }

    function appendContextCompactProgress(opts) {
        opts = opts || {};
        clearEmpty();
        var view = createContextCompactProgress(opts);
        config.messagesEl.appendChild(view.row);
        config.scrollBottom();
        return view;
    }

    function createContextCompactDivider(text, opts) {
        opts = opts || {};
        var row = document.createElement('div');
        row.className = 'message-row context-compact-divider';
        var label = String(text || '上下文已压缩').trim() || '上下文已压缩';
        row.innerHTML =
            getContextCompactDividerHtml(label);
        if (opts.createdAt) {
            config.attachMessageMeta(row, {
                createdAt: opts.createdAt,
                copyText: label,
            });
        }
        return row;
    }

    function createContextCompactProgress(opts) {
        var startedAt = opts.startedAt || Date.now();
        var label = String(opts.label || '正在压缩上下文').trim() || '正在压缩上下文';
        var row = document.createElement('div');
        row.className = 'message-row context-compact-progress is-running';
        row.innerHTML =
            '<div class="context-compact-progress-status" data-role="status">处理中 0s</div>' +
            '<div class="context-compact-progress-rule"></div>' +
            '<div class="context-compact-progress-divider">' +
            getContextCompactDividerHtml(label) +
            '</div>';

        var statusEl = row.querySelector('[data-role="status"]');
        var labelEl = row.querySelector('.context-compact-divider-label span');
        var timer = setInterval(function () {
            updateStatus('处理中');
        }, 1000);

        function elapsedMs() {
            return Math.max(0, Date.now() - startedAt);
        }

        function updateStatus(prefix) {
            if (!statusEl) return;
            statusEl.textContent = prefix + ' ' + formatCompactDuration(elapsedMs());
        }

        function updateLabel(nextLabel) {
            if (!labelEl) return;
            labelEl.textContent = String(nextLabel || '').trim() || label;
        }

        function finish(className, statusPrefix, nextLabel) {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            row.classList.remove('is-running', 'is-complete', 'is-cancelled', 'is-failed');
            row.classList.add(className);
            updateStatus(statusPrefix);
            updateLabel(nextLabel);
            config.scrollBottom();
        }

        return {
            row: row,
            complete: function (nextLabel, completeOpts) {
                completeOpts = completeOpts || {};
                finish('is-complete', '已处理', nextLabel || '上下文已压缩');
                if (completeOpts.messageId) row.dataset.messageId = String(completeOpts.messageId);
            },
            cancel: function (nextLabel) {
                finish('is-cancelled', '已停止', nextLabel || '压缩已停止');
            },
            fail: function (nextLabel) {
                finish('is-failed', '处理失败', nextLabel || '压缩失败');
            },
            remove: function () {
                if (timer) clearInterval(timer);
                row.remove();
            },
        };
    }

    function getContextCompactDividerHtml(label) {
        return '' +
            '<div class="context-compact-divider-line"></div>' +
            '<div class="context-compact-divider-label">' +
            '<svg class="context-compact-divider-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
            '<path d="M5 2.5h5l2.5 2.5v8.5H5V2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
            '<path d="M10 2.5V5h2.5M3.5 5.5v8h7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>' +
            '<span>' + escapeHtml(label) + '</span>' +
            '</div>' +
            '<div class="context-compact-divider-line"></div>';
    }

    function formatCompactDuration(ms) {
        var seconds = Math.max(0, Math.round(ms / 1000));
        var mins = Math.floor(seconds / 60);
        var secs = seconds % 60;
        return mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';
    }

    function createAssistantBubble(text, changeReview, opts) {
        var bubble = document.createElement('div');
        bubble.className = 'bubble';

        var avatar = document.createElement('div');
        avatar.className = 'avatar ai-avatar';
        avatar.textContent = 'Ab';

        var content = document.createElement('div');
        content.className = 'message-content';
        renderAssistantText(content, text);
        if (changeReview && window.ChangeReview) {
            var reviewCard = window.ChangeReview.render({
                review: changeReview,
                scrollBottom: config.scrollBottom,
            });
            if (reviewCard) content.appendChild(reviewCard);
        }

        bubble.appendChild(avatar);
        bubble.appendChild(content);
        return bubble;
    }

    function createUserBubble(visibleText, attachments, opts, messageSkills, messageProjects, messageFileReferences) {
        var bubble = document.createElement('div');
        bubble.className = 'bubble';

        var content = document.createElement('div');
        content.className = 'message-content';
        var userLine = createUserMessageLine(visibleText, opts, messageSkills, messageProjects, messageFileReferences);
        if (userLine) content.appendChild(userLine.line);
        appendAttachments(content, attachments);
        setupUserMessageCollapse(content, userLine ? userLine.textEl : null, visibleText, opts);

        bubble.appendChild(content);
        return bubble;
    }

    function createUserMessageLine(visibleText, opts, messageSkills, messageProjects, messageFileReferences) {
        var userLine = document.createElement('div');
        userLine.className = 'message-user-line';
        if (messageSkills.length > 0) {
            userLine.appendChild(createMessageSkillRefs(messageSkills));
        }
        if (messageProjects.length > 0) {
            userLine.appendChild(createMessageProjectRefs(messageProjects));
        }
        if (messageFileReferences.length > 0) {
            userLine.appendChild(createMessageFileRefs(messageFileReferences));
        }

        var userText = document.createElement('span');
        userText.className = 'message-user-text';
        userText.textContent = visibleText;
        if (visibleText || (opts && opts.contentTruncated && opts.messageId)) {
            userLine.appendChild(userText);
        }
        if (userLine.childNodes.length === 0) return null;
        return { line: userLine, textEl: userText };
    }

    function setupUserMessageCollapse(content, userText, visibleText, opts) {
        if (!userText) return;

        var shouldCollapse = !!(opts && opts.contentTruncated && opts.messageId)
            || shouldCollapseUserMessageByText(visibleText);
        if (shouldCollapse) {
            activateUserMessageCollapse(content, userText, opts);
            return;
        }

        requestUserMessageLayoutCheck(function () {
            if (!content.isConnected || userText.classList.contains('user-message-collapsible')) return;
            if (shouldCollapseUserMessageByLayout(userText)) {
                activateUserMessageCollapse(content, userText, opts);
            }
        });
    }

    function shouldCollapseUserMessageByText(text) {
        var value = String(text || '');
        if (!value) return false;
        if (Array.from(value).length > USER_MESSAGE_COLLAPSE_CHARS) return true;
        return value.split(/\r\n|\r|\n/).length > USER_MESSAGE_COLLAPSE_LINES;
    }

    function requestUserMessageLayoutCheck(callback) {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(callback);
            return;
        }
        setTimeout(callback, 0);
    }

    function shouldCollapseUserMessageByLayout(userText) {
        var style = window.getComputedStyle(userText);
        var lineHeight = parseFloat(style.lineHeight);
        if (!Number.isFinite(lineHeight)) {
            var fontSize = parseFloat(style.fontSize);
            lineHeight = Number.isFinite(fontSize) ? fontSize * 1.65 : 23;
        }
        return userText.scrollHeight > Math.ceil(lineHeight * USER_MESSAGE_COLLAPSE_LINES) + 1;
    }

    function activateUserMessageCollapse(content, userText, opts) {
        var fullContentLoaded = !(opts && opts.contentTruncated && opts.messageId);
        var toggle = document.createElement('button');
        toggle.className = 'user-message-toggle';
        toggle.type = 'button';
        toggle.textContent = '展开';
        toggle.setAttribute('aria-expanded', 'false');

        userText.classList.add('user-message-collapsible', 'is-collapsed');

        toggle.addEventListener('click', async function () {
            if (userText.classList.contains('is-collapsed')) {
                if (!fullContentLoaded) {
                    toggle.disabled = true;
                    toggle.textContent = '加载中...';
                    try {
                        userText.textContent = await config.fetchFullMessageContent(opts.messageId);
                        fullContentLoaded = true;
                    } catch (e) {
                        config.showError(e.message || '加载完整内容失败');
                        toggle.disabled = false;
                        toggle.textContent = '展开';
                        return;
                    }
                    toggle.disabled = false;
                }
                userText.classList.remove('is-collapsed');
                toggle.textContent = '收起';
                toggle.setAttribute('aria-expanded', 'true');
                return;
            }

            userText.classList.add('is-collapsed');
            toggle.textContent = '展开';
            toggle.setAttribute('aria-expanded', 'false');
        });

        content.appendChild(toggle);
    }

    function appendAttachments(content, attachments) {
        if (!attachments || attachments.length === 0) return;

        var attDiv = document.createElement('div');
        attDiv.className = 'message-attachments';
        attachments.forEach(function (att) {
            attDiv.appendChild(createAttachmentNode(att));
        });
        content.appendChild(attDiv);
    }

    function createAttachmentNode(att) {
        var name = (typeof att === 'string') ? att : att.name;
        var attPath = (typeof att === 'string') ? null : att.path;
        var isImg = config.imageExts.some(function (ext) { return name.toLowerCase().endsWith(ext); });

        if (isImg && attPath) {
            var imgSrc = '/api/local-file?path=' + encodeURIComponent(attPath);
            var img = document.createElement('img');
            img.className = 'chat-image user-attachment-image';
            img.src = imgSrc;
            img.alt = name;
            img.onclick = function () { config.openImageModal(imgSrc); };
            return img;
        }

        var tag = document.createElement('span');
        tag.className = 'message-attachment-tag';
        tag.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M14 8.5l-5.5 5.5a3.5 3.5 0 01-5-5L9 3.5a2 2 0 013 3L6.5 12a.5.5 0 01-.7-.7L11 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> ' + escapeHtml(name);
        return tag;
    }

    return {
        appendContextCompactDivider: appendContextCompactDivider,
        appendContextCompactProgress: appendContextCompactProgress,
        appendMessage: appendMessage,
        clearEmpty: clearEmpty,
        renderAssistantText: renderAssistantText,
        showEmptyState: showEmptyState,
    };
}
