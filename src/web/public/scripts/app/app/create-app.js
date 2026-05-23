import { createAttachmentController } from '../chat/attachments.js';
import { createContextUsageController, formatTokenCount } from '../chat/context-usage.js';
import { bindChatInputEvents } from '../chat/input-events.js';
import { createInputHistoryController } from '../chat/input-history.js';
import { createChatInputUiController } from '../chat/input-ui.js';
import { createMessageListController } from '../chat/message-list-controller.js';
import { createMessageMetaController } from '../chat/message-meta.js';
import { createSendMessageController } from '../chat/send-message.js';
import { createSessionController } from '../chat/session-controller.js';
import { createSlashItemsStore } from '../chat/slash-items-store.js';
import { createSlashPickerController } from '../chat/slash-picker.js';
import {
    isSelectionOnlyFallback,
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
const HISTORY_SESSION_PREVIEW_LIMIT = 4;
const PROJECT_SESSION_PREVIEW_LIMIT = 4;
const LARGE_MESSAGE_PREVIEW_CHARS = 20000;
const SIDEBAR_REFRESH_INTERVAL_MS = 5000;
const CURRENT_SESSION_REFRESH_INTERVAL_MS = 2000;
const REALTIME_REFRESH_DEBOUNCE_MS = 150;
const REALTIME_RECONNECT_MS = 3000;
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif', '.heic', '.heif', '.avif'];

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
        settingsBtn,
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
        settingsSandboxCombobox,
        settingsSandboxTrigger,
        settingsSandboxCurrent,
        settingsSandboxGroup,
        settingsProviderModelCombobox,
        settingsProviderModelTrigger,
        settingsProviderModelCurrent,
        settingsProviderModelMenu,
        settingsProviderModelSelect,
        settingsProviderCompatToggleFields,
        settingsProviderBinFields,
        settingsProviderExtraFields,
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
        selectedSkillsEl,
        dropOverlay,
        chatView,
        channelView,
        skillsView,
        channelsBtn,
        skillsBtn,
    } = dom;

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
    let pendingAttachments = [];
    const toastController = createToastController({ documentRef: documentRef });

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
        chatViewEl: chatView,
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

    documentRef.addEventListener('click', function (e) {
        if (slashPickerController.isOpen() && skillPickerEl && e.target !== inputEl && !skillPickerEl.contains(e.target)) {
            closeSkillPicker();
        }
        settingsController.handleDocumentClick(e);
    });

    documentRef.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            if (slashPickerController.isOpen()) {
                closeSkillPicker({ removeTrigger: documentRef.activeElement === inputEl });
                if (documentRef.activeElement === inputEl) inputEl.focus();
                return;
            }
            if (settingsController.handleDocumentEscape(e)) return;
        }
    });

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
        documentRef: documentRef,
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

    return {
        init: init,
    };
}
