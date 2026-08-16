import { createAttachmentController } from '../chat/attachments.js';
import { createAutomationsPageController } from '../automations/automations-page.js';
import { createContextUsageController, formatTokenCount } from '../chat/context-usage.js';
import { createFileReferencePickerController } from '../chat/file-reference-picker.js';
import { bindChatInputEvents } from '../chat/input-events.js';
import { createInputHistoryController } from '../chat/input-history.js';
import { createChatInputUiController } from '../chat/input-ui.js';
import { createMessageListController } from '../chat/message-list-controller.js';
import { createMessageMetaController } from '../chat/message-meta.js';
import { createPermissionMode } from '../chat/permission-mode.js';
import { createHomeHero } from '../chat/home-hero.js';
import { createSendMessageController } from '../chat/send-message.js';
import { createSessionController } from '../chat/session-controller.js';
import { createSlashItemsStore } from '../chat/slash-items-store.js';
import { createSlashPickerController } from '../chat/slash-picker.js';
import {
    isSelectionOnlyFallback,
    normalizeMessageFileReferences,
    normalizeMessageProjects,
    normalizeMessageSkills,
} from '../chat/message-selection.js';
import { getChannelMeta } from '../channels/channel-meta.js';
import { createChannelsPageController } from '../channels/channels-page.js';
import { createSidebarController } from '../sidebar/sidebar-controller.js';
import { createSettingsController } from '../settings/settings-controller.js';
import { createSkillsPageController } from '../skills/skills-page.js';
import { copyCode } from '../ui/code-copy.js';
import { openImageModal } from '../ui/image-modal.js';
import { createToastController } from '../ui/toast.js';
import { createViewRouter } from './view-router.js';

const SESSION_MESSAGE_PAGE_SIZE = 40;
const SESSION_LIST_PAGE_SIZE = 40;
const HISTORY_SESSION_PREVIEW_LIMIT = 4;
const PROJECT_SESSION_PREVIEW_LIMIT = 4;
const LARGE_MESSAGE_PREVIEW_CHARS = 20000;
const SIDEBAR_REFRESH_INTERVAL_MS = 5000;
const CURRENT_SESSION_REFRESH_INTERVAL_MS = 2000;
const REALTIME_REFRESH_DEBOUNCE_MS = 150;
const REALTIME_RECONNECT_MS = 3000;
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif', '.heic', '.heif', '.avif'];

function requireAppController(controller, name) {
    if (controller) return controller;
    throw new Error('AnyBot app controller is not ready: ' + name);
}

