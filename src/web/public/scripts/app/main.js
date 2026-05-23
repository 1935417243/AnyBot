import { createAttachmentController } from './chat/attachments.js';
import { bindChatInputEvents } from './chat/input-events.js';
import { createInputHistoryController } from './chat/input-history.js';
import { createMessageRenderer } from './chat/message-renderer.js';
import { createSendMessageController } from './chat/send-message.js';
import { createSlashPickerController } from './chat/slash-picker.js';
import { createSidebarController } from './sidebar/sidebar-controller.js';
import {
    isSelectionOnlyFallback,
    normalizeMessageProjects,
    normalizeMessageSkills,
} from './chat/message-selection.js';
import { renderMarkdown, configureMarkdown } from './markdown.js';
import { createSkillCard as createSkillCardElement, showSkillsSaveStatus as showSaveStatus } from './skills/skill-card.js';
import { copyCode } from './ui/code-copy.js';
import { openImageModal } from './ui/image-modal.js';
import { buildSettingsComboboxOptionHtml, createSettingsSingleSelectCombobox } from './ui/settings-combobox.js';
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
        const settingsLanguageSelect = document.getElementById('settings-language-select');
        const settingsOpenLogin = document.getElementById('settings-open-login');
        const settingsOpenWindow = document.getElementById('settings-open-window');
        const settingsWebPort = document.getElementById('settings-web-port');
        const settingsProviderModelCombobox = document.getElementById('settings-provider-model-combobox');
        const settingsProviderModelTrigger = document.getElementById('settings-provider-model-trigger');
        const settingsProviderModelCurrent = document.getElementById('settings-provider-model-current');
        const settingsProviderModelMenu = document.getElementById('settings-provider-model-menu');
        const settingsProviderModelSelect = document.getElementById('settings-provider-model-select');
        const settingsProviderStatus = document.getElementById('settings-provider-status');
        const settingsProviderCompatToggleFields = document.getElementById('settings-provider-compat-toggle-fields');
        const settingsProviderBinFields = document.getElementById('settings-provider-bin-fields');
        const settingsProviderExtraFields = document.getElementById('settings-provider-extra-fields');
        const settingsProviderDetectBtn = document.getElementById('settings-provider-detect-btn');
        const settingsDangerConfirm = document.getElementById('settings-danger-confirm');
        const settingsDefaultWorkdir = document.getElementById('settings-default-workdir');
        const settingsWorkdirOpenBtn = document.getElementById('settings-workdir-open-btn');
        const settingsWorkdirPickBtn = document.getElementById('settings-workdir-pick-btn');
        const settingsProjectsEntryBtn = document.getElementById('settings-projects-entry-btn');
        const settingsLogLevel = document.getElementById('settings-log-level');
        const settingsLogContent = document.getElementById('settings-log-content');
        const settingsLogPrompt = document.getElementById('settings-log-prompt');
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
        let modelConfig = null;
        let providerData = null;
        let sandboxConfig = null;
        let appSettingsPayload = null;
        let appSettings = null;
        let settingsModelConfig = null;
        let selectedSandbox = null;
        let activeSettingsTab = 'general';
        let desktopUpdateStatus = null;
        let desktopUpdatePollTimer = null;
        let sessionModelSelections = {};
        let settingsProviderModelComboboxController = null;
        let latestContextUsage = null;
        let activeStreamSessionId = null;
        let activeStreamAbortController = null;
        let isBatchRenderingMessages = false;
        let currentSessionHasMoreMessages = false;
        let currentSessionUpdatedAt = 0;
        let currentNewestMessageId = 0;
        let isLoadingOlderMessages = false;
        const GITHUB_LATEST_RELEASE_URL = 'https://github.com/1935417243/AnyBot/releases/latest';
        let slashPickerController = null;
        let sidebarController = null;
        const SESSION_MESSAGE_PAGE_SIZE = 40;
        const HISTORY_SESSION_PREVIEW_LIMIT = 4;
        const PROJECT_SESSION_PREVIEW_LIMIT = 4;
        const LARGE_MESSAGE_PREVIEW_CHARS = 20000;
        const THEME_STORAGE_KEY = 'webuiTheme';
        const THEME_OPTIONS = [
            {id: 'light', name: '浅色'},
            {id: 'dark', name: '深色'},
            {id: 'system', name: '自动'},
        ];
        const HIGHLIGHT_DARK_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark-dimmed.min.css';
        const HIGHLIGHT_LIGHT_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
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
        const systemThemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
        let currentThemeSetting = readStoredTheme();
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

        function readStoredTheme() {
            var value = localStorage.getItem(THEME_STORAGE_KEY);
            return ['light', 'dark', 'system'].includes(value) ? value : 'dark';
        }

        function getEffectiveTheme(setting) {
            if (setting === 'system') {
                return systemThemeQuery && systemThemeQuery.matches ? 'light' : 'dark';
            }
            return setting === 'light' ? 'light' : 'dark';
        }

        function applyTheme(setting) {
            currentThemeSetting = ['light', 'dark', 'system'].includes(setting) ? setting : 'dark';
            var effectiveTheme = getEffectiveTheme(currentThemeSetting);
            document.documentElement.dataset.theme = effectiveTheme;
            document.documentElement.dataset.themeSetting = currentThemeSetting;
            document.documentElement.style.colorScheme = effectiveTheme;

            var highlightTheme = document.getElementById('highlight-theme');
            if (highlightTheme) {
                highlightTheme.href = effectiveTheme === 'light' ? HIGHLIGHT_LIGHT_CSS : HIGHLIGHT_DARK_CSS;
            }

            updateThemeDisplay();

            if (latestContextUsage) updateContextUsage(latestContextUsage);
        }

        function setTheme(setting) {
            localStorage.setItem(THEME_STORAGE_KEY, setting);
            applyTheme(setting);
        }

        function getThemeLabel(theme) {
            var option = THEME_OPTIONS.find(function (item) {
                return item.id === theme;
            });
            return option ? option.name : '自动';
        }

        function renderThemeOptions() {
            if (!settingsThemeGroup) return;
            settingsThemeGroup.innerHTML = '';
            THEME_OPTIONS.forEach(function (theme) {
                var item = document.createElement('button');
                item.className = 'settings-combobox-option theme-option';
                item.type = 'button';
                item.setAttribute('role', 'option');
                item.dataset.themeValue = theme.id;
                item.dataset.themeName = theme.name;
                item.innerHTML = buildSettingsComboboxOptionHtml(theme.id === currentThemeSetting, theme.name);
                item.addEventListener('click', async function (e) {
                    e.stopPropagation();
                    setTheme(theme.id);
                    setSettingsThemeMenuOpen(false);
                    if (settingsThemeTrigger) settingsThemeTrigger.focus();
                    await persistAppSettingsPatch({general: {theme: theme.id}}, '已保存');
                });
                item.addEventListener('keydown', handleSettingsThemeOptionKeydown);
                settingsThemeGroup.appendChild(item);
            });
            updateThemeDisplay();
        }

        function updateThemeDisplay() {
            if (settingsThemeCurrent) settingsThemeCurrent.textContent = getThemeLabel(currentThemeSetting);
            if (!settingsThemeGroup) return;
            Array.prototype.forEach.call(settingsThemeGroup.querySelectorAll('.theme-option'), function (item) {
                var isActive = item.dataset.themeValue === currentThemeSetting;
                item.classList.toggle('active', isActive);
                item.setAttribute('aria-selected', isActive ? 'true' : 'false');
                item.innerHTML = buildSettingsComboboxOptionHtml(isActive, item.dataset.themeName || '');
            });
        }

        function getSettingsThemeOptions() {
            if (!settingsThemeGroup) return [];
            return Array.prototype.slice.call(settingsThemeGroup.querySelectorAll('.theme-option'));
        }

        function setSettingsThemeMenuOpen(isOpen) {
            if (!settingsThemeCombobox || !settingsThemeTrigger) return;
            if (isOpen) {
                setSettingsSandboxMenuOpen(false);
                setSettingsProviderMenuOpen(false);
                if (settingsProviderModelComboboxController) settingsProviderModelComboboxController.setOpen(false);
            }
            settingsThemeCombobox.classList.toggle('open', isOpen);
            settingsThemeTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            if (isOpen) {
                var active = settingsThemeGroup && settingsThemeGroup.querySelector('.theme-option.active');
                requestAnimationFrame(function () {
                    (active || getSettingsThemeOptions()[0] || settingsThemeTrigger).focus();
                });
            }
        }

        function moveSettingsThemeFocus(delta) {
            var options = getSettingsThemeOptions();
            if (!options.length) return;
            var currentIndex = options.indexOf(document.activeElement);
            var nextIndex = currentIndex < 0 ? 0 : (currentIndex + delta + options.length) % options.length;
            options[nextIndex].focus();
        }

        function handleSettingsThemeOptionKeydown(e) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveSettingsThemeFocus(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveSettingsThemeFocus(-1);
            } else if (e.key === 'Home') {
                e.preventDefault();
                var first = getSettingsThemeOptions()[0];
                if (first) first.focus();
            } else if (e.key === 'End') {
                e.preventDefault();
                var options = getSettingsThemeOptions();
                var last = options[options.length - 1];
                if (last) last.focus();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.currentTarget.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setSettingsThemeMenuOpen(false);
                if (settingsThemeTrigger) settingsThemeTrigger.focus();
            }
        }

        renderThemeOptions();
        applyTheme(currentThemeSetting);

        if (settingsThemeTrigger) {
            settingsThemeTrigger.addEventListener('click', function (e) {
                e.stopPropagation();
                setSettingsThemeMenuOpen(!settingsThemeCombobox.classList.contains('open'));
            });
            settingsThemeTrigger.addEventListener('keydown', function (e) {
                if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSettingsThemeMenuOpen(true);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSettingsThemeMenuOpen(true);
                    requestAnimationFrame(function () {
                        var options = getSettingsThemeOptions();
                        var last = options[options.length - 1];
                        if (last) last.focus();
                    });
                } else if (e.key === 'Escape') {
                    setSettingsThemeMenuOpen(false);
                }
            });
        }

        if (settingsThemeGroup) {
            settingsThemeGroup.addEventListener('click', function (e) {
                e.stopPropagation();
            });
        }

        if (systemThemeQuery) {
            var handleSystemThemeChange = function () {
                if (currentThemeSetting === 'system') applyTheme('system');
            };
            if (systemThemeQuery.addEventListener) {
                systemThemeQuery.addEventListener('change', handleSystemThemeChange);
            } else if (systemThemeQuery.addListener) {
                systemThemeQuery.addListener(handleSystemThemeChange);
            }
        }

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
            var currentProviderType = providerData && providerData.current;
            var canReuseEmptySession =
                !options.force &&
                currentSessionId &&
                currentSessionProjectId === targetProjectId &&
                (!currentProviderType || currentSessionProvider === currentProviderType) &&
                !document.querySelector('#messages .message-row');
            if (canReuseEmptySession) {
                sidebarController.setActiveProjectId(targetProjectId);
                delete sessionModelSelections[currentSessionId];
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
                    modelConfig: modelConfig,
                    pendingAttachments: pendingAttachments,
                    promptProjects: promptSelection.projects,
                    promptSkills: promptSelection.skills,
                    providerData: providerData,
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

        function updateModelBadgeLabel() {
            if (!modelConfig) return;
            currentModelNameEl.textContent = modelConfig.currentModel;
            modelBadge.title = currentModelNameEl.textContent;
        }

        async function fetchModelConfig(providerType) {
            try {
                var targetProvider = providerType || currentSessionProvider || '';
                var url = '/api/model-config' + (targetProvider ? '?provider=' + encodeURIComponent(targetProvider) : '');
                var res = await fetch(url);
                modelConfig = await res.json();
                var sessionModel = currentSessionId ? sessionModelSelections[currentSessionId] : null;
                if (sessionModel && modelConfig.models && modelConfig.models.some(function (model) { return model.id === sessionModel; })) {
                    modelConfig.currentModel = sessionModel;
                }
                updateModelBadgeLabel();
                renderModelDropdown();
            } catch (e) {
                currentModelNameEl.textContent = 'error';
                console.error('Failed to fetch model config:', e);
            }
        }

        function renderModelDropdown() {
            if (!modelConfig) return;
            modelDropdown.innerHTML = '';
            modelConfig.models.forEach(function (m) {
                var opt = document.createElement('div');
                opt.className = 'model-option' + (m.id === modelConfig.currentModel ? ' active' : '');
                opt.innerHTML =
                    '<div class="model-option-name">' +
                    (m.id === modelConfig.currentModel
                        ? '<svg class="model-option-check" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                        : '<span style="width:14px;display:inline-block"></span>') +
                    escapeHtml(m.id) +
                    '</div>' +
                    '<div class="model-option-desc">' + escapeHtml(m.description) + '</div>';
                opt.addEventListener('click', function (e) {
                    e.stopPropagation();
                    switchModel(m.id);
                });
                modelDropdown.appendChild(opt);
            });
        }

        function switchModel(modelId) {
            if (!modelConfig || modelId === modelConfig.currentModel) {
                modelSwitcher.classList.remove('open');
                modelBadge.setAttribute('aria-expanded', 'false');
                return;
            }
            if (!modelConfig.models || !modelConfig.models.some(function (model) { return model.id === modelId; })) {
                showError('切换模型失败');
                return;
            }
            modelConfig.currentModel = modelId;
            if (currentSessionId) sessionModelSelections[currentSessionId] = modelId;
            updateModelBadgeLabel();
            renderModelDropdown();
            modelSwitcher.classList.remove('open');
            modelBadge.setAttribute('aria-expanded', 'false');
        }

        modelBadge.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = modelSwitcher.classList.toggle('open');
            modelBadge.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        const SETTINGS_TAB_META = {
            general: ['常规', '外观主题和默认权限'],
            provider: ['提供商', '提供商配置'],
            workspace: ['工作区', '默认工作目录和项目入口'],
            privacy: ['隐私与日志', '日志目录和清理操作'],
            about: ['关于', '版本信息和更新'],
        };

        function createDefaultAppSettings() {
            return {
                general: {
                    theme: 'system',
                    language: 'auto',
                    openAtLogin: false,
                    openWindowOnStart: true,
                    webPort: 19981,
                },
                providers: {},
                workspace: {
                    defaultWorkdir: '',
                },
                permissions: {
                    requireDangerousConfirmation: true,
                },
                privacy: {
                    logLevel: 'info',
                    logIncludeContent: false,
                    logIncludePrompt: false,
                    logRetentionDays: 3,
                },
            };
        }

        function mergeAppSettings(raw) {
            var base = createDefaultAppSettings();
            raw = raw || {};
            return {
                general: Object.assign({}, base.general, raw.general || {}),
                providers: Object.assign({}, base.providers, raw.providers || {}),
                workspace: Object.assign({}, base.workspace, raw.workspace || {}),
                permissions: Object.assign({}, base.permissions, raw.permissions || {}),
                privacy: Object.assign({}, base.privacy, raw.privacy || {}),
            };
        }

        function showSettingsStatus(message, tone) {
            if (!settingsSaveStatus) return;
            settingsSaveStatus.textContent = message || '';
            settingsSaveStatus.style.color = tone === 'error' ? '#fb7185' : '';
            clearTimeout(settingsSaveStatus._timer);
            if (message) {
                settingsSaveStatus._timer = setTimeout(function () {
                    settingsSaveStatus.textContent = '';
                    settingsSaveStatus.style.color = '';
                }, 2600);
            }
        }

        async function persistAppSettingsPatch(patch, successMessage) {
            try {
                var res = await fetch('/api/app-settings', {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(patch),
                });
                if (!res.ok) {
                    var err = await res.json().catch(function () { return {}; });
                    showError(err.error || '保存设置失败');
                    return false;
                }
                appSettingsPayload = await res.json();
                appSettings = mergeAppSettings(appSettingsPayload.settings);
                var migratedCount = Array.isArray(appSettingsPayload.migratedMemoryFiles)
                    ? appSettingsPayload.migratedMemoryFiles.length
                    : 0;
                showSettingsStatus(migratedCount > 0 ? '已保存，已复制 ' + migratedCount + ' 个记忆文件' : (successMessage || '已保存'));
                return true;
            } catch (e) {
                showError('保存设置失败');
                return false;
            }
        }

        async function fetchAppSettings() {
            try {
                var res = await fetch('/api/app-settings');
                appSettingsPayload = await res.json();
                appSettings = mergeAppSettings(appSettingsPayload.settings);
                renderAppSettings();
            } catch (e) {
                console.error('Failed to fetch app settings:', e);
                appSettings = createDefaultAppSettings();
                renderAppSettings();
            }
        }

        function renderAppSettings() {
            if (!appSettings) return;
            setTheme(appSettings.general.theme || currentThemeSetting || 'system');
            if (settingsDefaultWorkdir) {
                settingsDefaultWorkdir.value =
                    appSettings.workspace.defaultWorkdir ||
                    (appSettingsPayload && appSettingsPayload.effective && appSettingsPayload.effective.workdir) ||
                    '';
            }
            if (settingsLogRetentionDays) {
                settingsLogRetentionDays.value = String(normalizeLogRetentionDays(appSettings.privacy.logRetentionDays));
            }
            renderNetworkSettings();
            renderSettingsProviderDetails();
        }

        function normalizeLogRetentionDays(value) {
            var parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 1) return 3;
            return Math.floor(parsed);
        }

        async function persistLogRetentionDays() {
            if (!settingsLogRetentionDays) return;
            var days = normalizeLogRetentionDays(settingsLogRetentionDays.value);
            settingsLogRetentionDays.value = String(days);
            await persistAppSettingsPatch({ privacy: { logRetentionDays: days } }, '已保存日志保留时间');
        }

        function formatUpdateBytes(bytes) {
            var value = Number(bytes || 0);
            if (!Number.isFinite(value) || value <= 0) return '0 B';
            var units = ['B', 'KB', 'MB', 'GB'];
            var unit = 0;
            while (value >= 1024 && unit < units.length - 1) {
                value = value / 1024;
                unit += 1;
            }
            return (unit === 0 ? String(Math.round(value)) : value.toFixed(1)) + ' ' + units[unit];
        }

        function getUpdateStatusTone(state) {
            if (state === 'available' || state === 'downloaded' || state === 'not-available') return 'ready';
            if (state === 'unsupported' || state === 'unavailable') return '';
            if (state === 'error') return 'error';
            return '';
        }

        function formatUpdateCheckedAt(value) {
            var timestamp = Number(value || 0);
            if (!Number.isFinite(timestamp) || timestamp <= 0) return '尚未检查';
            var date = new Date(timestamp);
            if (Number.isNaN(date.getTime())) return '尚未检查';
            return date.getFullYear() + '/' +
                String(date.getMonth() + 1) + '/' +
                String(date.getDate()) + ' ' +
                String(date.getHours()).padStart(2, '0') + ':' +
                String(date.getMinutes()).padStart(2, '0') + ':' +
                String(date.getSeconds()).padStart(2, '0');
        }

        function isManualUpdateStatus(status) {
            return Boolean(status && (status.manualDownload || status.supported === false));
        }

        function getUpdateReleaseUrl(status) {
            return (status && (status.downloadUrl || status.releaseUrl)) || GITHUB_LATEST_RELEASE_URL;
        }

        function getUpdateStatusText(status) {
            if (!status) return '加载中…';
            if (status.state === 'checking') return '正在检查更新...';
            if (status.state === 'available') return '发现新版本' + (status.latestVersion ? ' · ' + status.latestVersion : '');
            if (status.state === 'downloading') return '正在下载更新...';
            if (status.state === 'downloaded') return '更新已下载，重启后安装。';
            if (status.state === 'not-available') return '当前已是最新版本。';
            if (status.state === 'unsupported' || status.state === 'unavailable') return '准备检查更新。';
            if (status.state === 'error') return '更新失败。';
            if (status.message) return status.message;
            return '准备检查更新。';
        }

        function renderDesktopUpdateStatus(status) {
            desktopUpdateStatus = status || desktopUpdateStatus;
            status = desktopUpdateStatus;
            var state = status && status.state;
            var progress = status && status.progress;
            var manualDownload = isManualUpdateStatus(status);
            if (settingsAboutVersion) {
                settingsAboutVersion.textContent = status && status.currentVersion ? status.currentVersion : '未知';
            }
            if (settingsUpdateCheckedAt) {
                settingsUpdateCheckedAt.textContent = formatUpdateCheckedAt(status && status.checkedAt);
            }
            if (settingsUpdateStatus) {
                settingsUpdateStatus.classList.remove('ready', 'warn', 'error');
                var tone = getUpdateStatusTone(state);
                if (tone) settingsUpdateStatus.classList.add(tone);
                settingsUpdateStatus.textContent = getUpdateStatusText(status);
            }

            if (settingsUpdateProgress) {
                var showProgress = state === 'downloading' && progress;
                settingsUpdateProgress.hidden = !showProgress;
                if (showProgress) {
                    var percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
                    if (settingsUpdateProgressFill) settingsUpdateProgressFill.style.width = percent.toFixed(1) + '%';
                    if (settingsUpdateProgressText) {
                        settingsUpdateProgressText.textContent =
                            percent.toFixed(1) + '% · ' +
                            formatUpdateBytes(progress.transferred) + ' / ' +
                            formatUpdateBytes(progress.total);
                    }
                }
            }

            if (settingsUpdateCheckBtn) {
                var canCheck = status && state !== 'checking' && state !== 'downloading' && state !== 'downloaded' && state !== 'restarting';
                settingsUpdateCheckBtn.disabled = !canCheck;
                settingsUpdateCheckBtn.textContent = state === 'checking' ? '检查中…' : '检查更新';
            }
            if (settingsUpdateDownloadBtn) {
                var canDownload = status && ((status.supported && state === 'available') || manualDownload);
                settingsUpdateDownloadBtn.hidden = manualDownload ? state === 'not-available' : !(state === 'available' || state === 'downloading');
                settingsUpdateDownloadBtn.disabled = !canDownload || state === 'checking' || state === 'restarting';
                settingsUpdateDownloadBtn.textContent = manualDownload
                    ? '前往下载'
                    : (state === 'downloading' ? '下载中…' : '立即下载');
            }
            if (settingsUpdateRestartBtn) {
                settingsUpdateRestartBtn.hidden = state !== 'downloaded' && state !== 'restarting';
                settingsUpdateRestartBtn.disabled = state === 'restarting';
                settingsUpdateRestartBtn.textContent = state === 'restarting' ? '重启中…' : '重启更新';
            }

            updateDesktopUpdatePolling();
        }

        async function requestDesktopUpdate(endpoint, method) {
            var res = await fetch('/api/desktop-update/' + endpoint, { method: method || 'GET' });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok) {
                throw new Error(data.error || data.message || '更新请求失败');
            }
            return data;
        }

        async function fetchDesktopUpdateStatus() {
            try {
                renderDesktopUpdateStatus(await requestDesktopUpdate('status', 'GET'));
            } catch (e) {
                renderDesktopUpdateStatus({
                    platform: '',
                    supported: false,
                    packaged: false,
                    currentVersion: desktopUpdateStatus && desktopUpdateStatus.currentVersion,
                    state: 'error',
                    message: e && e.message ? e.message : '读取更新状态失败。',
                    latestVersion: null,
                    updateInfo: null,
                    progress: null,
                    error: e && e.message ? e.message : String(e),
                });
            }
        }

        async function checkDesktopUpdate() {
            if (!settingsUpdateCheckBtn) return;
            settingsUpdateCheckBtn.disabled = true;
            settingsUpdateCheckBtn.textContent = '检查中…';
            try {
                renderDesktopUpdateStatus(await requestDesktopUpdate('check', 'POST'));
            } catch (e) {
                showError(e && e.message ? e.message : '检查更新失败');
                await fetchDesktopUpdateStatus();
            }
        }

        async function downloadDesktopUpdate() {
            if (!settingsUpdateDownloadBtn) return;
            if (isManualUpdateStatus(desktopUpdateStatus)) {
                window.open(getUpdateReleaseUrl(desktopUpdateStatus), '_blank', 'noopener');
                return;
            }
            settingsUpdateDownloadBtn.disabled = true;
            settingsUpdateDownloadBtn.textContent = '下载中…';
            try {
                renderDesktopUpdateStatus(await requestDesktopUpdate('download', 'POST'));
            } catch (e) {
                showError(e && e.message ? e.message : '下载更新失败');
                await fetchDesktopUpdateStatus();
            }
        }

        async function restartDesktopUpdate() {
            if (!settingsUpdateRestartBtn) return;
            settingsUpdateRestartBtn.disabled = true;
            settingsUpdateRestartBtn.textContent = '重启中…';
            try {
                renderDesktopUpdateStatus(await requestDesktopUpdate('restart', 'POST'));
            } catch (e) {
                showError(e && e.message ? e.message : '重启更新失败');
                await fetchDesktopUpdateStatus();
            }
        }

        function updateDesktopUpdatePolling() {
            var state = desktopUpdateStatus && desktopUpdateStatus.state;
            var shouldPoll = activeSettingsTab === 'about' && (state === 'checking' || state === 'downloading');
            if (!shouldPoll) {
                if (desktopUpdatePollTimer) {
                    clearInterval(desktopUpdatePollTimer);
                    desktopUpdatePollTimer = null;
                }
                return;
            }
            if (!desktopUpdatePollTimer) {
                desktopUpdatePollTimer = setInterval(fetchDesktopUpdateStatus, 1200);
            }
        }

        function setSettingsTab(tab) {
            if (!SETTINGS_TAB_META[tab]) tab = 'general';
            activeSettingsTab = tab;
            settingsNavItems.forEach(function (item) {
                var active = item.dataset.settingsTab === tab;
                item.classList.toggle('active', active);
                item.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            settingsTabPanels.forEach(function (panel) {
                panel.classList.toggle('active', panel.dataset.settingsPanel === tab);
            });
            if (settingsTitle) settingsTitle.textContent = SETTINGS_TAB_META[tab][0];
            if (settingsSubtitle) settingsSubtitle.textContent = SETTINGS_TAB_META[tab][1];
            if (tab === 'about') {
                fetchDesktopUpdateStatus();
            } else {
                updateDesktopUpdatePolling();
            }
        }

        settingsNavItems.forEach(function (item) {
            item.addEventListener('click', function () {
                setSettingsTab(item.dataset.settingsTab);
            });
        });

        function getSelectedSettingsProvider() {
            if (!providerData || !settingsProviderSelect) return null;
            return providerData.providers.find(function (p) {
                return p.type === settingsProviderSelect.value;
            }) || null;
        }

        async function fetchSettingsModelConfig(providerType) {
            if (!providerType || !settingsProviderModelSelect) return;
            try {
                var res = await fetch('/api/model-config?provider=' + encodeURIComponent(providerType));
                if (!res.ok) return;
                settingsModelConfig = await res.json();
                renderSettingsModelSelect();
            } catch (e) {
                console.error('Failed to fetch settings model config:', e);
            }
        }

        function renderSettingsModelSelect() {
            if (!settingsProviderModelSelect) return;
            settingsProviderModelSelect.innerHTML = '';
            if (!settingsModelConfig || !Array.isArray(settingsModelConfig.models)) {
                settingsProviderModelSelect.disabled = true;
                if (settingsProviderModelComboboxController) {
                    settingsProviderModelComboboxController.render([], '');
                    settingsProviderModelComboboxController.setDisabled(true);
                }
                return;
            }
            settingsProviderModelSelect.disabled = settingsModelConfig.models.length === 0;
            settingsModelConfig.models.forEach(function (model) {
                var option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.name || model.id;
                settingsProviderModelSelect.appendChild(option);
            });
            settingsProviderModelSelect.value = settingsModelConfig.currentModel || (settingsModelConfig.models[0] && settingsModelConfig.models[0].id) || '';
            if (settingsProviderModelComboboxController) {
                settingsProviderModelComboboxController.render(settingsModelConfig.models.map(function (model) {
                    return {
                        value: model.id,
                        label: model.name || model.id,
                    };
                }), settingsProviderModelSelect.value);
                settingsProviderModelComboboxController.setDisabled(settingsModelConfig.models.length === 0);
            }
        }

        function getProviderSettings(providerType) {
            if (!appSettings) appSettings = createDefaultAppSettings();
            if (!appSettings.providers) appSettings.providers = {};
            if (!appSettings.providers[providerType]) appSettings.providers[providerType] = {};
            return appSettings.providers[providerType];
        }

        var PROVIDER_SETTINGS_DEFINITIONS = {
            'claude-code': {
                isExpanded: function (cfg) {
                    return cfg.anthropicCompatEnabled === true;
                },
                buildToggle: buildClaudeCodeCompatToggle,
                bindToggle: bindClaudeCodeCompatToggle,
                buildFields: buildClaudeCodeCompatFields,
                collect: collectClaudeCodeCompatSettings,
                validate: validateClaudeCodeSettings,
                refreshProviderOnSave: true,
                showModelSelect: true,
            },
        };

        var PROVIDER_MODEL_SUGGESTION_STRATEGIES = [];
        var PROVIDER_BASE_URL_SUGGESTIONS = [
            {
                id: 'deepseek',
                label: 'DeepSeek',
                value: 'https://api.deepseek.com/anthropic',
            },
            {
                id: 'vibeapi',
                label: 'VibeAPI',
                value: 'https://vibeapi.cc',
            },
        ];
        var remoteProviderModelSuggestions = [];
        var remoteProviderModelFetchTimer = null;
        var remoteProviderModelFetchSeq = 0;

        function getProviderSettingsDefinition(providerType) {
            return PROVIDER_SETTINGS_DEFINITIONS[providerType] || null;
        }

        function getRemoteProviderModelSource(baseUrl) {
            var lower = String(baseUrl || '').toLowerCase();
            if (lower.indexOf('vibeapi') !== -1) return 'VibeAPI';
            if (lower.indexOf('api.deepseek.com') !== -1) return 'DeepSeek';
            return '';
        }

        function getProviderModelSuggestionStrategy(baseUrl) {
            return PROVIDER_MODEL_SUGGESTION_STRATEGIES.find(function (strategy) {
                return strategy.matchUrl(baseUrl);
            }) || null;
        }

        function getProviderModelSuggestions(baseUrl) {
            var strategy = getProviderModelSuggestionStrategy(baseUrl);
            var suggestions = strategy ? strategy.models.map(function (model) {
                return {
                    id: model,
                    label: model,
                    source: strategy.label,
                };
            }) : [];
            if (getRemoteProviderModelSource(baseUrl)) {
                remoteProviderModelSuggestions.forEach(function (suggestion) {
                    var exists = suggestions.some(function (item) {
                        return item.id === suggestion.id;
                    });
                    if (!exists) suggestions.push(suggestion);
                });
            }
            return suggestions;
        }

        function buildProviderModelInput(id, value, label) {
            return '<div class="provider-settings-input-control provider-model-input-control">' +
                '<input class="settings-inline-input provider-model-input" id="' + escapeAttr(id) + '"' +
                ' aria-label="' + escapeAttr(label || '') + '"' +
                ' data-provider-model-suggestion-input="true" value="' + escapeAttr(value || '') + '"' +
                ' spellcheck="false" autocomplete="off">' +
                '<div class="provider-model-suggest-menu" role="listbox"></div>' +
                '</div>';
        }

        function buildProviderBaseUrlInput(value, label) {
            return '<div class="provider-settings-input-control provider-model-input-control">' +
                '<input class="settings-inline-input" id="settings-provider-anthropic-base-url" type="url"' +
                ' aria-label="' + escapeAttr(label || '') + '"' +
                ' data-provider-base-url-suggestion-input="true" value="' + escapeAttr(value || '') + '"' +
                ' spellcheck="false" autocomplete="off">' +
                '<div class="provider-model-suggest-menu" role="listbox"></div>' +
                '</div>';
        }

        function buildProviderSecretInput(id, value, label) {
            return '<div class="provider-settings-input-control">' +
                '<input class="settings-inline-input" id="' + escapeAttr(id) + '" type="password"' +
                ' aria-label="' + escapeAttr(label || '') + '"' +
                ' value="' + escapeAttr(value || '') + '" autocomplete="off" spellcheck="false">' +
                '</div>';
        }

        function closeProviderModelSuggestionMenus() {
            Array.prototype.forEach.call(document.querySelectorAll('.provider-model-input-control.open'), function (control) {
                control.classList.remove('open');
                var input = control.querySelector('[data-provider-model-suggestion-input="true"]');
                if (!input) input = control.querySelector('[data-provider-base-url-suggestion-input="true"]');
                if (input) input.setAttribute('aria-expanded', 'false');
            });
        }

        function getProviderModelSuggestionBaseUrl() {
            var input = document.getElementById('settings-provider-anthropic-base-url');
            return input ? input.value.trim() : '';
        }

        function getProviderModelSuggestionApiKey() {
            var input = document.getElementById('settings-provider-api-key');
            return input ? input.value.trim() : '';
        }

        function clearRemoteProviderModelSuggestions() {
            remoteProviderModelSuggestions = [];
            remoteProviderModelFetchSeq += 1;
            var openInput = document.querySelector('.provider-model-input-control.open [data-provider-model-suggestion-input="true"]');
            if (openInput) showProviderModelSuggestionMenu(openInput);
        }

        function scheduleRemoteProviderModelFetch() {
            if (remoteProviderModelFetchTimer) clearTimeout(remoteProviderModelFetchTimer);
            remoteProviderModelFetchTimer = setTimeout(fetchRemoteProviderModels, 600);
        }

        async function fetchRemoteProviderModels() {
            remoteProviderModelFetchTimer = null;
            var baseUrl = getProviderModelSuggestionBaseUrl();
            var apiKey = getProviderModelSuggestionApiKey();
            var source = getRemoteProviderModelSource(baseUrl);
            if (!source || !apiKey) {
                clearRemoteProviderModelSuggestions();
                return;
            }
            var seq = remoteProviderModelFetchSeq + 1;
            remoteProviderModelFetchSeq = seq;
            try {
                var res = await fetch('/api/provider-models', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({baseUrl: baseUrl, apiKey: apiKey}),
                });
                var data = await res.json().catch(function () { return {}; });
                if (seq !== remoteProviderModelFetchSeq) return;
                if (!res.ok) {
                    remoteProviderModelSuggestions = [];
                    showSettingsStatus(data.error || '获取模型列表失败', 'error');
                    return;
                }
                var models = Array.isArray(data.models) ? data.models : [];
                remoteProviderModelSuggestions = models.filter(function (model) {
                    return typeof model === 'string' && model.trim();
                }).map(function (model) {
                    var id = model.trim();
                    return {
                        id: id,
                        label: id,
                        source: data.provider || source,
                    };
                });
                var openInput = document.querySelector('.provider-model-input-control.open [data-provider-model-suggestion-input="true"]');
                if (openInput) showProviderModelSuggestionMenu(openInput);
            } catch (e) {
                if (seq !== remoteProviderModelFetchSeq) return;
                remoteProviderModelSuggestions = [];
                showSettingsStatus('获取模型列表失败', 'error');
            }
        }

        function showProviderModelSuggestionMenu(input) {
            if (!input) return;
            var control = input.closest('.provider-model-input-control');
            if (!control) return;
            var menu = control.querySelector('.provider-model-suggest-menu');
            if (!menu) return;

            var suggestions = getProviderModelSuggestions(getProviderModelSuggestionBaseUrl());
            closeProviderModelSuggestionMenus();
            menu.innerHTML = '';
            if (suggestions.length === 0) return;

            suggestions.forEach(function (suggestion) {
                var option = document.createElement('button');
                option.className = 'provider-model-suggest-option';
                option.type = 'button';
                option.setAttribute('role', 'option');
                option.dataset.value = suggestion.id;
                option.innerHTML =
                    '<span class="provider-model-suggest-name">' + escapeHtml(suggestion.label) + '</span>' +
                    '<span class="provider-model-suggest-source">' + escapeHtml(suggestion.source) + '</span>';
                option.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                });
                option.addEventListener('click', function (e) {
                    e.stopPropagation();
                    input.value = suggestion.id;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    closeProviderModelSuggestionMenus();
                    input.focus();
                });
                option.addEventListener('keydown', handleProviderModelSuggestionOptionKeydown);
                menu.appendChild(option);
            });
            control.classList.add('open');
            input.setAttribute('aria-expanded', 'true');
        }

        function showProviderBaseUrlSuggestionMenu(input) {
            if (!input) return;
            var control = input.closest('.provider-model-input-control');
            if (!control) return;
            var menu = control.querySelector('.provider-model-suggest-menu');
            if (!menu) return;

            closeProviderModelSuggestionMenus();
            menu.innerHTML = '';
            PROVIDER_BASE_URL_SUGGESTIONS.forEach(function (suggestion) {
                var option = document.createElement('button');
                option.className = 'provider-model-suggest-option';
                option.type = 'button';
                option.setAttribute('role', 'option');
                option.dataset.value = suggestion.value;
                option.innerHTML =
                    '<span class="provider-model-suggest-name">' + escapeHtml(suggestion.label) + '</span>' +
                    '<span class="provider-model-suggest-source">' + escapeHtml(suggestion.value) + '</span>';
                option.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                });
                option.addEventListener('click', function (e) {
                    e.stopPropagation();
                    input.value = suggestion.value;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    closeProviderModelSuggestionMenus();
                    input.focus();
                });
                option.addEventListener('keydown', handleProviderModelSuggestionOptionKeydown);
                menu.appendChild(option);
            });
            control.classList.add('open');
            input.setAttribute('aria-expanded', 'true');
        }

        function getOpenProviderModelSuggestionOptions() {
            var menu = document.querySelector('.provider-model-input-control.open .provider-model-suggest-menu');
            return menu ? Array.prototype.slice.call(menu.querySelectorAll('.provider-model-suggest-option')) : [];
        }

        function handleProviderModelSuggestionInputKeydown(e) {
            if (e.key === 'ArrowDown') {
                var options = getOpenProviderModelSuggestionOptions();
                if (options.length === 0) {
                    if (e.currentTarget.matches('[data-provider-base-url-suggestion-input="true"]')) {
                        showProviderBaseUrlSuggestionMenu(e.currentTarget);
                    } else {
                        showProviderModelSuggestionMenu(e.currentTarget);
                    }
                }
                options = getOpenProviderModelSuggestionOptions();
                if (options.length > 0) {
                    e.preventDefault();
                    options[0].focus();
                }
            } else if (e.key === 'Escape') {
                closeProviderModelSuggestionMenus();
            }
        }

        function handleProviderModelSuggestionOptionKeydown(e) {
            var options = getOpenProviderModelSuggestionOptions();
            var index = options.indexOf(e.currentTarget);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (options.length === 0) return;
                var delta = e.key === 'ArrowDown' ? 1 : -1;
                options[(index + delta + options.length) % options.length].focus();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.currentTarget.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                var control = e.currentTarget.closest('.provider-model-input-control');
                var input = control && control.querySelector('[data-provider-model-suggestion-input="true"]');
                if (!input) input = control && control.querySelector('[data-provider-base-url-suggestion-input="true"]');
                closeProviderModelSuggestionMenus();
                if (input) input.focus();
            }
        }

        function bindProviderModelSuggestionInputs() {
            var baseUrlInput = document.getElementById('settings-provider-anthropic-base-url');
            var apiKeyInput = document.getElementById('settings-provider-api-key');
            var modelInputs = Array.prototype.slice.call(document.querySelectorAll('[data-provider-model-suggestion-input="true"]'));
            if (baseUrlInput) {
                baseUrlInput.addEventListener('input', function () {
                    if (!getRemoteProviderModelSource(baseUrlInput.value)) {
                        clearRemoteProviderModelSuggestions();
                    } else {
                        clearRemoteProviderModelSuggestions();
                        scheduleRemoteProviderModelFetch();
                    }
                    var openInput = document.querySelector('.provider-model-input-control.open [data-provider-model-suggestion-input="true"]');
                    if (openInput) showProviderModelSuggestionMenu(openInput);
                });
                baseUrlInput.setAttribute('aria-haspopup', 'listbox');
                baseUrlInput.setAttribute('aria-expanded', 'false');
                baseUrlInput.addEventListener('focus', function () {
                    showProviderBaseUrlSuggestionMenu(baseUrlInput);
                });
                baseUrlInput.addEventListener('click', function (e) {
                    e.stopPropagation();
                    showProviderBaseUrlSuggestionMenu(baseUrlInput);
                });
                baseUrlInput.addEventListener('keydown', handleProviderModelSuggestionInputKeydown);
            }
            if (apiKeyInput) {
                apiKeyInput.addEventListener('input', function () {
                    clearRemoteProviderModelSuggestions();
                    scheduleRemoteProviderModelFetch();
                });
                apiKeyInput.addEventListener('change', scheduleRemoteProviderModelFetch);
            }
            modelInputs.forEach(function (input) {
                input.setAttribute('aria-haspopup', 'listbox');
                input.setAttribute('aria-expanded', 'false');
                input.addEventListener('focus', function () {
                    showProviderModelSuggestionMenu(input);
                });
                input.addEventListener('click', function (e) {
                    e.stopPropagation();
                    showProviderModelSuggestionMenu(input);
                });
                input.addEventListener('keydown', handleProviderModelSuggestionInputKeydown);
            });
            scheduleRemoteProviderModelFetch();
        }

        function renderSettingsProviderDetails() {
            var provider = getSelectedSettingsProvider();
            if (!provider || !appSettings) return;
            closeProviderModelSuggestionMenus();
            var cfg = getProviderSettings(provider.type);
            var definition = getProviderSettingsDefinition(provider.type);
            var hasProviderSettings = !!definition;
            var showProviderFields = !!(definition && definition.isExpanded(cfg));
            var providerModelField = settingsProviderModelSelect && settingsProviderModelSelect.closest('.settings-field');
            var providerActions = settingsSaveBtn && settingsSaveBtn.closest('.settings-button-row');
            if (providerModelField) {
                providerModelField.style.display = definition && definition.showModelSelect ? '' : 'none';
            }
            if (providerActions) providerActions.style.display = showProviderFields ? '' : 'none';
            if (settingsProviderCompatToggleFields) {
                settingsProviderCompatToggleFields.style.display = hasProviderSettings ? '' : 'none';
                settingsProviderCompatToggleFields.innerHTML = definition ? definition.buildToggle(cfg) : '';
                if (definition && definition.bindToggle) definition.bindToggle(cfg);
            }
            if (settingsProviderBinFields) {
                settingsProviderBinFields.style.display = 'none';
                settingsProviderBinFields.innerHTML = '';
            }
            if (settingsProviderExtraFields) {
                settingsProviderExtraFields.style.display = showProviderFields ? '' : 'none';
                settingsProviderExtraFields.innerHTML = showProviderFields ? definition.buildFields(cfg) : '';
                if (showProviderFields) bindProviderModelSuggestionInputs();
            }
            if (definition && definition.showModelSelect) fetchSettingsModelConfig(provider.type);
        }

        function buildClaudeCodeCompatToggle(cfg) {
            var checked = cfg.anthropicCompatEnabled === true;
            return '<div class="settings-row compat-toggle-row"><span><strong>Anthropic 兼容接口</strong><small>开启后使用下方 URL、密钥和模型映射</small></span>' +
                '<label class="settings-switch" aria-label="Anthropic 兼容接口">' +
                '<input id="settings-provider-anthropic-compat-enabled" type="checkbox"' + (checked ? ' checked' : '') + '>' +
                '<span class="settings-switch-slider"></span>' +
                '</label></div>';
        }

        function bindClaudeCodeCompatToggle() {
            var compatToggle = document.getElementById('settings-provider-anthropic-compat-enabled');
            if (compatToggle) compatToggle.addEventListener('change', handleClaudeCodeCompatToggle);
        }

        async function handleClaudeCodeCompatToggle(e) {
            var cfg = getProviderSettings('claude-code');
            var enabled = e.currentTarget.checked === true;
            cfg.anthropicCompatEnabled = enabled;
            if (enabled) {
                renderSettingsProviderDetails();
                return;
            }
            await persistAppSettingsPatch({ providers: { 'claude-code': Object.assign({}, cfg, { anthropicCompatEnabled: false }) } }, '已关闭');
            if (providerData && providerData.current === 'claude-code') {
                await switchProviderTo('claude-code', { force: true, closeOnSuccess: false });
            }
            renderSettingsProviderDetails();
        }

        function buildClaudeCodeCompatFields(cfg) {
            return '<div class="settings-row"><span><strong>Anthropic Base URL</strong><small>兼容 Anthropic API 的服务地址</small></span>' +
                buildProviderBaseUrlInput(cfg.anthropicBaseUrl || '', 'Anthropic Base URL') + '</div>' +
                '<div class="settings-row"><span><strong>API Key</strong><small>访问兼容服务所需的密钥</small></span>' +
                buildProviderSecretInput('settings-provider-api-key', cfg.apiKey || '', 'API Key') + '</div>' +
                '<div class="settings-row"><span><strong>Auto 模型</strong><small>用于 Auto 模型</small></span>' +
                buildProviderModelInput('settings-provider-anthropic-auto-model', cfg.anthropicAutoModel || cfg.defaultModel || '', 'Auto 模型') + '</div>' +
                '<div class="settings-row"><span><strong>Opus 模型</strong><small>用于 Opus 模型</small></span>' +
                buildProviderModelInput('settings-provider-anthropic-opus-model', cfg.anthropicOpusModel || '', 'Opus 模型') + '</div>' +
                '<div class="settings-row"><span><strong>Sonnet 模型</strong><small>用于 Sonnet 模型</small></span>' +
                buildProviderModelInput('settings-provider-anthropic-sonnet-model', cfg.anthropicSonnetModel || '', 'Sonnet 模型') + '</div>' +
                '<div class="settings-row"><span><strong>Haiku / Fast 模型</strong><small>用于轻量或快速模型</small></span>' +
                buildProviderModelInput('settings-provider-anthropic-haiku-model', cfg.anthropicHaikuModel || '', 'Haiku / Fast 模型') + '</div>' +
                '<div class="settings-row"><span><strong>Subagent 模型</strong><small>用于子任务模型</small></span>' +
                buildProviderModelInput('settings-provider-subagent-model', cfg.claudeCodeSubagentModel || '', 'Subagent 模型') + '</div>';
        }

        function collectProviderSettings(providerType) {
            var current = getProviderSettings(providerType);
            var definition = getProviderSettingsDefinition(providerType);
            if (definition && definition.collect) return definition.collect(current);
            var next = Object.assign({}, current);
            var binInput = document.getElementById('settings-provider-bin-input');
            if (binInput) next.bin = binInput.value.trim();
            Object.keys(next).forEach(function (key) {
                if (next[key] === '') delete next[key];
            });
            return next;
        }

        function collectClaudeCodeCompatSettings(current) {
            var next = Object.assign({}, current, { anthropicCompatEnabled: true });
            var binInput = document.getElementById('settings-provider-bin-input');
            var apiKeyInput = document.getElementById('settings-provider-api-key');
            var anthropicBaseUrlInput = document.getElementById('settings-provider-anthropic-base-url');
            var anthropicAutoModelInput = document.getElementById('settings-provider-anthropic-auto-model');
            var anthropicOpusModelInput = document.getElementById('settings-provider-anthropic-opus-model');
            var anthropicSonnetModelInput = document.getElementById('settings-provider-anthropic-sonnet-model');
            var anthropicHaikuModelInput = document.getElementById('settings-provider-anthropic-haiku-model');
            var subagentModelInput = document.getElementById('settings-provider-subagent-model');
            if (binInput) {
                next.pathToClaudeCodeExecutable = binInput.value.trim();
                delete next.bin;
            }
            if (apiKeyInput) next.apiKey = apiKeyInput.value;
            if (anthropicBaseUrlInput) next.anthropicBaseUrl = anthropicBaseUrlInput.value.trim();
            if (anthropicAutoModelInput) {
                next.anthropicAutoModel = anthropicAutoModelInput.value.trim();
                next.defaultModel = next.anthropicAutoModel;
            }
            if (anthropicOpusModelInput) next.anthropicOpusModel = anthropicOpusModelInput.value.trim();
            if (anthropicSonnetModelInput) next.anthropicSonnetModel = anthropicSonnetModelInput.value.trim();
            if (anthropicHaikuModelInput) next.anthropicHaikuModel = anthropicHaikuModelInput.value.trim();
            if (subagentModelInput) next.claudeCodeSubagentModel = subagentModelInput.value.trim();
            Object.keys(next).forEach(function (key) {
                if (next[key] === '') delete next[key];
            });
            return next;
        }

        function validateClaudeCodeSettings() {
            var fields = [
                ['Anthropic Base URL', document.getElementById('settings-provider-anthropic-base-url')],
                ['API Key', document.getElementById('settings-provider-api-key')],
                ['Auto 模型', document.getElementById('settings-provider-anthropic-auto-model')],
                ['Opus 模型', document.getElementById('settings-provider-anthropic-opus-model')],
                ['Sonnet 模型', document.getElementById('settings-provider-anthropic-sonnet-model')],
                ['Haiku / Fast 模型', document.getElementById('settings-provider-anthropic-haiku-model')],
                ['Subagent 模型', document.getElementById('settings-provider-subagent-model')],
            ];
            var missing = fields.filter(function (entry) {
                var label = entry[0];
                var input = entry[1];
                if (!input) return false;
                var value = input.value.trim();
                return !value;
            }).map(function (entry) {
                return entry[0];
            });
            if (missing.length > 0) {
                showSettingsStatus('请先填写：' + missing.join('、'), 'error');
                return false;
            }
            return true;
        }

        if (settingsProviderTrigger) {
            settingsProviderTrigger.addEventListener('click', function (e) {
                e.stopPropagation();
                setSettingsProviderMenuOpen(!settingsProviderCombobox.classList.contains('open'));
            });
            settingsProviderTrigger.addEventListener('keydown', function (e) {
                if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSettingsProviderMenuOpen(true);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSettingsProviderMenuOpen(true);
                    requestAnimationFrame(function () {
                        var options = getSettingsProviderOptions();
                        var last = options[options.length - 1];
                        if (last) last.focus();
                    });
                } else if (e.key === 'Escape') {
                    setSettingsProviderMenuOpen(false);
                }
            });
        }

        if (settingsProviderMenu) {
            settingsProviderMenu.addEventListener('click', function (e) {
                e.stopPropagation();
            });
        }

        if (settingsSandboxTrigger) {
            settingsSandboxTrigger.addEventListener('click', function (e) {
                e.stopPropagation();
                setSettingsSandboxMenuOpen(!settingsSandboxCombobox.classList.contains('open'));
            });
            settingsSandboxTrigger.addEventListener('keydown', function (e) {
                if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSettingsSandboxMenuOpen(true);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSettingsSandboxMenuOpen(true);
                    requestAnimationFrame(function () {
                        var options = getSettingsSandboxOptions();
                        var last = options[options.length - 1];
                        if (last) last.focus();
                    });
                } else if (e.key === 'Escape') {
                    setSettingsSandboxMenuOpen(false);
                }
            });
        }

        if (settingsSandboxGroup) {
            settingsSandboxGroup.addEventListener('click', function (e) {
                e.stopPropagation();
            });
        }

        async function fetchProviders() {
            try {
                var res = await fetch('/api/providers');
                providerData = await res.json();
                renderProviderSelect();
                updateModelBadgeLabel();
            } catch (e) {
                console.error('Failed to fetch providers:', e);
            }
        }

        async function fetchSandboxConfig() {
            try {
                var res = await fetch('/api/sandbox-config');
                sandboxConfig = await res.json();
                selectedSandbox = sandboxConfig.defaultSandbox;
                renderSandboxOptions();
            } catch (e) {
                console.error('Failed to fetch sandbox config:', e);
            }
        }

        function renderSandboxOptions() {
            if (!settingsSandboxGroup || !sandboxConfig) return;
            settingsSandboxGroup.innerHTML = '';
            sandboxConfig.modes.forEach(function (mode) {
                var option = document.createElement('button');
                var isActive = mode.id === selectedSandbox;
                option.className = 'settings-combobox-option sandbox-option' + (isActive ? ' active' : '');
                option.type = 'button';
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', isActive ? 'true' : 'false');
                option.dataset.sandboxValue = mode.id;
                option.dataset.sandboxName = mode.name;
                option.dataset.sandboxDescription = mode.description;
                option.innerHTML =
                    (isActive
                        ? '<svg class="settings-combobox-check" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                        : '<span class="settings-combobox-check-placeholder"></span>') +
                    '<span class="sandbox-option-copy">' +
                    '<span class="sandbox-option-name">' + escapeHtml(mode.name) + '</span>' +
                    '<span class="sandbox-option-desc">' + escapeHtml(mode.description) + '</span>' +
                    '</span>';
                option.addEventListener('click', async function (e) {
                    e.stopPropagation();
                    if (setSettingsSandboxValue(mode.id)) {
                        setSettingsSandboxMenuOpen(false);
                        if (settingsSandboxTrigger) settingsSandboxTrigger.focus();
                        await persistSandboxConfig();
                        showSettingsStatus('已保存');
                    }
                });
                option.addEventListener('keydown', handleSettingsSandboxOptionKeydown);
                settingsSandboxGroup.appendChild(option);
            });
            updateSandboxDisplay();
        }

        function setSettingsSandboxValue(sandbox) {
            if (!sandboxConfig || !settingsSandboxGroup) return false;
            var valid = sandboxConfig.modes.some(function (mode) {
                return mode.id === sandbox;
            });
            if (!valid) {
                showError('该权限模式不可用');
                return false;
            }
            selectedSandbox = sandbox;
            updateSandboxDisplay();
            return true;
        }

        function updateSandboxDisplay() {
            if (!settingsSandboxGroup || !sandboxConfig) return;
            var selectedMode = sandboxConfig.modes.find(function (mode) {
                return mode.id === selectedSandbox;
            });
            if (settingsSandboxCurrent) {
                settingsSandboxCurrent.textContent = selectedMode ? selectedMode.name : '请选择权限';
            }
            Array.prototype.forEach.call(settingsSandboxGroup.querySelectorAll('.sandbox-option'), function (option) {
                var isActive = option.dataset.sandboxValue === selectedSandbox;
                option.classList.toggle('active', isActive);
                option.setAttribute('aria-selected', isActive ? 'true' : 'false');
                option.innerHTML =
                    (isActive
                        ? '<svg class="settings-combobox-check" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                        : '<span class="settings-combobox-check-placeholder"></span>') +
                    '<span class="sandbox-option-copy">' +
                    '<span class="sandbox-option-name">' + escapeHtml(option.dataset.sandboxName || '') + '</span>' +
                    '<span class="sandbox-option-desc">' + escapeHtml(option.dataset.sandboxDescription || '') + '</span>' +
                    '</span>';
            });
        }

        function getSettingsSandboxOptions() {
            if (!settingsSandboxGroup) return [];
            return Array.prototype.slice.call(settingsSandboxGroup.querySelectorAll('.sandbox-option'));
        }

        function setSettingsSandboxMenuOpen(isOpen) {
            if (!settingsSandboxCombobox || !settingsSandboxTrigger) return;
            if (isOpen) {
                setSettingsThemeMenuOpen(false);
                setSettingsProviderMenuOpen(false);
                if (settingsProviderModelComboboxController) settingsProviderModelComboboxController.setOpen(false);
            }
            settingsSandboxCombobox.classList.toggle('open', isOpen);
            settingsSandboxTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            if (isOpen) {
                var active = settingsSandboxGroup && settingsSandboxGroup.querySelector('.sandbox-option.active');
                requestAnimationFrame(function () {
                    (active || getSettingsSandboxOptions()[0] || settingsSandboxTrigger).focus();
                });
            }
        }

        function moveSettingsSandboxFocus(delta) {
            var options = getSettingsSandboxOptions();
            if (!options.length) return;
            var currentIndex = options.indexOf(document.activeElement);
            var nextIndex = currentIndex < 0 ? 0 : (currentIndex + delta + options.length) % options.length;
            options[nextIndex].focus();
        }

        function handleSettingsSandboxOptionKeydown(e) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveSettingsSandboxFocus(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveSettingsSandboxFocus(-1);
            } else if (e.key === 'Home') {
                e.preventDefault();
                var first = getSettingsSandboxOptions()[0];
                if (first) first.focus();
            } else if (e.key === 'End') {
                e.preventDefault();
                var options = getSettingsSandboxOptions();
                var last = options[options.length - 1];
                if (last) last.focus();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.currentTarget.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setSettingsSandboxMenuOpen(false);
                if (settingsSandboxTrigger) settingsSandboxTrigger.focus();
            }
        }

        async function persistSandboxConfig() {
            if (!sandboxConfig || !selectedSandbox || selectedSandbox === sandboxConfig.defaultSandbox) return true;
            try {
                var res = await fetch('/api/sandbox-config', {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({defaultSandbox: selectedSandbox}),
                });
                if (!res.ok) {
                    var err = await res.json().catch(function () { return {}; });
                    showError(err.error || '保存权限配置失败');
                    return false;
                }
                sandboxConfig = await res.json();
                selectedSandbox = sandboxConfig.defaultSandbox;
                renderSandboxOptions();
                return true;
            } catch (e) {
                showError('保存权限配置失败');
                return false;
            }
        }

        function renderProviderSelect() {
            if (!providerData || !settingsProviderSelect) return;
            settingsProviderSelect.innerHTML = '';
            if (settingsProviderMenu) settingsProviderMenu.innerHTML = '';
            providerData.providers.forEach(function (p) {
                var isInstalled = isProviderInstalled(p);
                var opt = document.createElement('option');
                opt.value = p.type;
                opt.textContent = p.displayName + (isInstalled ? '' : '（未安装）');
                opt.disabled = !isInstalled;
                settingsProviderSelect.appendChild(opt);

                if (settingsProviderMenu) {
                    var item = document.createElement('button');
                    item.className = 'settings-combobox-option';
                    item.type = 'button';
                    item.setAttribute('role', 'option');
                    item.disabled = !isInstalled;
                    item.setAttribute('aria-disabled', isInstalled ? 'false' : 'true');
                    if (!isInstalled) item.title = (p.bin || p.displayName) + ' 未安装';
                    item.dataset.providerType = p.type;
                    item.dataset.providerDisplayName = p.displayName;
                    item.dataset.providerInstalled = isInstalled ? 'true' : 'false';
                    item.dataset.providerBin = p.bin || '';
                    item.innerHTML = buildSettingsProviderOptionHtml(false, p.displayName, !isInstalled);
                    item.addEventListener('click', async function (e) {
                        e.stopPropagation();
                        if (setSettingsProviderValue(p.type)) {
                            setSettingsProviderMenuOpen(false);
                            settingsProviderTrigger.focus();
                            await persistSettingsProviderSelection(p.type);
                        }
                    });
                    item.addEventListener('keydown', handleSettingsProviderOptionKeydown);
                    settingsProviderMenu.appendChild(item);
                }
            });
            settingsProviderSelect.value = providerData.current;
            updateSettingsProviderDisplay();
            renderSettingsProviderDetails();
        }

        function isProviderInstalled(provider) {
            return !provider || provider.installed !== false;
        }

        function isSettingsProviderSelectable(providerType) {
            if (!providerData) return false;
            var provider = providerData.providers.find(function (p) {
                return p.type === providerType;
            });
            return !!provider && isProviderInstalled(provider);
        }

        function buildSettingsProviderOptionHtml(isActive, displayName, isDisabled) {
            return buildSettingsComboboxOptionHtml(isActive, displayName, isDisabled ? '未安装' : '');
        }

        settingsProviderModelComboboxController = createSettingsSingleSelectCombobox({
            combobox: settingsProviderModelCombobox,
            trigger: settingsProviderModelTrigger,
            current: settingsProviderModelCurrent,
            menu: settingsProviderModelMenu,
            placeholder: '请选择模型',
            closeOthers: function () {
                setSettingsThemeMenuOpen(false);
                setSettingsSandboxMenuOpen(false);
                setSettingsProviderMenuOpen(false);
            },
            onChange: function (modelId) {
                if (settingsProviderModelSelect) settingsProviderModelSelect.value = modelId;
                var provider = getSelectedSettingsProvider();
                if (!provider) return;
                saveSettingsProviderModel(provider.type, modelId);
            },
        });

        function getSettingsProviderOptions(includeDisabled) {
            if (!settingsProviderMenu) return [];
            var options = Array.prototype.slice.call(settingsProviderMenu.querySelectorAll('.settings-combobox-option'));
            if (includeDisabled) return options;
            return options.filter(function (item) { return !item.disabled; });
        }

        function updateSettingsProviderDisplay() {
            if (!providerData || !settingsProviderSelect) return;
            var selected = providerData.providers.find(function (p) {
                return p.type === settingsProviderSelect.value;
            });
            if (settingsProviderCurrent) {
                settingsProviderCurrent.textContent = selected
                    ? selected.displayName + (isProviderInstalled(selected) ? '' : '（未安装）')
                    : '请选择提供商';
            }
            getSettingsProviderOptions(true).forEach(function (item) {
                var isActive = item.dataset.providerType === settingsProviderSelect.value;
                var isDisabled = item.dataset.providerInstalled === 'false';
                item.classList.toggle('active', isActive);
                item.classList.toggle('disabled', isDisabled);
                item.disabled = isDisabled;
                item.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
                item.setAttribute('aria-selected', isActive ? 'true' : 'false');
                item.innerHTML = buildSettingsProviderOptionHtml(
                    isActive,
                    item.dataset.providerDisplayName || '',
                    isDisabled,
                );
            });
        }

        function setSettingsProviderValue(providerType) {
            if (!settingsProviderSelect) return false;
            if (!isSettingsProviderSelectable(providerType)) {
                showError('该提供商未安装，无法选择');
                return false;
            }
            settingsProviderSelect.value = providerType;
            updateSettingsProviderDisplay();
            renderSettingsProviderDetails();
            return true;
        }

        function setSettingsProviderMenuOpen(isOpen) {
            if (!settingsProviderCombobox || !settingsProviderTrigger) return;
            if (isOpen) {
                setSettingsThemeMenuOpen(false);
                setSettingsSandboxMenuOpen(false);
                if (settingsProviderModelComboboxController) settingsProviderModelComboboxController.setOpen(false);
            }
            settingsProviderCombobox.classList.toggle('open', isOpen);
            settingsProviderTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            if (isOpen) {
                var active = settingsProviderMenu && settingsProviderMenu.querySelector('.settings-combobox-option.active:not(:disabled)');
                requestAnimationFrame(function () {
                    (active || getSettingsProviderOptions()[0] || settingsProviderTrigger).focus();
                });
            }
        }

        function moveSettingsProviderFocus(delta) {
            var options = getSettingsProviderOptions();
            if (!options.length) return;
            var currentIndex = options.indexOf(document.activeElement);
            var nextIndex = currentIndex < 0 ? 0 : (currentIndex + delta + options.length) % options.length;
            options[nextIndex].focus();
        }

        function handleSettingsProviderOptionKeydown(e) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveSettingsProviderFocus(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveSettingsProviderFocus(-1);
            } else if (e.key === 'Home') {
                e.preventDefault();
                var first = getSettingsProviderOptions()[0];
                if (first) first.focus();
            } else if (e.key === 'End') {
                e.preventDefault();
                var options = getSettingsProviderOptions();
                var last = options[options.length - 1];
                if (last) last.focus();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                var providerType = e.currentTarget.dataset.providerType;
                if (setSettingsProviderValue(providerType)) {
                    setSettingsProviderMenuOpen(false);
                    settingsProviderTrigger.focus();
                    persistSettingsProviderSelection(providerType);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setSettingsProviderMenuOpen(false);
                settingsProviderTrigger.focus();
            }
        }

        function openSettingsPanel() {
            hideAllViews();
            currentView = 'settings';
            setSettingsTab(activeSettingsTab || 'general');
            if (appSettings) renderAppSettings();
            if (providerData) renderProviderSelect();
            if (sandboxConfig) {
                selectedSandbox = sandboxConfig.defaultSandbox;
                renderSandboxOptions();
            }
            settingsView.style.display = 'flex';
            settingsBtn.classList.add('active');
            modelSwitcher.classList.remove('open');
            modelBadge.setAttribute('aria-expanded', 'false');
            requestAnimationFrame(function () {
                var activeNav = document.querySelector('.settings-nav-item.active');
                if (activeNav) activeNav.focus();
            });
        }

        function closeSettingsPanel() {
            setSettingsThemeMenuOpen(false);
            setSettingsSandboxMenuOpen(false);
            setSettingsProviderMenuOpen(false);
            if (settingsProviderModelComboboxController) settingsProviderModelComboboxController.setOpen(false);
            showChatView();
        }

        async function persistDefaultWorkdir() {
            if (!settingsDefaultWorkdir) return false;
            return persistAppSettingsPatch({
                workspace: {
                    defaultWorkdir: settingsDefaultWorkdir.value.trim(),
                },
            }, '已保存');
        }

        async function persistSettingsProviderSelection(providerType) {
            if (!providerType || !isSettingsProviderSelectable(providerType)) return false;
            var saved = await switchProviderTo(providerType, { closeOnSuccess: false });
            if (saved) showSettingsStatus('已保存');
            return saved;
        }

        async function saveSettingsProviderModel(providerType, modelId) {
            try {
                var res = await fetch('/api/model-config', {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({provider: providerType, modelId: modelId}),
                });
                if (!res.ok) {
                    var err = await res.json().catch(function () { return {}; });
                    showError(err.error || '保存默认模型失败');
                    return false;
                }
                var savedConfig = await res.json();
                settingsModelConfig = savedConfig;
                if (!currentSessionProvider || currentSessionProvider === providerType) {
                    modelConfig = savedConfig;
                    updateModelBadgeLabel();
                    renderModelDropdown();
                }
                showSettingsStatus('已保存');
            } catch (e) {
                showError('保存默认模型失败');
            }
        }

        async function saveSettingsProviderSettings() {
            var provider = getSelectedSettingsProvider();
            if (!provider || !isSettingsProviderSelectable(provider.type)) return false;
            var currentSettings = getProviderSettings(provider.type);
            var definition = getProviderSettingsDefinition(provider.type);
            if (!definition || !definition.isExpanded(currentSettings)) return false;
            if (definition.validate && !definition.validate()) {
                return false;
            }
            var nextSettings = collectProviderSettings(provider.type);
            var saved = await persistAppSettingsPatch({
                providers: (function () {
                    var providers = {};
                    providers[provider.type] = nextSettings;
                    return providers;
                })(),
            }, '已保存');
            if (!saved) return false;

            if (definition.refreshProviderOnSave && providerData && providerData.current === provider.type) {
                await switchProviderTo(provider.type, { force: true, closeOnSuccess: false });
            } else if (definition.showModelSelect) {
                await fetchSettingsModelConfig(provider.type);
            }
            await fetchProviders();
            return true;
        }

        async function switchProviderTo(providerType, opts) {
            if (!providerData || (providerType === providerData.current && !(opts && opts.force))) {
                if (opts && opts.closeOnSuccess) closeSettingsPanel();
                return true;
            }
            var shouldClose = !!(opts && opts.closeOnSuccess);
            var originalText = settingsSaveBtn ? settingsSaveBtn.textContent : '';
            if (shouldClose) {
                if (settingsSaveBtn) {
                    settingsSaveBtn.disabled = true;
                    settingsSaveBtn.textContent = '保存中…';
                }
            }
            try {
                var res = await fetch('/api/providers/current', {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({provider: providerType}),
                });
                if (!res.ok) {
                    var err = await res.json().catch(function () { return {}; });
                    showError(err.error || '切换 Provider 失败');
                    return false;
                }
                var switchedConfig = await res.json();
                providerData.current = providerType;
                if (!currentSessionProvider || currentSessionProvider === providerType) {
                    modelConfig = switchedConfig;
                    updateModelBadgeLabel();
                } else {
                    await fetchModelConfig(currentSessionProvider);
                }
                renderProviderSelect();
                renderModelDropdown();
                if (shouldClose) closeSettingsPanel();
                return true;
            } catch (e) {
                showError('切换 Provider 失败');
                return false;
            } finally {
                if (shouldClose && settingsSaveBtn) {
                    settingsSaveBtn.disabled = false;
                    settingsSaveBtn.textContent = originalText;
                }
            }
        }

        settingsBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            openSettingsPanel();
        });

        if (settingsCancelBtn) settingsCancelBtn.addEventListener('click', closeSettingsPanel);
        if (settingsSaveBtn) {
            settingsSaveBtn.addEventListener('click', saveSettingsProviderSettings);
        }
        if (settingsProviderModelSelect) {
            settingsProviderModelSelect.addEventListener('change', function () {
                var provider = getSelectedSettingsProvider();
                if (!provider) return;
                saveSettingsProviderModel(provider.type, settingsProviderModelSelect.value);
            });
        }
        if (settingsWorkdirPickBtn) {
            settingsWorkdirPickBtn.addEventListener('click', async function () {
                try {
                    var res = await fetch('/api/app-settings/default-workdir/pick', { method: 'POST' });
                    var data = await res.json();
                    if (data.path && settingsDefaultWorkdir) {
                        settingsDefaultWorkdir.value = data.path;
                        await persistDefaultWorkdir();
                    }
                } catch (e) {
                    showError('选择目录失败');
                }
            });
        }
        if (settingsWorkdirOpenBtn) {
            settingsWorkdirOpenBtn.addEventListener('click', function () {
                runSettingsAction('/api/app-settings/default-workdir/open', 'POST', '已打开工作区文件夹');
            });
        }
        if (settingsDefaultWorkdir) {
            settingsDefaultWorkdir.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (settingsWorkdirPickBtn) settingsWorkdirPickBtn.click();
                }
            });
        }
        if (settingsLogRetentionDays) {
            settingsLogRetentionDays.addEventListener('change', persistLogRetentionDays);
            settingsLogRetentionDays.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    settingsLogRetentionDays.blur();
                }
            });
        }
        if (settingsUpdateCheckBtn) {
            settingsUpdateCheckBtn.addEventListener('click', checkDesktopUpdate);
        }
        if (settingsUpdateDownloadBtn) {
            settingsUpdateDownloadBtn.addEventListener('click', downloadDesktopUpdate);
        }
        if (settingsUpdateRestartBtn) {
            settingsUpdateRestartBtn.addEventListener('click', restartDesktopUpdate);
        }
        if (settingsProjectsEntryBtn) {
            settingsProjectsEntryBtn.addEventListener('click', function () {
                closeSettingsPanel();
                sidebarController.setProjectsCollapsed(false);
                if (addProjectBtn) addProjectBtn.focus();
            });
        }
        if (settingsOpenLogsBtn) settingsOpenLogsBtn.addEventListener('click', function () { runSettingsAction('/api/logs/open', 'POST', '已打开日志目录'); });
        if (settingsClearLogsBtn) settingsClearLogsBtn.addEventListener('click', function () {
            if (confirm('确认清空日志？')) runSettingsAction('/api/logs', 'DELETE', '日志已清空');
        });
        if (settingsOpenDataBtn) settingsOpenDataBtn.addEventListener('click', function () { runSettingsAction('/api/data/open', 'POST', '已打开数据目录'); });
        if (settingsClearUploadsBtn) settingsClearUploadsBtn.addEventListener('click', function () {
            if (confirm('确认清理上传临时文件？')) runSettingsAction('/api/data/uploads', 'DELETE', '上传文件已清理');
        });
        if (settingsClearHistoryBtn) settingsClearHistoryBtn.addEventListener('click', async function () {
            if (!confirm('确认清空所有聊天历史？此操作不可撤销。')) return;
            await runSettingsAction('/api/data/history', 'DELETE', '聊天历史已清空');
            await fetchSessions();
            await createNewChat(null, { force: true });
        });
        if (settingsExportDataBtn) settingsExportDataBtn.addEventListener('click', function () {
            window.location.href = '/api/data/export';
        });
        if (settingsImportDataBtn && settingsImportFile) {
            settingsImportDataBtn.addEventListener('click', function () { settingsImportFile.click(); });
            settingsImportFile.addEventListener('change', importSettingsFile);
        }
        var proxyAuthToggle = document.getElementById('proxy-auth-toggle');
        if (proxyAuthToggle) {
            proxyAuthToggle.addEventListener('click', function () {
                var fields = document.getElementById('proxy-auth-fields');
                if (!fields) return;
                var showing = fields.classList.toggle('show');
                this.textContent = showing ? '隐藏认证' : '认证（可选）';
            });
        }
        var proxySaveBtn = document.getElementById('proxy-save-btn');
        if (proxySaveBtn) proxySaveBtn.addEventListener('click', saveProxyConfig);
        var proxyTestBtn = document.getElementById('proxy-test-btn');
        if (proxyTestBtn) proxyTestBtn.addEventListener('click', testProxyConnection);

        async function runSettingsAction(url, method, successMessage) {
            try {
                var res = await fetch(url, { method: method });
                if (!res.ok) {
                    var err = await res.json().catch(function () { return {}; });
                    showError(err.error || '操作失败');
                    return false;
                }
                showSettingsStatus(successMessage || '已完成');
                return true;
            } catch (e) {
                showError('操作失败');
                return false;
            }
        }

        async function importSettingsFile() {
            var file = settingsImportFile.files && settingsImportFile.files[0];
            settingsImportFile.value = '';
            if (!file) return;
            try {
                var text = await file.text();
                var payload = JSON.parse(text);
                var res = await fetch('/api/data/import', {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload),
                });
                if (!res.ok) {
                    var err = await res.json().catch(function () { return {}; });
                    showError(err.error || '导入失败');
                    return;
                }
                await Promise.all([fetchAppSettings(), fetchProviders(), fetchSandboxConfig(), fetchModelConfig()]);
                showSettingsStatus('导入完成');
            } catch (e) {
                showError('导入失败，请确认文件格式');
            }
        }

        document.addEventListener('click', function (e) {
            if (slashPickerController.isOpen() && skillPickerEl && e.target !== inputEl && !skillPickerEl.contains(e.target)) {
                closeSkillPicker();
            }
            if (!modelSwitcher.contains(e.target)) {
                modelSwitcher.classList.remove('open');
                modelBadge.setAttribute('aria-expanded', 'false');
            }
            if (settingsProviderCombobox && !settingsProviderCombobox.contains(e.target)) {
                setSettingsProviderMenuOpen(false);
            }
            if (settingsThemeCombobox && !settingsThemeCombobox.contains(e.target)) {
                setSettingsThemeMenuOpen(false);
            }
            if (settingsSandboxCombobox && !settingsSandboxCombobox.contains(e.target)) {
                setSettingsSandboxMenuOpen(false);
            }
            if (settingsProviderModelComboboxController && !settingsProviderModelComboboxController.contains(e.target)) {
                settingsProviderModelComboboxController.setOpen(false);
            }
            if (!e.target.closest || !e.target.closest('.provider-model-input-control')) {
                closeProviderModelSuggestionMenus();
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (slashPickerController.isOpen()) {
                    closeSkillPicker({ removeTrigger: document.activeElement === inputEl });
                    if (document.activeElement === inputEl) inputEl.focus();
                    return;
                }
                if (settingsProviderModelComboboxController && settingsProviderModelComboboxController.isOpen()) {
                    settingsProviderModelComboboxController.setOpen(false);
                    settingsProviderModelComboboxController.focusTrigger();
                    return;
                }
                if (document.querySelector('.provider-model-input-control.open')) {
                    closeProviderModelSuggestionMenus();
                    return;
                }
                if (settingsThemeCombobox && settingsThemeCombobox.classList.contains('open')) {
                    setSettingsThemeMenuOpen(false);
                    settingsThemeTrigger.focus();
                    return;
                }
                if (settingsSandboxCombobox && settingsSandboxCombobox.classList.contains('open')) {
                    setSettingsSandboxMenuOpen(false);
                    settingsSandboxTrigger.focus();
                    return;
                }
                if (settingsProviderCombobox && settingsProviderCombobox.classList.contains('open')) {
                    setSettingsProviderMenuOpen(false);
                    settingsProviderTrigger.focus();
                    return;
                }
                modelSwitcher.classList.remove('open');
                modelBadge.setAttribute('aria-expanded', 'false');
                if (currentView === 'settings') closeSettingsPanel();
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

        var proxyConfig = null;

        async function fetchProxyConfig() {
            try {
                var res = await fetch('/api/proxy');
                proxyConfig = await res.json();
                renderNetworkSettings();
            } catch (e) {
                console.error('Failed to fetch proxy config:', e);
            }
        }

        function renderNetworkSettings() {
            var cfg = proxyConfig || { enabled: false, protocol: 'http', host: '127.0.0.1', port: 7890 };
            var featureEnabled = cfg.featureEnabled !== false;
            var hasAuth = !!(cfg.username || cfg.password);
            var enabled = document.getElementById('proxy-enabled');
            var protocol = document.getElementById('proxy-protocol');
            var host = document.getElementById('proxy-host');
            var port = document.getElementById('proxy-port');
            var username = document.getElementById('proxy-username');
            var password = document.getElementById('proxy-password');
            var authFields = document.getElementById('proxy-auth-fields');
            var authToggle = document.getElementById('proxy-auth-toggle');
            var saveBtn = document.getElementById('proxy-save-btn');
            var testBtn = document.getElementById('proxy-test-btn');
            var statusEl = document.getElementById('proxy-status');
            if (!enabled || !protocol || !host || !port || !username || !password) return;
            enabled.checked = featureEnabled && !!cfg.enabled;
            protocol.value = cfg.protocol || 'http';
            host.value = cfg.host || '';
            port.value = cfg.port || '';
            username.value = cfg.username || '';
            password.value = cfg.password || '';
            [enabled, protocol, host, port, username, password].forEach(function (control) {
                control.disabled = !featureEnabled;
            });
            if (authToggle) authToggle.disabled = !featureEnabled;
            if (saveBtn) saveBtn.disabled = !featureEnabled;
            if (testBtn) testBtn.disabled = !featureEnabled;
            if (authFields) authFields.classList.toggle('show', hasAuth);
            if (authToggle) authToggle.textContent = hasAuth ? '隐藏认证' : '认证（可选）';
            if (statusEl && !featureEnabled) {
                statusEl.className = 'proxy-status show info';
                statusEl.textContent = '代理功能已暂时关闭';
            }
        }

        async function saveProxyConfig() {
            if (proxyConfig && proxyConfig.featureEnabled === false) return;
            var saveBtn = document.getElementById('proxy-save-btn');
            var statusEl = document.getElementById('proxy-status');
            saveBtn.disabled = true;
            saveBtn.textContent = '保存中…';

            var body = {
                enabled: document.getElementById('proxy-enabled').checked,
                protocol: document.getElementById('proxy-protocol').value,
                host: document.getElementById('proxy-host').value.trim(),
                port: parseInt(document.getElementById('proxy-port').value, 10) || 0,
                username: document.getElementById('proxy-username').value,
                password: document.getElementById('proxy-password').value,
            };

            try {
                var res = await fetch('/api/proxy', {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(body)
                });

                if (!res.ok) {
                    var err = await res.json();
                    throw new Error(err.error || '保存失败');
                }

                proxyConfig = await res.json();
                statusEl.className = 'proxy-status show ' + (body.enabled ? 'success' : 'info');
                statusEl.textContent = body.enabled ? '代理已保存并启用' : '代理配置已保存（未启用）';
            } catch (e) {
                statusEl.className = 'proxy-status show error';
                statusEl.textContent = e.message || '保存失败';
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = '保存';
            }
        }

        async function testProxyConnection() {
            if (proxyConfig && proxyConfig.featureEnabled === false) return;
            var testBtn = document.getElementById('proxy-test-btn');
            var statusEl = document.getElementById('proxy-status');
            testBtn.disabled = true;
            testBtn.textContent = '测试中…';
            statusEl.className = 'proxy-status show info';
            statusEl.textContent = '正在测试代理连接…';

            var body = {
                protocol: document.getElementById('proxy-protocol').value,
                host: document.getElementById('proxy-host').value.trim(),
                port: parseInt(document.getElementById('proxy-port').value, 10) || 0,
                username: document.getElementById('proxy-username').value,
                password: document.getElementById('proxy-password').value,
            };

            try {
                var res = await fetch('/api/proxy/test', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(body)
                });
                var data = await res.json();

                if (data.ok) {
                    statusEl.className = 'proxy-status show success';
                    statusEl.textContent = '连接成功，延迟 ' + data.latency + 'ms';
                } else {
                    statusEl.className = 'proxy-status show error';
                    statusEl.textContent = '连接失败: ' + (data.error || '未知错误');
                }
            } catch (e) {
                statusEl.className = 'proxy-status show error';
                statusEl.textContent = '测试请求失败: ' + (e.message || '网络错误');
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = '测试连接';
            }
        }

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
