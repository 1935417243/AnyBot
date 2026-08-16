import { createSettingsProviderController } from './settings-provider-controller.js';
import { createSettingsMcpController } from './settings-mcp-controller.js';
import { buildSettingsComboboxOptionHtml } from '../ui/settings-combobox.js';
import { escapeHtml } from '../utils/html.js';

const GITHUB_LATEST_RELEASE_URL = 'https://github.com/1935417243/AnyBot/releases/latest';
const THEME_STORAGE_KEY = 'webuiTheme';
const DESKTOP_UPDATE_STATUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const THEME_OPTIONS = [
    {id: 'light', name: '浅色'},
    {id: 'dark', name: '深色'},
    {id: 'system', name: '自动'},
];
const HIGHLIGHT_DARK_CSS = 'vendor/highlight/github-dark-dimmed.min.css';
const HIGHLIGHT_LIGHT_CSS = 'vendor/highlight/github.min.css';

export function createSettingsController(options) {
    const addProjectBtn = options.addProjectBtn;
    const currentModelNameEl = options.currentModelNameEl;
    const modelSwitcher = options.modelSwitcher;
    const modelBadge = options.modelBadge;
    const modelDropdown = options.modelDropdown;
    const settingsAboutVersion = options.settingsAboutVersion;
    const settingsCancelBtn = options.settingsCancelBtn;
    const settingsClearHistoryBtn = options.settingsClearHistoryBtn;
    const settingsClearLogsBtn = options.settingsClearLogsBtn;
    const settingsClearUploadsBtn = options.settingsClearUploadsBtn;
    const settingsDefaultWorkdir = options.settingsDefaultWorkdir;
    const settingsExportDataBtn = options.settingsExportDataBtn;
    const settingsImportDataBtn = options.settingsImportDataBtn;
    const settingsImportFile = options.settingsImportFile;
    const settingsLogRetentionDays = options.settingsLogRetentionDays;
    const settingsNavItems = options.settingsNavItems || [];
    const settingsOpenDataBtn = options.settingsOpenDataBtn;
    const settingsOpenLogsBtn = options.settingsOpenLogsBtn;
    const settingsProjectsEntryBtn = options.settingsProjectsEntryBtn;
    const settingsProviderCombobox = options.settingsProviderCombobox;
    const settingsProviderCompatToggleFields = options.settingsProviderCompatToggleFields;
    const settingsProviderCurrent = options.settingsProviderCurrent;
    const settingsProviderExtraFields = options.settingsProviderExtraFields;
    const settingsProviderBinFields = options.settingsProviderBinFields;
    const settingsProviderMenu = options.settingsProviderMenu;
    const settingsProviderModelCombobox = options.settingsProviderModelCombobox;
    const settingsProviderModelCurrent = options.settingsProviderModelCurrent;
    const settingsProviderModelMenu = options.settingsProviderModelMenu;
    const settingsProviderModelSelect = options.settingsProviderModelSelect;
    const settingsProviderModelTrigger = options.settingsProviderModelTrigger;
    const settingsProviderSubtabs = options.settingsProviderSubtabs;
    const settingsProviderSubtabPanels = options.settingsProviderSubtabPanels;
    const settingsProviderTimeoutFields = options.settingsProviderTimeoutFields;
    const settingsProviderSelect = options.settingsProviderSelect;
    const settingsProviderTrigger = options.settingsProviderTrigger;
    const settingsMcpRefreshBtn = options.settingsMcpRefreshBtn;
    const settingsMcpAddControl = options.settingsMcpAddControl;
    const settingsMcpAddBtn = options.settingsMcpAddBtn;
    const settingsMcpAddMenu = options.settingsMcpAddMenu;
    const settingsMcpServerList = options.settingsMcpServerList;
    const settingsSaveBtn = options.settingsSaveBtn;
    const settingsSaveStatus = options.settingsSaveStatus;
    const settingsTabPanels = options.settingsTabPanels || [];
    const settingsThemeCombobox = options.settingsThemeCombobox;
    const settingsThemeCurrent = options.settingsThemeCurrent;
    const settingsThemeGroup = options.settingsThemeGroup;
    const settingsThemeTrigger = options.settingsThemeTrigger;
    const settingsTitle = options.settingsTitle;
    const settingsSubtitle = options.settingsSubtitle;
    const settingsUpdateCheckBtn = options.settingsUpdateCheckBtn;
    const settingsUpdateCheckedAt = options.settingsUpdateCheckedAt;
    const settingsUpdateDownloadBtn = options.settingsUpdateDownloadBtn;
    const settingsUpdateProgress = options.settingsUpdateProgress;
    const settingsUpdateProgressFill = options.settingsUpdateProgressFill;
    const settingsUpdateProgressText = options.settingsUpdateProgressText;
    const settingsUpdateRestartBtn = options.settingsUpdateRestartBtn;
    const settingsUpdateStatus = options.settingsUpdateStatus;
    const settingsView = options.settingsView;
    const settingsBtn = options.settingsBtn;
    const sidebarUpdateBtn = options.sidebarUpdateBtn;
    const settingsWorkdirOpenBtn = options.settingsWorkdirOpenBtn;
    const settingsWorkdirPickBtn = options.settingsWorkdirPickBtn;
    const systemThemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

    let modelConfig = null;
    let appSettingsPayload = null;
    let appSettings = null;
    let activeSettingsTab = 'general';
    let desktopUpdateStatus = null;
    let desktopUpdatePollTimer = null;
    let desktopUpdateRefreshTimer = null;
    let sessionModelSelections = {};
    let settingsProviderController = null;
    let settingsMcpController = null;
    let currentThemeSetting = readStoredTheme();

    function createNewChat(projectId, chatOptions) {
        if (!options.createNewChat) return Promise.resolve();
        return options.createNewChat(projectId, chatOptions);
    }

    function fetchSessions() {
        if (!options.fetchSessions) return Promise.resolve();
        return options.fetchSessions();
    }

    function getCurrentSessionId() {
        return options.getCurrentSessionId ? options.getCurrentSessionId() : null;
    }

    function getCurrentSessionProvider() {
        return options.getCurrentSessionProvider ? options.getCurrentSessionProvider() : null;
    }

    function getCurrentView() {
        return options.getCurrentView ? options.getCurrentView() : '';
    }

    function getLatestContextUsage() {
        return options.getLatestContextUsage ? options.getLatestContextUsage() : null;
    }

    function getSidebarController() {
        return options.getSidebarController ? options.getSidebarController() : null;
    }

    function showChatView() {
        if (options.showChatView) options.showChatView();
    }

    function showError(message) {
        if (options.showError) options.showError(message);
    }

    function showSettingsView() {
        if (options.showSettingsView) options.showSettingsView();
    }

    function updateContextUsage(usage) {
        if (options.updateContextUsage) options.updateContextUsage(usage);
    }

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

        var latestContextUsage = getLatestContextUsage();
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
            if (settingsProviderController) settingsProviderController.closeProviderControls();
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

    function updateModelBadgeLabel() {
        if (!modelConfig) return;
        var current = null;
        (modelConfig.models || []).forEach(function (m) {
            if (m.id === modelConfig.currentModel) current = m;
        });
        currentModelNameEl.textContent = current && current.name ? current.name : modelConfig.currentModel;
        modelBadge.title = currentModelNameEl.textContent;
    }

    async function fetchModelConfig(providerType) {
        try {
            var targetProvider = providerType || getCurrentSessionProvider() || '';
            var url = '/api/model-config' + (targetProvider ? '?provider=' + encodeURIComponent(targetProvider) : '');
            var res = await fetch(url);
            modelConfig = await res.json();
            var sessionId = getCurrentSessionId();
            var sessionModel = sessionId ? sessionModelSelections[sessionId] : null;
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
                escapeHtml(m.name || m.id) +
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
        var sessionId = getCurrentSessionId();
        if (sessionId) sessionModelSelections[sessionId] = modelId;
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

    function ensureAppSettings() {
        if (!appSettings) appSettings = createDefaultAppSettings();
        if (!appSettings.providers) appSettings.providers = {};
        return appSettings;
    }

    function applyModelConfig(config) {
        modelConfig = config;
        updateModelBadgeLabel();
        renderModelDropdown();
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

    settingsProviderController = createSettingsProviderController({
        closeSettingsPanel: closeSettingsPanel,
        closeThemeMenu: setSettingsThemeMenuOpen,
        ensureAppSettings: ensureAppSettings,
        fetchModelConfig: fetchModelConfig,
        getCurrentSessionProvider: getCurrentSessionProvider,
        applyModelConfig: applyModelConfig,
        persistAppSettingsPatch: persistAppSettingsPatch,
        refreshModelBadge: updateModelBadgeLabel,
        refreshModelDropdown: renderModelDropdown,
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
        settingsProviderTimeoutFields: settingsProviderTimeoutFields,
        settingsProviderSelect: settingsProviderSelect,
        settingsProviderTrigger: settingsProviderTrigger,
        settingsSaveBtn: settingsSaveBtn,
        showError: showError,
        showSettingsStatus: showSettingsStatus,
    });

    settingsMcpController = createSettingsMcpController({
        settingsProviderSubtabs: settingsProviderSubtabs,
        settingsProviderSubtabPanels: settingsProviderSubtabPanels,
        settingsMcpRefreshBtn: settingsMcpRefreshBtn,
        settingsMcpAddControl: settingsMcpAddControl,
        settingsMcpAddBtn: settingsMcpAddBtn,
        settingsMcpAddMenu: settingsMcpAddMenu,
        settingsMcpServerList: settingsMcpServerList,
        showError: showError,
        showSettingsStatus: showSettingsStatus,
    });

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
        if (settingsProviderController) settingsProviderController.renderProviderDetails();
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

    function shouldShowSidebarUpdateButton(status) {
        if (!status) return false;
        return status.state === 'available' || status.state === 'downloading' || status.state === 'downloaded';
    }

    function shouldAutoDownloadOnUpdateClick(status) {
        return Boolean(status &&
            status.platform === 'win32' &&
            status.supported &&
            status.state === 'available' &&
            !isManualUpdateStatus(status));
    }

    function getUpdateReleaseUrl(status) {
        return (status && (status.downloadUrl || status.releaseUrl)) || GITHUB_LATEST_RELEASE_URL;
    }

    function renderSidebarUpdateButton(status) {
        if (!sidebarUpdateBtn) return;
        var showUpdate = shouldShowSidebarUpdateButton(status);
        sidebarUpdateBtn.hidden = !showUpdate;
        sidebarUpdateBtn.classList.toggle('downloading', Boolean(status && status.state === 'downloading'));
        sidebarUpdateBtn.classList.toggle('downloaded', Boolean(status && status.state === 'downloaded'));
        if (!showUpdate) return;

        var version = status && status.latestVersion ? ' ' + status.latestVersion : '';
        var label = status && status.state === 'downloaded'
            ? '更新已下载，打开关于页重启安装'
            : '发现新版本' + version + '，打开更新设置';
        sidebarUpdateBtn.title = label;
        sidebarUpdateBtn.setAttribute('aria-label', label);
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
        renderSidebarUpdateButton(status);
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

    function startDesktopUpdateStatusRefresh() {
        if (desktopUpdateRefreshTimer) return;
        fetchDesktopUpdateStatus();
        desktopUpdateRefreshTimer = setInterval(fetchDesktopUpdateStatus, DESKTOP_UPDATE_STATUS_REFRESH_INTERVAL_MS);
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
        var shouldPoll = state === 'checking' || state === 'downloading';
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
        if (tab !== 'provider' && settingsMcpController) settingsMcpController.closeMenus();
        if (tab === 'about') {
            fetchDesktopUpdateStatus();
        } else {
            updateDesktopUpdatePolling();
        }
    }

    settingsNavItems.forEach(function (item) {
        item.addEventListener('click', async function () {
            var tab = item.dataset.settingsTab;
            setSettingsTab(tab);
            if (tab === 'workspace') {
                await fetchAppSettings();
            }
        });
    });

    async function fetchProviders() {
        return settingsProviderController
            ? settingsProviderController.fetchProviders()
            : Promise.resolve();
    }

    function getProviderData() {
        return settingsProviderController ? settingsProviderController.getProviderData() : null;
    }

    function openSettingsPanel(tab) {
        showSettingsView();
        setSettingsTab(tab || activeSettingsTab || 'general');
        if (appSettings) renderAppSettings();
        if (getProviderData() && settingsProviderController) settingsProviderController.renderProviderSelect();
        settingsView.style.display = 'flex';
        modelSwitcher.classList.remove('open');
        modelBadge.setAttribute('aria-expanded', 'false');
        requestAnimationFrame(function () {
            var activeNav = document.querySelector('.settings-nav-item.active');
            if (activeNav) activeNav.focus();
        });
    }

    function closeSettingsPanel() {
        setSettingsThemeMenuOpen(false);
        if (settingsProviderController) settingsProviderController.closeProviderControls();
        if (settingsMcpController) settingsMcpController.closeMenus();
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

    settingsBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openSettingsPanel();
    });
    if (sidebarUpdateBtn) {
        sidebarUpdateBtn.addEventListener('click', async function (e) {
            e.stopPropagation();
            openSettingsPanel('about');
            if (shouldAutoDownloadOnUpdateClick(desktopUpdateStatus)) {
                await downloadDesktopUpdate();
            }
        });
    }

    if (settingsCancelBtn) settingsCancelBtn.addEventListener('click', closeSettingsPanel);
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
            var sidebarController = getSidebarController();
            if (sidebarController) sidebarController.setProjectsCollapsed(false);
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
            await Promise.all([fetchAppSettings(), fetchProviders(), fetchModelConfig()]);
            showSettingsStatus('导入完成');
        } catch (e) {
            showError('导入失败，请确认文件格式');
        }
    }

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



    function closeModelDropdown() {
        if (!modelSwitcher || !modelBadge) return;
        modelSwitcher.classList.remove('open');
        modelBadge.setAttribute('aria-expanded', 'false');
    }

    function handleDocumentClick(e) {
        if (modelSwitcher && !modelSwitcher.contains(e.target)) {
            closeModelDropdown();
        }
        if (settingsProviderController) settingsProviderController.handleDocumentClick(e);
        if (settingsMcpController) settingsMcpController.handleDocumentClick(e);
        if (settingsThemeCombobox && !settingsThemeCombobox.contains(e.target)) {
            setSettingsThemeMenuOpen(false);
        }
    }

    function handleDocumentEscape() {
        if (settingsMcpController && settingsMcpController.handleEscape()) return true;
        if (settingsProviderController && settingsProviderController.handleTransientEscape()) return true;
        if (settingsThemeCombobox && settingsThemeCombobox.classList.contains('open')) {
            setSettingsThemeMenuOpen(false);
            if (settingsThemeTrigger) settingsThemeTrigger.focus();
            return true;
        }
        if (settingsProviderController && settingsProviderController.handleProviderMenuEscape()) return true;
        closeModelDropdown();
        if (getCurrentView() === 'settings') {
            closeSettingsPanel();
            return true;
        }
        return false;
    }

    return {
        clearSessionModelSelection: function (sessionId) {
            if (sessionId) delete sessionModelSelections[sessionId];
        },
        closeSettingsPanel: closeSettingsPanel,
        fetchAppSettings: fetchAppSettings,
        fetchModelConfig: fetchModelConfig,
        fetchProviders: fetchProviders,
        fetchProxyConfig: fetchProxyConfig,
        fetchDesktopUpdateStatus: fetchDesktopUpdateStatus,
        getModelConfig: function () {
            return modelConfig;
        },
        getProviderData: getProviderData,
        handleDocumentClick: handleDocumentClick,
        handleDocumentEscape: handleDocumentEscape,
        openSettingsPanel: openSettingsPanel,
        startDesktopUpdateStatusRefresh: startDesktopUpdateStatusRefresh,
    };
}
