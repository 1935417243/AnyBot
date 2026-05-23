import { createAttachmentController } from './chat/attachments.js';
import { bindChatInputEvents } from './chat/input-events.js';
import { createInputHistoryController } from './chat/input-history.js';
import { createMessageListController } from './chat/message-list-controller.js';
import { createMessageMetaController } from './chat/message-meta.js';
import { createSendMessageController } from './chat/send-message.js';
import { createSessionController } from './chat/session-controller.js';
import { createSlashPickerController } from './chat/slash-picker.js';
import { createChannelsPageController } from './channels/channels-page.js';
import { createSidebarController } from './sidebar/sidebar-controller.js';
import { createSettingsController } from './settings/settings-controller.js';
import {
    isSelectionOnlyFallback,
    normalizeMessageProjects,
    normalizeMessageSkills,
} from './chat/message-selection.js';
import { renderMarkdown, configureMarkdown } from './markdown.js';
import { createSkillsPageController } from './skills/skills-page.js';
import { copyCode } from './ui/code-copy.js';
import { openImageModal } from './ui/image-modal.js';

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

        let latestContextUsage = null;
        let slashPickerController = null;
        let messageListController = null;
        let messageMetaController = null;
        let sessionController = null;
        let sidebarController = null;
        let settingsController = null;
        let channelsPageController = null;
        let skillsPageController = null;
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
                return sessionController ? sessionController.getCurrentSessionId() : null;
            },
            getCurrentSessionProvider: function () {
                return sessionController ? sessionController.getCurrentSessionProvider() : null;
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
            var isRunning = !!(sessionController && sessionController.getIsTyping());
            var isCancelling = !!(sessionController && sessionController.getIsCancellingResponse());
            var promptSelection = slashPickerController
                ? slashPickerController.getSelection()
                : { skills: [], projects: [] };
            sendBtn.classList.toggle('is-stop', isRunning);
            sendBtn.innerHTML = isRunning ? STOP_BUTTON_ICON : SEND_BUTTON_ICON;
            sendBtn.title = isRunning ? (isCancelling ? '正在中断' : '中断') : '发送';
            sendBtn.setAttribute('aria-label', sendBtn.title);
            sendBtn.disabled = isRunning
                ? isCancelling
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
                return sessionController ? sessionController.getCurrentSessionProjectId() : null;
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
                return sessionController ? sessionController.getCurrentSessionId() : null;
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
                return sessionController ? sessionController.getIsTyping() : false;
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
                return sessionController ? sessionController.getActiveStreamSessionId() : null;
            },
            getChannelMeta: getChannelMeta,
            getCurrentNewestMessageId: function () {
                return sessionController ? sessionController.getCurrentNewestMessageId() : 0;
            },
            getCurrentSessionId: function () {
                return sessionController ? sessionController.getCurrentSessionId() : null;
            },
            getCurrentSessionProjectId: function () {
                return sessionController ? sessionController.getCurrentSessionProjectId() : null;
            },
            getCurrentSessionUpdatedAt: function () {
                return sessionController ? sessionController.getCurrentSessionUpdatedAt() : 0;
            },
            getCurrentView: function () {
                return currentView;
            },
            getIsLoadingOlderMessages: function () {
                return messageListController ? messageListController.getIsLoadingOlderMessages() : false;
            },
            getIsTyping: function () {
                return sessionController ? sessionController.getIsTyping() : false;
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
                if (sessionController) sessionController.setCurrentNewestMessageId(value);
            },
            setCurrentSessionUpdatedAt: function (value) {
                if (sessionController) sessionController.setCurrentSessionUpdatedAt(value);
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

        messageMetaController = createMessageMetaController({
            showError: showError,
        });
        messageMetaController.installGlobal();

        messageListController = createMessageListController({
            attachMessageMeta: messageMetaController.attachMessageMeta,
            copyCode: copyCode,
            getCurrentSessionId: function () {
                return sessionController ? sessionController.getCurrentSessionId() : null;
            },
            imageExts: IMAGE_EXTS,
            largeMessagePreviewChars: LARGE_MESSAGE_PREVIEW_CHARS,
            messagesEl: messagesEl,
            openImageModal: openImageModal,
            prependInputHistoryMessages: prependInputHistoryMessages,
            renderMarkdown: renderMarkdown,
            formatTokenCount: formatTokenCount,
            sessionMessagePageSize: SESSION_MESSAGE_PAGE_SIZE,
            showError: showError,
            updateContextUsage: updateContextUsage,
        });

        function scrollBottom() {
            return messageListController.scrollBottom();
        }

        function updateConversationHeaderTitle(title) {
            return messageListController.updateConversationHeaderTitle(title);
        }

        function showEmptyState() {
            return messageListController.showEmptyState();
        }

        function appendMessage(role, text, attachments, changeReview, opts) {
            return messageListController.appendMessage(role, text, attachments, changeReview, opts);
        }

        function getOldestRenderedMessageId() {
            return messageListController ? messageListController.getOldestRenderedMessageId() : null;
        }

        function getNewestMessageId(messages) {
            return messageListController ? messageListController.getNewestMessageId(messages) : 0;
        }

        function showTyping() {
            return messageListController.showTyping();
        }

        function removeTyping() {
            return messageListController.removeTyping();
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

        function parseMessageMetadata(raw) {
            return messageListController ? messageListController.parseMessageMetadata(raw) : {};
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

        sessionController = createSessionController({
            clearPromptSkills: clearPromptSkills,
            clearSessionModelSelection: function (sessionId) {
                settingsController.clearSessionModelSelection(sessionId);
            },
            expandProject: function (projectId) {
                return sidebarController.expandProject(projectId);
            },
            fetchModelConfig: fetchModelConfig,
            fetchSessions: fetchSessions,
            findSessionSummary: findSessionSummary,
            getActiveProjectId: function () {
                return sidebarController.getActiveProjectId();
            },
            getCurrentView: function () {
                return currentView;
            },
            getProviderData: function () {
                return settingsController.getProviderData();
            },
            inputEl: inputEl,
            messagesEl: messagesEl,
            renderHistory: renderHistory,
            renderProjects: renderProjects,
            renderSessionMessages: function (messages, hasMoreMessages) {
                return messageListController.renderSessionMessages(messages, hasMoreMessages);
            },
            resetInputHistoryFromMessages: resetInputHistoryFromMessages,
            resizeChatInput: resizeChatInput,
            revealActiveSessionInSidebar: revealActiveSessionInSidebar,
            revealSessionContainer: revealSessionContainer,
            scrollBottom: scrollBottom,
            sessionMessagePageSize: SESSION_MESSAGE_PAGE_SIZE,
            setActiveProjectId: function (projectId) {
                sidebarController.setActiveProjectId(projectId);
            },
            setSendButtonDisabled: function (value) {
                sendBtn.disabled = value;
            },
            showChatView: showChatView,
            showEmptyState: showEmptyState,
            showError: showError,
            updateContextUsage: updateContextUsage,
            updateConversationHeaderTitle: updateConversationHeaderTitle,
            updateSendBtnState: updateSendBtnState,
            updateSidebarSelection: updateSidebarSelection,
        });

        async function createNewChat(projectId, options) {
            return sessionController.createNewChat(projectId, options);
        }

        async function cancelCurrentResponse() {
            return sessionController.cancelCurrentResponse();
        }

        async function loadSession(id, options) {
            return sessionController.loadSession(id, options);
        }

        async function deleteSession(id) {
            return sessionController.deleteSession(id);
        }

        const sendMessageController = createSendMessageController({
            inputEl: inputEl,
            messagesEl: messagesEl,
            getState: function () {
                var promptSelection = slashPickerController.getSelection();
                return {
                    currentSessionId: sessionController.getCurrentSessionId(),
                    currentSessionProvider: sessionController.getCurrentSessionProvider(),
                    isTyping: sessionController.getIsTyping(),
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
                sessionController.setTyping(value);
            },
            setCancelling: function (value) {
                sessionController.setCancelling(value);
            },
            setSendButtonDisabled: function (value) {
                sendBtn.disabled = value;
            },
            setActiveStream: function (controller, sessionId) {
                sessionController.setActiveStream(controller, sessionId);
            },
            clearActiveStreamForSession: function (sessionId) {
                sessionController.clearActiveStreamForSession(sessionId);
            },
            setCurrentSessionProvider: function (provider) {
                sessionController.setCurrentSessionProvider(provider);
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

        var slashItemsData = null;
        var slashItemsDataProvider = '';
        var slashItemsDataFetchedAt = 0;
        var slashItemsDataCache = {};
        var SLASH_ITEMS_CACHE_TTL = 5 * 1000;
        var currentView = 'chat';

        channelsPageController = createChannelsPageController({
            channelView: channelView,
            getChannelMeta: getChannelMeta,
            showError: showError,
        });

        skillsPageController = createSkillsPageController({
            getActiveSlashProviderType: getActiveSlashProviderType,
            getProviderQuery: getProviderQuery,
            invalidateSlashItemsData: invalidateSlashItemsData,
            showChatView: showChatView,
            showError: showError,
            skillsView: skillsView,
        });

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
            channelsPageController.render();
        }

        function showSkillsPage() {
            hideAllViews();
            currentView = 'skills';
            skillsView.style.display = 'flex';
            skillsBtn.classList.add('active');
            renderHistory();
            skillsPageController.render();
        }

        channelsBtn.addEventListener('click', function () {
            if (currentView === 'channels') return;
            if (!channelsPageController.hasChannelsData()) {
                channelsPageController.fetchChannels().then(function () {
                    showChannelsPage();
                });
            } else {
                showChannelsPage();
            }
        });

        skillsBtn.addEventListener('click', function () {
            if (currentView === 'skills') return;
            skillsPageController.fetchSkills().then(function () {
                showSkillsPage();
            });
        });

        function getActiveSlashProviderType() {
            var providerData = settingsController ? settingsController.getProviderData() : null;
            var modelConfig = settingsController ? settingsController.getModelConfig() : null;
            var currentProvider = sessionController ? sessionController.getCurrentSessionProvider() : null;
            return currentProvider || (providerData && providerData.current) || (modelConfig && modelConfig.provider) || '';
        }

        function getProviderQuery(providerType) {
            return providerType ? '?provider=' + encodeURIComponent(providerType) : '';
        }

        function getSlashItemsCacheKey(providerType) {
            return providerType || '__current__';
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

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && channelsPageController.handleEscape()) {
                return;
            }
            if (currentView !== 'skills') return;
            skillsPageController.handleKeydown(e);
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