export function createAnyBotApp(dom, deps) {
    deps = deps || {};

    const documentRef = deps.documentRef || document;
    const renderMarkdown = deps.renderMarkdown;
    const {
        messagesEl,
        inputEl,
        inputWrapper,
        sendBtn,
        sidebar,
        projectToggle,
        projectList,
        addProjectBtn,
        historyToggle,
        historyList,
        addHistoryChatBtn,
        newChatBtn,
        modelSwitcher,
        modelBadge,
        modelDropdown,
        currentModelNameEl,
        permissionSwitcher,
        permissionBadge,
        permissionName,
        permissionDropdown,
        homeHero,
        homeProjectPicker,
        homeProjectChip,
        homeProjectChipName,
        homeProjectDropdown,
        settingsBtn,
        sidebarUpdateBtn,
        settingsView,
        settingsCancelBtn,
        settingsSaveBtn,
        settingsSaveStatus,
        settingsTitle,
        settingsSubtitle,
        settingsNavItems,
        settingsTabPanels,
        settingsProviderSelect,
        settingsProviderCombobox,
        settingsProviderTrigger,
        settingsProviderCurrent,
        settingsProviderMenu,
        settingsThemeCombobox,
        settingsThemeTrigger,
        settingsThemeCurrent,
        settingsThemeGroup,
        settingsProviderModelCombobox,
        settingsProviderModelTrigger,
        settingsProviderModelCurrent,
        settingsProviderModelMenu,
        settingsProviderModelSelect,
        settingsProviderTimeoutFields,
        settingsProviderCompatToggleFields,
        settingsProviderBinFields,
        settingsProviderExtraFields,
        settingsProviderSubtabs,
        settingsProviderSubtabPanels,
        settingsMcpRefreshBtn,
        settingsMcpAddControl,
        settingsMcpAddBtn,
        settingsMcpAddMenu,
        settingsMcpServerList,
        settingsDefaultWorkdir,
        settingsWorkdirOpenBtn,
        settingsWorkdirPickBtn,
        settingsProjectsEntryBtn,
        settingsLogRetentionDays,
        settingsOpenLogsBtn,
        settingsClearLogsBtn,
        settingsOpenDataBtn,
        settingsClearUploadsBtn,
        settingsExportDataBtn,
        settingsImportDataBtn,
        settingsImportFile,
        settingsClearHistoryBtn,
        settingsAboutVersion,
        settingsUpdateStatus,
        settingsUpdateCheckedAt,
        settingsUpdateProgress,
        settingsUpdateProgressFill,
        settingsUpdateProgressText,
        settingsUpdateCheckBtn,
        settingsUpdateDownloadBtn,
        settingsUpdateRestartBtn,
        fileInput,
        attachBtn,
        attachmentPreview,
        skillPickerEl,
        filePickerEl,
        selectedSkillsEl,
        selectedFilesEl,
        dropOverlay,
        chatView,
        channelView,
        skillsView,
        automationView,
        channelsBtn,
        skillsBtn,
        automationsBtn,
    } = dom;

    let contextUsageController = null;
    let fileReferencePickerController = null;
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
    let automationsPageController = null;
    let viewRouter = null;
    let attachmentController = null;
    let inputHistoryController = null;
    let permissionModeController = null;
    let homeHeroController = null;
    let appEventsBound = false;
    let pendingAttachments = [];
    const toastController = createToastController({ documentRef: documentRef });

    function requireAttachmentController() {
        return requireAppController(attachmentController, 'attachmentController');
    }

    function requireFileReferencePickerController() {
        return requireAppController(fileReferencePickerController, 'fileReferencePickerController');
    }

    function requireInputHistoryController() {
        return requireAppController(inputHistoryController, 'inputHistoryController');
    }

    function requireMessageListController() {
        return requireAppController(messageListController, 'messageListController');
    }

    function requireSendMessageController() {
        return requireAppController(sendMessageController, 'sendMessageController');
    }

    function requireSessionController() {
        return requireAppController(sessionController, 'sessionController');
    }

    function requireSettingsController() {
        return requireAppController(settingsController, 'settingsController');
    }

    function requireSidebarController() {
        return requireAppController(sidebarController, 'sidebarController');
    }

    function requireSlashPickerController() {
        return requireAppController(slashPickerController, 'slashPickerController');
    }

    function requireViewRouter() {
        return requireAppController(viewRouter, 'viewRouter');
    }

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
            var fileSelection = fileReferencePickerController
                ? fileReferencePickerController.getSelection()
                : [];
            var promptSelection = slashPickerController
                ? slashPickerController.getSelection()
                : { skills: [], projects: [] };
            return slashPickerController
                ? Object.assign({}, promptSelection, { files: fileSelection })
                : { skills: [], projects: [], files: fileSelection };
        },
    });

    permissionModeController = createPermissionMode({
        switcher: permissionSwitcher,
        badge: permissionBadge,
        nameEl: permissionName,
        dropdown: permissionDropdown,
        onError: showError,
    });

    homeHeroController = createHomeHero({
        hero: homeHero,
        picker: homeProjectPicker,
        chip: homeProjectChip,
        chipNameEl: homeProjectChipName,
        dropdown: homeProjectDropdown,
        getActiveProjectId: function () {
            return sidebarController ? sidebarController.getActiveProjectId() : null;
        },
        getProjects: function () {
            return sidebarController ? sidebarController.getProjects() : [];
        },
        selectProject: function (projectId) {
            var sidebar = requireSidebarController();
            // 首页 chip 只切换选中项目，侧边栏项目在发送消息创建会话后才展开
            sidebar.setActiveProjectId(projectId || null);
            sidebar.updateSelection();
            return requireSessionController().createNewChat(projectId || null, { deferSidebarReveal: true });
        },
    });

    settingsController = createSettingsController({
        addProjectBtn: addProjectBtn,
        createNewChat: function (projectId, chatOptions) {
            return requireSessionController().createNewChat(projectId, chatOptions);
        },
        currentModelNameEl: currentModelNameEl,
        fetchSessions: function () {
            return requireSidebarController().fetchSessions();
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
            return requireSidebarController();
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
        settingsProviderTimeoutFields: settingsProviderTimeoutFields,
        settingsProviderSubtabs: settingsProviderSubtabs,
        settingsProviderSubtabPanels: settingsProviderSubtabPanels,
        settingsProviderModelTrigger: settingsProviderModelTrigger,
        settingsProviderSelect: settingsProviderSelect,
        settingsProviderTrigger: settingsProviderTrigger,
        settingsMcpRefreshBtn: settingsMcpRefreshBtn,
        settingsMcpAddControl: settingsMcpAddControl,
        settingsMcpAddBtn: settingsMcpAddBtn,
        settingsMcpAddMenu: settingsMcpAddMenu,
        settingsMcpServerList: settingsMcpServerList,
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
        sidebarUpdateBtn: sidebarUpdateBtn,
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

    attachmentController = createAttachmentController({
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
        getLatestContextUsage: function () {
            return contextUsageController ? contextUsageController.getLatestUsage() : null;
        },
        getSlashItemsState: function () {
            return slashItemsStore ? slashItemsStore.getState() : null;
        },
        resetInputHistoryNavigation: function () {
            return requireInputHistoryController().resetNavigation();
        },
        runProviderCommand: function (commandText, item) {
            if (!sendMessageController) return false;
            return sendMessageController.sendProviderCommand(commandText, item);
        },
        resizeChatInput: resizeChatInput,
        showError: showError,
        updateSendBtnState: updateSendBtnState,
    });

    fileReferencePickerController = createFileReferencePickerController({
        inputEl: inputEl,
        filePickerEl: filePickerEl,
        selectedFilesEl: selectedFilesEl,
        getCurrentSessionId: function () {
            return sessionController ? sessionController.getCurrentSessionId() : null;
        },
        getCurrentProjectId: function () {
            return sessionController ? sessionController.getCurrentSessionProjectId() : null;
        },
        getCurrentView: function () {
            return getCurrentView();
        },
        resizeChatInput: resizeChatInput,
        updateSendBtnState: updateSendBtnState,
    });

    inputHistoryController = createInputHistoryController({
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
            var promptSelection = slashPickerController.getSelection();
            return Object.assign({}, promptSelection, {
                files: fileReferencePickerController ? fileReferencePickerController.getSelection() : [],
            });
        },
        isSelectionOnlyFallback: isSelectionOnlyFallback,
        normalizeMessageFileReferences: normalizeMessageFileReferences,
        normalizeMessageProjects: normalizeMessageProjects,
        normalizeMessageSkills: normalizeMessageSkills,
        parseMessageMetadata: function (raw) {
            return messageListController ? messageListController.parseMessageMetadata(raw) : {};
        },
    });

    function applyChatInputDraft(value, skills, projects, files) {
        inputEl.value = value;
        requireSlashPickerController().setSelection(skills, projects);
        requireFileReferencePickerController().setSelection(files || []);
    }

    function closeSkillPicker(options) {
        return requireSlashPickerController().close(options);
    }

    function closeFilePicker() {
        if (fileReferencePickerController) fileReferencePickerController.close();
    }

    function clearFileReferences() {
        if (fileReferencePickerController) fileReferencePickerController.clearSelection();
    }

    sidebarController = createSidebarController({
        addProjectBtn: addProjectBtn,
        createNewChat: function (projectId, options) {
            return requireSessionController().createNewChat(projectId, options);
        },
        currentSessionRefreshIntervalMs: CURRENT_SESSION_REFRESH_INTERVAL_MS,
        deleteSession: function (id) {
            return requireSessionController().deleteSession(id);
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
            return requireSessionController().loadSession(id, options);
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
        sessionPageSize: SESSION_LIST_PAGE_SIZE,
        sidebar: sidebar,
        sidebarRefreshIntervalMs: SIDEBAR_REFRESH_INTERVAL_MS,
        updateConversationHeaderTitle: function (title) {
            return requireMessageListController().updateConversationHeaderTitle(title);
        },
    });

    messageMetaController = createMessageMetaController({
        showError: showError,
    });
    messageMetaController.installGlobal();

    messageListController = createMessageListController({
        attachMessageMeta: messageMetaController.attachMessageMeta,
        chatViewEl: chatView,
        copyCode: copyCode,
        getCurrentSessionId: function () {
            return sessionController ? sessionController.getCurrentSessionId() : null;
        },
        homeHeroEl: homeHero,
        imageExts: IMAGE_EXTS,
        largeMessagePreviewChars: LARGE_MESSAGE_PREVIEW_CHARS,
        messagesEl: messagesEl,
        onShowHome: function () {
            if (homeHeroController) homeHeroController.syncChip();
        },
        openImageModal: openImageModal,
        prependInputHistoryMessages: function (messages, hasMoreMessages) {
            return requireInputHistoryController().prependMessages(messages, hasMoreMessages);
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
            return requireSlashPickerController().clearPromptSelections();
        },
        closeFilePicker: closeFilePicker,
        clearFileReferences: clearFileReferences,
        clearSessionModelSelection: function (sessionId) {
            requireSettingsController().clearSessionModelSelection(sessionId);
        },
        expandProject: function (projectId) {
            return requireSidebarController().expandProject(projectId);
        },
        fetchModelConfig: function (providerType) {
            return requireSettingsController().fetchModelConfig(providerType);
        },
        fetchSessions: function () {
            return requireSidebarController().fetchSessions();
        },
        findSessionSummary: function (id) {
            return requireSidebarController().findSessionSummary(id);
        },
        getActiveProjectId: function () {
            return requireSidebarController().getActiveProjectId();
        },
        getCurrentView: function () {
            return getCurrentView();
        },
        getProviderData: function () {
            return requireSettingsController().getProviderData();
        },
        inputEl: inputEl,
        messagesEl: messagesEl,
        renderHistory: function () {
            requireSidebarController().renderHistory();
        },
        renderProjects: function () {
            requireSidebarController().renderProjects();
        },
        removeSessionSummary: function (id) {
            requireSidebarController().removeSessionSummary(id);
        },
        renderSessionMessages: function (messages, hasMoreMessages) {
            return requireMessageListController().renderSessionMessages(messages, hasMoreMessages);
        },
        appendContextCompactProgress: function (opts) {
            return requireMessageListController().appendContextCompactProgress(opts);
        },
        resetInputHistoryFromMessages: function (messages, hasMoreMessages) {
            return requireInputHistoryController().resetFromMessages(messages, hasMoreMessages);
        },
        resizeChatInput: resizeChatInput,
        revealActiveSessionInSidebar: function () {
            requireSidebarController().revealActiveSession();
        },
        revealSessionContainer: function (projectId, opts) {
            requireSidebarController().revealSessionContainer(projectId, opts);
        },
        scrollBottom: function (opts) {
            return requireMessageListController().scrollBottom(opts);
        },
        sessionMessagePageSize: SESSION_MESSAGE_PAGE_SIZE,
        setActiveProjectId: function (projectId) {
            requireSidebarController().setActiveProjectId(projectId);
            if (homeHeroController) homeHeroController.syncChip();
        },
        setSendButtonDisabled: function (value) {
            sendBtn.disabled = value;
        },
        showChatView: showChatView,
        showEmptyState: function () {
            return requireMessageListController().showEmptyState();
        },
        showError: showError,
        updateContextUsage: updateContextUsage,
        updateConversationHeaderTitle: function (title) {
            return requireMessageListController().updateConversationHeaderTitle(title);
        },
        updateSendBtnState: updateSendBtnState,
        updateSidebarSelection: function () {
            requireSidebarController().updateSelection();
        },
    });

    sendMessageController = createSendMessageController({
        inputEl: inputEl,
        messagesEl: messagesEl,
        ensureSession: function () {
            return requireSessionController().ensureSession();
        },
        getState: function () {
            var promptSelection = requireSlashPickerController().getSelection();
            var session = requireSessionController();
            var settings = requireSettingsController();
            return {
                currentSessionId: session.getCurrentSessionId(),
                currentSessionProvider: session.getCurrentSessionProvider(),
                isTyping: session.getIsTyping(),
                modelConfig: settings.getModelConfig(),
                pendingAttachments: pendingAttachments,
                fileReferences: fileReferencePickerController ? fileReferencePickerController.getSelection() : [],
                promptProjects: promptSelection.projects,
                promptSkills: promptSelection.skills,
                providerData: settings.getProviderData(),
            };
        },
        setPendingAttachments: function (value) {
            pendingAttachments = value;
        },
        setTyping: function (value) {
            requireSessionController().setTyping(value);
        },
        setCancelling: function (value) {
            requireSessionController().setCancelling(value);
        },
        setSendButtonDisabled: function (value) {
            sendBtn.disabled = value;
        },
        setActiveStream: function (controller, sessionId) {
            requireSessionController().setActiveStream(controller, sessionId);
        },
        clearActiveStreamForSession: function (sessionId) {
            requireSessionController().clearActiveStreamForSession(sessionId);
        },
        setCurrentSessionProvider: function (provider) {
            requireSessionController().setCurrentSessionProvider(provider);
        },
        startCompactProgress: function (sessionId, startedAt) {
            requireSessionController().startActiveCompact(sessionId, startedAt);
        },
        finishCompactProgress: function (sessionId, result) {
            return requireSessionController().finishActiveCompact(sessionId, result);
        },
        cancelCompactProgress: function (sessionId, label) {
            return requireSessionController().cancelActiveCompact(sessionId, label);
        },
        failCompactProgress: function (sessionId, label) {
            return requireSessionController().failActiveCompact(sessionId, label);
        },
        appendMessage: function (role, text, attachments, changeReview, opts) {
            return requireMessageListController().appendMessage(role, text, attachments, changeReview, opts);
        },
        appendContextCompactDivider: function (text, opts) {
            return requireMessageListController().appendContextCompactDivider(text, opts);
        },
        appendContextCompactProgress: function (opts) {
            return requireMessageListController().appendContextCompactProgress(opts);
        },
        clearPromptSkills: function () {
            return requireSlashPickerController().clearPromptSelections();
        },
        clearFileReferences: clearFileReferences,
        fetchSessions: function () {
            return requireSidebarController().fetchSessions();
        },
        rememberSentUserMessage: function (text, skills, projects, files) {
            return requireInputHistoryController().rememberSentUserMessage(text, skills, projects, files);
        },
        removeTyping: function () {
            return requireMessageListController().removeTyping();
        },
        renderAttachmentPreview: function () {
            return requireAttachmentController().renderPreview();
        },
        resizeChatInput: resizeChatInput,
        scrollBottom: function (opts) {
            return requireMessageListController().scrollBottom(opts);
        },
        showError: showError,
        showTyping: function () {
            return requireMessageListController().showTyping();
        },
        updateContextUsage: updateContextUsage,
        updateConversationHeaderTitle: function (title) {
            return requireMessageListController().updateConversationHeaderTitle(title);
        },
        updateSendBtnState: updateSendBtnState,
    });

    channelsPageController = createChannelsPageController({
        channelView: channelView,
        getChannelMeta: getChannelMeta,
        showError: showError,
    });

    skillsPageController = createSkillsPageController({
        getActiveSlashProviderType: function () {
            return slashItemsStore ? slashItemsStore.getConfiguredProviderType() : '';
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

    automationsPageController = createAutomationsPageController({
        automationView: automationView,
        getActiveProviderType: function () {
            return slashItemsStore ? slashItemsStore.getActiveProviderType() : '';
        },
        getChannelMeta: getChannelMeta,
        openSession: function (sessionId) {
            return requireSessionController().loadSession(sessionId, { force: true });
        },
        showError: showError,
    });

    viewRouter = createViewRouter({
        automationsBtn: automationsBtn,
        automationView: automationView,
        channelsBtn: channelsBtn,
        channelView: channelView,
        chatView: chatView,
        closeSkillPicker: closeSkillPicker,
        documentRef: documentRef,
        fetchChannels: function () {
            return channelsPageController.fetchChannels();
        },
        fetchAutomations: function () {
            return automationsPageController.fetchInitialData();
        },
        fetchSkills: function () {
            return skillsPageController.fetchSkills();
        },
        handleAutomationsEscape: function () {
            return automationsPageController.handleEscape();
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
        hasAutomationsData: function () {
            return automationsPageController.hasAutomationsData();
        },
        newChatBtn: newChatBtn,
        renderAutomationsPage: function () {
            return automationsPageController.render();
        },
        renderChannelsPage: function () {
            return channelsPageController.render();
        },
        renderHistory: function () {
            requireSidebarController().renderHistory();
        },
        renderProjects: function () {
            requireSidebarController().renderProjects();
        },
        renderSkillsPage: function () {
            return skillsPageController.render();
        },
        settingsBtn: settingsBtn,
        settingsView: settingsView,
        skillsBtn: skillsBtn,
        skillsView: skillsView,
    });

    function getCurrentView() {
        return viewRouter ? viewRouter.getCurrentView() : 'chat';
    }

    function showChatView() {
        if (viewRouter) viewRouter.showChatView();
    }

    function showSettingsView() {
        if (viewRouter) viewRouter.showSettingsView();
    }

    function bindAppEvents() {
        if (appEventsBound) return;
        appEventsBound = true;

        bindChatInputEvents({
            attachBtn: attachBtn,
            cancelCurrentResponse: function () {
                return requireSessionController().cancelCurrentResponse();
            },
            canOpenSkillPickerFromSlash: function (e) {
                return requireSlashPickerController().canOpenFromSlash(e);
            },
            chatViewEl: chatView,
            clearPromptSkillDeleteTarget: function () {
                return requireSlashPickerController().clearDeleteTarget();
            },
            clearFileDeleteTarget: function () {
                return requireFileReferencePickerController().clearDeleteTarget();
            },
            closeFilePicker: closeFilePicker,
            dropOverlay: dropOverlay,
            fileInput: fileInput,
            getIsTyping: function () {
                return sessionController ? sessionController.getIsTyping() : false;
            },
            handlePromptSkillBackspace: function (e) {
                return requireSlashPickerController().handlePromptBackspace(e);
            },
            handleFilePickerKeydown: function (e) {
                return requireFileReferencePickerController().handleKeydown(e);
            },
            handleFileReferenceDelete: function (e) {
                return requireFileReferencePickerController().handleSelectedFileDelete(e);
            },
            handleSkillPickerKeydown: function (e) {
                return requireSlashPickerController().handleKeydown(e);
            },
            inputEl: inputEl,
            inputWrapper: inputWrapper,
            insertSkillSlashTrigger: function () {
                return requireSlashPickerController().insertSlashTrigger();
            },
            navigateInputHistory: function (direction) {
                return requireInputHistoryController().navigate(direction);
            },
            resetInputHistoryNavigation: function () {
                return requireInputHistoryController().resetNavigation();
            },
            resizeChatInput: resizeChatInput,
            sendBtn: sendBtn,
            sendMessage: function () {
                return requireSendMessageController().sendMessage();
            },
            shouldHandleInputHistoryKey: function (e, direction) {
                return requireInputHistoryController().shouldHandleKey(e, direction);
            },
            syncSkillPickerFromInput: function () {
                return requireSlashPickerController().syncFromInput();
            },
            syncFilePickerFromInput: function () {
                return requireFileReferencePickerController().syncFromInput();
            },
            updateSendBtnState: updateSendBtnState,
            uploadFiles: function (files) {
                return requireAttachmentController().uploadFiles(files);
            },
        });

        newChatBtn.addEventListener('click', function () {
            requireSessionController().createNewChat();
        });
        projectToggle.addEventListener('click', function () {
            requireSidebarController().toggleProjects();
        });
        addProjectBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            return requireSidebarController().addProject();
        });
        historyToggle.addEventListener('click', function () {
            requireSidebarController().toggleHistory();
        });
        addHistoryChatBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            requireSessionController().createNewChat(null, { force: true });
        });

        documentRef.addEventListener('click', function (e) {
            var slashPicker = requireSlashPickerController();
            var filePicker = requireFileReferencePickerController();
            if (slashPicker.isOpen() && skillPickerEl && e.target !== inputEl && !skillPickerEl.contains(e.target)) {
                closeSkillPicker();
            }
            if (filePicker.isOpen() && filePickerEl && e.target !== inputEl && !filePickerEl.contains(e.target)) {
                closeFilePicker();
            }
            if (permissionModeController) permissionModeController.handleDocumentClick(e);
            if (homeHeroController) homeHeroController.handleDocumentClick(e);
            requireSettingsController().handleDocumentClick(e);
        });

        documentRef.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                var filePicker = requireFileReferencePickerController();
                var slashPicker = requireSlashPickerController();
                if (filePicker.isOpen()) {
                    closeFilePicker();
                    if (documentRef.activeElement === inputEl) inputEl.focus();
                    return;
                }
                if (slashPicker.isOpen()) {
                    closeSkillPicker({ removeTrigger: documentRef.activeElement === inputEl });
                    if (documentRef.activeElement === inputEl) inputEl.focus();
                    return;
                }
                if (permissionModeController && permissionModeController.handleEscape()) return;
                if (homeHeroController && homeHeroController.handleEscape()) return;
                if (requireSettingsController().handleDocumentEscape(e)) return;
            }
        });

        requireViewRouter().bindNavigation();
        requireSidebarController().bindRealtimeLifecycle();
    }

    async function init() {
        bindAppEvents();
        var sidebar = requireSidebarController();
        var settings = requireSettingsController();
        var session = requireSessionController();
        sidebar.setupTooltips();
        if (inputUiController) inputUiController.startPlaceholderRotation();
        sidebar.updateProjectsCollapsedState();
        sidebar.updateHistoryCollapsedState();
        await Promise.all([
            sidebar.fetchProjects(),
            sidebar.fetchSessions(),
            settings.fetchModelConfig(),
            settings.fetchProviders(),
            settings.fetchAppSettings(),
            settings.fetchProxyConfig(),
            permissionModeController ? permissionModeController.refresh() : Promise.resolve(),
        ]);
        settings.startDesktopUpdateStatusRefresh();
        var initialSessions = sidebar.getSessions();
        if (initialSessions.length > 0) {
            await session.loadSession(initialSessions[0].id);
        } else {
            await session.createNewChat();
        }
        sidebar.startRealtimeEvents();
        inputEl.focus();
    }

    return {
        init: init,
    };
}
