import { createAttachmentController } from './chat/attachments.js';
import { createContextUsageController, formatTokenCount } from './chat/context-usage.js';
import { bindChatInputEvents } from './chat/input-events.js';
import { createInputHistoryController } from './chat/input-history.js';
import { createChatInputUiController } from './chat/input-ui.js';
import { createMessageListController } from './chat/message-list-controller.js';
import { createMessageMetaController } from './chat/message-meta.js';
import { createSendMessageController } from './chat/send-message.js';
import { createSessionController } from './chat/session-controller.js';
import { createSlashItemsStore } from './chat/slash-items-store.js';
import { createSlashPickerController } from './chat/slash-picker.js';
import { createViewRouter } from './app/view-router.js';
import { getChannelMeta } from './channels/channel-meta.js';
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
import { createToastController } from './ui/toast.js';

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
        let contextUsageController = null;
        let slashItemsStore = null;
        let slashPickerController = null;
        let inputUiController = null;
        let messageListController = null;
        let messageMetaController = null;
        let sessionController = null;
        let sendMessageController = null;
        let sidebarController = null;
        let settingsController = null;
        let channelsPageController = null;
        let skillsPageController = null;
        let viewRouter = null;
        const toastController = createToastController();
        const SESSION_MESSAGE_PAGE_SIZE = 40;
        const HISTORY_SESSION_PREVIEW_LIMIT = 4;
        const PROJECT_SESSION_PREVIEW_LIMIT = 4;
        const LARGE_MESSAGE_PREVIEW_CHARS = 20000;
        const SIDEBAR_REFRESH_INTERVAL_MS = 5000;
        const CURRENT_SESSION_REFRESH_INTERVAL_MS = 2000;
        const REALTIME_REFRESH_DEBOUNCE_MS = 150;
        const REALTIME_RECONNECT_MS = 3000;

        // 附件相关
        const fileInput = document.getElementById('file-input');
        const attachBtn = document.getElementById('attach-btn');
        const attachmentPreview = document.getElementById('attachment-preview');
        const skillPickerEl = document.getElementById('skill-picker');
        const selectedSkillsEl = document.getElementById('selected-skills');
        const dropOverlay = document.getElementById('drop-overlay');
        let pendingAttachments = []; // { path, name, size, isImage, localUrl? }

        const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif', '.heic', '.heif', '.avif'];

        contextUsageController = createContextUsageController();

        inputUiController = createChatInputUiController({
            inputEl: inputEl,
            sendBtn: sendBtn,
            getIsTyping: function () {
                return sessionController ? sessionController.getIsTyping() : false;
            },
            getIsCancellingResponse: function () {
                return sessionController ? sessionController.getIsCancellingResponse() : false;
            },
            getPendingAttachments: function () {
                return pendingAttachments;
            },
            getPromptSelection: function () {
                return slashPickerController
                    ? slashPickerController.getSelection()
                    : { skills: [], projects: [] };
            },
        });

        settingsController = createSettingsController({
            addProjectBtn: addProjectBtn,
            createNewChat: function (projectId, chatOptions) {
                return sessionController.createNewChat(projectId, chatOptions);
            },
            currentModelNameEl: currentModelNameEl,
            fetchSessions: function () {
                return sidebarController.fetchSessions();
            },
            getCurrentSessionId: function () {
                return sessionController ? sessionController.getCurrentSessionId() : null;
            },
            getCurrentSessionProvider: function () {
                return sessionController ? sessionController.getCurrentSessionProvider() : null;
            },
            getCurrentView: function () {
                return getCurrentView();
            },
            getLatestContextUsage: function () {
                return contextUsageController ? contextUsageController.getLatestUsage() : null;
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
            showSettingsView: showSettingsView,
            updateContextUsage: updateContextUsage,
        });

        function updateSendBtnState() {
            if (inputUiController) inputUiController.updateSendBtnState();
        }

        function resizeChatInput() {
            if (inputUiController) inputUiController.resizeChatInput();
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

        slashItemsStore = createSlashItemsStore({
            getCurrentSessionProvider: function () {
                return sessionController ? sessionController.getCurrentSessionProvider() : null;
            },
            getModelConfig: function () {
                return settingsController ? settingsController.getModelConfig() : null;
            },
            getProviderData: function () {
                return settingsController ? settingsController.getProviderData() : null;
            },
        });

        slashPickerController = createSlashPickerController({
            inputEl: inputEl,
            selectedSkillsEl: selectedSkillsEl,
            skillPickerEl: skillPickerEl,
            fetchSlashItemsData: function (force) {
                if (slashItemsStore) return slashItemsStore.fetchItems(force);
            },
            getCurrentSessionProjectId: function () {
                return sessionController ? sessionController.getCurrentSessionProjectId() : null;
            },
            getCurrentView: function () {
                return getCurrentView();
            },
            getSlashItemsState: function () {
                return slashItemsStore ? slashItemsStore.getState() : null;
            },
            resetInputHistoryNavigation: function () {
                return inputHistoryController.resetNavigation();
            },
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
            getOldestRenderedMessageId: function () {
                return messageListController ? messageListController.getOldestRenderedMessageId() : null;
            },
            getPromptSelection: function () {
                return slashPickerController.getSelection();
            },
            isSelectionOnlyFallback: isSelectionOnlyFallback,
            normalizeMessageProjects: normalizeMessageProjects,
            normalizeMessageSkills: normalizeMessageSkills,
            parseMessageMetadata: function (raw) {
                return messageListController ? messageListController.parseMessageMetadata(raw) : {};
            },
        });

        function applyChatInputDraft(value, skills, projects) {
            inputEl.value = value;
            slashPickerController.setSelection(skills, projects);
        }

        function closeSkillPicker(options) {
            return slashPickerController.close(options);
        }

        bindChatInputEvents({
            attachBtn: attachBtn,
            cancelCurrentResponse: function () {
                return sessionController.cancelCurrentResponse();
            },
            canOpenSkillPickerFromSlash: function (e) {
                return slashPickerController.canOpenFromSlash(e);
            },
            chatViewEl: document.getElementById('chat-view'),
            clearPromptSkillDeleteTarget: function () {
                return slashPickerController.clearDeleteTarget();
            },
            dropOverlay: dropOverlay,
            fileInput: fileInput,
            getIsTyping: function () {
                return sessionController ? sessionController.getIsTyping() : false;
            },
            handlePromptSkillBackspace: function (e) {
                return slashPickerController.handlePromptBackspace(e);
            },
            handleSkillPickerKeydown: function (e) {
                return slashPickerController.handleKeydown(e);
            },
            inputEl: inputEl,
            inputWrapper: inputWrapper,
            insertSkillSlashTrigger: function () {
                return slashPickerController.insertSlashTrigger();
            },
            navigateInputHistory: function (direction) {
                return inputHistoryController.navigate(direction);
            },
            resetInputHistoryNavigation: function () {
                return inputHistoryController.resetNavigation();
            },
            resizeChatInput: resizeChatInput,
            sendBtn: sendBtn,
            sendMessage: function () {
                return sendMessageController.sendMessage();
            },
            shouldHandleInputHistoryKey: function (e, direction) {
                return inputHistoryController.shouldHandleKey(e, direction);
            },
            syncSkillPickerFromInput: function () {
                return slashPickerController.syncFromInput();
            },
            updateSendBtnState: updateSendBtnState,
            uploadFiles: function (files) {
                return attachmentController.uploadFiles(files);
            },
        });

        sidebarController = createSidebarController({
            addProjectBtn: addProjectBtn,
            createNewChat: function (projectId, options) {
                return sessionController.createNewChat(projectId, options);
            },
            currentSessionRefreshIntervalMs: CURRENT_SESSION_REFRESH_INTERVAL_MS,
            deleteSession: function (id) {
                return sessionController.deleteSession(id);
            },
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
                return getCurrentView();
            },
            getIsLoadingOlderMessages: function () {
                return messageListController ? messageListController.getIsLoadingOlderMessages() : false;
            },
            getIsTyping: function () {
                return sessionController ? sessionController.getIsTyping() : false;
            },
            getNewestMessageId: function (messages) {
                return messageListController ? messageListController.getNewestMessageId(messages) : 0;
            },
            historyList: historyList,
            historySessionPreviewLimit: HISTORY_SESSION_PREVIEW_LIMIT,
            historyToggle: historyToggle,
            invalidateSlashItemsData: function (providerType) {
                if (slashItemsStore) slashItemsStore.invalidate(providerType);
            },
            loadSession: function (id, options) {
                return sessionController.loadSession(id, options);
            },
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
            updateConversationHeaderTitle: function (title) {
                return messageListController.updateConversationHeaderTitle(title);
            },
        });
        sidebarController.bindRealtimeLifecycle();

        newChatBtn.addEventListener('click', function () {
            sessionController.createNewChat();
        });
        projectToggle.addEventListener('click', function () {
            sidebarController.toggleProjects();
        });
        addProjectBtn.addEventListener('click', function () {
            return sidebarController.addProject();
        });
        historyToggle.addEventListener('click', function () {
            sidebarController.toggleHistory();
        });
        addHistoryChatBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            sessionController.createNewChat(null, { force: true });
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
            prependInputHistoryMessages: function (messages, hasMoreMessages) {
                return inputHistoryController.prependMessages(messages, hasMoreMessages);
            },
            renderMarkdown: renderMarkdown,
            formatTokenCount: formatTokenCount,
            sessionMessagePageSize: SESSION_MESSAGE_PAGE_SIZE,
            showError: showError,
            updateContextUsage: updateContextUsage,
        });

        function showError(msg) {
            toastController.showError(msg);
        }

        function updateContextUsage(usage) {
            if (contextUsageController) contextUsageController.updateUsage(usage);
        }

        sessionController = createSessionController({
            clearPromptSkills: function () {
                return slashPickerController.clearPromptSelections();
            },
            clearSessionModelSelection: function (sessionId) {
                settingsController.clearSessionModelSelection(sessionId);
            },
            expandProject: function (projectId) {
                return sidebarController.expandProject(projectId);
            },
            fetchModelConfig: function (providerType) {
                return settingsController.fetchModelConfig(providerType);
            },
            fetchSessions: function () {
                return sidebarController.fetchSessions();
            },
            findSessionSummary: function (id) {
                return sidebarController.findSessionSummary(id);
            },
            getActiveProjectId: function () {
                return sidebarController.getActiveProjectId();
            },
            getCurrentView: function () {
                return getCurrentView();
            },
            getProviderData: function () {
                return settingsController.getProviderData();
            },
            inputEl: inputEl,
            messagesEl: messagesEl,
            renderHistory: function () {
                sidebarController.renderHistory();
            },
            renderProjects: function () {
                sidebarController.renderProjects();
            },
            renderSessionMessages: function (messages, hasMoreMessages) {
                return messageListController.renderSessionMessages(messages, hasMoreMessages);
            },
            resetInputHistoryFromMessages: function (messages, hasMoreMessages) {
                return inputHistoryController.resetFromMessages(messages, hasMoreMessages);
            },
            resizeChatInput: resizeChatInput,
            revealActiveSessionInSidebar: function () {
                sidebarController.revealActiveSession();
            },
            revealSessionContainer: function (projectId) {
                sidebarController.revealSessionContainer(projectId);
            },
            scrollBottom: function () {
                return messageListController.scrollBottom();
            },
            sessionMessagePageSize: SESSION_MESSAGE_PAGE_SIZE,
            setActiveProjectId: function (projectId) {
                sidebarController.setActiveProjectId(projectId);
            },
            setSendButtonDisabled: function (value) {
                sendBtn.disabled = value;
            },
            showChatView: showChatView,
            showEmptyState: function () {
                return messageListController.showEmptyState();
            },
            showError: showError,
            updateContextUsage: updateContextUsage,
            updateConversationHeaderTitle: function (title) {
                return messageListController.updateConversationHeaderTitle(title);
            },
            updateSendBtnState: updateSendBtnState,
            updateSidebarSelection: function () {
                sidebarController.updateSelection();
            },
        });

        sendMessageController = createSendMessageController({
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
            appendMessage: function (role, text, attachments, changeReview, opts) {
                return messageListController.appendMessage(role, text, attachments, changeReview, opts);
            },
            clearPromptSkills: function () {
                return slashPickerController.clearPromptSelections();
            },
            fetchSessions: function () {
                return sidebarController.fetchSessions();
            },
            rememberSentUserMessage: function (text, skills, projects) {
                return inputHistoryController.rememberSentUserMessage(text, skills, projects);
            },
            removeTyping: function () {
                return messageListController.removeTyping();
            },
            renderAttachmentPreview: function () {
                return attachmentController.renderPreview();
            },
            resizeChatInput: resizeChatInput,
            scrollBottom: function () {
                return messageListController.scrollBottom();
            },
            showError: showError,
            showTyping: function () {
                return messageListController.showTyping();
            },
            updateContextUsage: updateContextUsage,
            updateConversationHeaderTitle: function (title) {
                return messageListController.updateConversationHeaderTitle(title);
            },
            updateSendBtnState: updateSendBtnState,
        });

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

        channelsPageController = createChannelsPageController({
            channelView: channelView,
            getChannelMeta: getChannelMeta,
            showError: showError,
        });

        skillsPageController = createSkillsPageController({
            getActiveSlashProviderType: function () {
                return slashItemsStore ? slashItemsStore.getActiveProviderType() : '';
            },
            getProviderQuery: function (providerType) {
                return slashItemsStore ? slashItemsStore.getProviderQuery(providerType) : (providerType ? '?provider=' + encodeURIComponent(providerType) : '');
            },
            invalidateSlashItemsData: function (providerType) {
                if (slashItemsStore) slashItemsStore.invalidate(providerType);
            },
            showChatView: showChatView,
            showError: showError,
            skillsView: skillsView,
        });

        viewRouter = createViewRouter({
            channelsBtn: channelsBtn,
            channelView: channelView,
            chatView: chatView,
            closeSkillPicker: closeSkillPicker,
            fetchChannels: function () {
                return channelsPageController.fetchChannels();
            },
            fetchSkills: function () {
                return skillsPageController.fetchSkills();
            },
            handleChannelsEscape: function () {
                return channelsPageController.handleEscape();
            },
            handleSkillsKeydown: function (e) {
                return skillsPageController.handleKeydown(e);
            },
            hasChannelsData: function () {
                return channelsPageController.hasChannelsData();
            },
            newChatBtn: newChatBtn,
            renderChannelsPage: function () {
                return channelsPageController.render();
            },
            renderHistory: function () {
                sidebarController.renderHistory();
            },
            renderProjects: function () {
                sidebarController.renderProjects();
            },
            renderSkillsPage: function () {
                return skillsPageController.render();
            },
            settingsBtn: settingsBtn,
            settingsView: settingsView,
            skillsBtn: skillsBtn,
            skillsView: skillsView,
        });
        viewRouter.bindNavigation();

        function getCurrentView() {
            return viewRouter ? viewRouter.getCurrentView() : 'chat';
        }

        function showChatView() {
            if (viewRouter) viewRouter.showChatView();
        }

        function showSettingsView() {
            if (viewRouter) viewRouter.showSettingsView();
        }

        async function init() {
            sidebarController.setupTooltips();
            if (inputUiController) inputUiController.startPlaceholderRotation();
            sidebarController.updateProjectsCollapsedState();
            sidebarController.updateHistoryCollapsedState();
            await Promise.all([
                sidebarController.fetchProjects(),
                sidebarController.fetchSessions(),
                settingsController.fetchModelConfig(),
                settingsController.fetchProviders(),
                settingsController.fetchSandboxConfig(),
                settingsController.fetchAppSettings(),
                settingsController.fetchProxyConfig(),
            ]);
            var initialSessions = sidebarController.getSessions();
            if (initialSessions.length > 0) {
                await sessionController.loadSession(initialSessions[0].id);
            } else {
                await sessionController.createNewChat();
            }
            sidebarController.startRealtimeEvents();
            inputEl.focus();
        }

        init();
    })();
