import { escapeHtml } from '../utils/html.js';
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
    function clearEmpty() {
        var empty = document.getElementById('empty-state');
        if (empty) empty.remove();
    }

    function renderAssistantText(content, text, opts) {
        opts = opts || {};
        var fullText = String(text || '');
        var renderText = fullText;
        var isLarge = opts.contentTruncated || fullText.length > config.largeMessagePreviewChars;
        if (isLarge) {
            renderText = opts.contentTruncated
                ? fullText
                : fullText.slice(0, config.largeMessagePreviewChars) + '\n\n...[内容较长，已折叠]';
        }
        try {
            content.innerHTML = config.renderMarkdown(renderText);
        } catch (e) {
            content.textContent = renderText;
        }
        if (!isLarge) return;

        var expand = document.createElement('button');
        expand.className = 'large-message-expand';
        expand.type = 'button';
        expand.textContent = opts.contentChars ? ('展开完整内容（' + config.formatTokenCount(opts.contentChars) + ' 字符）') : '展开完整内容';
        expand.addEventListener('click', async function () {
            expand.disabled = true;
            expand.textContent = '加载中...';
            var nextText = fullText;
            if (opts.contentTruncated && opts.messageId) {
                try {
                    nextText = await config.fetchFullMessageContent(opts.messageId);
                } catch (e) {
                    config.showError(e.message || '加载完整内容失败');
                    expand.disabled = false;
                    expand.textContent = '展开完整内容';
                    return;
                }
            }
            try {
                content.innerHTML = config.renderMarkdown(nextText);
            } catch (e) {
                content.textContent = nextText;
            }
        });
        content.appendChild(expand);
    }

    function showEmptyState() {
        config.messagesEl.innerHTML =
            config.conversationHeaderHtml() +
            '<div id="empty-state">' +
            '<div class="empty-icon">Ab</div>' +
            '<div class="empty-title">AnyBot 已就绪</div>' +
            '<div class="empty-sub">输入你的需求，我来帮你处理</div>' +
            '</div>';
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
        renderAssistantText(content, text, opts);
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
        if (opts && opts.contentTruncated && opts.messageId) {
            content.appendChild(createUserExpandButton(userLine ? userLine.textEl : null, opts));
        }
        appendAttachments(content, attachments);

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

    function createUserExpandButton(userText, opts) {
        var userExpand = document.createElement('button');
        userExpand.className = 'large-message-expand';
        userExpand.type = 'button';
        userExpand.textContent = opts.contentChars ? ('展开完整内容（' + config.formatTokenCount(opts.contentChars) + ' 字符）') : '展开完整内容';
        userExpand.addEventListener('click', async function () {
            userExpand.disabled = true;
            userExpand.textContent = '加载中...';
            try {
                if (userText) userText.textContent = await config.fetchFullMessageContent(opts.messageId);
                userExpand.remove();
            } catch (e) {
                config.showError(e.message || '加载完整内容失败');
                userExpand.disabled = false;
                userExpand.textContent = '展开完整内容';
            }
        });
        return userExpand;
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
