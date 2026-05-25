import { buildSettingsComboboxOptionHtml, createSettingsSingleSelectCombobox } from '../ui/settings-combobox.js';
import { escapeAttr, escapeHtml } from '../utils/html.js';

const GITHUB_LATEST_RELEASE_URL = 'https://github.com/1935417243/AnyBot/releases/latest';
const THEME_STORAGE_KEY = 'webuiTheme';
const THEME_OPTIONS = [
    {id: 'light', name: '浅色'},
    {id: 'dark', name: '深色'},
    {id: 'system', name: '自动'},
];
const HIGHLIGHT_DARK_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark-dimmed.min.css';
const HIGHLIGHT_LIGHT_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';

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
    const settingsProviderTimeoutFields = options.settingsProviderTimeoutFields;
    const settingsProviderSelect = options.settingsProviderSelect;
    const settingsProviderTrigger = options.settingsProviderTrigger;
    const settingsSandboxCombobox = options.settingsSandboxCombobox;
    const settingsSandboxCurrent = options.settingsSandboxCurrent;
    const settingsSandboxGroup = options.settingsSandboxGroup;
    const settingsSandboxTrigger = options.settingsSandboxTrigger;
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
    const settingsWorkdirOpenBtn = options.settingsWorkdirOpenBtn;
    const settingsWorkdirPickBtn = options.settingsWorkdirPickBtn;
    const systemThemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

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

    function updateModelBadgeLabel() {
        if (!modelConfig) return;
        currentModelNameEl.textContent = modelConfig.currentModel;
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
        'codex': {
            isExpanded: function (cfg) {
                return cfg.codexCompatEnabled === true;
            },
            buildToggle: buildCodexCompatToggle,
            bindToggle: bindCodexCompatToggle,
            buildFields: buildCodexCompatFields,
            collect: collectCodexCompatSettings,
            validate: validateCodexSettings,
            refreshProviderOnSave: true,
            showModelSelect: true,
        },
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
    var DEFAULT_PROVIDER_TIMEOUT_MINUTES = 15;

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
        var showModelSelect = isProviderInstalled(provider);
        var showTimeoutField = provider.type === 'codex' || provider.type === 'claude-code';
        var providerModelField = settingsProviderModelSelect && settingsProviderModelSelect.closest('.settings-field');
        var providerActions = settingsSaveBtn && settingsSaveBtn.closest('.settings-button-row');
        if (providerModelField) {
            providerModelField.style.display = showModelSelect ? '' : 'none';
        }
        if (providerActions) providerActions.style.display = showProviderFields ? '' : 'none';
        if (settingsProviderTimeoutFields) {
            settingsProviderTimeoutFields.style.display = showTimeoutField ? '' : 'none';
            settingsProviderTimeoutFields.innerHTML = showTimeoutField ? buildProviderTimeoutField(provider.type, cfg) : '';
            if (showTimeoutField) bindProviderTimeoutField(provider.type);
        }
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
        if (showModelSelect) fetchSettingsModelConfig(provider.type);
    }

    function getProviderTimeoutMinutes(cfg) {
        var timeoutMs = Number(cfg && cfg.timeoutMs);
        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            return Math.max(1, Math.round(timeoutMs / 60000));
        }
        return DEFAULT_PROVIDER_TIMEOUT_MINUTES;
    }

    function buildProviderTimeoutField(providerType, cfg) {
        var minutes = getProviderTimeoutMinutes(cfg);
        return '<span class="settings-field-label">执行时长</span>' +
            '<div class="provider-timeout-control">' +
            '<input class="settings-inline-input provider-timeout-input" id="settings-provider-timeout-minutes" type="number" min="1" max="35791" step="1"' +
            ' inputmode="numeric" value="' + escapeAttr(String(minutes)) + '" data-provider-type="' + escapeAttr(providerType) + '">' +
            '<span class="provider-timeout-unit">分钟</span>' +
            '</div>';
    }

    function bindProviderTimeoutField(providerType) {
        var input = document.getElementById('settings-provider-timeout-minutes');
        if (!input) return;
        input.addEventListener('change', function () {
            persistProviderTimeout(providerType);
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                persistProviderTimeout(providerType);
                input.blur();
            }
        });
    }

    function buildCodexCompatToggle(cfg) {
        var checked = cfg.codexCompatEnabled === true;
        return '<div class="settings-row compat-toggle-row"><span><strong>Responses 适配层</strong><small>开启后 Codex 仅在 AnyBot 内映射到兼容服务</small></span>' +
            '<label class="settings-switch" aria-label="Responses 适配层">' +
            '<input id="settings-provider-codex-compat-enabled" type="checkbox"' + (checked ? ' checked' : '') + '>' +
            '<span class="settings-switch-slider"></span>' +
            '</label></div>';
    }

    function bindCodexCompatToggle() {
        var compatToggle = document.getElementById('settings-provider-codex-compat-enabled');
        if (compatToggle) compatToggle.addEventListener('change', handleCodexCompatToggle);
    }

    async function handleCodexCompatToggle(e) {
        var cfg = getProviderSettings('codex');
        var enabled = e.currentTarget.checked === true;
        cfg.codexCompatEnabled = enabled;
        if (enabled) {
            renderSettingsProviderDetails();
            return;
        }
        await persistAppSettingsPatch({ providers: { 'codex': Object.assign({}, cfg, { codexCompatEnabled: false }) } }, '已关闭');
        if (providerData && providerData.current === 'codex') {
            await switchProviderTo('codex', { force: true, closeOnSuccess: false });
        }
        renderSettingsProviderDetails();
    }

    function buildCodexCompatFields(cfg) {
        return '<div class="settings-row"><span><strong>Anthropic Base URL</strong><small>兼容 Anthropic API 的服务地址</small></span>' +
            buildProviderBaseUrlInput(cfg.codexAnthropicBaseUrl || '', 'Anthropic Base URL') + '</div>' +
            '<div class="settings-row"><span><strong>API Key</strong><small>访问兼容服务所需的密钥</small></span>' +
            buildProviderSecretInput('settings-provider-api-key', cfg.codexApiKey || '', 'API Key') + '</div>' +
            '<div class="settings-row"><span><strong>gpt-5.5</strong><small>映射到默认通用模型</small></span>' +
            buildProviderModelInput('settings-provider-codex-default-model', cfg.codexDefaultModel || '', 'gpt-5.5') + '</div>' +
            '<div class="settings-row"><span><strong>gpt-mini</strong><small>映射到轻量快速模型</small></span>' +
            buildProviderModelInput('settings-provider-codex-fast-model', cfg.codexFastModel || '', 'gpt-mini') + '</div>' +
            '<div class="settings-row"><span><strong>gpt-codex</strong><small>映射到编程模型</small></span>' +
            buildProviderModelInput('settings-provider-codex-code-model', cfg.codexCodeModel || '', 'gpt-codex') + '</div>';
    }

    function buildClaudeCodeCompatToggle(cfg) {
        var checked = cfg.anthropicCompatEnabled === true;
        return '<div class="settings-row compat-toggle-row"><span><strong>Anthropic 兼容接口</strong><small>开启后 Claude Code 仅在 AnyBot 内映射到兼容服务\n</small></span>' +
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

    function collectCodexCompatSettings(current) {
        var next = Object.assign({}, current, { codexCompatEnabled: true });
        var apiKeyInput = document.getElementById('settings-provider-api-key');
        var baseUrlInput = document.getElementById('settings-provider-anthropic-base-url');
        var defaultModelInput = document.getElementById('settings-provider-codex-default-model');
        var fastModelInput = document.getElementById('settings-provider-codex-fast-model');
        var codeModelInput = document.getElementById('settings-provider-codex-code-model');
        if (apiKeyInput) next.codexApiKey = apiKeyInput.value;
        if (baseUrlInput) next.codexAnthropicBaseUrl = baseUrlInput.value.trim();
        if (defaultModelInput) next.codexDefaultModel = defaultModelInput.value.trim();
        if (fastModelInput) next.codexFastModel = fastModelInput.value.trim();
        if (codeModelInput) next.codexCodeModel = codeModelInput.value.trim();
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

    function validateCodexSettings() {
        var fields = [
            ['Anthropic Base URL', document.getElementById('settings-provider-anthropic-base-url')],
            ['API Key', document.getElementById('settings-provider-api-key')],
            ['gpt-5.5', document.getElementById('settings-provider-codex-default-model')],
            ['gpt-mini', document.getElementById('settings-provider-codex-fast-model')],
            ['gpt-codex', document.getElementById('settings-provider-codex-code-model')],
        ];
        var missing = fields.filter(function (entry) {
            var input = entry[1];
            if (!input) return false;
            return !input.value.trim();
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
        showSettingsView();
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
            if (!getCurrentSessionProvider() || getCurrentSessionProvider() === providerType) {
                modelConfig = savedConfig;
                updateModelBadgeLabel();
                renderModelDropdown();
            }
            showSettingsStatus('已保存');
        } catch (e) {
            showError('保存默认模型失败');
        }
    }

    async function persistProviderTimeout(providerType) {
        var input = document.getElementById('settings-provider-timeout-minutes');
        if (!input) return false;
        var minutes = Number(input.value);
        if (!Number.isFinite(minutes) || minutes < 1) {
            showSettingsStatus('执行超时需大于 0 分钟', 'error');
            input.value = String(getProviderTimeoutMinutes(getProviderSettings(providerType)));
            return false;
        }
        minutes = Math.floor(minutes);
        input.value = String(minutes);
        var nextSettings = Object.assign({}, getProviderSettings(providerType), {
            timeoutMs: minutes * 60 * 1000,
        });
        var saved = await persistAppSettingsPatch({
            providers: (function () {
                var providers = {};
                providers[providerType] = nextSettings;
                return providers;
            })(),
        }, '已保存');
        if (!saved) return false;

        if (providerData && providerData.current === providerType) {
            await switchProviderTo(providerType, { force: true, closeOnSuccess: false });
        } else {
            renderSettingsProviderDetails();
        }
        await fetchProviders();
        return true;
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
            if (!getCurrentSessionProvider() || getCurrentSessionProvider() === providerType) {
                modelConfig = switchedConfig;
                updateModelBadgeLabel();
            } else {
                await fetchModelConfig(getCurrentSessionProvider());
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
            await Promise.all([fetchAppSettings(), fetchProviders(), fetchSandboxConfig(), fetchModelConfig()]);
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
    }

    function handleDocumentEscape() {
        if (settingsProviderModelComboboxController && settingsProviderModelComboboxController.isOpen()) {
            settingsProviderModelComboboxController.setOpen(false);
            settingsProviderModelComboboxController.focusTrigger();
            return true;
        }
        if (document.querySelector('.provider-model-input-control.open')) {
            closeProviderModelSuggestionMenus();
            return true;
        }
        if (settingsThemeCombobox && settingsThemeCombobox.classList.contains('open')) {
            setSettingsThemeMenuOpen(false);
            if (settingsThemeTrigger) settingsThemeTrigger.focus();
            return true;
        }
        if (settingsSandboxCombobox && settingsSandboxCombobox.classList.contains('open')) {
            setSettingsSandboxMenuOpen(false);
            if (settingsSandboxTrigger) settingsSandboxTrigger.focus();
            return true;
        }
        if (settingsProviderCombobox && settingsProviderCombobox.classList.contains('open')) {
            setSettingsProviderMenuOpen(false);
            if (settingsProviderTrigger) settingsProviderTrigger.focus();
            return true;
        }
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
        fetchSandboxConfig: fetchSandboxConfig,
        getModelConfig: function () {
            return modelConfig;
        },
        getProviderData: function () {
            return providerData;
        },
        handleDocumentClick: handleDocumentClick,
        handleDocumentEscape: handleDocumentEscape,
        openSettingsPanel: openSettingsPanel,
    };
}
