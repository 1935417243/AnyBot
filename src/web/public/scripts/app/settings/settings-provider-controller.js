import { buildSettingsComboboxOptionHtml, createSettingsSingleSelectCombobox } from '../ui/settings-combobox.js';
import { escapeAttr, escapeHtml } from '../utils/html.js';

export function createSettingsProviderController(options) {
    const settingsProviderCombobox = options.settingsProviderCombobox;
    const settingsProviderCompatToggleFields = options.settingsProviderCompatToggleFields;
    const settingsProviderCurrent = options.settingsProviderCurrent;
    const settingsProviderExtraFields = options.settingsProviderExtraFields;
    const settingsProviderBinFields = options.settingsProviderBinFields;
    const settingsProviderRuntimeFields = options.settingsProviderRuntimeFields;
    const settingsProviderMenu = options.settingsProviderMenu;
    const settingsProviderModelCombobox = options.settingsProviderModelCombobox;
    const settingsProviderModelCurrent = options.settingsProviderModelCurrent;
    const settingsProviderModelMenu = options.settingsProviderModelMenu;
    const settingsProviderModelSelect = options.settingsProviderModelSelect;
    const settingsProviderModelTrigger = options.settingsProviderModelTrigger;
    const settingsProviderEffortCombobox = options.settingsProviderEffortCombobox;
    const settingsProviderEffortCurrent = options.settingsProviderEffortCurrent;
    const settingsProviderEffortMenu = options.settingsProviderEffortMenu;
    const settingsProviderEffortTrigger = options.settingsProviderEffortTrigger;
    const settingsProviderTimeoutFields = options.settingsProviderTimeoutFields;
    const settingsProviderSelect = options.settingsProviderSelect;
    const settingsProviderTrigger = options.settingsProviderTrigger;
    const settingsSaveBtn = options.settingsSaveBtn;

    let providerData = null;
    let settingsModelConfig = null;
    let settingsProviderModelComboboxController = null;
    let settingsProviderEffortComboboxController = null;
    // codex「上游格式」combobox 控制器；字段区每次渲染重建 DOM，控制器随之重建
    let codexFormatComboboxController = null;
    // 内置 CLI 组件状态共享 store（由 create-app 注入；可能为空，需防御）
    const cliRuntimeStore = options.cliRuntimeStore || null;
    // 各 provider 上次已知的组件阶段，用于检测 ready 跃迁后自动切换
    let lastRuntimePhases = {};
    let remoteProviderModelSuggestions = [];
    let remoteProviderModelFetchTimer = null;
    let remoteProviderModelFetchSeq = 0;

    const DEFAULT_PROVIDER_TIMEOUT_MINUTES = 30;
    // 各 provider 的推理强度档位（与聊天输入区强度滑块一致）：claude-code 6 档，codex 4 档
    const PROVIDER_EFFORT_LEVELS = {
        'claude-code': [
            { id: 'low', name: 'Low' },
            { id: 'medium', name: 'Medium' },
            { id: 'high', name: 'High' },
            { id: 'xhigh', name: 'XHigh' },
            { id: 'max', name: 'Max' },
            { id: 'ultracode', name: 'Ultracode' },
        ],
        'codex': [
            { id: 'low', name: 'Low' },
            { id: 'medium', name: 'Medium' },
            { id: 'high', name: 'High' },
            { id: 'xhigh', name: 'XHigh' },
        ],
    };
    // 未持久化过时展示的默认档位（各 provider 的档位列表里都包含它）
    const DEFAULT_PROVIDER_EFFORT = 'high';
    const ALIYUN_TOKEN_PLAN_BASE_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic';
    const KIMI_CODING_BASE_URL = 'https://api.kimi.com/coding';
    const KIMI_CODING_MODELS = ['kimi-for-coding', 'k3', 'k3-256k', 'kimi-for-coding-highspeed'];
    const OLLAMA_BASE_URL = 'http://localhost:11434';
    const OLLAMA_PLACEHOLDER_API_KEY = 'ollama';
    // 与后端 src/web/services/secrets.ts 的 SECRET_MASK 保持一致。
    const SECRET_MASK = '__anybot_secret_unchanged__';
    const PROVIDER_BASE_URL_SUGGESTIONS = [
        {
            id: 'aliyun-token-plan',
            label: '阿里Token Plan',
            value: ALIYUN_TOKEN_PLAN_BASE_URL,
        },
        {
            id: 'deepseek',
            label: 'DeepSeek',
            value: 'https://api.deepseek.com/anthropic',
        },
        {
            id: 'kimi',
            label: 'Kimi',
            value: KIMI_CODING_BASE_URL,
        },
        {
            id: 'minimax',
            label: 'MiniMax',
            value: 'https://api.minimaxi.com/anthropic',
        },
        {
            id: 'ollama',
            label: 'Ollama（本地）',
            value: OLLAMA_BASE_URL,
        },
        {
            id: 'vibeapi',
            label: 'VibeAPI',
            value: 'https://vibeapi.cc',
        },
    ];
    // codex「上游格式 = Responses」时的 Base URL 建议（id 与 Anthropic 模式的 deepseek 条目区分，避免预设串扰）
    const CODEX_RESPONSES_BASE_URL_SUGGESTIONS = [
        {
            id: 'deepseek-responses',
            label: 'DeepSeek',
            value: 'https://api.deepseek.com',
        },
    ];
    const PROVIDER_MODEL_SUGGESTION_STRATEGIES = [
        {
            label: 'Kimi',
            models: KIMI_CODING_MODELS,
            matchUrl: isKimiCodingBaseUrl,
        },
    ];

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

    // 同步聊天输入区的强度滑块（修改的是当前 provider 的默认强度时）
    function syncEffortModeConfig(config) {
        if (options.syncEffortModeConfig) options.syncEffortModeConfig(config);
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
            renderSettingsEffortSelect();
        } catch (e) {
            console.error('Failed to fetch settings model config:', e);
        }
    }

    // 渲染「默认强度」下拉：档位按当前选中 provider 区分，值取该 provider 已持久化的档位
    function renderSettingsEffortSelect() {
        if (!settingsProviderEffortComboboxController) return;
        var provider = getSelectedSettingsProvider();
        var levels = (provider && PROVIDER_EFFORT_LEVELS[provider.type]) || [];
        var current = settingsModelConfig && settingsModelConfig.effort;
        var matched = levels.some(function (level) {
            return level.id === current;
        });
        if (!matched) current = DEFAULT_PROVIDER_EFFORT;
        settingsProviderEffortComboboxController.render(levels.map(function (level) {
            return {
                value: level.id,
                label: level.name,
            };
        }), current);
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

    function isOllamaBaseUrl(baseUrl) {
        var normalized = normalizeProviderBaseUrl(baseUrl);
        return /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]):11434(\/|$)/.test(normalized);
    }

    function getRemoteProviderModelSource(baseUrl) {
        var lower = String(baseUrl || '').toLowerCase();
        if (lower.indexOf('token-plan.cn-beijing.maas.aliyuncs.com') !== -1) return '阿里Token Plan';
        if (lower.indexOf('vibeapi') !== -1) return 'VibeAPI';
        if (lower.indexOf('api.deepseek.com') !== -1) return 'DeepSeek';
        if (lower.indexOf('api.minimaxi.com') !== -1) return 'MiniMax';
        if (isOllamaBaseUrl(baseUrl)) return 'Ollama';
        return '';
    }

    function normalizeProviderBaseUrl(baseUrl) {
        return String(baseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
    }

    // 与后端 getCodexUpstreamFormat 的迁移默认值一致：老配置（已存 Base URL、无新字段）默认 anthropic
    function getCodexUpstreamFormat(cfg) {
        if (cfg && (cfg.codexUpstreamFormat === 'responses' || cfg.codexUpstreamFormat === 'anthropic')) {
            return cfg.codexUpstreamFormat;
        }
        return cfg && cfg.codexAnthropicBaseUrl ? 'anthropic' : 'responses';
    }

    // 面板打开时以下拉框当前值为准（用户可能刚切换还没保存）
    function getCurrentCodexUpstreamFormat() {
        var select = document.getElementById('settings-provider-codex-upstream-format');
        if (select) return select.value === 'anthropic' ? 'anthropic' : 'responses';
        return getCodexUpstreamFormat(getProviderSettings('codex'));
    }

    // codex + Responses 格式时只展示原生 Responses 服务（当前仅 DeepSeek），其余情况用全局列表
    function getActiveBaseUrlSuggestions() {
        var provider = getSelectedSettingsProvider();
        if (provider && provider.type === 'codex' && getCurrentCodexUpstreamFormat() === 'responses') {
            return CODEX_RESPONSES_BASE_URL_SUGGESTIONS;
        }
        return PROVIDER_BASE_URL_SUGGESTIONS;
    }

    function getProviderBaseUrlSuggestion(baseUrl) {
        var normalized = normalizeProviderBaseUrl(baseUrl);
        return getActiveBaseUrlSuggestions().find(function (suggestion) {
            return normalizeProviderBaseUrl(suggestion.value) === normalized;
        }) || null;
    }

    function getProviderBaseUrlPresetKey(baseUrl) {
        var suggestion = getProviderBaseUrlSuggestion(baseUrl);
        return suggestion ? suggestion.id : '';
    }

    function isKimiCodingBaseUrl(baseUrl) {
        return normalizeProviderBaseUrl(baseUrl) === KIMI_CODING_BASE_URL;
    }

    function getProviderModelSuggestionStrategy(baseUrl) {
        return PROVIDER_MODEL_SUGGESTION_STRATEGIES.find(function (strategy) {
            return strategy.matchUrl(baseUrl);
        }) || null;
    }

    function getFixedProviderModel(baseUrl) {
        var strategy = getProviderModelSuggestionStrategy(baseUrl);
        return strategy && strategy.fixedModel ? strategy.fixedModel : '';
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

    function applyFixedProviderModel(baseUrl) {
        var fixedModel = getFixedProviderModel(baseUrl);
        Array.prototype.forEach.call(document.querySelectorAll('[data-provider-model-suggestion-input="true"]'), function (input) {
            input.readOnly = Boolean(fixedModel);
            if (!fixedModel) return;
            if (input.value !== fixedModel) {
                input.value = fixedModel;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    }

    function setProviderInputValue(id, value) {
        var input = document.getElementById(id);
        if (!input) return;
        input.value = value || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function applyClaudeCodeBaseUrlPreset(preset) {
        setProviderInputValue('settings-provider-api-key', preset && preset.apiKey);
        setProviderInputValue('settings-provider-anthropic-auto-model', preset && (preset.anthropicAutoModel || preset.defaultModel));
        setProviderInputValue('settings-provider-anthropic-opus-model', preset && preset.anthropicOpusModel);
        setProviderInputValue('settings-provider-anthropic-sonnet-model', preset && preset.anthropicSonnetModel);
        setProviderInputValue('settings-provider-anthropic-haiku-model', preset && preset.anthropicHaikuModel);
        setProviderInputValue('settings-provider-subagent-model', preset && preset.claudeCodeSubagentModel);
    }

    function applyCodexBaseUrlPreset(preset) {
        setProviderInputValue('settings-provider-api-key', preset && preset.codexApiKey);
        setProviderInputValue('settings-provider-codex-default-model', preset && preset.codexDefaultModel);
        setProviderInputValue('settings-provider-codex-fast-model', preset && preset.codexFastModel);
        setProviderInputValue('settings-provider-codex-code-model', preset && preset.codexCodeModel);
    }

    function applySavedProviderBaseUrlSettings(baseUrl) {
        var presetKey = getProviderBaseUrlPresetKey(baseUrl);
        var provider = getSelectedSettingsProvider();
        if (!presetKey || !provider) {
            applyFixedProviderModel(baseUrl);
            return false;
        }
        var cfg = getProviderSettings(provider.type);
        var preset = null;
        if (provider.type === 'claude-code') {
            var anthropicPresets = cfg.anthropicBaseUrlPresets || {};
            preset = anthropicPresets[presetKey] || null;
            applyClaudeCodeBaseUrlPreset(preset);
        } else if (provider.type === 'codex') {
            var codexPresets = cfg.codexBaseUrlPresets || {};
            preset = codexPresets[presetKey] || null;
            applyCodexBaseUrlPreset(preset);
        }
        applyFixedProviderModel(baseUrl);
        return Boolean(preset);
    }

    function cleanProviderPreset(preset) {
        var clean = {};
        Object.keys(preset).forEach(function (key) {
            if (preset[key] !== '') clean[key] = preset[key];
        });
        return clean;
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
        return '<div class="provider-settings-input-control provider-secret-input-control">' +
            '<input class="settings-inline-input" id="' + escapeAttr(id) + '" type="password"' +
            ' aria-label="' + escapeAttr(label || '') + '"' +
            ' value="' + escapeAttr(value || '') + '" autocomplete="off" spellcheck="false">' +
            '<button class="provider-secret-toggle" type="button" aria-label="显示密钥" aria-pressed="false"' +
            ' data-provider-secret-toggle="' + escapeAttr(id) + '">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>' +
            '</svg>' +
            '</button>' +
            '</div>';
    }

    async function revealProviderSecretInput(input) {
        var provider = getSelectedSettingsProvider();
        if (!provider) return;
        var field = provider.type === 'codex' ? 'codexApiKey' : 'apiKey';
        var baseUrlInput = document.getElementById('settings-provider-anthropic-base-url');
        var presetKey = getProviderBaseUrlPresetKey(baseUrlInput ? baseUrlInput.value.trim() : '');
        try {
            var res = await fetch('/api/app-settings/reveal-secret', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    provider: provider.type,
                    field: field,
                    presetKey: presetKey || undefined,
                }),
            });
            var data = await res.json().catch(function () { return {}; });
            if (res.ok && typeof data.value === 'string' && data.value) {
                input.value = data.value;
            }
        } catch (e) {
            // 取回失败时保留掩码,仅切换显示状态。
        }
    }

    function bindProviderSecretToggles() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-provider-secret-toggle]'), function (button) {
            button.addEventListener('click', async function () {
                var input = document.getElementById(button.dataset.providerSecretToggle || '');
                if (!input) return;
                var shouldShow = input.type === 'password';
                if (shouldShow && input.value === SECRET_MASK) {
                    await revealProviderSecretInput(input);
                }
                input.type = shouldShow ? 'text' : 'password';
                button.setAttribute('aria-pressed', shouldShow ? 'true' : 'false');
                button.setAttribute('aria-label', shouldShow ? '隐藏密钥' : '显示密钥');
                button.title = shouldShow ? '隐藏密钥' : '显示密钥';
            });
        });
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
        if (!source || (!apiKey && !isOllamaBaseUrl(baseUrl))) {
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
        getActiveBaseUrlSuggestions().forEach(function (suggestion) {
            var option = document.createElement('button');
            option.className = 'provider-model-suggest-option provider-base-url-suggest-option';
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
                input.dataset.providerBaseUrlSelectedSuggestion = suggestion.id;
                input.value = suggestion.value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                delete input.dataset.providerBaseUrlSelectedSuggestion;
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
                updateProviderApiKeyVisibility();
                applyFixedProviderModel(baseUrlInput.value);
                if (!getRemoteProviderModelSource(baseUrlInput.value)) {
                    clearRemoteProviderModelSuggestions();
                } else {
                    clearRemoteProviderModelSuggestions();
                    scheduleRemoteProviderModelFetch();
                }
                var openInput = document.querySelector('.provider-model-input-control.open [data-provider-model-suggestion-input="true"]');
                if (openInput) showProviderModelSuggestionMenu(openInput);
            });
            baseUrlInput.addEventListener('change', function () {
                updateProviderApiKeyVisibility();
                var selectedSuggestion = baseUrlInput.dataset.providerBaseUrlSelectedSuggestion || '';
                var appliedPreset = applySavedProviderBaseUrlSettings(baseUrlInput.value);
                if (selectedSuggestion && appliedPreset) {
                    saveSettingsProviderSettings('已切换');
                }
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
            applyFixedProviderModel(baseUrlInput.value);
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
        var codexFormatSelect = document.getElementById('settings-provider-codex-upstream-format');
        if (codexFormatSelect) bindCodexUpstreamFormatCombobox();
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
        // 默认强度仅 claude-code / codex 支持，其余 provider 隐藏该字段
        var showEffortSelect = showModelSelect && !!PROVIDER_EFFORT_LEVELS[provider.type];
        var showTimeoutField = provider.type === 'codex' || provider.type === 'claude-code';
        var providerModelField = settingsProviderModelSelect && settingsProviderModelSelect.closest('.settings-field');
        var providerEffortField = settingsProviderEffortCombobox && settingsProviderEffortCombobox.closest('.settings-field');
        var providerActions = settingsSaveBtn && settingsSaveBtn.closest('.settings-button-row');
        if (providerModelField) {
            providerModelField.style.display = showModelSelect ? '' : 'none';
        }
        if (providerEffortField) {
            providerEffortField.style.display = showEffortSelect ? '' : 'none';
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
        renderCliRuntimeFields(provider);
        if (settingsProviderExtraFields) {
            settingsProviderExtraFields.style.display = showProviderFields ? '' : 'none';
            settingsProviderExtraFields.innerHTML = showProviderFields ? definition.buildFields(cfg) : '';
            if (showProviderFields) {
                bindProviderModelSuggestionInputs();
                bindProviderSecretToggles();
                updateProviderApiKeyVisibility();
            }
        }
        if (showModelSelect) fetchSettingsModelConfig(provider.type);
    }

    // ---------- 内置 CLI 组件（按需下载）状态条与下载源 ----------

    // 需要内置 CLI 组件的 provider；与后端 cli-runtime manifest 的 provider 集合一致
    const CLI_RUNTIME_PROVIDER_LABELS = {
        'codex': 'Codex',
        'claude-code': 'Claude Code',
    };

    function isCliRuntimeProvider(providerType) {
        return !!CLI_RUNTIME_PROVIDER_LABELS[providerType];
    }

    /** provider 未安装但可通过内置组件下载补齐 */
    function isProviderDownloadable(provider) {
        return !!provider && !isProviderInstalled(provider) && !!provider.cliRuntime;
    }

    function formatRuntimeSize(bytes) {
        var value = Number(bytes || 0);
        if (!Number.isFinite(value) || value <= 0) return '';
        var mb = value / (1024 * 1024);
        return (mb >= 100 ? String(Math.round(mb)) : mb.toFixed(1)) + ' MB';
    }

    /** 状态条色调复用 settings-update-status 的 ready/warn/error */
    function getCliRuntimeTone(status) {
        if (!status) return 'warn';
        if (status.phase === 'ready') return 'ready';
        if (status.phase === 'error') return 'error';
        return 'warn';
    }

    function buildCliRuntimeStatusText(provider, status) {
        var label = CLI_RUNTIME_PROVIDER_LABELS[provider.type] || provider.displayName || provider.type;
        var sizeText = status ? formatRuntimeSize(status.sizeBytes) : '';
        if (!status) return label + ' 内置组件状态加载中…';
        if (!status.supported) return label + ' 内置组件暂不支持当前平台自动下载，请配置外部 CLI';
        if (status.phase === 'ready') return label + ' 内置组件已就绪（' + status.version + '）';
        if (status.phase === 'downloading') return label + ' 内置组件下载中…';
        if (status.phase === 'verifying') return label + ' 内置组件校验中…';
        if (status.phase === 'error') {
            return label + ' 内置组件下载失败' + (status.message ? '：' + status.message : '');
        }
        return label + ' 内置组件未下载' + (sizeText ? '（约 ' + sizeText + '）' : '');
    }

    /** 未下载/下载中/失败时展示的状态条；结构复用桌面更新的 settings-update-* 三件套 */
    function buildCliRuntimeStatusHtml(provider, status) {
        var html = '<div class="settings-cli-runtime-status settings-update-status ' +
            getCliRuntimeTone(status) + '" id="settings-cli-runtime-status">' +
            escapeHtml(buildCliRuntimeStatusText(provider, status)) + '</div>';
        var showProgress = status && (status.phase === 'downloading' || status.phase === 'verifying');
        if (showProgress) {
            var percent = status.phase === 'verifying'
                ? 100
                : Math.max(0, Math.min(100, Number(status.percent || 0)));
            var detail = status.phase === 'verifying'
                ? '正在校验文件完整性…'
                : percent.toFixed(1) + '%' +
                    (status.percent != null && status.sizeBytes
                        ? ' · ' + formatRuntimeSize(status.sizeBytes * percent / 100) + ' / ' + formatRuntimeSize(status.sizeBytes)
                        : '') +
                    (status.source ? ' · ' + status.source : '');
            html += '<div class="settings-update-progress">' +
                '<div class="settings-update-progress-bar"><span style="width:' + percent.toFixed(1) + '%"></span></div>' +
                '<div class="settings-update-progress-text">' + escapeHtml(detail) + '</div>' +
                '</div>';
        }
        var canDownload = status && status.supported && status.phase !== 'downloading' && status.phase !== 'verifying';
        if (canDownload) {
            html += '<div class="settings-button-row settings-cli-runtime-actions">' +
                '<button class="settings-primary-btn compact" id="settings-cli-runtime-download-btn" type="button">' +
                (status.phase === 'error' ? '重试下载' : '立即下载') + '</button>' +
                '</div>';
        }
        return html;
    }

    /** 渲染组件状态条（未就绪时）；已就绪或非内置组件 provider 时隐藏 */
    function renderCliRuntimeFields(provider) {
        if (!settingsProviderRuntimeFields) return;
        var showFields = !!provider && isCliRuntimeProvider(provider.type) && !!cliRuntimeStore && !isProviderInstalled(provider);
        if (!showFields) {
            settingsProviderRuntimeFields.style.display = 'none';
            settingsProviderRuntimeFields.innerHTML = '';
            return;
        }
        var status = cliRuntimeStore.get(provider.type);
        settingsProviderRuntimeFields.innerHTML =
            '<div class="settings-cli-runtime">' + buildCliRuntimeStatusHtml(provider, status) + '</div>';
        settingsProviderRuntimeFields.style.display = '';
        bindCliRuntimeFields(provider);
    }

    function bindCliRuntimeFields(provider) {
        var downloadBtn = document.getElementById('settings-cli-runtime-download-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', function () {
                if (cliRuntimeStore) cliRuntimeStore.startDownload(provider.type);
            });
        }
    }

    /** 组件状态变更订阅回调：就地刷新状态条；就绪跃迁时刷新列表并自动切换过去 */
    function handleCliRuntimeChange() {
        if (!cliRuntimeStore) return;
        // fetchProviders 会把下拉重置回当前 provider，先记住用户正在查看的 provider
        var viewingBeforeRefresh = getSelectedSettingsProvider();
        Object.keys(CLI_RUNTIME_PROVIDER_LABELS).forEach(function (providerType) {
            var status = cliRuntimeStore.get(providerType);
            var phase = status ? status.phase : null;
            var prevPhase = lastRuntimePhases[providerType] || null;
            if (prevPhase !== 'ready' && phase === 'ready') {
                fetchProviders().then(function () {
                    // 用户正在查看该 provider 时，下载完成后直接切换为当前 provider
                    if (viewingBeforeRefresh && viewingBeforeRefresh.type === providerType) {
                        persistSettingsProviderSelection(providerType);
                    }
                });
            }
            if (phase) lastRuntimePhases[providerType] = phase;
        });
        var provider = getSelectedSettingsProvider();
        if (provider) renderCliRuntimeFields(provider);
    }

    if (cliRuntimeStore) {
        cliRuntimeStore.subscribe(handleCliRuntimeChange);
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
        var tooltip = '控制模型在单次会话中的最大处理时间，达到上限后，本次任务会自动停止。';
        return '<span class="settings-field-label settings-field-label-with-help">时长上限' +
            '<span class="settings-field-help" tabindex="0" aria-label="' + escapeAttr(tooltip) + '"' +
            ' data-tooltip="' + escapeAttr(tooltip) + '">?</span>' +
            '</span>' +
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
        return '<div class="settings-row compat-toggle-row"><span><strong>自定义上游</strong><small>开启后 Codex 使用自定义上游服务（Responses 直连或 Anthropic 适配）</small></span>' +
            '<label class="settings-switch" aria-label="自定义上游">' +
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

    function buildProviderApiKeyRow(value, hint) {
        return '<div class="settings-row provider-api-key-row"><span><strong>API Key</strong><small>' + escapeHtml(hint || '访问兼容服务所需的密钥') + '</small></span>' +
            buildProviderSecretInput('settings-provider-api-key', value || '', 'API Key') + '</div>';
    }

    function updateProviderApiKeyVisibility() {
        var baseUrlInput = document.getElementById('settings-provider-anthropic-base-url');
        var hide = isOllamaBaseUrl(baseUrlInput ? baseUrlInput.value : '');
        Array.prototype.forEach.call(document.querySelectorAll('.provider-api-key-row'), function (row) {
            row.style.display = hide ? 'none' : '';
        });
    }

    // codex 上游格式下拉：Responses = Codex 直连上游；Anthropic = 经 AnyBot 本地适配层翻译。
    // 用项目统一的 settings-combobox 样式；隐藏 input 承载当前值，供收集/校验逻辑读取
    function buildCodexUpstreamFormatRow(format) {
        return '<div class="settings-row"><span><strong>上游格式</strong><small>上游服务支持的 API 协议</small></span>' +
            '<input type="hidden" id="settings-provider-codex-upstream-format" value="' + escapeAttr(format) + '">' +
            '<div class="settings-combobox" id="settings-provider-codex-format-combobox">' +
            '<button class="settings-combobox-trigger" id="settings-provider-codex-format-trigger" type="button"' +
            ' aria-haspopup="listbox" aria-expanded="false" aria-label="上游格式">' +
            '<span class="settings-combobox-value" id="settings-provider-codex-format-current"></span>' +
            '<svg class="settings-combobox-arrow" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</button>' +
            '<div class="settings-combobox-menu" id="settings-provider-codex-format-menu" role="listbox" aria-label="上游格式"></div>' +
            '</div></div>';
    }

    // Base URL 行的标签与说明随上游格式变化；id 供切换格式时就地更新文案（避免重渲染丢失未保存输入）
    function buildCodexBaseUrlRow(format, value) {
        var isResponses = format === 'responses';
        var label = isResponses ? 'Responses Base URL' : 'Anthropic Base URL';
        var hint = isResponses ? '兼容 OpenAI Responses API 的服务地址' : '兼容 Anthropic API 的服务地址';
        return '<div class="settings-row" id="settings-provider-codex-base-url-row"><span><strong>' + label + '</strong><small>' + hint + '</small></span>' +
            buildProviderBaseUrlInput(value || '', label) + '</div>';
    }

    // 切换上游格式：更新内存配置并就地刷新 Base URL 行文案，持久化随保存进行
    function applyCodexUpstreamFormat(format) {
        var cfg = getProviderSettings('codex');
        cfg.codexUpstreamFormat = format;
        var row = document.getElementById('settings-provider-codex-base-url-row');
        if (row) {
            var isResponses = format === 'responses';
            var labelEl = row.querySelector('strong');
            var hintEl = row.querySelector('small');
            if (labelEl) labelEl.textContent = isResponses ? 'Responses Base URL' : 'Anthropic Base URL';
            if (hintEl) hintEl.textContent = isResponses ? '兼容 OpenAI Responses API 的服务地址' : '兼容 Anthropic API 的服务地址';
        }
        closeProviderModelSuggestionMenus();
    }

    // 绑定上游格式 combobox；字段区每次渲染都会重建 DOM，因此控制器也随渲染重建
    function bindCodexUpstreamFormatCombobox() {
        var combobox = document.getElementById('settings-provider-codex-format-combobox');
        if (!combobox) {
            codexFormatComboboxController = null;
            return;
        }
        var hiddenInput = document.getElementById('settings-provider-codex-upstream-format');
        codexFormatComboboxController = createSettingsSingleSelectCombobox({
            combobox: combobox,
            trigger: document.getElementById('settings-provider-codex-format-trigger'),
            current: document.getElementById('settings-provider-codex-format-current'),
            menu: document.getElementById('settings-provider-codex-format-menu'),
            closeOthers: function () {
                closeOtherSettingsMenus();
                closeProviderModelSuggestionMenus();
            },
            onChange: function (format) {
                if (hiddenInput) hiddenInput.value = format;
                applyCodexUpstreamFormat(format);
            },
        });
        codexFormatComboboxController.render([
            { value: 'responses', label: 'Responses' },
            { value: 'anthropic', label: 'Anthropic' },
        ], hiddenInput && hiddenInput.value === 'anthropic' ? 'anthropic' : 'responses');
    }

    function buildCodexCompatFields(cfg) {
        var format = getCodexUpstreamFormat(cfg);
        return buildCodexUpstreamFormatRow(format) +
            buildCodexBaseUrlRow(format, cfg.codexAnthropicBaseUrl || '') +
            buildProviderApiKeyRow(cfg.codexApiKey || '') +
            '<div class="settings-row"><span><strong>gpt-5.6-sol</strong><small>映射到默认通用模型</small></span>' +
            buildProviderModelInput('settings-provider-codex-default-model', cfg.codexDefaultModel || '', 'gpt-5.6-sol') + '</div>' +
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
            buildProviderApiKeyRow(cfg.apiKey || '') +
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
        var anthropicBaseUrl = anthropicBaseUrlInput ? anthropicBaseUrlInput.value.trim() : '';
        var fixedModel = getFixedProviderModel(anthropicBaseUrl);
        var presetKey = getProviderBaseUrlPresetKey(anthropicBaseUrl);
        if (binInput) {
            next.pathToClaudeCodeExecutable = binInput.value.trim();
            delete next.bin;
        }
        if (apiKeyInput) {
            next.apiKey = apiKeyInput.value;
            if (!next.apiKey.trim() && isOllamaBaseUrl(anthropicBaseUrl)) {
                next.apiKey = OLLAMA_PLACEHOLDER_API_KEY;
            }
        }
        if (anthropicBaseUrlInput) next.anthropicBaseUrl = anthropicBaseUrl;
        if (anthropicAutoModelInput) {
            next.anthropicAutoModel = fixedModel || anthropicAutoModelInput.value.trim();
            next.defaultModel = next.anthropicAutoModel;
        }
        if (anthropicOpusModelInput) next.anthropicOpusModel = fixedModel || anthropicOpusModelInput.value.trim();
        if (anthropicSonnetModelInput) next.anthropicSonnetModel = fixedModel || anthropicSonnetModelInput.value.trim();
        if (anthropicHaikuModelInput) next.anthropicHaikuModel = fixedModel || anthropicHaikuModelInput.value.trim();
        if (subagentModelInput) next.claudeCodeSubagentModel = fixedModel || subagentModelInput.value.trim();
        if (presetKey) {
            next.anthropicBaseUrlPresets = Object.assign({}, current.anthropicBaseUrlPresets || {});
            next.anthropicBaseUrlPresets[presetKey] = cleanProviderPreset({
                apiKey: next.apiKey || '',
                anthropicBaseUrl: next.anthropicBaseUrl || '',
                anthropicAutoModel: next.anthropicAutoModel || '',
                defaultModel: next.defaultModel || '',
                anthropicOpusModel: next.anthropicOpusModel || '',
                anthropicSonnetModel: next.anthropicSonnetModel || '',
                anthropicHaikuModel: next.anthropicHaikuModel || '',
                claudeCodeSubagentModel: next.claudeCodeSubagentModel || '',
            });
        }
        Object.keys(next).forEach(function (key) {
            if (next[key] === '') delete next[key];
        });
        return next;
    }

    function collectCodexCompatSettings(current) {
        var next = Object.assign({}, current, { codexCompatEnabled: true });
        var formatSelect = document.getElementById('settings-provider-codex-upstream-format');
        var apiKeyInput = document.getElementById('settings-provider-api-key');
        var baseUrlInput = document.getElementById('settings-provider-anthropic-base-url');
        var defaultModelInput = document.getElementById('settings-provider-codex-default-model');
        var fastModelInput = document.getElementById('settings-provider-codex-fast-model');
        var codeModelInput = document.getElementById('settings-provider-codex-code-model');
        var baseUrl = baseUrlInput ? baseUrlInput.value.trim() : '';
        var fixedModel = getFixedProviderModel(baseUrl);
        var presetKey = getProviderBaseUrlPresetKey(baseUrl);
        if (formatSelect) {
            next.codexUpstreamFormat = formatSelect.value === 'anthropic' ? 'anthropic' : 'responses';
        }
        if (apiKeyInput) {
            next.codexApiKey = apiKeyInput.value;
            if (!next.codexApiKey.trim() && isOllamaBaseUrl(baseUrl)) {
                next.codexApiKey = OLLAMA_PLACEHOLDER_API_KEY;
            }
        }
        if (baseUrlInput) next.codexAnthropicBaseUrl = baseUrl;
        if (defaultModelInput) next.codexDefaultModel = fixedModel || defaultModelInput.value.trim();
        if (fastModelInput) next.codexFastModel = fixedModel || fastModelInput.value.trim();
        if (codeModelInput) next.codexCodeModel = fixedModel || codeModelInput.value.trim();
        if (presetKey) {
            next.codexBaseUrlPresets = Object.assign({}, current.codexBaseUrlPresets || {});
            next.codexBaseUrlPresets[presetKey] = cleanProviderPreset({
                codexAnthropicBaseUrl: next.codexAnthropicBaseUrl || '',
                codexApiKey: next.codexApiKey || '',
                codexDefaultModel: next.codexDefaultModel || '',
                codexFastModel: next.codexFastModel || '',
                codexCodeModel: next.codexCodeModel || '',
            });
        }
        Object.keys(next).forEach(function (key) {
            if (next[key] === '') delete next[key];
        });
        return next;
    }

    function validateClaudeCodeSettings() {
        var baseUrlInput = document.getElementById('settings-provider-anthropic-base-url');
        var ollamaLocal = isOllamaBaseUrl(baseUrlInput ? baseUrlInput.value : '');
        var fields = [
            ['Anthropic Base URL', baseUrlInput],
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
            if (ollamaLocal && input.id === 'settings-provider-api-key') return false;
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
        var baseUrlInput = document.getElementById('settings-provider-anthropic-base-url');
        var formatSelect = document.getElementById('settings-provider-codex-upstream-format');
        var baseUrlLabel = formatSelect && formatSelect.value === 'anthropic' ? 'Anthropic Base URL' : 'Responses Base URL';
        var ollamaLocal = isOllamaBaseUrl(baseUrlInput ? baseUrlInput.value : '');
        var fields = [
            [baseUrlLabel, baseUrlInput],
            ['API Key', document.getElementById('settings-provider-api-key')],
            ['gpt-5.6-sol', document.getElementById('settings-provider-codex-default-model')],
            ['gpt-mini', document.getElementById('settings-provider-codex-fast-model')],
            ['gpt-codex', document.getElementById('settings-provider-codex-code-model')],
        ];
        var missing = fields.filter(function (entry) {
            var input = entry[1];
            if (!input) return false;
            if (ollamaLocal && input.id === 'settings-provider-api-key') return false;
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
            // 内置组件可下载的 provider 允许选中查看状态条，但不切换当前 provider
            var isDownloadable = isProviderDownloadable(p);
            var opt = document.createElement('option');
            opt.value = p.type;
            opt.textContent = p.displayName + (isInstalled ? '' : (isDownloadable ? '（需下载）' : '（未安装）'));
            opt.disabled = !isInstalled && !isDownloadable;
            settingsProviderSelect.appendChild(opt);

            if (settingsProviderMenu) {
                var item = document.createElement('button');
                item.className = 'settings-combobox-option';
                item.type = 'button';
                item.setAttribute('role', 'option');
                item.disabled = !isInstalled && !isDownloadable;
                item.setAttribute('aria-disabled', item.disabled ? 'true' : 'false');
                if (!isInstalled) {
                    item.title = isDownloadable
                        ? '内置组件未下载，选中后可就地下载'
                        : (p.bin || p.displayName) + ' 未安装';
                }
                item.dataset.providerType = p.type;
                item.dataset.providerDisplayName = p.displayName;
                item.dataset.providerInstalled = isInstalled ? 'true' : 'false';
                item.dataset.providerDownloadable = isDownloadable ? 'true' : 'false';
                item.dataset.providerBin = p.bin || '';
                item.innerHTML = buildSettingsProviderOptionHtml(
                    false,
                    p.displayName,
                    isInstalled ? '' : (isDownloadable ? '需下载' : '未安装'),
                );
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
        return !!provider && (isProviderInstalled(provider) || isProviderDownloadable(provider));
    }

    function buildSettingsProviderOptionHtml(isActive, displayName, statusText) {
        return buildSettingsComboboxOptionHtml(isActive, displayName, statusText || '');
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
            if (settingsProviderEffortComboboxController) settingsProviderEffortComboboxController.setOpen(false);
        },
        onChange: function (modelId) {
            if (settingsProviderModelSelect) settingsProviderModelSelect.value = modelId;
            var provider = getSelectedSettingsProvider();
            if (!provider) return;
            saveSettingsProviderModel(provider.type, modelId);
        },
    });

    settingsProviderEffortComboboxController = createSettingsSingleSelectCombobox({
        combobox: settingsProviderEffortCombobox,
        trigger: settingsProviderEffortTrigger,
        current: settingsProviderEffortCurrent,
        menu: settingsProviderEffortMenu,
        placeholder: '请选择强度',
        closeOthers: function () {
            closeOtherSettingsMenus();
            setSettingsProviderMenuOpen(false);
            if (settingsProviderModelComboboxController) settingsProviderModelComboboxController.setOpen(false);
        },
        onChange: function (effortId) {
            var provider = getSelectedSettingsProvider();
            if (!provider) return;
            saveSettingsProviderEffort(provider.type, effortId);
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
                ? selected.displayName + (isProviderInstalled(selected) ? '' : (isProviderDownloadable(selected) ? '（需下载）' : '（未安装）'))
                : '请选择提供商';
        }
        getSettingsProviderOptions(true).forEach(function (item) {
            var isActive = item.dataset.providerType === settingsProviderSelect.value;
            var isInstalled = item.dataset.providerInstalled !== 'false';
            var isDownloadable = item.dataset.providerDownloadable === 'true';
            var isDisabled = !isInstalled && !isDownloadable;
            item.classList.toggle('active', isActive);
            item.classList.toggle('disabled', isDisabled);
            item.disabled = isDisabled;
            item.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
            item.setAttribute('aria-selected', isActive ? 'true' : 'false');
            item.innerHTML = buildSettingsProviderOptionHtml(
                isActive,
                item.dataset.providerDisplayName || '',
                isInstalled ? '' : (isDownloadable ? '需下载' : '未安装'),
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
            if (settingsProviderEffortComboboxController) settingsProviderEffortComboboxController.setOpen(false);
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
        // 需下载的 provider 允许选中查看状态条，但在组件就绪前不切换当前 provider
        var provider = providerData.providers.find(function (p) {
            return p.type === providerType;
        });
        if (!provider || !isProviderInstalled(provider)) return false;
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

    // 保存指定 provider 的默认强度；若改的是当前会话 provider，同步模型配置与聊天区强度滑块
    async function saveSettingsProviderEffort(providerType, effortId) {
        try {
            var res = await fetch('/api/model-config', {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({provider: providerType, effort: effortId}),
            });
            if (!res.ok) {
                var err = await res.json().catch(function () { return {}; });
                showError(err.error || '保存默认强度失败');
                return false;
            }
            var savedConfig = await res.json();
            settingsModelConfig = savedConfig;
            if (!getCurrentSessionProvider() || getCurrentSessionProvider() === providerType) {
                applyModelConfig(savedConfig);
                syncEffortModeConfig(savedConfig);
            }
            showSettingsStatus('已保存');
        } catch (e) {
            showError('保存默认强度失败');
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

    async function saveSettingsProviderSettings(successMessage) {
        var provider = getSelectedSettingsProvider();
        if (!provider || !isSettingsProviderSelectable(provider.type)) return false;
        var savedMessage = typeof successMessage === 'string' ? successMessage : '已保存';
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
        }, savedMessage);
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
        if (settingsProviderEffortComboboxController) settingsProviderEffortComboboxController.setOpen(false);
        if (codexFormatComboboxController) codexFormatComboboxController.setOpen(false);
    }

    function handleDocumentClick(e) {
        if (settingsProviderCombobox && !settingsProviderCombobox.contains(e.target)) {
            setSettingsProviderMenuOpen(false);
        }
        if (settingsProviderModelComboboxController && !settingsProviderModelComboboxController.contains(e.target)) {
            settingsProviderModelComboboxController.setOpen(false);
        }
        if (settingsProviderEffortComboboxController && !settingsProviderEffortComboboxController.contains(e.target)) {
            settingsProviderEffortComboboxController.setOpen(false);
        }
        if (codexFormatComboboxController && !codexFormatComboboxController.contains(e.target)) {
            codexFormatComboboxController.setOpen(false);
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
        if (settingsProviderEffortComboboxController && settingsProviderEffortComboboxController.isOpen()) {
            settingsProviderEffortComboboxController.setOpen(false);
            settingsProviderEffortComboboxController.focusTrigger();
            return true;
        }
        if (codexFormatComboboxController && codexFormatComboboxController.isOpen()) {
            codexFormatComboboxController.setOpen(false);
            codexFormatComboboxController.focusTrigger();
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
