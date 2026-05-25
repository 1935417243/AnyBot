import { buildSettingsComboboxOptionHtml, createSettingsSingleSelectCombobox } from '../ui/settings-combobox.js';
import { escapeAttr, escapeHtml } from '../utils/html.js';

export function createSettingsProviderController(options) {
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
    const settingsSaveBtn = options.settingsSaveBtn;

    let providerData = null;
    let settingsModelConfig = null;
    let settingsProviderModelComboboxController = null;
    let remoteProviderModelSuggestions = [];
    let remoteProviderModelFetchTimer = null;
    let remoteProviderModelFetchSeq = 0;

    const DEFAULT_PROVIDER_TIMEOUT_MINUTES = 15;
    const PROVIDER_BASE_URL_SUGGESTIONS = [
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
    const PROVIDER_MODEL_SUGGESTION_STRATEGIES = [];

    const PROVIDER_SETTINGS_DEFINITIONS = {
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

    function showError(message) {
        if (options.showError) options.showError(message);
    }

    function showSettingsStatus(message, tone) {
        if (options.showSettingsStatus) options.showSettingsStatus(message, tone);
    }

    function persistAppSettingsPatch(patch, successMessage) {
        return options.persistAppSettingsPatch
            ? options.persistAppSettingsPatch(patch, successMessage)
            : Promise.resolve(false);
    }

    function ensureAppSettings() {
        return options.ensureAppSettings ? options.ensureAppSettings() : { providers: {} };
    }

    function getCurrentSessionProvider() {
        return options.getCurrentSessionProvider ? options.getCurrentSessionProvider() : null;
    }

    function fetchMainModelConfig(providerType) {
        return options.fetchModelConfig ? options.fetchModelConfig(providerType) : Promise.resolve();
    }

    function applyModelConfig(config) {
        if (options.applyModelConfig) options.applyModelConfig(config);
    }

    function refreshModelBadge() {
        if (options.refreshModelBadge) options.refreshModelBadge();
    }

    function refreshModelDropdown() {
        if (options.refreshModelDropdown) options.refreshModelDropdown();
    }

    function closeSettingsPanel() {
        if (options.closeSettingsPanel) options.closeSettingsPanel();
    }

    function closeOtherSettingsMenus() {
        if (options.closeThemeMenu) options.closeThemeMenu(false);
        if (options.closeSandboxMenu) options.closeSandboxMenu(false);
    }

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
        var appSettings = ensureAppSettings();
        if (!appSettings.providers) appSettings.providers = {};
        if (!appSettings.providers[providerType]) appSettings.providers[providerType] = {};
        return appSettings.providers[providerType];
    }

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

    function renderProviderDetails() {
        var provider = getSelectedSettingsProvider();
        var appSettings = ensureAppSettings();
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

    function hasCompleteCodexCompatSettings(cfg) {
        return Boolean(
            cfg &&
            cfg.codexAnthropicBaseUrl &&
            cfg.codexApiKey &&
            cfg.codexDefaultModel &&
            cfg.codexFastModel &&
            cfg.codexCodeModel
        );
    }

    async function handleCodexCompatToggle(e) {
        var cfg = getProviderSettings('codex');
        var enabled = e.currentTarget.checked === true;
        cfg.codexCompatEnabled = enabled;
        if (enabled) {
            if (hasCompleteCodexCompatSettings(cfg)) {
                await persistAppSettingsPatch({ providers: { 'codex': Object.assign({}, cfg, { codexCompatEnabled: true }) } }, '已开启');
                if (providerData && providerData.current === 'codex') {
                    await switchProviderTo('codex', { force: true, closeOnSuccess: false });
                }
            }
            renderProviderDetails();
            return;
        }
        await persistAppSettingsPatch({ providers: { 'codex': Object.assign({}, cfg, { codexCompatEnabled: false }) } }, '已关闭');
        if (providerData && providerData.current === 'codex') {
            await switchProviderTo('codex', { force: true, closeOnSuccess: false });
        }
        renderProviderDetails();
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
            renderProviderDetails();
            return;
        }
        await persistAppSettingsPatch({ providers: { 'claude-code': Object.assign({}, cfg, { anthropicCompatEnabled: false }) } }, '已关闭');
        if (providerData && providerData.current === 'claude-code') {
            await switchProviderTo('claude-code', { force: true, closeOnSuccess: false });
        }
        renderProviderDetails();
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

    async function fetchProviders() {
        try {
            var res = await fetch('/api/providers');
            providerData = await res.json();
            renderProviderSelect();
            refreshModelBadge();
        } catch (e) {
            console.error('Failed to fetch providers:', e);
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
        renderProviderDetails();
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
            closeOtherSettingsMenus();
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
        renderProviderDetails();
        return true;
    }

    function setSettingsProviderMenuOpen(isOpen) {
        if (!settingsProviderCombobox || !settingsProviderTrigger) return;
        if (isOpen) {
            closeOtherSettingsMenus();
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
                applyModelConfig(savedConfig);
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
            renderProviderDetails();
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
                applyModelConfig(switchedConfig);
            } else {
                await fetchMainModelConfig(getCurrentSessionProvider());
            }
            renderProviderSelect();
            refreshModelDropdown();
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

    function closeProviderControls() {
        setSettingsProviderMenuOpen(false);
        closeProviderModelSuggestionMenus();
        if (settingsProviderModelComboboxController) settingsProviderModelComboboxController.setOpen(false);
    }

    function handleDocumentClick(e) {
        if (settingsProviderCombobox && !settingsProviderCombobox.contains(e.target)) {
            setSettingsProviderMenuOpen(false);
        }
        if (settingsProviderModelComboboxController && !settingsProviderModelComboboxController.contains(e.target)) {
            settingsProviderModelComboboxController.setOpen(false);
        }
        if (!e.target.closest || !e.target.closest('.provider-model-input-control')) {
            closeProviderModelSuggestionMenus();
        }
    }

    function handleTransientEscape() {
        if (settingsProviderModelComboboxController && settingsProviderModelComboboxController.isOpen()) {
            settingsProviderModelComboboxController.setOpen(false);
            settingsProviderModelComboboxController.focusTrigger();
            return true;
        }
        if (document.querySelector('.provider-model-input-control.open')) {
            closeProviderModelSuggestionMenus();
            return true;
        }
        return false;
    }

    function handleProviderMenuEscape() {
        if (settingsProviderCombobox && settingsProviderCombobox.classList.contains('open')) {
            setSettingsProviderMenuOpen(false);
            if (settingsProviderTrigger) settingsProviderTrigger.focus();
            return true;
        }
        return false;
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

    return {
        closeProviderControls: closeProviderControls,
        fetchProviders: fetchProviders,
        getProviderData: function () {
            return providerData;
        },
        handleDocumentClick: handleDocumentClick,
        handleProviderMenuEscape: handleProviderMenuEscape,
        handleTransientEscape: handleTransientEscape,
        renderProviderDetails: renderProviderDetails,
        renderProviderSelect: renderProviderSelect,
        setProviderMenuOpen: setSettingsProviderMenuOpen,
    };
}
