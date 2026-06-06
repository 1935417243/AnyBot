import { escapeHtml } from '../utils/html.js';

const WEEKDAY_LABELS = {
    1: '周一',
    2: '周二',
    3: '周三',
    4: '周四',
    5: '周五',
    6: '周六',
    0: '周日',
};
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const LOCAL_CHANNEL_TYPE = 'local';

export function createAutomationsPageController(options) {
    const automationView = options.automationView;

    var automations = [];
    var automationRuns = {};
    var providersData = null;
    var channelsData = null;
    var projects = [];
    var skillsData = { skills: [] };
    var modelData = { models: [] };
    var selectedProvider = '';
    var selectedModelId = '';
    var selectedSkillIds = new Set();
    var selectedChannel = '';
    var selectedProjectId = '';
    var selectedScheduleType = 'minutes';
    var selectedWeekday = 1;
    var editAutomationId = null;
    var selectedAutomationId = null;
    var searchTerm = '';

    function showError(message) {
        if (options.showError) options.showError(message);
    }

    function getChannelMeta(type) {
        if (type === LOCAL_CHANNEL_TYPE) return { name: '本地', icon: '本', iconClass: 'default' };
        if (options.getChannelMeta) return options.getChannelMeta(type);
        return { name: type, icon: type.charAt(0).toUpperCase(), iconClass: 'default' };
    }

    function getActiveProviderType() {
        if (options.getActiveProviderType) return options.getActiveProviderType();
        return providersData && providersData.current ? providersData.current : '';
    }

    function providerLabel(type) {
        var provider = providersData && providersData.providers
            ? providersData.providers.find(function (item) { return item.type === type; })
            : null;
        return provider ? provider.displayName : type;
    }

    function modelLabel(modelId) {
        if (!modelId) return '默认模型';
        var model = modelData && modelData.models
            ? modelData.models.find(function (item) { return item.id === modelId; })
            : null;
        return model ? model.name : modelId;
    }

    function projectLabel(projectId) {
        if (!projectId) return '默认工作目录';
        var project = projects.find(function (item) { return item.id === projectId; });
        return project ? project.name : '未知项目';
    }

    function channelLabel(type) {
        return getChannelMeta(type).name || type;
    }

    function getAutomationChannels() {
        var registered = channelsData && channelsData.registered ? channelsData.registered : [];
        var config = channelsData && channelsData.config ? channelsData.config : {};
        return [LOCAL_CHANNEL_TYPE].concat(registered.filter(function (type) {
            return type !== LOCAL_CHANNEL_TYPE && config[type] && config[type].enabled;
        }));
    }

    function scheduleLabel(schedule) {
        if (!schedule) return '未配置';
        if (schedule.type === 'minutes') return '每 ' + (schedule.intervalMinutes || 30) + ' 分钟';
        if (schedule.type === 'hourly') return '每小时';
        if (schedule.type === 'daily') return '每天 ' + (schedule.time || '09:00');
        if (schedule.type === 'weekly') return '每' + (WEEKDAY_LABELS[schedule.weekday] || '周一') + ' ' + (schedule.time || '09:00');
        return '未配置';
    }

    function formatDateTime(date) {
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        var hour = String(date.getHours()).padStart(2, '0');
        var minute = String(date.getMinutes()).padStart(2, '0');
        return month + '-' + day + ' ' + hour + ':' + minute;
    }

    function formatTimestamp(value) {
        if (!value) return '-';
        return formatDateTime(new Date(value));
    }

    function nextRunLabel(schedule) {
        if (!schedule) return '未配置';
        var now = new Date();
        if (schedule.type === 'minutes') {
            var minutes = Number(schedule.intervalMinutes || 30);
            var nextMinutes = new Date(now.getTime() + Math.max(1, minutes) * 60 * 1000);
            return formatDateTime(nextMinutes);
        }
        if (schedule.type === 'hourly') {
            return formatDateTime(new Date(now.getTime() + 60 * 60 * 1000));
        }
        if (schedule.type === 'daily' || schedule.type === 'weekly') {
            var time = String(schedule.time || '09:00').split(':');
            var next = new Date(now);
            next.setHours(Number(time[0] || 9), Number(time[1] || 0), 0, 0);
            if (schedule.type === 'daily') {
                if (next <= now) next.setDate(next.getDate() + 1);
                return formatDateTime(next);
            }
            var targetWeekday = Number(schedule.weekday ?? 1);
            var daysAhead = (targetWeekday - next.getDay() + 7) % 7;
            if (daysAhead === 0 && next <= now) daysAhead = 7;
            next.setDate(next.getDate() + daysAhead);
            return formatDateTime(next);
        }
        return '未配置';
    }

    function showStatus(message) {
        var status = document.getElementById('automation-status');
        if (!status) return;
        status.textContent = message;
        status.classList.add('show');
        setTimeout(function () {
            status.classList.remove('show');
        }, 1800);
    }

    async function fetchAutomations() {
        try {
            var res = await fetch('/api/automations');
            var data = await res.json();
            automations = Array.isArray(data.automations) ? data.automations : [];
        } catch (e) {
            console.error('Failed to fetch automations:', e);
            automations = [];
        }
    }

    async function fetchAutomationRuns(id) {
        try {
            var res = await fetch('/api/automations/' + encodeURIComponent(id) + '/runs');
            var data = await res.json();
            automationRuns[id] = Array.isArray(data.runs) ? data.runs : [];
        } catch (e) {
            console.error('Failed to fetch automation runs:', e);
            automationRuns[id] = [];
        }
    }

    async function fetchProviders() {
        try {
            var res = await fetch('/api/providers');
            providersData = await res.json();
            selectedProvider = selectedProvider || getActiveProviderType() || providersData.current || '';
        } catch (e) {
            console.error('Failed to fetch providers:', e);
            providersData = { current: '', providers: [] };
        }
    }

    async function fetchChannels() {
        try {
            var res = await fetch('/api/channels');
            channelsData = await res.json();
            selectedChannel = selectedChannel || LOCAL_CHANNEL_TYPE;
        } catch (e) {
            console.error('Failed to fetch channels:', e);
            channelsData = { registered: [], config: {} };
            selectedChannel = selectedChannel || LOCAL_CHANNEL_TYPE;
        }
    }

    async function fetchProjects() {
        try {
            var res = await fetch('/api/projects');
            projects = await res.json();
            if (!Array.isArray(projects)) projects = [];
        } catch (e) {
            console.error('Failed to fetch projects:', e);
            projects = [];
        }
    }

    async function fetchSkills(providerType) {
        try {
            var query = providerType ? '?provider=' + encodeURIComponent(providerType) : '';
            var res = await fetch('/api/skills/mentions' + query);
            skillsData = await res.json();
            if (!Array.isArray(skillsData.skills)) skillsData = { skills: [] };
        } catch (e) {
            console.error('Failed to fetch automation skills:', e);
            skillsData = { skills: [] };
        }
    }

    async function fetchModels(providerType) {
        try {
            var query = providerType ? '?provider=' + encodeURIComponent(providerType) : '';
            var res = await fetch('/api/model-config' + query);
            modelData = await res.json();
            if (!Array.isArray(modelData.models)) modelData = { models: [] };
            var ids = new Set(modelData.models.map(function (model) { return model.id; }));
            if (!selectedModelId || !ids.has(selectedModelId)) {
                selectedModelId = modelData.currentModel || (modelData.models[0] && modelData.models[0].id) || '';
            }
        } catch (e) {
            console.error('Failed to fetch automation models:', e);
            modelData = { models: [] };
            selectedModelId = '';
        }
    }

    async function fetchInitialData() {
        await Promise.all([fetchAutomations(), fetchProviders(), fetchChannels(), fetchProjects()]);
        await Promise.all([fetchSkills(selectedProvider), fetchModels(selectedProvider)]);
    }

    function hasAutomationsData() {
        return !!providersData && !!channelsData;
    }

    function render() {
        automationView.innerHTML = '';

        var page = document.createElement('div');
        page.className = 'automation-page';
        page.innerHTML =
            '<div class="automation-header">' +
            '<div class="automation-header-top">' +
            '<div class="automation-header-icon">' +
            '<svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 4.5v3.6l2.3 1.4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z" stroke="currentColor" stroke-width="1.2"/></svg>' +
            '</div>' +
            '<div>' +
            '<div class="automation-title">自动化</div>' +
            '<div class="automation-subtitle">配置定时任务、技能和交付方式</div>' +
            '</div>' +
            '</div>' +
            '<button class="automation-primary-btn" id="automation-create-btn" type="button">' +
            '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1.5v11M1.5 7h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
            '新建自动化' +
            '</button>' +
            '</div>' +
            '<div class="automation-toolbar">' +
            '<input class="automation-search" id="automation-search" type="text" placeholder="搜索名称、内容、技能或交付方式…" value="' + escapeHtml(searchTerm) + '">' +
            '<button class="automation-toolbar-btn" id="automation-refresh-btn" title="刷新" type="button">' +
            '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 7a5.5 5.5 0 0 1 9.35-3.95M12.5 7a5.5 5.5 0 0 1-9.35 3.95" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M10.5 1v2.5H13M3.5 13v-2.5H1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</button>' +
            '</div>' +
            '<div class="automation-list-head">自动化任务 <span class="automation-count" id="automation-count">0</span></div>' +
            '<div class="automation-list" id="automation-list"></div>' +
            '<div class="automation-status" id="automation-status"></div>' +
            '<div class="automation-drawer-overlay" id="automation-drawer-overlay"></div>' +
            '<aside class="automation-drawer" id="automation-detail-drawer"></aside>' +
            '<aside class="automation-drawer automation-runs-drawer" id="automation-runs-drawer"></aside>' +
            '<aside class="automation-editor" id="automation-editor"></aside>';

        automationView.appendChild(page);

        document.getElementById('automation-create-btn').addEventListener('click', openCreateEditor);
        document.getElementById('automation-search').addEventListener('input', function () {
            searchTerm = this.value;
            renderList();
        });
        document.getElementById('automation-refresh-btn').addEventListener('click', function () {
            fetchAutomations().then(function () {
                renderList();
                showStatus('已刷新');
            });
        });
        document.getElementById('automation-drawer-overlay').addEventListener('click', closeDrawers);

        renderList();
    }

    function getFilteredAutomations() {
        var term = searchTerm.trim().toLowerCase();
        return automations.filter(function (automation) {
            if (!term) return true;
            var haystack = [
                automation.name,
                automation.prompt,
                scheduleLabel(automation.schedule),
                providerLabel(automation.provider),
                automation.modelId,
                channelLabel(automation.channelType),
                projectLabel(automation.projectId),
                automation.skills.map(function (skill) { return skill.name; }).join(' '),
            ].join(' ').toLowerCase();
            return haystack.indexOf(term) !== -1;
        });
    }

    function renderList() {
        var listEl = document.getElementById('automation-list');
        var countEl = document.getElementById('automation-count');
        if (!listEl) return;
        var filtered = getFilteredAutomations();
        if (countEl) countEl.textContent = String(filtered.length);

        if (filtered.length === 0) {
            listEl.innerHTML =
                '<div class="automation-empty">' +
                '<div class="automation-empty-icon">' +
                '<svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M8 4.5v3.6l2.3 1.4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z" stroke="currentColor" stroke-width="1.2"/></svg>' +
                '</div>' +
                '<div class="automation-empty-text">' + (searchTerm ? '没有找到匹配的自动化' : '暂无自动化配置') + '</div>' +
                '</div>';
            return;
        }

        listEl.innerHTML = filtered.map(function (automation) {
            return '<article class="automation-card ' + (automation.id === selectedAutomationId ? 'selected' : '') + '" data-id="' + escapeHtml(automation.id) + '">' +
                '<div class="automation-card-main">' +
                '<div class="automation-card-title-row">' +
                '<div class="automation-card-title">' + escapeHtml(automation.name) + '</div>' +
                '<span class="automation-pill ' + (automation.enabled ? 'enabled' : '') + '">' + (automation.enabled ? '已启用' : '未启用') + '</span>' +
                '</div>' +
                '<div class="automation-card-desc">' + escapeHtml(automation.prompt) + '</div>' +
                '<div class="automation-meta-row">' +
                '<span class="automation-meta accent">' + iconClock() + escapeHtml(scheduleLabel(automation.schedule)) + '</span>' +
                '<span class="automation-meta">' + escapeHtml(providerLabel(automation.provider)) + '</span>' +
                (automation.modelId ? '<span class="automation-meta">' + escapeHtml(modelLabel(automation.modelId)) + '</span>' : '') +
                '<span class="automation-meta green">' + automation.skills.length + ' 个技能</span>' +
                '<span class="automation-meta blue">' + escapeHtml(channelLabel(automation.channelType)) + '</span>' +
                '<span class="automation-meta">' + escapeHtml(projectLabel(automation.projectId)) + '</span>' +
                '</div>' +
                '</div>' +
                '<div class="automation-card-side">' +
                '<button class="automation-toggle ' + (automation.enabled ? 'on' : '') + '" data-action="toggle" title="' + (automation.enabled ? '停用' : '启用') + '"></button>' +
                '<button class="automation-icon-btn" data-action="edit" title="编辑">' + iconEdit() + '</button>' +
                '<button class="automation-icon-btn" data-action="runs" title="运行记录">' + iconHistory() + '</button>' +
                '<button class="automation-icon-btn danger" data-action="delete" title="删除">' + iconTrash() + '</button>' +
                '</div>' +
                '</article>';
        }).join('');

        listEl.querySelectorAll('.automation-card').forEach(function (card) {
            card.addEventListener('click', function (e) {
                if (e.target.closest('[data-action]')) return;
                selectedAutomationId = card.dataset.id;
                renderList();
                openDetailDrawer(selectedAutomationId);
            });
        });

        listEl.querySelectorAll('[data-action="toggle"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var automation = findAutomation(btn.closest('.automation-card').dataset.id);
                if (!automation) return;
                saveAutomation(Object.assign({}, automation, { enabled: !automation.enabled }), true);
            });
        });

        listEl.querySelectorAll('[data-action="edit"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                openEditEditor(btn.closest('.automation-card').dataset.id);
            });
        });

        listEl.querySelectorAll('[data-action="runs"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                selectedAutomationId = btn.closest('.automation-card').dataset.id;
                renderList();
                openRunsDrawer(selectedAutomationId);
            });
        });

        listEl.querySelectorAll('[data-action="delete"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                deleteAutomation(btn.closest('.automation-card').dataset.id);
            });
        });
    }

    function findAutomation(id) {
        return automations.find(function (automation) { return automation.id === id; }) || null;
    }

    function openOverlay() {
        document.getElementById('automation-drawer-overlay').classList.add('open');
    }

    function openDetailDrawer(id) {
        var automation = findAutomation(id);
        if (!automation) return;
        closeRunsDrawer();
        closeEditor();
        var drawer = document.getElementById('automation-detail-drawer');
        drawer.innerHTML =
            '<div class="automation-drawer-header">' +
            '<div>' +
            '<div class="automation-drawer-title">' + escapeHtml(automation.name) + '</div>' +
            '<div class="automation-drawer-subtitle">' + (automation.enabled ? '当前配置已启用' : '当前配置未启用') + '</div>' +
            '</div>' +
            '<button class="automation-drawer-close" id="automation-detail-close" type="button">' + iconClose() + '</button>' +
            '</div>' +
            '<div class="automation-drawer-body">' +
            detailBlock('执行内容', escapeHtml(automation.prompt)) +
            detailBlock('触发配置', escapeHtml(scheduleLabel(automation.schedule))) +
            detailBlock('下次执行时间', escapeHtml(formatTimestamp(automation.nextRunAt))) +
            detailBlock('执行提供商', escapeHtml(providerLabel(automation.provider))) +
            detailBlock('模型', escapeHtml(modelLabel(automation.modelId))) +
            detailBlock('工作目录', escapeHtml(projectLabel(automation.projectId))) +
            detailBlock('技能', '<div class="automation-meta-row">' + automation.skills.map(function (skill) {
                return '<span class="automation-meta green">' + escapeHtml(skill.name) + '</span>';
            }).join('') + '</div>') +
            detailBlock('交付方式', escapeHtml(channelLabel(automation.channelType))) +
            '</div>' +
            '<div class="automation-drawer-footer">' +
            '<button class="automation-secondary-btn" id="automation-detail-edit" type="button">编辑</button>' +
            '</div>';
        document.getElementById('automation-detail-close').addEventListener('click', closeDrawers);
        document.getElementById('automation-detail-edit').addEventListener('click', function () {
            closeDetailDrawer();
            openEditEditor(id);
        });
        openOverlay();
        requestAnimationFrame(function () {
            drawer.classList.add('open');
        });
    }

    function runStatusLabel(status) {
        if (status === 'running') return '运行中';
        if (status === 'success') return '成功';
        if (status === 'failed') return '失败';
        return '等待中';
    }

    function deliveryStatusLabel(status) {
        if (status === 'local') return '本地';
        if (status === 'delivered') return '已推送';
        if (status === 'delivery_failed') return '推送失败';
        return '未交付';
    }

    function openRunsDrawer(id) {
        var automation = findAutomation(id);
        if (!automation) return;
        closeDetailDrawer();
        closeEditor();
        var drawer = document.getElementById('automation-runs-drawer');
        drawer.innerHTML =
            '<div class="automation-drawer-header">' +
            '<div>' +
            '<div class="automation-drawer-title">运行记录</div>' +
            '<div class="automation-drawer-subtitle">' + escapeHtml(automation.name) + '</div>' +
            '</div>' +
            '<button class="automation-drawer-close" id="automation-runs-close" type="button">' + iconClose() + '</button>' +
            '</div>' +
            '<div class="automation-drawer-body">' +
            '<div id="automation-run-history" class="automation-run-history">' +
            '<div class="automation-choice-empty">加载中</div>' +
            '</div>' +
            '</div>';
        document.getElementById('automation-runs-close').addEventListener('click', closeDrawers);
        fetchAutomationRuns(id).then(function () {
            renderRunHistory(id);
        });
        openOverlay();
        requestAnimationFrame(function () {
            drawer.classList.add('open');
        });
    }

    function renderRunHistory(id) {
        var container = document.getElementById('automation-run-history');
        if (!container) return;
        var automation = findAutomation(id);
        var runs = automationRuns[id] || [];
        if (runs.length === 0) {
            container.innerHTML = '<div class="automation-choice-empty">暂无运行记录</div>';
            return;
        }
        container.innerHTML = runs.map(function (run) {
            return '<div class="automation-run-card" role="button" tabindex="0" data-session-id="' + escapeHtml(run.sessionId || '') + '">' +
                '<div class="automation-run-main">' +
                '<div class="automation-run-badges">' +
                '<span class="automation-run-status ' + runStatusClass(run.status) + '">' + escapeHtml(runStatusLabel(run.status)) + '</span>' +
                '<span class="automation-run-trigger">' + iconClock() + '自动触发</span>' +
                '<span class="automation-run-delivery">' + escapeHtml(deliveryStatusLabel(run.deliveryStatus)) + '</span>' +
                '</div>' +
                '<div class="automation-run-title">' + escapeHtml(automation ? automation.name : '自动化任务') + '</div>' +
                '</div>' +
                '<div class="automation-run-time">' + escapeHtml(formatTimestamp(run.startedAt || run.createdAt)) + '</div>' +
                '</div>';
        }).join('');
        container.querySelectorAll('.automation-run-card').forEach(function (card) {
            card.addEventListener('click', function () {
                openRunSession(card.dataset.sessionId);
            });
            card.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                openRunSession(card.dataset.sessionId);
            });
        });
    }

    function runStatusClass(status) {
        if (status === 'success') return 'success';
        if (status === 'failed') return 'failed';
        if (status === 'running') return 'running';
        return 'pending';
    }

    async function openRunSession(sessionId) {
        if (!sessionId) {
            showError('这条运行记录没有对应对话');
            return;
        }
        if (!options.openSession) {
            showError('无法打开对应对话');
            return;
        }
        closeDrawers();
        await options.openSession(sessionId);
    }

    function detailBlock(label, valueHtml) {
        return '<div class="automation-detail-block"><div class="automation-detail-label">' + label + '</div><div class="automation-detail-value">' + valueHtml + '</div></div>';
    }

    function openCreateEditor() {
        editAutomationId = null;
        selectedProvider = getActiveProviderType() || (providersData && providersData.current) || selectedProvider;
        selectedModelId = '';
        selectedProjectId = '';
        selectedChannel = LOCAL_CHANNEL_TYPE;
        selectedSkillIds = new Set();
        Promise.all([fetchSkills(selectedProvider), fetchModels(selectedProvider)]).then(function () {
            renderEditor(null);
        });
    }

    function openEditEditor(id) {
        var automation = findAutomation(id);
        if (!automation) return;
        editAutomationId = id;
        selectedProvider = automation.provider;
        selectedModelId = automation.modelId || '';
        selectedProjectId = automation.projectId || '';
        selectedChannel = automation.channelType;
        selectedSkillIds = new Set(automation.skills.map(function (skill) { return skill.id; }));
        Promise.all([fetchSkills(selectedProvider), fetchModels(selectedProvider)]).then(function () {
            renderEditor(automation);
        });
    }

    function renderEditor(automation) {
        var editor = document.getElementById('automation-editor');
        var schedule = automation && automation.schedule ? automation.schedule : { type: 'minutes', intervalMinutes: 30 };
        if (schedule.type === 'cron') schedule = { type: 'minutes', intervalMinutes: 30 };
        selectedScheduleType = schedule.type || 'minutes';
        selectedWeekday = Number(schedule.weekday ?? 1);
        editor.innerHTML =
            '<div class="automation-drawer-header">' +
            '<div>' +
            '<div class="automation-drawer-title">' + (automation ? '编辑自动化' : '新建自动化') + '</div>' +
            '<div class="automation-drawer-subtitle">配置触发方式、技能和交付方式</div>' +
            '</div>' +
            '<button class="automation-drawer-close" id="automation-editor-close" type="button">' + iconClose() + '</button>' +
            '</div>' +
            '<div class="automation-editor-body">' +
            '<section class="automation-form-section">' +
            '<div class="automation-form-title">基础信息</div>' +
            formField('任务名称', '<input class="automation-input" id="automation-name-input" value="' + escapeHtml(automation ? automation.name : '') + '" placeholder="例如：每日代码总结">') +
            formField('执行内容', '<textarea class="automation-textarea" id="automation-prompt-input" placeholder="例如：总结昨天的代码变更，并生成日报">' + escapeHtml(automation ? automation.prompt : '') + '</textarea>') +
            '</section>' +
            '<section class="automation-form-section">' +
            '<div class="automation-form-title">运行上下文</div>' +
            formField('提供商', buildProviderSelect()) +
            formField('模型', '<div id="automation-model-dropdown"></div>') +
            formField('项目', buildProjectSelect()) +
            '</section>' +
            '<section class="automation-form-section">' +
            '<div class="automation-form-title">触发配置</div>' +
            formField('时间触发', buildScheduleSelect(schedule)) +
            '<div id="automation-schedule-extra"></div>' +
            '<div class="automation-schedule-preview" id="automation-schedule-preview"></div>' +
            '</section>' +
            '<section class="automation-form-section">' +
            '<div class="automation-form-title">技能</div>' +
            '<div id="automation-skill-dropdown"></div>' +
            '</section>' +
            '<section class="automation-form-section">' +
            '<div class="automation-form-title">交付方式</div>' +
            '<div id="automation-channel-dropdown"></div>' +
            '</section>' +
            '</div>' +
            '<div class="automation-drawer-footer">' +
            '<button class="automation-secondary-btn" id="automation-editor-cancel" type="button">取消</button>' +
            '<button class="automation-primary-btn grow" id="automation-save-btn" type="button">保存配置</button>' +
            '</div>';

        document.getElementById('automation-editor-close').addEventListener('click', closeDrawers);
        document.getElementById('automation-editor-cancel').addEventListener('click', closeDrawers);
        document.getElementById('automation-save-btn').addEventListener('click', saveEditor);
        editor.onclick = function (e) {
            if (!e.target.closest('.automation-combobox')) closeAutomationDropdowns();
        };
        bindSingleDropdown('automation-provider', function (value) {
            selectedProvider = value;
            selectedModelId = '';
            selectedSkillIds = new Set();
            Promise.all([fetchSkills(selectedProvider), fetchModels(selectedProvider)]).then(function () {
                renderModelDropdown();
                renderSkillDropdown();
            });
        });
        bindSingleDropdown('automation-project', function (value) {
            selectedProjectId = value;
        });
        bindSingleDropdown('automation-schedule', function (value) {
            selectedScheduleType = value;
            renderScheduleFields({ type: value });
        });

        renderScheduleFields(schedule);
        renderModelDropdown();
        renderSkillDropdown();
        renderChannelDropdown();
        closeDetailDrawer();
        closeRunsDrawer();
        openOverlay();
        requestAnimationFrame(function () {
            editor.classList.add('open');
        });
    }

    function formField(label, controlHtml) {
        return '<label class="automation-field"><span class="automation-field-label">' + label + '</span>' + controlHtml + '</label>';
    }

    function buildProviderSelect() {
        var providers = providersData && providersData.providers ? providersData.providers : [];
        return buildDropdown('automation-provider', providers.map(function (provider) {
            return { value: provider.type, label: provider.displayName };
        }), selectedProvider, '选择提供商');
    }

    function renderModelDropdown() {
        var container = document.getElementById('automation-model-dropdown');
        if (!container) return;
        var models = modelData && modelData.models ? modelData.models : [];
        container.innerHTML = buildDropdown('automation-model', models.map(function (model) {
            return { value: model.id, label: model.name, description: model.description || model.id };
        }), selectedModelId, '选择模型');
        bindSingleDropdown('automation-model', function (value) {
            selectedModelId = value;
        });
    }

    function buildProjectSelect() {
        return buildDropdown('automation-project', [{ value: '', label: '默认工作目录' }].concat(projects.map(function (project) {
            return { value: project.id, label: project.name, description: project.path };
        })), selectedProjectId, '选择项目');
    }

    function buildScheduleSelect(schedule) {
        var type = schedule.type || 'minutes';
        return buildDropdown('automation-schedule', getScheduleOptions(), type, '选择触发方式');
    }

    function getScheduleOptions() {
        return [
            { value: 'minutes', label: '分钟' },
            { value: 'hourly', label: '每小时' },
            { value: 'daily', label: '每天' },
            { value: 'weekly', label: '每周' },
        ];
    }

    function buildDropdown(id, items, value, placeholder, options) {
        options = options || {};
        var values = Array.isArray(value) ? value : [value];
        var activeItems = items.filter(function (item) { return values.indexOf(item.value) !== -1; });
        var label = options.label || (activeItems.length > 0 ? activeItems.map(function (item) { return item.label; }).join('、') : placeholder);
        if (options.countLabel && activeItems.length > 1) label = options.countLabel(activeItems.length);
        return '<div class="automation-combobox" data-dropdown-id="' + escapeHtml(id) + '">' +
            '<button class="automation-combobox-trigger" id="' + escapeHtml(id) + '-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">' +
            '<span class="automation-combobox-value" id="' + escapeHtml(id) + '-current">' + escapeHtml(label) + '</span>' +
            '<svg class="automation-combobox-arrow" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</button>' +
            '<div class="automation-combobox-menu" id="' + escapeHtml(id) + '-menu" role="listbox">' +
            items.map(function (item) {
                var active = values.indexOf(item.value) !== -1;
                return '<button class="automation-combobox-option ' + (active ? 'active' : '') + '" type="button" role="option" aria-selected="' + (active ? 'true' : 'false') + '" data-value="' + escapeHtml(item.value) + '">' +
                    '<span class="automation-combobox-option-main">' +
                    '<span>' + escapeHtml(item.label) + '</span>' +
                    (item.description ? '<small>' + escapeHtml(item.description) + '</small>' : '') +
                    '</span>' +
                    '<span class="automation-combobox-check">' + iconCheck() + '</span>' +
                    '</button>';
            }).join('') +
            '</div>' +
            '</div>';
    }

    function closeAutomationDropdowns(exceptId) {
        document.querySelectorAll('.automation-combobox').forEach(function (combobox) {
            var shouldKeep = exceptId && combobox.dataset.dropdownId === exceptId;
            combobox.classList.toggle('open', !!shouldKeep);
            var trigger = combobox.querySelector('.automation-combobox-trigger');
            if (trigger) trigger.setAttribute('aria-expanded', shouldKeep ? 'true' : 'false');
        });
    }

    function bindSingleDropdown(id, onSelect) {
        var combobox = document.querySelector('.automation-combobox[data-dropdown-id="' + id + '"]');
        if (!combobox) return;
        var trigger = combobox.querySelector('.automation-combobox-trigger');
        if (trigger) {
            trigger.addEventListener('click', function (e) {
                e.stopPropagation();
                var shouldOpen = !combobox.classList.contains('open');
                closeAutomationDropdowns(shouldOpen ? id : null);
            });
        }
        combobox.querySelectorAll('.automation-combobox-option').forEach(function (option) {
            option.addEventListener('click', function (e) {
                e.stopPropagation();
                onSelect(option.dataset.value);
                closeAutomationDropdowns();
                updateDropdownSelection(id, option.dataset.value);
            });
        });
    }

    function updateDropdownSelection(id, value) {
        var combobox = document.querySelector('.automation-combobox[data-dropdown-id="' + id + '"]');
        if (!combobox) return;
        combobox.querySelectorAll('.automation-combobox-option').forEach(function (option) {
            var active = option.dataset.value === value;
            option.classList.toggle('active', active);
            option.setAttribute('aria-selected', active ? 'true' : 'false');
            if (active) {
                var label = option.querySelector('.automation-combobox-option-main span');
                var current = combobox.querySelector('.automation-combobox-value');
                if (label && current) current.textContent = label.textContent;
            }
        });
    }

    function renderScheduleFields(schedule) {
        var type = selectedScheduleType || 'minutes';
        var current = schedule || {};
        var extra = document.getElementById('automation-schedule-extra');
        var html = '';
        if (type === 'minutes') {
            html = formField('间隔分钟', '<input class="automation-input" id="automation-minute-input" type="number" min="1" step="1" value="' + escapeHtml(current.intervalMinutes || 30) + '">');
        } else if (type === 'daily') {
            html = formField('执行时间', '<input class="automation-input" id="automation-time-input" type="time" value="' + escapeHtml(current.time || '09:00') + '">');
        } else if (type === 'weekly') {
            selectedWeekday = Number(current.weekday ?? selectedWeekday ?? 1);
            html = formField('执行星期', buildDropdown('automation-weekday', WEEKDAY_ORDER.map(function (key) {
                return { value: String(key), label: WEEKDAY_LABELS[key] };
            }), String(selectedWeekday), '选择星期')) +
                formField('执行时间', '<input class="automation-input" id="automation-time-input" type="time" value="' + escapeHtml(current.time || '09:00') + '">');
        }
        extra.innerHTML = html;
        Array.prototype.slice.call(extra.querySelectorAll('input, select')).forEach(function (input) {
            input.addEventListener('input', updateSchedulePreview);
            input.addEventListener('change', updateSchedulePreview);
        });
        bindSingleDropdown('automation-weekday', function (value) {
            selectedWeekday = Number(value);
            updateSchedulePreview();
        });
        updateSchedulePreview();
    }

    function readScheduleFromEditor() {
        var type = selectedScheduleType || 'minutes';
        var schedule = { type: type };
        if (type === 'minutes') schedule.intervalMinutes = Number(document.getElementById('automation-minute-input').value || 30);
        if (type === 'daily' || type === 'weekly') schedule.time = document.getElementById('automation-time-input').value || '09:00';
        if (type === 'weekly') schedule.weekday = Number(selectedWeekday ?? 1);
        return schedule;
    }

    function updateSchedulePreview() {
        var preview = document.getElementById('automation-schedule-preview');
        if (preview) preview.textContent = '下次执行时间：' + nextRunLabel(readScheduleFromEditor());
    }

    function renderSkillDropdown() {
        var container = document.getElementById('automation-skill-dropdown');
        if (!container) return;
        var skills = skillsData.skills || [];
        if (skills.length === 0) {
            container.innerHTML = '<div class="automation-choice-empty">当前提供商暂无技能</div>';
            return;
        }
        var selectedIds = Array.from(selectedSkillIds);
        container.innerHTML = buildDropdown('automation-skills', skills.map(function (skill) {
            return { value: skill.id, label: skill.name, description: skill.description || skill.source || '' };
        }), selectedIds, '选择技能', {
            label: selectedIds.length === 0
                ? '选择技能'
                : selectedIds.map(function (id) {
                    var skill = skills.find(function (item) { return item.id === id; });
                    return skill ? skill.name : '';
                }).filter(Boolean).join('、'),
            countLabel: function (count) { return count + ' 个技能'; },
        });
        var combobox = container.querySelector('.automation-combobox');
        var trigger = combobox.querySelector('.automation-combobox-trigger');
        trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            var shouldOpen = !combobox.classList.contains('open');
            closeAutomationDropdowns(shouldOpen ? 'automation-skills' : null);
        });
        combobox.querySelectorAll('.automation-combobox-option').forEach(function (item) {
            item.addEventListener('click', function (e) {
                e.stopPropagation();
                var id = item.dataset.value;
                if (selectedSkillIds.has(id)) selectedSkillIds.delete(id);
                else selectedSkillIds.add(id);
                renderSkillDropdown();
                closeAutomationDropdowns('automation-skills');
            });
        });
    }

    function renderChannelDropdown() {
        var container = document.getElementById('automation-channel-dropdown');
        if (!container) return;
        var channels = getAutomationChannels();
        if (channels.length === 0) {
            container.innerHTML = '<div class="automation-choice-empty">暂无可用交付方式</div>';
            return;
        }
        container.innerHTML = buildDropdown('automation-channel', channels.map(function (type) {
            var meta = getChannelMeta(type);
            return { value: type, label: meta.name, description: type };
        }), selectedChannel, '选择交付方式');
        bindSingleDropdown('automation-channel', function (value) {
            selectedChannel = value;
        });
    }

    async function saveEditor() {
        var name = document.getElementById('automation-name-input').value.trim();
        var prompt = document.getElementById('automation-prompt-input').value.trim();
        if (!name) {
            showError('请填写任务名称');
            return;
        }
        if (!prompt) {
            showError('请填写执行内容');
            return;
        }
        if (!selectedChannel) {
            showError('请选择交付方式');
            return;
        }
        var skills = (skillsData.skills || []).filter(function (skill) {
            return selectedSkillIds.has(skill.id);
        }).map(function (skill) {
            return { id: skill.id, name: skill.name, source: skill.source };
        });
        await saveAutomation({
            id: editAutomationId,
            name: name,
            prompt: prompt,
            enabled: editAutomationId ? findAutomation(editAutomationId).enabled : true,
            provider: selectedProvider,
            modelId: selectedModelId || null,
            projectId: selectedProjectId || null,
            channelType: selectedChannel,
            skills: skills,
            schedule: readScheduleFromEditor(),
        }, false);
    }

    async function saveAutomation(payload, keepDrawerOpen) {
        var id = payload.id;
        var method = id ? 'PUT' : 'POST';
        var url = id ? '/api/automations/' + encodeURIComponent(id) : '/api/automations';
        try {
            var res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok) {
                showError(data.error || '保存自动化失败');
                return;
            }
            var saved = data.automation;
            var index = automations.findIndex(function (item) { return item.id === saved.id; });
            if (index >= 0) automations[index] = saved;
            else automations.unshift(saved);
            selectedAutomationId = saved.id;
            if (!keepDrawerOpen) closeDrawers();
            renderList();
            showStatus(id ? '自动化已更新' : '自动化已创建');
        } catch (e) {
            showError('保存自动化失败');
        }
    }

    async function deleteAutomation(id) {
        if (!window.confirm('删除这个自动化配置？')) return;
        try {
            var res = await fetch('/api/automations/' + encodeURIComponent(id), { method: 'DELETE' });
            if (!res.ok) {
                var data = await res.json().catch(function () { return {}; });
                showError(data.error || '删除自动化失败');
                return;
            }
            automations = automations.filter(function (automation) { return automation.id !== id; });
            if (selectedAutomationId === id) selectedAutomationId = null;
            closeDrawers();
            renderList();
            showStatus('自动化已删除');
        } catch (e) {
            showError('删除自动化失败');
        }
    }

    function closeDetailDrawer() {
        var drawer = document.getElementById('automation-detail-drawer');
        if (drawer) drawer.classList.remove('open');
    }

    function closeRunsDrawer() {
        var drawer = document.getElementById('automation-runs-drawer');
        if (drawer) drawer.classList.remove('open');
    }

    function closeEditor() {
        var editor = document.getElementById('automation-editor');
        if (editor) editor.classList.remove('open');
    }

    function closeDrawers() {
        var overlay = document.getElementById('automation-drawer-overlay');
        var detailDrawer = document.getElementById('automation-detail-drawer');
        var runsDrawer = document.getElementById('automation-runs-drawer');
        var editor = document.getElementById('automation-editor');
        if (overlay) overlay.classList.remove('open');
        if (detailDrawer) detailDrawer.classList.remove('open');
        if (runsDrawer) runsDrawer.classList.remove('open');
        if (editor) editor.classList.remove('open');
        return !!(detailDrawer && detailDrawer.classList.contains('open')) || !!(runsDrawer && runsDrawer.classList.contains('open')) || !!(editor && editor.classList.contains('open'));
    }

    function handleEscape() {
        var overlay = document.getElementById('automation-drawer-overlay');
        if (!overlay || !overlay.classList.contains('open')) return false;
        closeDrawers();
        return true;
    }

    function iconClock() {
        return '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 3.8v3.4l2.1 1.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 7A5.5 5.5 0 1 1 1.5 7a5.5 5.5 0 0 1 11 0Z" stroke="currentColor" stroke-width="1.1"/></svg>';
    }

    function iconEdit() {
        return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 11.5h2.2L11 5.2a1.4 1.4 0 0 0-2-2L2.7 9.5v2Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="m8.2 4 1.8 1.8" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/></svg>';
    }

    function iconHistory() {
        return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.2 4.3A4.8 4.8 0 1 1 2 7" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/><path d="M2.9 2.3v2.2h2.2M7 4.6v2.7l1.8 1.1" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    function iconTrash() {
        return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 4h9M5.5 6v4M8.5 6v4M5 4l.6-1.5h2.8L9 4M3.5 4l.6 8h5.8l.6-8" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    function iconClose() {
        return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    }

    function iconCheck() {
        return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.2 6.3 4.8 9 10 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    return {
        fetchInitialData: fetchInitialData,
        handleEscape: handleEscape,
        hasAutomationsData: hasAutomationsData,
        render: render,
    };
}
