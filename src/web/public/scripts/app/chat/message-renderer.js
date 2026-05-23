import { escapeHtml } from '../utils/html.js';
import {
    createMessageProjectRefs,
    createMessageSkillRefs,
    getSelectionFallbackText,
    isSelectionOnlyFallback,
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
            '<div class="empty-sub">发送消息，开始你的对话</div>' +
            '</div>';
    }

    function appendMessage(role, text, attachments, changeReview, opts) {
        opts = opts || {};
        clearEmpty();
        var row = document.createElement('div');
        row.className = 'message-row ' + role;
        var messageSkills = role === 'user' ? normalizeMessageSkills(opts.skills) : [];
        var messageProjects = role === 'user' ? normalizeMessageProjects(opts.projects) : [];
        var rawText = String(text || '');
        var visibleText = isSelectionOnlyFallback(rawText, messageSkills, messageProjects) ? '' : rawText;

        if (role === 'ai') {
            row.appendChild(createAssistantBubble(text, changeReview, opts));
        } else {
            row.appendChild(createUserBubble(visibleText, attachments, opts, messageSkills, messageProjects));
        }

        config.attachMessageMeta(row, {
            createdAt: opts.createdAt,
            copyText: role === 'user' && (messageSkills.length > 0 || messageProjects.length > 0)
                ? (visibleText ? getSelectionFallbackText(messageSkills, messageProjects) + '\n' + visibleText : getSelectionFallbackText(messageSkills, messageProjects))
                : rawText,
        });
        config.messagesEl.appendChild(row);
        config.scrollBottom();
        return row;
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

    function createUserBubble(visibleText, attachments, opts, messageSkills, messageProjects) {
        var bubble = document.createElement('div');
        bubble.className = 'bubble';

        var content = document.createElement('div');
        content.className = 'message-content';
        var userLine = createUserMessageLine(visibleText, opts, messageSkills, messageProjects);
        if (userLine) content.appendChild(userLine.line);
        if (opts && opts.contentTruncated && opts.messageId) {
            content.appendChild(createUserExpandButton(userLine ? userLine.textEl : null, opts));
        }
        appendAttachments(content, attachments);

        bubble.appendChild(content);
        return bubble;
    }

    function createUserMessageLine(visibleText, opts, messageSkills, messageProjects) {
        var userLine = document.createElement('div');
        userLine.className = 'message-user-line';
        if (messageSkills.length > 0) {
            userLine.appendChild(createMessageSkillRefs(messageSkills));
        }
        if (messageProjects.length > 0) {
            userLine.appendChild(createMessageProjectRefs(messageProjects));
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
        appendMessage: appendMessage,
        clearEmpty: clearEmpty,
        renderAssistantText: renderAssistantText,
        showEmptyState: showEmptyState,
    };
}
