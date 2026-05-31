import { createMessageRenderer } from './message-renderer.js';
import { escapeAttr, escapeHtml } from '../utils/html.js';

export function createMessageListController(config) {
    var BOTTOM_THRESHOLD_PX = 64;
    var messagesEl = config.messagesEl;
    var currentConversationTitle = '新对话';
    var isBatchRenderingMessages = false;
    var currentSessionHasMoreMessages = false;
    var isLoadingOlderMessages = false;
    var autoFollowMessages = true;
    var returnToBottomBtn = null;

    var messageRenderer = createMessageRenderer({
        messagesEl: messagesEl,
        conversationHeaderHtml: conversationHeaderHtml,
        largeMessagePreviewChars: config.largeMessagePreviewChars,
        imageExts: config.imageExts,
        renderMarkdown: config.renderMarkdown,
        formatTokenCount: config.formatTokenCount,
        fetchFullMessageContent: fetchFullMessageContent,
        showError: config.showError,
        openImageModal: config.openImageModal,
        attachMessageMeta: config.attachMessageMeta,
        scrollBottom: scrollBottom,
    });

    function bindMessageListEvents() {
        messagesEl.addEventListener('click', function (e) {
            var copyButton = e.target && e.target.closest ? e.target.closest('.code-copy') : null;
            if (copyButton && messagesEl.contains(copyButton)) {
                config.copyCode(copyButton);
                return;
            }

            var target = e.target && e.target.closest ? e.target.closest('.chat-image') : null;
            if (target && messagesEl.contains(target)) {
                config.openImageModal(target.src);
            }
        });

        messagesEl.addEventListener('scroll', function () {
            if (isBatchRenderingMessages) return;
            if (isNearBottom()) {
                autoFollowMessages = true;
            } else {
                autoFollowMessages = false;
            }
            updateReturnToBottomVisibility();
        }, { passive: true });
    }

    function ensureReturnToBottomControl() {
        if (!returnToBottomBtn) {
            returnToBottomBtn = document.createElement('button');
            returnToBottomBtn.id = 'return-to-bottom';
            returnToBottomBtn.className = 'return-to-bottom';
            returnToBottomBtn.type = 'button';
            returnToBottomBtn.hidden = true;
            returnToBottomBtn.textContent = '↓ 回到底部';
            returnToBottomBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                scrollBottom({ force: true });
            });
        }
        if (!messagesEl.contains(returnToBottomBtn) || messagesEl.lastElementChild !== returnToBottomBtn) {
            messagesEl.appendChild(returnToBottomBtn);
        }
        return returnToBottomBtn;
    }

    function isNearBottom() {
        var distance = messagesEl.scrollHeight - messagesEl.clientHeight - messagesEl.scrollTop;
        return distance <= BOTTOM_THRESHOLD_PX;
    }

    function updateReturnToBottomVisibility() {
        var btn = ensureReturnToBottomControl();
        btn.hidden = autoFollowMessages || isNearBottom();
    }

    function scrollBottom(opts) {
        opts = opts || {};
        if (isBatchRenderingMessages) return;
        ensureReturnToBottomControl();
        if (opts.force) autoFollowMessages = true;
        if (!autoFollowMessages && !isNearBottom()) {
            updateReturnToBottomVisibility();
            return;
        }
        autoFollowMessages = true;
        messagesEl.scrollTop = messagesEl.scrollHeight;
        updateReturnToBottomVisibility();
    }

    function clearEmpty() {
        messageRenderer.clearEmpty();
    }

    function normalizeConversationTitle(title) {
        var value = String(title || '').trim();
        return value || '新对话';
    }

    function conversationHeaderHtml() {
        return '' +
            '<header class="conversation-header" aria-label="当前会话">' +
            '<div class="conversation-header-inner">' +
            '<div id="conversation-title" class="conversation-title" title="' + escapeAttr(currentConversationTitle) + '">' +
            escapeHtml(currentConversationTitle) +
            '</div>' +
            '</div>' +
            '</header>';
    }

    function ensureConversationHeader() {
        if (document.getElementById('conversation-title')) return;
        messagesEl.insertAdjacentHTML('afterbegin', conversationHeaderHtml());
    }

    function updateConversationHeaderTitle(title) {
        currentConversationTitle = normalizeConversationTitle(title);
        ensureConversationHeader();
        var titleEl = document.getElementById('conversation-title');
        if (!titleEl) return;
        titleEl.textContent = currentConversationTitle;
        titleEl.title = currentConversationTitle;
    }

    function getFirstMessageContentNode() {
        for (var i = 0; i < messagesEl.children.length; i++) {
            var child = messagesEl.children[i];
            if (!child.classList.contains('conversation-header')) return child;
        }
        return null;
    }

    async function fetchFullMessageContent(messageId) {
        var sessionId = config.getCurrentSessionId();
        if (!sessionId || !messageId) throw new Error('无法加载完整内容');
        var res = await fetch('/api/sessions/' + sessionId + '/messages/' + encodeURIComponent(messageId) + '/content');
        if (!res.ok) throw new Error('加载完整内容失败');
        var data = await res.json();
        return data.content || '';
    }

    function showEmptyState() {
        currentSessionHasMoreMessages = false;
        isLoadingOlderMessages = false;
        autoFollowMessages = true;
        messageRenderer.showEmptyState();
        scrollBottom({ force: true });
    }

    function appendMessage(role, text, attachments, changeReview, opts) {
        return messageRenderer.appendMessage(role, text, attachments, changeReview, opts);
    }

    function appendContextCompactDivider(text, opts) {
        var row = messageRenderer.appendContextCompactDivider(text, opts);
        if (row && opts && opts.messageId) row.dataset.messageId = String(opts.messageId);
        return row;
    }

    function appendContextCompactProgress(opts) {
        return messageRenderer.appendContextCompactProgress(opts);
    }

    function getOldestRenderedMessageId() {
        var first = messagesEl.querySelector('.message-row[data-message-id]');
        return first ? Number(first.dataset.messageId || 0) : null;
    }

    function getNewestRenderedMessageId() {
        var newest = 0;
        messagesEl.querySelectorAll('.message-row[data-message-id]').forEach(function (row) {
            var id = Number(row.dataset.messageId || 0);
            if (id > newest) newest = id;
        });
        return newest;
    }

    function getNewestMessageId(messages) {
        return (messages || []).reduce(function (newest, message) {
            var id = Number(message && message.id || 0);
            return id > newest ? id : newest;
        }, 0);
    }

    function removeOlderMessagesControl() {
        var existing = document.getElementById('load-older-messages');
        if (existing) existing.remove();
    }

    function renderOlderMessagesControl() {
        removeOlderMessagesControl();
        if (!currentSessionHasMoreMessages) return;
        var btn = document.createElement('button');
        btn.id = 'load-older-messages';
        btn.className = 'load-older-messages';
        btn.type = 'button';
        btn.textContent = isLoadingOlderMessages ? '加载中...' : '加载更早消息';
        btn.disabled = isLoadingOlderMessages;
        btn.addEventListener('click', loadOlderMessages);
        messagesEl.insertBefore(btn, getFirstMessageContentNode());
    }

    function renderMessageRecord(m, beforeNode) {
        var row = null;
        var attInfo = null;
        var meta = parseMessageMetadata(m.metadata);
        if (meta.attachments && meta.attachments.length > 0) {
            attInfo = meta.attachments;
        }
        if (m.role === 'assistant' && meta.contextCompact) {
            row = appendContextCompactDivider(m.content, {
                messageId: m.id,
                createdAt: m.createdAt,
            });
            if (meta.contextCompact.contextUsage) config.updateContextUsage(meta.contextCompact.contextUsage);
        } else if (m.role === 'assistant' && meta.claudeAgentLoop && window.ClaudeAgentLoop && window.ClaudeAgentLoop.renderPersistedMessage) {
            clearEmpty();
            var view = window.ClaudeAgentLoop.renderPersistedMessage({
                messagesEl: messagesEl,
                scrollBottom: scrollBottom,
                content: m.content,
                loop: meta.claudeAgentLoop,
                changeReview: meta.changeReview,
                contentTruncated: !!m.contentTruncated,
                contentChars: m.contentChars,
                createdAt: m.createdAt,
                fullContentLoader: m.contentTruncated
                    ? function () { return fetchFullMessageContent(m.id); }
                    : null,
            });
            row = view && view.row;
            var usageEvents = Array.isArray(meta.claudeAgentLoop.events)
                ? meta.claudeAgentLoop.events.filter(function (event) { return event && event.type === 'context_usage' && event.usage; })
                : [];
            if (usageEvents.length > 0) config.updateContextUsage(usageEvents[usageEvents.length - 1].usage);
        } else {
            row = appendMessage(m.role === 'user' ? 'user' : 'ai', m.content, attInfo, meta.changeReview, {
                messageId: m.id,
                contentTruncated: !!m.contentTruncated,
                contentChars: m.contentChars,
                createdAt: m.createdAt,
                fileReferences: meta.fileReferences,
                skills: meta.skills,
                projects: meta.projects,
            });
        }
        if (row) {
            row.dataset.messageId = String(m.id);
            if (beforeNode && row !== beforeNode) messagesEl.insertBefore(row, beforeNode);
        }
        return row;
    }

    function renderSessionMessages(messages, hasMoreMessages) {
        currentSessionHasMoreMessages = !!hasMoreMessages;
        isLoadingOlderMessages = false;
        messagesEl.innerHTML = '';
        ensureConversationHeader();
        isBatchRenderingMessages = true;
        try {
            if (!messages || messages.length === 0) {
                messageRenderer.showEmptyState();
            } else {
                messages.forEach(function (m) {
                    renderMessageRecord(m);
                });
            }
        } finally {
            isBatchRenderingMessages = false;
        }
        renderOlderMessagesControl();
        scrollBottom({ force: true });
        return getNewestRenderedMessageId();
    }

    async function loadOlderMessages() {
        var sessionId = config.getCurrentSessionId();
        if (!sessionId || isLoadingOlderMessages) return;
        var beforeId = getOldestRenderedMessageId();
        if (!beforeId) return;
        var anchor = messagesEl.querySelector('.message-row[data-message-id]');
        var previousScrollHeight = messagesEl.scrollHeight;
        try {
            isLoadingOlderMessages = true;
            renderOlderMessagesControl();
            var res = await fetch('/api/sessions/' + sessionId + '/messages?before=' + encodeURIComponent(beforeId) + '&limit=' + config.sessionMessagePageSize);
            if (!res.ok) throw new Error('加载更早消息失败');
            var data = await res.json();
            removeOlderMessagesControl();
            isBatchRenderingMessages = true;
            try {
                config.prependInputHistoryMessages(data.messages || [], data.hasMoreMessages);
                (data.messages || []).forEach(function (m) {
                    renderMessageRecord(m, anchor);
                });
            } finally {
                isBatchRenderingMessages = false;
            }
            currentSessionHasMoreMessages = !!data.hasMoreMessages;
            renderOlderMessagesControl();
            messagesEl.scrollTop += messagesEl.scrollHeight - previousScrollHeight;
        } catch (e) {
            config.showError(e.message || '加载更早消息失败');
        } finally {
            isLoadingOlderMessages = false;
            renderOlderMessagesControl();
        }
    }

    function showTyping() {
        clearEmpty();
        var row = document.createElement('div');
        row.className = 'message-row ai';
        row.id = 'typing-row';
        row.innerHTML =
            '<div class="bubble">' +
            '<div class="avatar ai-avatar">Ab</div>' +
            '<div class="message-content">' +
            '<div class="typing-indicator">' +
            '<div class="typing-dot"></div>' +
            '<div class="typing-dot"></div>' +
            '<div class="typing-dot"></div>' +
            '</div>' +
            '</div>' +
            '</div>';
        messagesEl.appendChild(row);
        scrollBottom();
    }

    function removeTyping() {
        var t = document.getElementById('typing-row');
        if (t) t.remove();
    }

    function parseMessageMetadata(raw) {
        if (!raw) return {};
        try {
            return JSON.parse(raw) || {};
        } catch (_) {
            return {};
        }
    }

    bindMessageListEvents();

    return {
        appendContextCompactDivider: appendContextCompactDivider,
        appendContextCompactProgress: appendContextCompactProgress,
        appendMessage: appendMessage,
        clearEmpty: clearEmpty,
        getIsLoadingOlderMessages: function () {
            return isLoadingOlderMessages;
        },
        getNewestMessageId: getNewestMessageId,
        getNewestRenderedMessageId: getNewestRenderedMessageId,
        getOldestRenderedMessageId: getOldestRenderedMessageId,
        loadOlderMessages: loadOlderMessages,
        parseMessageMetadata: parseMessageMetadata,
        renderMessageRecord: renderMessageRecord,
        renderOlderMessagesControl: renderOlderMessagesControl,
        renderSessionMessages: renderSessionMessages,
        removeTyping: removeTyping,
        scrollBottom: scrollBottom,
        showEmptyState: showEmptyState,
        showTyping: showTyping,
        updateConversationHeaderTitle: updateConversationHeaderTitle,
    };
}
