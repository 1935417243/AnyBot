import { createAttachmentController } from './chat/attachments.js';
import { bindChatInputEvents } from './chat/input-events.js';
import { createInputHistoryController } from './chat/input-history.js';
import { createMessageRenderer } from './chat/message-renderer.js';
import { createSendMessageController } from './chat/send-message.js';
import { createSlashPickerController } from './chat/slash-picker.js';
import { createSidebarController } from './sidebar/sidebar-controller.js';
import { createSettingsController } from './settings/settings-controller.js';
import {
    isSelectionOnlyFallback,
    normalizeMessageProjects,
    normalizeMessageSkills,
} from './chat/message-selection.js';
import { renderMarkdown, configureMarkdown } from './markdown.js';
import { createSkillCard as createSkillCardElement, showSkillsSaveStatus as showSaveStatus } from './skills/skill-card.js';
import { copyCode } from './ui/code-copy.js';
import { openImageModal } from './ui/image-modal.js';
import { escapeAttr, escapeHtml } from './utils/html.js';

configureMarkdown();
window.AnyBotMarkdown = { render: renderMarkdown };

    (function () {
        const messagesEl = document.getElementById('messages');
        const inputEl = document.getElementById('chat-input');
        const inputWrapper = document.querySelector('.input-wrapper');
        const sendBtn = document.getElementById('send-btn');
        const sidebar = document.getElementById('sidebar');
        const projectToggle = document.getElementById('project-toggle');
        const projectList = document.getElementById('project-list');
        const addProjectBtn = document.getElementById('add-project-btn');
        const historyToggle = document.getElementById('history-toggle');
        const historyList = document.getElementById('history-list');
        const addHistoryChatBtn = document.getElementById('add-history-chat-btn');
        const newChatBtn = document.getElementById('new-chat-btn');

        const modelSwitcher = document.getElementById('model-switcher');
        const modelBadge = document.getElementById('model-badge');
        const modelDropdown = document.getElementById('model-dropdown');
        const currentModelNameEl = document.getElementById('current-model-name');
        const settingsBtn = document.getElementById('settings-btn');
        const settingsView = document.getElementById('settings-view');
        const settingsCancelBtn = document.getElementById('settings-cancel-btn');
        const settingsSaveBtn = document.getElementById('settings-save-btn');
        const settingsSaveStatus = document.getElementById('settings-save-status');
        const settingsTitle = document.getElementById('settings-title');
        const settingsSubtitle = document.getElementById('settings-subtitle');
        const settingsNavItems = Array.prototype.slice.call(document.querySelectorAll('.settings-nav-item'));
        const settingsTabPanels = Array.prototype.slice.call(document.querySelectorAll('.settings-tab-panel'));
        const settingsProviderSelect = document.getElementById('settings-provider-select');
        const settingsProviderCombobox = document.getElementById('settings-provider-combobox');
        const settingsProviderTrigger = document.getElementById('settings-provider-trigger');
        const settingsProviderCurrent = document.getElementById('settings-provider-current');
        const settingsProviderMenu = document.getElementById('settings-provider-menu');
        const settingsThemeCombobox = document.getElementById('settings-theme-combobox');
        const settingsThemeTrigger = document.getElementById('settings-theme-trigger');
        const settingsThemeCurrent = document.getElementById('settings-theme-current');
        const settingsThemeGroup = document.getElementById('settings-theme-group');
        const settingsSandboxCombobox = document.getElementById('settings-sandbox-combobox');
        const settingsSandboxTrigger = document.getElementById('settings-sandbox-trigger');
        const settingsSandboxCurrent = document.getElementById('settings-sandbox-current');
        const settingsSandboxGroup = document.getElementById('settings-sandbox-group');
        const settingsProviderModelCombobox = document.getElementById('settings-provider-model-combobox');
        const settingsProviderModelTrigger = document.getElementById('settings-provider-model-trigger');
        const settingsProviderModelCurrent = document.getElementById('settings-provider-model-current');
        const settingsProviderModelMenu = document.getElementById('settings-provider-model-menu');
        const settingsProviderModelSelect = document.getElementById('settings-provider-model-select');
        const settingsProviderCompatToggleFields = document.getElementById('settings-provider-compat-toggle-fields');
        const settingsProviderBinFields = document.getElementById('settings-provider-bin-fields');
        const settingsProviderExtraFields = document.getElementById('settings-provider-extra-fields');
        const settingsDefaultWorkdir = document.getElementById('settings-default-workdir');
        const settingsWorkdirOpenBtn = document.getElementById('settings-workdir-open-btn');
        const settingsWorkdirPickBtn = document.getElementById('settings-workdir-pick-btn');
        const settingsProjectsEntryBtn = document.getElementById('settings-projects-entry-btn');
        const settingsLogRetentionDays = document.getElementById('settings-log-retention-days');
        const settingsOpenLogsBtn = document.getElementById('settings-open-logs-btn');
        const settingsClearLogsBtn = document.getElementById('settings-clear-logs-btn');
        const settingsOpenDataBtn = document.getElementById('settings-open-data-btn');
        const settingsClearUploadsBtn = document.getElementById('settings-clear-uploads-btn');
        const settingsExportDataBtn = document.getElementById('settings-export-data-btn');
        const settingsImportDataBtn = document.getElementById('settings-import-data-btn');
        const settingsImportFile = document.getElementById('settings-import-file');
        const settingsClearHistoryBtn = document.getElementById('settings-clear-history-btn');
        const settingsAboutVersion = document.getElementById('settings-about-version');
        const settingsUpdateStatus = document.getElementById('settings-update-status');
        const settingsUpdateCheckedAt = document.getElementById('settings-update-checked-at');
        const settingsUpdateProgress = document.getElementById('settings-update-progress');
        const settingsUpdateProgressFill = document.getElementById('settings-update-progress-fill');
        const settingsUpdateProgressText = document.getElementById('settings-update-progress-text');
        const settingsUpdateCheckBtn = document.getElementById('settings-update-check-btn');
        const settingsUpdateDownloadBtn = document.getElementById('settings-update-download-btn');
        const settingsUpdateRestartBtn = document.getElementById('settings-update-restart-btn');
        const contextUsageEl = document.getElementById('context-usage');
        const contextUsageRingEl = document.getElementById('context-usage-ring');
        const contextUsagePercentEl = document.getElementById('context-usage-percent');
        const contextUsageTokensEl = document.getElementById('context-usage-tokens');
        const contextUsageProviderEl = document.getElementById('context-usage-provider');

        let currentSessionId = null;
        let currentConversationTitle = '新对话';
        let currentSessionProjectId = null;
        let currentSessionProvider = null;
        let isTyping = false;
        let isCancellingResponse = false;
        let latestContextUsage = null;
        let activeStreamSessionId = null;
        let activeStreamAbortController = null;
        let isBatchRenderingMessages = false;
        let currentSessionHasMoreMessages = false;
        let currentSessionUpdatedAt = 0;
        let currentNewestMessageId = 0;
        let isLoadingOlderMessages = false;
        let slashPickerController = null;
        let sidebarController = null;
        let settingsController = null;
        const SESSION_MESSAGE_PAGE_SIZE = 40;
        const HISTORY_SESSION_PREVIEW_LIMIT = 4;
        const PROJECT_SESSION_PREVIEW_LIMIT = 4;
        const LARGE_MESSAGE_PREVIEW_CHARS = 20000;
        const SIDEBAR_REFRESH_INTERVAL_MS = 5000;
        const CURRENT_SESSION_REFRESH_INTERVAL_MS = 2000;
        const REALTIME_REFRESH_DEBOUNCE_MS = 150;
        const REALTIME_RECONNECT_MS = 3000;
        const CHAT_INPUT_PLACEHOLDERS = [
            '发送消息... 输入 / 使用技能或项目',
            '按 ↑ / ↓ 切换历史消息',
            '可粘贴图片或拖拽文件',
            'Enter 发送，Shift+Enter 换行',
        ];
        const CHAT_INPUT_PLACEHOLDER_INTERVAL_MS = 10000;
        let chatInputPlaceholderIndex = 0;
        let chatInputPlaceholderTimer = null;

        // 附件相关
        const fileInput = document.getElementById('file-input');
        const attachBtn = document.getElementById('attach-btn');
        const attachmentPreview = document.getElementById('attachment-preview');
        const skillPickerEl = document.getElementById('skill-picker');
        const selectedSkillsEl = document.getElementById('selected-skills');
        const dropOverlay = document.getElementById('drop-overlay');
        let pendingAttachments = []; // { path, name, size, isImage, localUrl? }

        const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif', '.heic', '.heif', '.avif'];
        const SEND_BUTTON_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 7h10M7.5 2.5L12 7l-4.5 4.5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const STOP_BUTTON_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.4" fill="white"/></svg>';

        settingsController = createSettingsController({
            addProjectBtn: addProjectBtn,
            createNewChat: createNewChat,
            currentModelNameEl: currentModelNameEl,
            fetchSessions: fetchSessions,
            getCurrentSessionId: function () {
                return currentSessionId;
            },
            getCurrentSessionProvider: function () {
                return currentSessionProvider;
            },
            getCurrentView: function () {
                return currentView;
            },
            getLatestContextUsage: function () {
                return latestContextUsage;
            },
            getSidebarController: function () {
                return sidebarController;
            },
            modelBadge: modelBadge,
            modelDropdown: modelDropdown,
            modelSwitcher: modelSwitcher,
            settingsAboutVersion: settingsAboutVersion,
            settingsCancelBtn: settingsCancelBtn,
            settingsClearHistoryBtn: settingsClearHistoryBtn,
            settingsClearLogsBtn: settingsClearLogsBtn,
            settingsClearUploadsBtn: settingsClearUploadsBtn,
            settingsDefaultWorkdir: settingsDefaultWorkdir,
            settingsExportDataBtn: settingsExportDataBtn,
            settingsImportDataBtn: settingsImportDataBtn,
            settingsImportFile: settingsImportFile,
            settingsLogRetentionDays: settingsLogRetentionDays,
            settingsNavItems: settingsNavItems,
            settingsOpenDataBtn: settingsOpenDataBtn,
            settingsOpenLogsBtn: settingsOpenLogsBtn,
            settingsProjectsEntryBtn: settingsProjectsEntryBtn,
            settingsProviderCombobox: settingsProviderCombobox,
            settingsProviderCompatToggleFields: settingsProviderCompatToggleFields,
            settingsProviderCurrent: settingsProviderCurrent,
            settingsProviderExtraFields: settingsProviderExtraFields,
            settingsProviderBinFields: settingsProviderBinFields,
            settingsProviderMenu: settingsProviderMenu,
            settingsProviderModelCombobox: settingsProviderModelCombobox,
            settingsProviderModelCurrent: settingsProviderModelCurrent,
            settingsProviderModelMenu: settingsProviderModelMenu,
            settingsProviderModelSelect: settingsProviderModelSelect,
            settingsProviderModelTrigger: settingsProviderModelTrigger,
            settingsProviderSelect: settingsProviderSelect,
            settingsProviderTrigger: settingsProviderTrigger,
            settingsSandboxCombobox: settingsSandboxCombobox,
            settingsSandboxCurrent: settingsSandboxCurrent,
            settingsSandboxGroup: settingsSandboxGroup,
            settingsSandboxTrigger: settingsSandboxTrigger,
            settingsSaveBtn: settingsSaveBtn,
            settingsSaveStatus: settingsSaveStatus,
            settingsTabPanels: settingsTabPanels,
            settingsThemeCombobox: settingsThemeCombobox,
            settingsThemeCurrent: settingsThemeCurrent,
            settingsThemeGroup: settingsThemeGroup,
            settingsThemeTrigger: settingsThemeTrigger,
            settingsTitle: settingsTitle,
            settingsSubtitle: settingsSubtitle,
            settingsUpdateCheckBtn: settingsUpdateCheckBtn,
            settingsUpdateCheckedAt: settingsUpdateCheckedAt,
            settingsUpdateDownloadBtn: settingsUpdateDownloadBtn,
            settingsUpdateProgress: settingsUpdateProgress,
            settingsUpdateProgressFill: settingsUpdateProgressFill,
            settingsUpdateProgressText: settingsUpdateProgressText,
            settingsUpdateRestartBtn: settingsUpdateRestartBtn,
            settingsUpdateStatus: settingsUpdateStatus,
            settingsView: settingsView,
            settingsBtn: settingsBtn,
            settingsWorkdirOpenBtn: settingsWorkdirOpenBtn,
            settingsWorkdirPickBtn: settingsWorkdirPickBtn,
            showChatView: showChatView,
            showError: showError,
            showSettingsView: function () {
                hideAllViews();
                currentView = 'settings';
                settingsView.style.display = 'flex';
                settingsBtn.classList.add('active');
            },
            updateContextUsage: updateContextUsage,
        });

        function updateSendBtnState() {
            var isRunning = !!isTyping;
            var promptSelection = slashPickerController
                ? slashPickerController.getSelection()
                : { skills: [], projects: [] };
            sendBtn.classList.toggle('is-stop', isRunning);
            sendBtn.innerHTML = isRunning ? STOP_BUTTON_ICON : SEND_BUTTON_ICON;
            sendBtn.title = isRunning ? (isCancellingResponse ? '正在中断' : '中断') : '发送';
            sendBtn.setAttribute('aria-label', sendBtn.title);
            sendBtn.disabled = isRunning
                ? isCancellingResponse
                : (
                    inputEl.value.trim() === '' &&
                    pendingAttachments.length === 0 &&
                    promptSelection.skills.length === 0 &&
                    promptSelection.projects.length === 0
                );
        }

        function resizeChatInput() {
            inputEl.style.height = 'auto';
            inputEl.style.overflowY = inputEl.scrollHeight > 160 ? 'auto' : 'hidden';
            inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
        }

        const attachmentController = createAttachmentController({
            attachmentPreview: attachmentPreview,
            imageExts: IMAGE_EXTS,
            getPendingAttachments: function () {
                return pendingAttachments;
            },
            showError: showError,
            updateSendBtnState: updateSendBtnState,
        });

        slashPickerController = createSlashPickerController({
            inputEl: inputEl,
            selectedSkillsEl: selectedSkillsEl,
            skillPickerEl: skillPickerEl,
            fetchSlashItemsData: fetchSlashItemsData,
            getCurrentSessionProjectId: function () {
                return currentSessionProjectId;
            },
            getCurrentView: function () {
                return currentView;
            },
            getSlashItemsState: function () {
                var providerType = getActiveSlashProviderType();
                return slashItemsDataProvider === providerType ? slashItemsData : null;
            },
            resetInputHistoryNavigation: resetInputHistoryNavigation,
            resizeChatInput: resizeChatInput,
            showError: showError,
            updateSendBtnState: updateSendBtnState,
        });

        const inputHistoryController = createInputHistoryController({
            inputEl: inputEl,
            pageSize: SESSION_MESSAGE_PAGE_SIZE,
            applyDraft: applyChatInputDraft,
            getCurrentSessionId: function () {
                return currentSessionId;
            },
            getOldestRenderedMessageId: getOldestRenderedMessageId,
            getPromptSelection: function () {
                return slashPickerController.getSelection();
            },
            isSelectionOnlyFallback: isSelectionOnlyFallback,
            normalizeMessageProjects: normalizeMessageProjects,
            normalizeMessageSkills: normalizeMessageSkills,
            parseMessageMetadata: parseMessageMetadata,
        });

        function resetInputHistoryNavigation() {
            return inputHistoryController.resetNavigation();
        }

        function resetInputHistoryFromMessages(messages, hasMoreMessages) {
            return inputHistoryController.resetFromMessages(messages, hasMoreMessages);
        }

        function prependInputHistoryMessages(messages, hasMoreMessages) {
            return inputHistoryController.prependMessages(messages, hasMoreMessages);
        }

        function rememberSentUserMessage(text, skills, projects) {
            return inputHistoryController.rememberSentUserMessage(text, skills, projects);
        }

        function shouldHandleInputHistoryKey(e, direction) {
            return inputHistoryController.shouldHandleKey(e, direction);
        }

        function navigateInputHistory(direction) {
            return inputHistoryController.navigate(direction);
        }

        function applyChatInputDraft(value, skills, projects) {
            inputEl.value = value;
            slashPickerController.setSelection(skills, projects);
        }

        function canOpenSkillPickerFromSlash(e) {
            return slashPickerController.canOpenFromSlash(e);
        }

        function closeSkillPicker(options) {
            return slashPickerController.close(options);
        }

        function syncSkillPickerFromInput() {
            return slashPickerController.syncFromInput();
        }

        function renderPromptSkills() {
            return slashPickerController.renderPromptSelections();
        }

        function clearPromptSkills() {
            return slashPickerController.clearPromptSelections();
        }

        function clearPromptSkillDeleteTarget() {
            return slashPickerController.clearDeleteTarget();
        }

        function handlePromptSkillBackspace(e) {
            return slashPickerController.handlePromptBackspace(e);
        }

        function insertSkillSlashTrigger() {
            return slashPickerController.insertSlashTrigger();
        }

        function handleSkillPickerKeydown(e) {
            return slashPickerController.handleKeydown(e);
        }

        function renderAttachmentPreview() {
            return attachmentController.renderPreview();
        }

        async function uploadFiles(files) {
            return attachmentController.uploadFiles(files);
        }

        bindChatInputEvents({
            attachBtn: attachBtn,
            cancelCurrentResponse: cancelCurrentResponse,
            canOpenSkillPickerFromSlash: canOpenSkillPickerFromSlash,
            chatViewEl: document.getElementById('chat-view'),
            clearPromptSkillDeleteTarget: clearPromptSkillDeleteTarget,
            dropOverlay: dropOverlay,
            fileInput: fileInput,
            getIsTyping: function () {
                return isTyping;
            },
            handlePromptSkillBackspace: handlePromptSkillBackspace,
            handleSkillPickerKeydown: handleSkillPickerKeydown,
            inputEl: inputEl,
            inputWrapper: inputWrapper,
            insertSkillSlashTrigger: insertSkillSlashTrigger,
            navigateInputHistory: navigateInputHistory,
            resetInputHistoryNavigation: resetInputHistoryNavigation,
            resizeChatInput: resizeChatInput,
            sendBtn: sendBtn,
            sendMessage: sendMessage,
            shouldHandleInputHistoryKey: shouldHandleInputHistoryKey,
            syncSkillPickerFromInput: syncSkillPickerFromInput,
            updateSendBtnState: updateSendBtnState,
            uploadFiles: uploadFiles,
        });

        sidebarController = createSidebarController({
            addProjectBtn: addProjectBtn,
            createNewChat: createNewChat,
            currentSessionRefreshIntervalMs: CURRENT_SESSION_REFRESH_INTERVAL_MS,
            deleteSession: deleteSession,
            getActiveStreamSessionId: function () {
                return activeStreamSessionId;
            },
            getChannelMeta: getChannelMeta,
            getCurrentNewestMessageId: function () {
                return currentNewestMessageId;
            },
            getCurrentSessionId: function () {
                return currentSessionId;
            },
            getCurrentSessionProjectId: function () {
                return currentSessionProjectId;
            },
            getCurrentSessionUpdatedAt: function () {
                return currentSessionUpdatedAt;
            },
            getCurrentView: function () {
                return currentView;
            },
            getIsLoadingOlderMessages: function () {
                return isLoadingOlderMessages;
            },
            getIsTyping: function () {
                return isTyping;
            },
            getNewestMessageId: getNewestMessageId,
            historyList: historyList,
            historySessionPreviewLimit: HISTORY_SESSION_PREVIEW_LIMIT,
            historyToggle: historyToggle,
            invalidateSlashItemsData: invalidateSlashItemsData,
            loadSession: loadSession,
            projectList: projectList,
            projectSessionPreviewLimit: PROJECT_SESSION_PREVIEW_LIMIT,
            projectToggle: projectToggle,
            realtimeReconnectMs: REALTIME_RECONNECT_MS,
            realtimeRefreshDebounceMs: REALTIME_REFRESH_DEBOUNCE_MS,
            setCurrentNewestMessageId: function (value) {
                currentNewestMessageId = value;
            },
            setCurrentSessionUpdatedAt: function (value) {
                currentSessionUpdatedAt = value;
            },
            showChatView: showChatView,
            showError: showError,
            sidebar: sidebar,
            sidebarRefreshIntervalMs: SIDEBAR_REFRESH_INTERVAL_MS,
            updateConversationHeaderTitle: updateConversationHeaderTitle,
        });
        sidebarController.bindRealtimeLifecycle();

        newChatBtn.addEventListener('click', function () {
            createNewChat();
        });
        projectToggle.addEventListener('click', toggleProjects);
        addProjectBtn.addEventListener('click', addProject);
        historyToggle.addEventListener('click', toggleHistory);
        addHistoryChatBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            createNewChat(null, { force: true });
        });

        messagesEl.addEventListener('click', function (e) {
            var copyButton = e.target && e.target.closest ? e.target.closest('.code-copy') : null;
            if (copyButton && messagesEl.contains(copyButton)) {
                copyCode(copyButton);
                return;
            }

            var target = e.target && e.target.closest ? e.target.closest('.chat-image') : null;
            if (target && messagesEl.contains(target)) {
                openImageModal(target.src);
            }
        });

        function scrollBottom() {
            if (isBatchRenderingMessages) return;
            messagesEl.scrollTop = messagesEl.scrollHeight;
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
            if (!currentSessionId || !messageId) throw new Error('无法加载完整内容');
            var res = await fetch('/api/sessions/' + currentSessionId + '/messages/' + encodeURIComponent(messageId) + '/content');
            if (!res.ok) throw new Error('加载完整内容失败');
            var data = await res.json();
            return data.content || '';
        }

        const messageRenderer = createMessageRenderer({
            messagesEl: messagesEl,
            conversationHeaderHtml: conversationHeaderHtml,
            largeMessagePreviewChars: LARGE_MESSAGE_PREVIEW_CHARS,
            imageExts: IMAGE_EXTS,
            renderMarkdown: renderMarkdown,
            formatTokenCount: formatTokenCount,
            fetchFullMessageContent: fetchFullMessageContent,
            showError: showError,
            openImageModal: openImageModal,
            attachMessageMeta: function (row, opts) {
                attachMessageMeta(row, opts);
            },
            scrollBottom: scrollBottom,
        });

        function renderAssistantText(content, text, opts) {
            return messageRenderer.renderAssistantText(content, text, opts);
        }

        function showEmptyState() {
            return messageRenderer.showEmptyState();
        }

        function appendMessage(role, text, attachments, changeReview, opts) {
            return messageRenderer.appendMessage(role, text, attachments, changeReview, opts);
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
            if (m.role === 'assistant' && meta.claudeAgentLoop && window.ClaudeAgentLoop && window.ClaudeAgentLoop.renderPersistedMessage) {
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
                if (usageEvents.length > 0) updateContextUsage(usageEvents[usageEvents.length - 1].usage);
            } else {
                row = appendMessage(m.role === 'user' ? 'user' : 'ai', m.content, attInfo, meta.changeReview, {
                    messageId: m.id,
                    contentTruncated: !!m.contentTruncated,
                    contentChars: m.contentChars,
                    createdAt: m.createdAt,
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

        async function loadOlderMessages() {
            if (!currentSessionId || isLoadingOlderMessages) return;
            var beforeId = getOldestRenderedMessageId();
            if (!beforeId) return;
            var anchor = messagesEl.querySelector('.message-row[data-message-id]');
            var previousScrollHeight = messagesEl.scrollHeight;
            try {
                isLoadingOlderMessages = true;
                renderOlderMessagesControl();
                var res = await fetch('/api/sessions/' + currentSessionId + '/messages?before=' + encodeURIComponent(beforeId) + '&limit=' + SESSION_MESSAGE_PAGE_SIZE);
                if (!res.ok) throw new Error('加载更早消息失败');
                var data = await res.json();
                removeOlderMessagesControl();
                isBatchRenderingMessages = true;
                try {
                    prependInputHistoryMessages(data.messages || [], data.hasMoreMessages);
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
                showError(e.message || '加载更早消息失败');
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

        function showError(msg) {
            var toast = document.createElement('div');
            toast.className = 'error-toast';
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(function () {
                toast.remove();
            }, 4000);
        }

        function formatMessageTime(timestamp) {
            var date = timestamp ? new Date(Number(timestamp)) : new Date();
            if (Number.isNaN(date.getTime())) date = new Date();
            return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
        }

        function copyTextToClipboard(text) {
            if (navigator.clipboard && window.isSecureContext) {
                return navigator.clipboard.writeText(text);
            }
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.top = '-1000px';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                return Promise.resolve();
            } catch (e) {
                return Promise.reject(e);
            } finally {
                textarea.remove();
            }
        }

        function attachMessageMeta(row, opts) {
            if (!row || row.querySelector('.message-hover-meta')) return;
            opts = opts || {};
            var bubble = row.querySelector('.bubble');
            if (!bubble) return;

            var meta = document.createElement('div');
            meta.className = 'message-hover-meta';

            var time = document.createElement('span');
            time.className = 'message-hover-time';
            time.textContent = formatMessageTime(opts.createdAt);

            var copyBtn = document.createElement('button');
            copyBtn.className = 'message-copy-btn';
            copyBtn.type = 'button';
            copyBtn.title = '复制';
            copyBtn.setAttribute('aria-label', '复制消息');
            var copyIcon = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.2" y="3.2" width="7.6" height="9.6" rx="1.6" stroke="currentColor" stroke-width="1.25"/><path d="M3.2 10.8V5a1.8 1.8 0 011.8-1.8h5.8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';
            var checkIcon = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.2 8.4l3.1 3.1 6.5-7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            copyBtn.innerHTML = copyIcon;
            copyBtn.addEventListener('click', function (event) {
                event.stopPropagation();
                var value = typeof opts.copyText === 'function' ? opts.copyText() : opts.copyText;
                copyTextToClipboard(String(value || '')).then(function () {
                    copyBtn.classList.add('copied');
                    copyBtn.title = '已复制';
                    copyBtn.setAttribute('aria-label', '已复制');
                    copyBtn.innerHTML = checkIcon;
                    setTimeout(function () {
                        copyBtn.classList.remove('copied');
                        copyBtn.title = '复制';
                        copyBtn.setAttribute('aria-label', '复制消息');
                        copyBtn.innerHTML = copyIcon;
                    }, 1200);
                }).catch(function () {
                    showError('复制失败');
                });
            });

            meta.appendChild(time);
            meta.appendChild(copyBtn);
            bubble.appendChild(meta);
        }

        window.AnyBotMessageMeta = {
            attach: attachMessageMeta,
        };

        function parseMessageMetadata(raw) {
            if (!raw) return {};
            try {
                return JSON.parse(raw) || {};
            } catch (_) {
                return {};
            }
        }

        function formatTokenCount(value) {
            var n = Number(value || 0);
            if (!Number.isFinite(n) || n <= 0) return '0';
            if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'm';
            if (n >= 1000) return Math.round(n / 1000) + 'k';
            return String(Math.round(n));
        }

        function contextUsageColor(percent) {
            if (percent >= 90) return '#ef4444';
            if (percent >= 70) return '#f59e0b';
            return '#9ca3af';
        }

        function updateContextUsage(usage) {
            latestContextUsage = usage || {
                usedTokens: 0,
                maxTokens: 0,
                usedPercentage: 0,
                remainingPercentage: 100,
                source: '',
            };
            if (!contextUsageEl || !contextUsageRingEl || !latestContextUsage) return;

            var usedPercent = Math.max(0, Math.min(100, Number(latestContextUsage.usedPercentage || 0)));
            var remainingPercent = Math.max(0, Math.round((100 - usedPercent) * 10) / 10);
            var usedTokens = Number(latestContextUsage.usedTokens || 0);
            var maxTokens = Number(latestContextUsage.maxTokens || 0);
            var color = contextUsageColor(usedPercent);
            var degrees = usedPercent * 3.6;

            contextUsageEl.classList.toggle('has-data', usedTokens > 0 && maxTokens > 0);
            contextUsageRingEl.style.background =
                'radial-gradient(circle at center, var(--input-bg) 48%, transparent 50%), ' +
                'conic-gradient(' + color + ' ' + degrees + 'deg, var(--ring-track) ' + degrees + 'deg)';

            if (contextUsagePercentEl) {
                contextUsagePercentEl.textContent =
                    Math.round(usedPercent) + '% 已用（剩余 ' + Math.round(remainingPercent) + '%）';
            }
            if (contextUsageTokensEl) {
                contextUsageTokensEl.textContent =
                    '已用 ' + formatTokenCount(usedTokens) + ' token，共 ' + formatTokenCount(maxTokens);
            }
            if (contextUsageProviderEl) {
                contextUsageProviderEl.textContent = '';
            }
        }

        function setupSidebarTooltips() {
            sidebarController.setupTooltips();
        }

        function updateChatInputPlaceholder() {
            inputEl.placeholder = CHAT_INPUT_PLACEHOLDERS[chatInputPlaceholderIndex];
        }

        function startChatInputPlaceholderRotation() {
            if (chatInputPlaceholderTimer) return;
            updateChatInputPlaceholder();
            chatInputPlaceholderTimer = setInterval(function () {
                chatInputPlaceholderIndex = (chatInputPlaceholderIndex + 1) % CHAT_INPUT_PLACEHOLDERS.length;
                updateChatInputPlaceholder();
            }, CHAT_INPUT_PLACEHOLDER_INTERVAL_MS);
        }

        function updateProjectsCollapsedState() {
            sidebarController.updateProjectsCollapsedState();
        }

        function toggleProjects() {
            sidebarController.toggleProjects();
        }

        function updateHistoryCollapsedState() {
            sidebarController.updateHistoryCollapsedState();
        }

        function toggleHistory() {
            sidebarController.toggleHistory();
        }

        function renderHistory() {
            sidebarController.renderHistory();
        }

        function selectProject(projectId) {
            sidebarController.selectProject(projectId);
        }

        function renderProjects() {
            sidebarController.renderProjects();
        }

        function updateSidebarSelection() {
            sidebarController.updateSelection();
        }

        function revealSessionContainer(projectId) {
            sidebarController.revealSessionContainer(projectId);
        }

        function revealActiveSessionInSidebar() {
            sidebarController.revealActiveSession();
        }

        function findSessionSummary(id) {
            return sidebarController.findSessionSummary(id);
        }

        async function syncCurrentSessionFromSummary() {
            return sidebarController.syncCurrentSessionFromSummary();
        }

        async function pollCurrentSessionMessages() {
            return sidebarController.pollCurrentSessionMessages();
        }

        async function fetchSessions() {
            return sidebarController.fetchSessions();
        }

        async function fetchProjects() {
            return sidebarController.fetchProjects();
        }

        async function refreshSidebarDirectory() {
            return sidebarController.refreshDirectory();
        }

        function startRealtimeEvents() {
            sidebarController.startRealtimeEvents();
        }

        async function addProject() {
            return sidebarController.addProject();
        }

        async function createNewChat(projectId, options) {
            options = options || {};
            var targetProjectId = arguments.length > 0 ? projectId : sidebarController.getActiveProjectId();
            if (!targetProjectId) targetProjectId = null;
            if (currentView !== 'chat') {
                showChatView();
            }
            var providerData = settingsController.getProviderData();
            var currentProviderType = providerData && providerData.current;
            var canReuseEmptySession =
                !options.force &&
                currentSessionId &&
                currentSessionProjectId === targetProjectId &&
                (!currentProviderType || currentSessionProvider === currentProviderType) &&
                !document.querySelector('#messages .message-row');
            if (canReuseEmptySession) {
                sidebarController.setActiveProjectId(targetProjectId);
                settingsController.clearSessionModelSelection(currentSessionId);
                var reusableSummary = findSessionSummary(currentSessionId);
                updateConversationHeaderTitle(reusableSummary ? reusableSummary.title : '新对话');
                revealSessionContainer(targetProjectId);
                renderHistory();
                renderProjects();
                updateSidebarSelection();
                revealActiveSessionInSidebar();
                await fetchModelConfig(currentSessionProvider);
                inputEl.focus();
                return;
            }
            try {
                var res = await fetch('/api/sessions', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ projectId: targetProjectId }),
                });
                var data = await res.json();
                if (!res.ok) throw new Error(data.error || '创建会话失败');
                currentSessionId = data.id;
                currentSessionProjectId = data.projectId || targetProjectId || null;
                currentSessionProvider = data.provider || null;
                updateConversationHeaderTitle(data.title);
                currentSessionUpdatedAt = Number(data.updatedAt || Date.now());
                currentNewestMessageId = 0;
                sidebarController.setActiveProjectId(currentSessionProjectId);
                revealSessionContainer(currentSessionProjectId);
                showChatView();
                updateContextUsage(null);
                resetInputHistoryFromMessages([], false);
                showEmptyState();
                inputEl.value = '';
                clearPromptSkills();
                resizeChatInput();
                sendBtn.disabled = true;
                inputEl.focus();
                await fetchModelConfig(currentSessionProvider);
                await fetchSessions();
                updateSidebarSelection();
                revealActiveSessionInSidebar();
            } catch (e) {
                showError(e.message || '创建会话失败');
            }
        }

        function stopActiveStreamSubscription() {
            if (activeStreamAbortController) {
                activeStreamAbortController.abort();
                activeStreamAbortController = null;
            }
            activeStreamSessionId = null;
            isTyping = false;
            isCancellingResponse = false;
            updateSendBtnState();
        }

        async function cancelCurrentResponse() {
            var targetSessionId = activeStreamSessionId || currentSessionId;
            if (!targetSessionId || isCancellingResponse) return;

            isCancellingResponse = true;
            updateSendBtnState();
            try {
                var res = await fetch('/api/sessions/' + targetSessionId + '/messages/cancel', {
                    method: 'POST',
                });
                if (!res.ok) {
                    var err = await res.json().catch(function () {
                        return {};
                    });
                    throw new Error(err.error || '中断失败');
                }
            } catch (e) {
                isCancellingResponse = false;
                updateSendBtnState();
                showError(e.message || '中断失败');
            }
        }

        async function resumeActiveStream(sessionId, activeStream) {
            if (!window.ClaudeAgentLoop || !window.ClaudeAgentLoop.resume) return;

            var controller = new AbortController();
            activeStreamAbortController = controller;
            activeStreamSessionId = sessionId;
            isTyping = true;
            isCancellingResponse = false;
            updateSendBtnState();

            var agentView = window.ClaudeAgentLoop.createMessage({
                messagesEl: messagesEl,
                scrollBottom: scrollBottom,
                startedAt: activeStream && activeStream.startedAt,
            });

            try {
                var result = await window.ClaudeAgentLoop.resume({
                    sessionId: sessionId,
                    view: agentView,
                    signal: controller.signal,
                    onContextUsage: updateContextUsage,
                });

                if (activeStreamSessionId !== sessionId) return;

                if (result && result.inactive) {
                    if (agentView.row) agentView.row.remove();
                    stopActiveStreamSubscription();
                    isTyping = false;
                    isCancellingResponse = false;
                    updateSendBtnState();
                    await loadSession(sessionId);
                    return;
                }

                await fetchSessions();
            } catch (e) {
                if (e.name === 'AbortError') return;
                if (agentView) {
                    agentView.handleEvent({
                        type: 'error',
                        error: e.message || '网络错误，请检查连接',
                    });
                }
                showError(e.message || '网络错误，请检查连接');
            } finally {
                if (activeStreamSessionId === sessionId) {
                    activeStreamAbortController = null;
                    activeStreamSessionId = null;
                    isTyping = false;
                    isCancellingResponse = false;
                    updateSendBtnState();
                }
            }
        }

        async function loadSession(id, options) {
            options = options || {};
            if (id === currentSessionId && activeStreamSessionId === id) {
                inputEl.focus();
                return;
            }
            if (id === currentSessionId && currentView === 'chat' && !options.force) {
                inputEl.focus();
                return;
            }

            try {
                stopActiveStreamSubscription();
                var res = await fetch('/api/sessions/' + id + '?limit=' + SESSION_MESSAGE_PAGE_SIZE);
                if (!res.ok) {
                    if (!options.silent) showError('加载会话失败');
                    return;
                }
                var data = await res.json();
                var wasChatView = currentView === 'chat';
                currentSessionId = id;
                currentSessionProjectId = data.projectId || null;
                currentSessionProvider = data.provider || null;
                updateConversationHeaderTitle(data.title);
                currentSessionUpdatedAt = Number(data.updatedAt || findSessionSummary(id)?.updatedAt || currentSessionUpdatedAt || 0);
                sidebarController.setActiveProjectId(data.projectId || null);
                currentSessionHasMoreMessages = !!data.hasMoreMessages;
                isLoadingOlderMessages = false;
                resetInputHistoryFromMessages(data.messages || [], currentSessionHasMoreMessages);
                updateContextUsage(null);
                var didExpandProject = sidebarController.expandProject(data.projectId || null);

                if (!wasChatView) showChatView();

                messagesEl.innerHTML = '';
                ensureConversationHeader();
                isBatchRenderingMessages = true;
                try {
                    if (data.messages.length === 0) {
                        showEmptyState();
                    } else {
                        data.messages.forEach(function (m) {
                            renderMessageRecord(m);
                        });
                    }
                } finally {
                    isBatchRenderingMessages = false;
                }
                renderOlderMessagesControl();
                currentNewestMessageId = getNewestRenderedMessageId();
                scrollBottom();
                await fetchModelConfig(currentSessionProvider);

                if (data.activeStream) {
                    resumeActiveStream(id, data.activeStream);
                }

                if (wasChatView && didExpandProject) renderProjects();
                updateSidebarSelection();
                inputEl.focus();
            } catch (e) {
                if (!options.silent) showError('加载会话失败');
            }
        }

        async function deleteSession(id) {
            try {
                await fetch('/api/sessions/' + id, {method: 'DELETE'});
                if (currentSessionId === id) {
                    currentSessionId = null;
                    currentSessionProjectId = null;
                    currentSessionProvider = null;
                    currentSessionUpdatedAt = 0;
                    currentNewestMessageId = 0;
                    updateConversationHeaderTitle('新对话');
                    resetInputHistoryFromMessages([], false);
                    clearPromptSkills();
                    updateContextUsage(null);
                    showEmptyState();
                }
                await fetchSessions();
            } catch (e) {
                showError('删除失败');
            }
        }

        const sendMessageController = createSendMessageController({
            inputEl: inputEl,
            messagesEl: messagesEl,
            getState: function () {
                var promptSelection = slashPickerController.getSelection();
                return {
                    currentSessionId: currentSessionId,
                    currentSessionProvider: currentSessionProvider,
                    isTyping: isTyping,
                    modelConfig: settingsController.getModelConfig(),
                    pendingAttachments: pendingAttachments,
                    promptProjects: promptSelection.projects,
                    promptSkills: promptSelection.skills,
                    providerData: settingsController.getProviderData(),
                };
            },
            setPendingAttachments: function (value) {
                pendingAttachments = value;
            },
            setTyping: function (value) {
                isTyping = value;
            },
            setCancelling: function (value) {
                isCancellingResponse = value;
            },
            setSendButtonDisabled: function (value) {
                sendBtn.disabled = value;
            },
            setActiveStream: function (controller, sessionId) {
                activeStreamAbortController = controller;
                activeStreamSessionId = sessionId;
            },
            clearActiveStreamForSession: function (sessionId) {
                if (activeStreamSessionId === sessionId) {
                    activeStreamAbortController = null;
                    activeStreamSessionId = null;
                }
            },
            setCurrentSessionProvider: function (provider) {
                currentSessionProvider = provider;
            },
            appendMessage: appendMessage,
            clearPromptSkills: clearPromptSkills,
            fetchSessions: fetchSessions,
            rememberSentUserMessage: rememberSentUserMessage,
            removeTyping: removeTyping,
            renderAttachmentPreview: renderAttachmentPreview,
            resizeChatInput: resizeChatInput,
            scrollBottom: scrollBottom,
            showError: showError,
            showTyping: showTyping,
            updateContextUsage: updateContextUsage,
            updateConversationHeaderTitle: updateConversationHeaderTitle,
            updateSendBtnState: updateSendBtnState,
        });

        async function sendMessage() {
            return sendMessageController.sendMessage();
        }

        function fetchModelConfig(providerType) {
            return settingsController.fetchModelConfig(providerType);
        }

        function fetchProviders() {
            return settingsController.fetchProviders();
        }

        function fetchSandboxConfig() {
            return settingsController.fetchSandboxConfig();
        }

        function fetchAppSettings() {
            return settingsController.fetchAppSettings();
        }

        function fetchProxyConfig() {
            return settingsController.fetchProxyConfig();
        }

        document.addEventListener('click', function (e) {
            if (slashPickerController.isOpen() && skillPickerEl && e.target !== inputEl && !skillPickerEl.contains(e.target)) {
                closeSkillPicker();
            }
            settingsController.handleDocumentClick(e);
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (slashPickerController.isOpen()) {
                    closeSkillPicker({ removeTrigger: document.activeElement === inputEl });
                    if (document.activeElement === inputEl) inputEl.focus();
                    return;
                }
                if (settingsController.handleDocumentEscape(e)) return;
            }
        });

        const chatView = document.getElementById('chat-view');
        const channelView = document.getElementById('channel-view');
        const skillsView = document.getElementById('skills-view');
        const channelsBtn = document.getElementById('channels-btn');
        const skillsBtn = document.getElementById('skills-btn');

        const CHANNEL_META = {
            web: {name: '本地', icon: '本', iconClass: 'web', badge: '本地'},
            feishu: {name: '飞书', icon: '飞', iconClass: 'feishu', badge: '飞书'},
            qqbot: {name: 'QQ', icon: 'Q', iconClass: 'qq', badge: 'QQ'},
            weixin: {name: '微信', icon: '微', iconClass: 'weixin', badge: '微信'},
            dingtalk: {name: '钉钉', icon: '钉', iconClass: 'dingtalk', badge: '钉钉'},
            telegram: {name: 'Telegram', icon: 'T', iconClass: 'telegram', badge: 'TG'},
            discord: {name: 'Discord', icon: 'D', iconClass: 'discord', badge: 'DC'},
        };

        function getChannelMeta(type) {
            return CHANNEL_META[type] || {name: type, icon: type.charAt(0).toUpperCase(), iconClass: 'default'};
        }

        var channelsData = null;
        var skillsData = null;
        var skillsDataProvider = '';
        var slashItemsData = null;
        var slashItemsDataProvider = '';
        var slashItemsDataFetchedAt = 0;
        var slashItemsDataCache = {};
        var SLASH_ITEMS_CACHE_TTL = 5 * 1000;
        var currentView = 'chat';
        var weixinLoginPollTimer = null;

        function hideAllViews() {
            closeSkillPicker();
            chatView.style.display = 'none';
            channelView.style.display = 'none';
            skillsView.style.display = 'none';
            settingsView.style.display = 'none';
            newChatBtn.classList.remove('active');
            channelsBtn.classList.remove('active');
            skillsBtn.classList.remove('active');
            settingsBtn.classList.remove('active');
        }

        function showChatView() {
            hideAllViews();
            currentView = 'chat';
            chatView.style.display = 'flex';
            newChatBtn.classList.add('active');
            renderHistory();
            renderProjects();
        }

        function showChannelsPage() {
            hideAllViews();
            currentView = 'channels';
            channelView.style.display = 'flex';
            channelsBtn.classList.add('active');
            renderHistory();
            renderAllChannels();
        }

        function showSkillsPage() {
            hideAllViews();
            currentView = 'skills';
            skillsView.style.display = 'flex';
            skillsBtn.classList.add('active');
            renderHistory();
            renderSkillsView();
        }

        channelsBtn.addEventListener('click', function () {
            if (currentView === 'channels') return;
            if (!channelsData) {
                fetchChannels().then(function () {
                    showChannelsPage();
                });
            } else {
                showChannelsPage();
            }
        });

        skillsBtn.addEventListener('click', function () {
            if (currentView === 'skills') return;
            fetchSkills().then(function () {
                showSkillsPage();
            });
        });

        async function fetchChannels() {
            try {
                var res = await fetch('/api/channels');
                channelsData = await res.json();
            } catch (e) {
                console.error('Failed to fetch channels:', e);
            }
        }

        var openDrawerType = null;

        function renderAllChannels() {
            channelView.innerHTML = '';
            if (!channelsData || !channelsData.registered) return;

            var page = document.createElement('div');
            page.className = 'channel-page';

            var header = document.createElement('div');
            header.className = 'channel-page-header';
            header.innerHTML =
                '<div class="channel-page-header-top">' +
                '<div class="channel-page-header-icon">' +
                '<svg width="20" height="20" viewBox="0 0 14 14" fill="none"><path d="M1.5 5h11M1.5 9h11M5 1.5l-1.5 11M10.5 1.5L9 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
                '</div>' +
                '<div>' +
                '<div class="channel-page-title">频道管理</div>' +
                '<div class="channel-page-subtitle">点击频道进行配置</div>' +
                '</div>' +
                '</div>';
            page.appendChild(header);

            var list = document.createElement('div');
            list.className = 'channel-list';

            channelsData.registered.forEach(function (type) {
                var cfg = (channelsData.config && channelsData.config[type]) || {};
                var meta = getChannelMeta(type);
                var isOn = !!cfg.enabled;

                var item = document.createElement('div');
                item.className = 'channel-item';
                item.dataset.type = type;
                item.innerHTML =
                    '<div class="channel-item-icon ' + meta.iconClass + '">' + escapeHtml(meta.icon) + '</div>' +
                    '<div class="channel-item-info">' +
                    '<div class="channel-item-name">' + escapeHtml(meta.name) + '</div>' +
                    '<div class="channel-item-status ' + (isOn ? 'on' : '') + '">' + (isOn ? '已启用' : '未启用') + '</div>' +
                    '</div>' +
                    '<svg class="channel-item-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

                item.addEventListener('click', function () {
                    openChannelDrawer(type);
                });
                list.appendChild(item);
            });

            page.appendChild(list);

            var overlay = document.createElement('div');
            overlay.className = 'channel-drawer-overlay';
            overlay.id = 'channel-drawer-overlay';
            overlay.addEventListener('click', closeChannelDrawer);

            var drawer = document.createElement('div');
            drawer.className = 'channel-drawer';
            drawer.id = 'channel-drawer';

            page.appendChild(overlay);
            page.appendChild(drawer);
            channelView.appendChild(page);
        }

        function openChannelDrawer(type) {
            openDrawerType = type;
            var cfg = (channelsData.config && channelsData.config[type]) || {};
            var meta = getChannelMeta(type);
            var isOn = !!cfg.enabled;

            document.querySelectorAll('.channel-item').forEach(function (el) {
                el.classList.toggle('active', el.dataset.type === type);
            });

            var drawer = document.getElementById('channel-drawer');
            var fieldsHtml = '';
            if (type === 'telegram') {
                fieldsHtml =
                    '<div class="channel-drawer-field">' +
                    '<label class="channel-drawer-field-label">Bot Token</label>' +
                    '<input class="channel-drawer-input" id="ch-token-' + type + '" type="password" value="' + escapeHtml(cfg.token || '') + '" placeholder="从 @BotFather 获取的 Token" spellcheck="false">' +
                    '</div>';
            } else if (type === 'weixin') {
                fieldsHtml =
                    '<div class="channel-drawer-field">' +
                    '<label class="channel-drawer-field-label">Bot Token <span style="font-weight:400;color:var(--text-dim)">(首次启用后扫码自动填入)</span></label>' +
                    '<input class="channel-drawer-input" id="ch-token-' + type + '" type="password" value="' + escapeHtml(cfg.token || '') + '" placeholder="扫码后自动填入" spellcheck="false">' +
                    '</div>' +
                    '<div class="channel-drawer-field">' +
                    '<label class="channel-drawer-field-label">Account ID</label>' +
                    '<input class="channel-drawer-input" id="ch-account-' + type + '" value="' + escapeHtml(cfg.accountId || '') + '" placeholder="扫码后自动填入" spellcheck="false">' +
                    '</div>';
            } else {
                fieldsHtml =
                    '<div class="channel-drawer-field">' +
                    '<label class="channel-drawer-field-label">App ID</label>' +
                    '<input class="channel-drawer-input" id="ch-appid-' + type + '" value="' + escapeHtml(cfg.appId || '') + '" placeholder="输入 App ID" spellcheck="false">' +
                    '</div>' +
                    '<div class="channel-drawer-field">' +
                    '<label class="channel-drawer-field-label">App Secret</label>' +
                    '<input class="channel-drawer-input" id="ch-secret-' + type + '" type="password" value="' + escapeHtml(cfg.appSecret || '') + '" placeholder="输入 App Secret" spellcheck="false">' +
                    '</div>';
            }
            fieldsHtml +=
                '<div class="channel-drawer-field">' +
                '<label class="channel-drawer-field-label">Owner Chat ID <span style="font-weight:400;color:var(--text-dim)">(私聊机器人后自动填入)</span></label>' +
                '<input class="channel-drawer-input" id="ch-owner-' + type + '" value="' + escapeHtml(cfg.ownerChatId || '') + '" placeholder="私聊机器人一次即可自动记录" spellcheck="false">' +
                '</div>';

            drawer.innerHTML =
                '<div class="channel-drawer-header">' +
                '<div class="channel-drawer-icon ' + meta.iconClass + '">' + escapeHtml(meta.icon) + '</div>' +
                '<span class="channel-drawer-title">' + escapeHtml(meta.name) + '</span>' +
                '<button class="channel-drawer-close" id="drawer-close-btn">' +
                '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
                '</button>' +
                '</div>' +
                '<div class="channel-drawer-body">' +
                '<div class="channel-drawer-row">' +
                '<span class="channel-drawer-row-label">启用频道</span>' +
                '<button class="channel-toggle ' + (isOn ? 'on' : '') + '" id="ch-toggle-' + type + '"></button>' +
                '</div>' +
                '<div class="channel-drawer-fields">' + fieldsHtml + '</div>' +
                '</div>' +
                '<div class="channel-drawer-footer">' +
                '<button class="channel-drawer-save" id="ch-save-' + type + '">保存</button>' +
                '<span class="channel-save-ok" id="save-ok-' + type + '">' +
                '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '已保存' +
                '</span>' +
                '</div>';

            document.getElementById('drawer-close-btn').addEventListener('click', closeChannelDrawer);
            document.getElementById('ch-toggle-' + type).addEventListener('click', function () {
                this.classList.toggle('on');
                if (type === 'weixin' && this.classList.contains('on')) {
                    var tokenInput = document.getElementById('ch-token-' + type);
                    var accountInput = document.getElementById('ch-account-' + type);
                    var hasToken = tokenInput && tokenInput.value.trim();
                    var hasAccount = accountInput && accountInput.value.trim();
                    if (!hasToken || !hasAccount) {
                        openWeixinLoginModal({
                            state: 'pending',
                            message: '正在生成微信登录二维码…'
                        });
                        startWeixinLoginPolling(true);
                        saveChannel(type);
                    }
                }
            });
            document.getElementById('ch-save-' + type).addEventListener('click', function () {
                saveChannel(type);
            });

            requestAnimationFrame(function () {
                document.getElementById('channel-drawer-overlay').classList.add('open');
                drawer.classList.add('open');
            });
        }

        function closeChannelDrawer() {
            var drawer = document.getElementById('channel-drawer');
            var overlay = document.getElementById('channel-drawer-overlay');
            if (drawer) drawer.classList.remove('open');
            if (overlay) overlay.classList.remove('open');
            document.querySelectorAll('.channel-item').forEach(function (el) {
                el.classList.remove('active');
            });
            openDrawerType = null;
        }

        async function saveChannel(type) {
            var toggle = document.getElementById('ch-toggle-' + type);
            var saveBtn = document.getElementById('ch-save-' + type);

            var payload = { enabled: toggle.classList.contains('on') };

            if (type === 'telegram') {
                var tokenInput = document.getElementById('ch-token-' + type);
                payload.token = tokenInput.value.trim();
            } else if (type === 'weixin') {
                var wxTokenInput = document.getElementById('ch-token-' + type);
                var accountInput = document.getElementById('ch-account-' + type);
                var currentWeixinCfg = (channelsData && channelsData.config && channelsData.config.weixin) || {};
                payload.token = wxTokenInput.value.trim();
                payload.accountId = accountInput.value.trim();
                payload.baseUrl = currentWeixinCfg.baseUrl || 'https://ilinkai.weixin.qq.com';
                payload.botAgent = currentWeixinCfg.botAgent || 'AnyBot/0.1.0';
                payload.botType = currentWeixinCfg.botType || '3';
            } else {
                var appIdInput = document.getElementById('ch-appid-' + type);
                var appSecretInput = document.getElementById('ch-secret-' + type);
                payload.appId = appIdInput.value.trim();
                payload.appSecret = appSecretInput.value.trim();
            }
            var ownerInput = document.getElementById('ch-owner-' + type);
            if (ownerInput) {
                payload.ownerChatId = ownerInput.value.trim();
            }

            saveBtn.disabled = true;
            saveBtn.textContent = '保存中…';

            try {
                var res = await fetch('/api/channels/' + type, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload),
                });

                if (!res.ok) {
                    var err = await res.json().catch(function () {
                        return {};
                    });
                    showError(err.error || '保存失败');
                    return;
                }

                var updatedConfig = await res.json();
                if (channelsData) {
                    channelsData.config = updatedConfig;
                }

                var okEl = document.getElementById('save-ok-' + type);
                okEl.classList.add('show');
                setTimeout(function () {
                    okEl.classList.remove('show');
                }, 2000);

                var statusEl = document.querySelector('.channel-item[data-type="' + type + '"] .channel-item-status');
                if (statusEl) {
                    var nowOn = toggle.classList.contains('on');
                    statusEl.textContent = nowOn ? '已启用' : '未启用';
                    statusEl.className = 'channel-item-status' + (nowOn ? ' on' : '');
                }

            } catch (e) {
                showError('保存频道配置失败');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = '保存';
            }
        }

        function isWeixinBound() {
            var cfg = (channelsData && channelsData.config && channelsData.config.weixin) || {};
            return !!(cfg.token && cfg.accountId);
        }

        function syncWeixinDrawerFields() {
            var cfg = (channelsData && channelsData.config && channelsData.config.weixin) || {};
            var tokenInput = document.getElementById('ch-token-weixin');
            var accountInput = document.getElementById('ch-account-weixin');
            var ownerInput = document.getElementById('ch-owner-weixin');
            var toggle = document.getElementById('ch-toggle-weixin');

            if (tokenInput) tokenInput.value = cfg.token || '';
            if (accountInput) accountInput.value = cfg.accountId || '';
            if (ownerInput) ownerInput.value = cfg.ownerChatId || '';
            if (toggle) toggle.classList.toggle('on', !!cfg.enabled);

            var statusEl = document.querySelector('.channel-item[data-type="weixin"] .channel-item-status');
            if (statusEl) {
                statusEl.textContent = cfg.enabled ? '已启用' : '未启用';
                statusEl.className = 'channel-item-status' + (cfg.enabled ? ' on' : '');
            }
        }

        function openWeixinLoginModal(status) {
            var existing = document.getElementById('weixin-login-overlay');
            if (existing) {
                updateWeixinLoginModal(status || {});
                return;
            }

            var overlay = document.createElement('div');
            overlay.className = 'weixin-login-overlay open';
            overlay.id = 'weixin-login-overlay';
            overlay.innerHTML =
                '<div class="weixin-login-modal">' +
                '<button class="weixin-login-close" id="weixin-login-close" aria-label="关闭">' +
                '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
                '</button>' +
                '<div class="weixin-login-icon">微</div>' +
                '<div class="weixin-login-title">微信扫码绑定</div>' +
                '<div class="weixin-login-subtitle" id="weixin-login-message">正在生成微信登录二维码…</div>' +
                '<div class="weixin-login-qr-frame">' +
                '<img class="weixin-login-qr" id="weixin-login-qr" alt="微信登录二维码">' +
                '<div class="weixin-login-placeholder" id="weixin-login-placeholder">等待二维码</div>' +
                '</div>' +
                '<a class="weixin-login-link" id="weixin-login-link" href="#" target="_blank" rel="noreferrer">打开二维码链接</a>' +
                '</div>';
            document.body.appendChild(overlay);
            document.getElementById('weixin-login-close').addEventListener('click', closeWeixinLoginModal);
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) closeWeixinLoginModal();
            });
            updateWeixinLoginModal(status || {});
        }

        function closeWeixinLoginModal() {
            if (weixinLoginPollTimer) {
                clearInterval(weixinLoginPollTimer);
                weixinLoginPollTimer = null;
            }
            var overlay = document.getElementById('weixin-login-overlay');
            if (!overlay) return;
            overlay.classList.remove('open');
            setTimeout(function () { overlay.remove(); }, 180);
        }

        function updateWeixinLoginModal(status) {
            var overlay = document.getElementById('weixin-login-overlay');
            if (!overlay) return;
            var messageEl = document.getElementById('weixin-login-message');
            var imgEl = document.getElementById('weixin-login-qr');
            var placeholderEl = document.getElementById('weixin-login-placeholder');
            var linkEl = document.getElementById('weixin-login-link');
            var message = status.message || '正在生成微信登录二维码…';
            if (status.state === 'confirmed') message = '微信绑定成功';
            if (status.state === 'failed') message = status.message || '微信绑定失败';
            messageEl.textContent = message;

            if (status.qrcodeDataUrl) {
                imgEl.src = status.qrcodeDataUrl;
                imgEl.style.display = 'block';
                placeholderEl.style.display = 'none';
            } else {
                imgEl.style.display = 'none';
                placeholderEl.style.display = 'flex';
            }

            if (status.qrcodeUrl) {
                linkEl.href = status.qrcodeUrl;
                linkEl.style.display = 'inline-flex';
            } else {
                linkEl.style.display = 'none';
            }
        }

        function startWeixinLoginPolling(showModal) {
            if (weixinLoginPollTimer) clearInterval(weixinLoginPollTimer);
            pollWeixinLoginStatus(showModal);
            weixinLoginPollTimer = setInterval(function () {
                pollWeixinLoginStatus(showModal);
            }, 1500);
        }

        async function pollWeixinLoginStatus(showModal) {
            try {
                await fetchChannels();
                if (isWeixinBound()) {
                    syncWeixinDrawerFields();
                    closeWeixinLoginModal();
                    return;
                }

                var res = await fetch('/api/channels/weixin/login-status');
                if (!res.ok) return;
                var status = await res.json();
                var shouldShow = showModal || ['pending', 'scanned', 'waiting_code'].indexOf(status.state) >= 0;
                if (!shouldShow || status.state === 'idle') return;
                openWeixinLoginModal(status);
                if (status.state === 'confirmed') {
                    if (weixinLoginPollTimer) {
                        clearInterval(weixinLoginPollTimer);
                        weixinLoginPollTimer = null;
                    }
                    await fetchChannels();
                    syncWeixinDrawerFields();
                    closeWeixinLoginModal();
                }
                if (status.state === 'failed' && weixinLoginPollTimer) {
                    clearInterval(weixinLoginPollTimer);
                    weixinLoginPollTimer = null;
                }
            } catch (e) {
                console.error('Failed to fetch weixin login status:', e);
            }
        }

        function getActiveSlashProviderType() {
            var providerData = settingsController ? settingsController.getProviderData() : null;
            var modelConfig = settingsController ? settingsController.getModelConfig() : null;
            return currentSessionProvider || (providerData && providerData.current) || (modelConfig && modelConfig.provider) || '';
        }

        function getProviderQuery(providerType) {
            return providerType ? '?provider=' + encodeURIComponent(providerType) : '';
        }

        function getSlashItemsCacheKey(providerType) {
            return providerType || '__current__';
        }

        async function fetchSkills() {
            var providerType = getActiveSlashProviderType();
            try {
                var res = await fetch('/api/skills' + getProviderQuery(providerType));
                skillsData = await res.json();
                skillsDataProvider = providerType;
                invalidateSlashItemsData(providerType);
            } catch (e) {
                console.error('Failed to fetch skills:', e);
                skillsData = { skills: [], sources: [] };
                skillsDataProvider = providerType;
            }
        }

        function invalidateSlashItemsData(providerType) {
            if (providerType) {
                delete slashItemsDataCache[getSlashItemsCacheKey(providerType)];
                if (slashItemsDataProvider !== providerType) return;
            } else {
                slashItemsDataCache = {};
            }
            slashItemsData = null;
            slashItemsDataProvider = '';
            slashItemsDataFetchedAt = 0;
        }

        async function fetchSlashItemsData(force) {
            var providerType = getActiveSlashProviderType();
            var cacheKey = getSlashItemsCacheKey(providerType);
            var cached = slashItemsDataCache[cacheKey];
            if (!force && cached && Date.now() - cached.fetchedAt < SLASH_ITEMS_CACHE_TTL) {
                slashItemsData = cached.data;
                slashItemsDataProvider = providerType;
                slashItemsDataFetchedAt = cached.fetchedAt;
                return;
            }
            try {
                var res = await fetch('/api/slash/items' + getProviderQuery(providerType));
                slashItemsData = await res.json();
                slashItemsDataProvider = providerType;
                slashItemsDataFetchedAt = Date.now();
                slashItemsDataCache[cacheKey] = {
                    data: slashItemsData,
                    fetchedAt: slashItemsDataFetchedAt,
                };
            } catch (e) {
                console.error('Failed to fetch slash items:', e);
                slashItemsData = { groups: [] };
                slashItemsDataProvider = providerType;
                slashItemsDataFetchedAt = 0;
            }
        }

        var skillsSearchTerm = '';

        function renderSkillsView() {
            skillsView.innerHTML = '';
            if (!skillsData) return;

            var page = document.createElement('div');
            page.className = 'skills-page';

            var header = document.createElement('div');
            header.className = 'skills-header';
            header.innerHTML =
                '<div class="skills-header-top">' +
                '<div class="skills-header-icon">' +
                '<svg width="22" height="22" viewBox="0 0 14 14" fill="none"><path d="M7 1L8.5 4.5L12.5 5L9.75 7.5L10.5 11.5L7 9.5L3.5 11.5L4.25 7.5L1.5 5L5.5 4.5L7 1Z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '</div>' +
                '<div>' +
                '<div class="skills-header-title">技能管理</div>' +
                '<div class="skills-header-count">' + skillsData.skills.length + ' 个技能可用</div>' +
                '</div>' +
                '</div>';
            page.appendChild(header);

            var toolbar = document.createElement('div');
            toolbar.className = 'skills-toolbar';

            var searchInput = document.createElement('input');
            searchInput.className = 'skills-search';
            searchInput.type = 'text';
            searchInput.placeholder = '搜索技能名称、描述或路径…';
            searchInput.value = skillsSearchTerm;
            searchInput.id = 'skills-search-input';
            searchInput.addEventListener('input', function () {
                skillsSearchTerm = this.value;
                renderSkillsList();
            });

            var refreshBtn = document.createElement('button');
            refreshBtn.className = 'skills-toolbar-btn';
            refreshBtn.title = '刷新';
            refreshBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 7a5.5 5.5 0 0 1 9.35-3.95M12.5 7a5.5 5.5 0 0 1-9.35 3.95" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M10.5 1v2.5H13M3.5 13v-2.5H1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            refreshBtn.addEventListener('click', function () {
                fetchSkills().then(function () {
                    renderSkillsView();
                    showSaveStatus('技能列表已刷新');
                });
            });

            var openFolderBtn = document.createElement('button');
            openFolderBtn.className = 'skills-toolbar-btn';
            openFolderBtn.title = '打开文件夹';
            openFolderBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 3.5v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H7L5.5 3.5H2.5a1 1 0 0 0-1 1z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            openFolderBtn.addEventListener('click', function () {
                fetch('/api/skills/open-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider: skillsDataProvider || getActiveSlashProviderType() }),
                });
            });

            toolbar.appendChild(searchInput);
            toolbar.appendChild(refreshBtn);
            toolbar.appendChild(openFolderBtn);
            page.appendChild(toolbar);

            var listContainer = document.createElement('div');
            listContainer.className = 'skills-list';
            listContainer.id = 'skills-list-container';
            page.appendChild(listContainer);

            var footer = document.createElement('div');
            footer.className = 'skills-footer';
            footer.innerHTML =
                '<div class="skills-save-status" id="skills-save-status">' +
                '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '所有更改已保存' +
                '</div>' +
                '<div class="skills-footer-actions">' +
                '<button class="skills-footer-btn" id="skills-close-btn">关闭</button>' +
                '</div>';
            page.appendChild(footer);

            skillsView.appendChild(page);

            document.getElementById('skills-close-btn').addEventListener('click', function () {
                showChatView();
            });

            renderSkillsList();
        }

        function renderSkillsList() {
            var container = document.getElementById('skills-list-container');
            if (!container || !skillsData) return;
            container.innerHTML = '';

            var term = skillsSearchTerm.toLowerCase().trim();
            var filtered = skillsData.skills;
            if (term) {
                filtered = filtered.filter(function (s) {
                    return s.name.toLowerCase().indexOf(term) !== -1 ||
                        s.description.toLowerCase().indexOf(term) !== -1 ||
                        s.fullPath.toLowerCase().indexOf(term) !== -1;
                });
            }

            if (filtered.length === 0) {
                container.innerHTML =
                    '<div class="skills-empty">' +
                    '<div class="skills-empty-icon">' +
                    '<svg width="20" height="20" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 9.5L12.5 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
                    '</div>' +
                    '<div class="skills-empty-text">' + (term ? '没有找到匹配的技能' : '暂无可用技能') + '</div>' +
                    '</div>';
                return;
            }

            var grouped = {};
            filtered.forEach(function (s) {
                if (!grouped[s.source]) grouped[s.source] = [];
                grouped[s.source].push(s);
            });

            Object.keys(grouped).forEach(function (source) {
                var items = grouped[source];
                var group = document.createElement('div');
                group.className = 'skills-group';

                var label = document.createElement('div');
                label.className = 'skills-group-label';
                label.innerHTML = escapeHtml(source) + ' <span class="skills-group-badge">' + items.length + '</span>';
                group.appendChild(label);

                items.forEach(function (skill) {
                    group.appendChild(createSkillCard(skill));
                });

                container.appendChild(group);
            });
        }

        function createSkillCard(skill) {
            return createSkillCardElement(skill, {
                getProviderType: function () {
                    return skillsDataProvider || getActiveSlashProviderType();
                },
                getProviderQuery: getProviderQuery,
                invalidateSlashItemsData: invalidateSlashItemsData,
                showError: showError,
                showSaveStatus: showSaveStatus,
                onDeleted: function (deletedSkill, providerType) {
                    if (skillsData) {
                        skillsData.skills = skillsData.skills.filter(function (s) { return s.id !== deletedSkill.id; });
                    }
                    invalidateSlashItemsData(providerType);
                    var countEl = document.querySelector('.skills-header-count');
                    if (countEl && skillsData) countEl.textContent = skillsData.skills.length + ' 个技能可用';
                    showSaveStatus('已删除: ' + deletedSkill.name);
                },
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && openDrawerType) {
                closeChannelDrawer();
                return;
            }
            if (currentView !== 'skills') return;
            if (e.key === '/' || (e.metaKey && e.key === 'f') || (e.ctrlKey && e.key === 'f')) {
                var searchEl = document.getElementById('skills-search-input');
                if (searchEl && document.activeElement !== searchEl) {
                    e.preventDefault();
                    searchEl.focus();
                }
            }
        });

        async function init() {
            setupSidebarTooltips();
            startChatInputPlaceholderRotation();
            updateProjectsCollapsedState();
            updateHistoryCollapsedState();
            await Promise.all([fetchProjects(), fetchSessions(), fetchModelConfig(), fetchProviders(), fetchSandboxConfig(), fetchAppSettings(), fetchProxyConfig()]);
            var initialSessions = sidebarController.getSessions();
            if (initialSessions.length > 0) {
                await loadSession(initialSessions[0].id);
            } else {
                await createNewChat();
            }
            startRealtimeEvents();
            inputEl.focus();
        }

        init();
    })();
