import { escapeAttr, escapeHtml } from '../utils/html.js';

const MCP_EXAMPLE_JSON = `{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "env": {
        "CONTEXT7_API_KEY": "your-api-key"
      },
      "startup_timeout_sec": 20
    }
  }
}`;

const STATUS_LABELS = {
    unchecked: '未检查',
    checking: '检查中...',
    verified: '已验证',
    not_started: '未检查',
    starting: '检查中...',
    running: '已验证',
    failed: '检查失败',
    disabled: '已禁用',
};

const MCP_STATUS_POLL_INTERVAL_MS = 1500;
const WARNING_ICON = '<svg class="mcp-status-warning-icon" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1.4 13 12H1L7 1.4Z" fill="currentColor"/><path d="M7 5v3.2M7 10.1h.01" stroke="var(--sidebar)" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SETTINGS_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7"/></svg>';

export function createSettingsMcpController(options) {
    const settingsProviderSubtabs = options.settingsProviderSubtabs || [];
    const settingsProviderSubtabPanels = options.settingsProviderSubtabPanels || [];
    const settingsMcpRefreshBtn = options.settingsMcpRefreshBtn;
    const settingsMcpAddControl = options.settingsMcpAddControl;
    const settingsMcpAddBtn = options.settingsMcpAddBtn;
    const settingsMcpAddMenu = options.settingsMcpAddMenu;
    const settingsMcpServerList = options.settingsMcpServerList;

    let activeTab = 'config';
    let servers = [];
    let loaded = false;
    let loading = false;
    let addMenuOpen = false;
    let openMenuServerId = '';
    let activeDialog = null;
    let statusPollTimer = null;
    let statusPollInFlight = false;

    function showError(message) {
        if (options.showError) options.showError(message);
    }

    function showSettingsStatus(message, tone) {
        if (options.showSettingsStatus) options.showSettingsStatus(message, tone);
    }

    function getStatusLabel(status) {
        return STATUS_LABELS[status] || STATUS_LABELS.not_started;
    }

    function setProviderSettingsTab(tab) {
        if (tab !== 'mcp') tab = 'config';
        activeTab = tab;
        settingsProviderSubtabs.forEach(function (item) {
            var active = item.dataset.providerSettingsTab === tab;
            item.classList.toggle('active', active);
            item.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        settingsProviderSubtabPanels.forEach(function (panel) {
            panel.classList.toggle('active', panel.dataset.providerSettingsPanel === tab);
        });
        if (tab === 'mcp' && settingsProviderSubtabs[0]) {
            var settingsPanelBody = settingsProviderSubtabs[0].closest('.settings-panel-body');
            if (settingsPanelBody) settingsPanelBody.scrollTop = 0;
        }
        if (tab === 'mcp' && !loaded) {
            fetchServers(false);
        }
        syncStatusPolling();
    }

    function setAddMenuOpen(isOpen) {
        addMenuOpen = !!isOpen;
        if (!settingsMcpAddControl || !settingsMcpAddBtn) return;
        settingsMcpAddControl.classList.toggle('open', addMenuOpen);
        settingsMcpAddBtn.setAttribute('aria-expanded', addMenuOpen ? 'true' : 'false');
    }

    function setOpenMenuServerId(serverId) {
        openMenuServerId = serverId || '';
        renderServers();
    }

    async function requestJson(url, requestOptions) {
        const res = await fetch(url, requestOptions || {});
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            throw new Error(data.error || '操作失败');
        }
        return data;
    }

    function hasCheckingServers() {
        return servers.some(function (server) {
            return server.enabled && (server.status === 'checking' || server.status === 'starting');
        });
    }

    function stopStatusPolling() {
        if (!statusPollTimer) return;
        clearTimeout(statusPollTimer);
        statusPollTimer = null;
    }

    function syncStatusPolling() {
        if (activeTab !== 'mcp' || !hasCheckingServers()) {
            stopStatusPolling();
            return;
        }
        if (statusPollTimer || statusPollInFlight) return;
        statusPollTimer = setTimeout(pollServerStatuses, MCP_STATUS_POLL_INTERVAL_MS);
    }

    async function pollServerStatuses() {
        statusPollTimer = null;
        if (activeTab !== 'mcp' || !hasCheckingServers() || statusPollInFlight) {
            syncStatusPolling();
            return;
        }
        statusPollInFlight = true;
        try {
            var data = await requestJson('/api/mcp/servers');
            servers = Array.isArray(data.servers) ? data.servers : [];
            loaded = true;
            renderServers();
        } catch {
            syncStatusPolling();
        } finally {
            statusPollInFlight = false;
            syncStatusPolling();
        }
    }

    async function fetchServers(refreshStatus) {
        loading = true;
        if (settingsMcpRefreshBtn) {
            settingsMcpRefreshBtn.disabled = true;
            settingsMcpRefreshBtn.textContent = refreshStatus ? '刷新中…' : '加载中…';
        }
        if (refreshStatus) {
            servers = servers.map(function (server) {
                return server.enabled ? Object.assign({}, server, { status: 'checking' }) : server;
            });
            renderServers();
        }

        try {
            var data = refreshStatus
                ? await requestJson('/api/mcp/servers/refresh', { method: 'POST' })
                : await requestJson('/api/mcp/servers');
            servers = Array.isArray(data.servers) ? data.servers : [];
            loaded = true;
            renderServers();
            if (refreshStatus) showSettingsStatus('MCP Servers 已刷新');
        } catch (e) {
            showError(e.message || '读取 MCP Servers 失败');
            renderServers();
        } finally {
            loading = false;
            if (settingsMcpRefreshBtn) {
                settingsMcpRefreshBtn.disabled = false;
                settingsMcpRefreshBtn.textContent = '刷新';
            }
            renderServers();
        }
    }

    function updateServers(data) {
        servers = Array.isArray(data.servers) ? data.servers : [];
        loaded = true;
        openMenuServerId = '';
        renderServers();
    }

    function setLocalChecking(serverId, enabled) {
        servers = servers.map(function (server) {
            if (server.id !== serverId) return server;
            var next = { status: 'checking', error: '' };
            if (typeof enabled === 'boolean') next.enabled = enabled;
            return Object.assign({}, server, next);
        });
        renderServers();
    }

    function showServerOperationStatus(serverId, successMessage, failedMessage) {
        var server = findServer(serverId);
        if (server && server.enabled && server.status === 'failed') {
            showSettingsStatus(failedMessage || 'MCP Server 检查失败', 'error');
            return;
        }
        showSettingsStatus(successMessage);
    }

    async function toggleServer(serverId, enabled) {
        if (enabled) {
            setLocalChecking(serverId, true);
        } else {
            servers = servers.map(function (server) {
                return server.id === serverId ? Object.assign({}, server, { enabled: false, status: 'disabled', error: '' }) : server;
            });
            renderServers();
        }
        try {
            var data = await requestJson('/api/mcp/servers/' + encodeURIComponent(serverId) + '/enabled', {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ enabled: enabled }),
            });
            updateServers(data);
            if (enabled) {
                showServerOperationStatus(serverId, 'MCP Server 已启用', 'MCP Server 已启用，检查失败');
            } else {
                showSettingsStatus('MCP Server 已禁用');
            }
        } catch (e) {
            showError(e.message || '切换 MCP Server 失败');
            fetchServers(false);
        }
    }

    async function checkServer(serverId, message) {
        setLocalChecking(serverId);
        try {
            var data = await requestJson('/api/mcp/servers/' + encodeURIComponent(serverId) + '/check', { method: 'POST' });
            updateServers(data);
            showServerOperationStatus(serverId, message || 'MCP Server 已重新检查', 'MCP Server 检查失败');
        } catch (e) {
            showError(e.message || '检查 MCP Server 失败');
            fetchServers(false);
        }
    }

    async function deleteServer(serverId) {
        if (!confirm('确定要删除该 MCP Server 吗？删除后将无法继续使用该工具能力。')) return;
        try {
            var data = await requestJson('/api/mcp/servers/' + encodeURIComponent(serverId), { method: 'DELETE' });
            updateServers(data);
            showSettingsStatus('MCP Server 已删除');
        } catch (e) {
            showError(e.message || '删除 MCP Server 失败');
        }
    }

    function findServer(serverId) {
        return servers.find(function (server) {
            return server.id === serverId;
        }) || null;
    }

    function getServerInitial(server) {
        var value = String(server.name || server.id || 'M').trim();
        return (value ? value.slice(0, 1) : 'M').toUpperCase();
    }

    function buildStatusHtml(server) {
        var status = server.enabled ? server.status : 'disabled';
        var label = getStatusLabel(status);
        return '<span class="mcp-status mcp-status-' + escapeAttr(status) + '">' +
            (status === 'failed' ? WARNING_ICON : '<span class="mcp-status-dot"></span>') +
            '<span class="mcp-status-label">' + escapeHtml(label) + '</span>' +
            '</span>';
    }

    function buildServerHtml(server) {
        var status = server.enabled ? server.status : 'disabled';
        var menuOpen = openMenuServerId === server.id;
        var retryHtml = status === 'failed'
            ? '<button class="mcp-retry-link" type="button" data-mcp-action="retry">重试</button>'
            : '';
        var toggleText = server.enabled ? '禁用' : '启用';
        var isChecking = status === 'checking' || status === 'starting';
        var checkDisabled = server.enabled ? '' : ' disabled';
        return '<div class="mcp-server-item" data-server-id="' + escapeAttr(server.id) + '">' +
            '<span class="mcp-server-avatar" aria-hidden="true">' + escapeHtml(getServerInitial(server)) + '</span>' +
            '<div class="mcp-server-main">' +
            '<div class="mcp-server-title-row">' +
            '<div class="mcp-server-name" title="' + escapeAttr(server.name || server.id) + '">' + escapeHtml(server.name || server.id) + '</div>' +
            buildStatusHtml(server) +
            retryHtml +
            '</div>' +
            '</div>' +
            '<div class="mcp-server-controls">' +
            '<div class="mcp-more-control' + (menuOpen ? ' open' : '') + '">' +
            '<button class="settings-icon-btn mcp-more-btn" type="button" data-mcp-action="menu" aria-haspopup="menu" aria-label="操作" title="操作" aria-expanded="' + (menuOpen ? 'true' : 'false') + '">' + SETTINGS_ICON + '</button>' +
            '<div class="mcp-more-menu" role="menu">' +
            '<button type="button" role="menuitem" data-mcp-action="edit">编辑</button>' +
            '<button type="button" role="menuitem" data-mcp-action="check"' + checkDisabled + '>重新检查</button>' +
            '<button type="button" role="menuitem" data-mcp-action="logs">查看日志</button>' +
            '<button type="button" role="menuitem" class="danger" data-mcp-action="delete">删除</button>' +
            '</div>' +
            '</div>' +
            '<label class="settings-switch mcp-server-switch" aria-label="' + escapeAttr(toggleText + ' ' + (server.name || server.id)) + '">' +
            '<input type="checkbox" data-mcp-action="toggle"' + (server.enabled ? ' checked' : '') + (isChecking ? ' disabled' : '') + '>' +
            '<span class="settings-switch-slider"></span>' +
            '</label>' +
            '</div>' +
            '</div>';
    }

    function positionOpenServerMenu() {
        if (!settingsMcpServerList || !openMenuServerId) return;
        var openControl = null;
        Array.prototype.some.call(settingsMcpServerList.querySelectorAll('.mcp-server-item'), function (item) {
            if (item.dataset.serverId !== openMenuServerId) return false;
            openControl = item.querySelector('.mcp-more-control');
            return true;
        });
        if (!openControl) return;
        openControl.classList.remove('drop-up');

        var menu = openControl.querySelector('.mcp-more-menu');
        if (!menu) return;
        var listRect = settingsMcpServerList.getBoundingClientRect();
        var controlRect = openControl.getBoundingClientRect();
        var menuRect = menu.getBoundingClientRect();
        var spaceBelow = listRect.bottom - controlRect.bottom;
        var spaceAbove = controlRect.top - listRect.top;
        if (menuRect.bottom > listRect.bottom && spaceAbove > spaceBelow) {
            openControl.classList.add('drop-up');
        }
    }

    function renderServers() {
        if (!settingsMcpServerList) return;
        if (loading && !servers.length) {
            settingsMcpServerList.innerHTML = '<div class="mcp-empty-state">正在加载 MCP Servers…</div>';
            syncStatusPolling();
            return;
        }
        if (!servers.length) {
            settingsMcpServerList.innerHTML = '<div class="mcp-empty-state">尚未配置 MCP Servers</div>';
            syncStatusPolling();
            return;
        }
        settingsMcpServerList.innerHTML = servers.map(buildServerHtml).join('');
        positionOpenServerMenu();
        syncStatusPolling();
    }

    function openConfigDialog(server) {
        closeActiveDialog();
        var isEdit = !!server;
        var overlay = document.createElement('div');
        overlay.className = 'mcp-dialog-overlay';
        overlay.innerHTML =
            '<div class="mcp-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-config-dialog-title">' +
            '<div class="mcp-dialog-header">' +
            '<div>' +
            '<div class="mcp-dialog-title" id="mcp-config-dialog-title">手动配置</div>' +
            '<div class="mcp-dialog-desc">请从 MCP Servers 的介绍页面复制配置 JSON，优先使用 NPX 或 UVX 配置，并粘贴到输入框中。</div>' +
            '</div>' +
            '<button class="mcp-dialog-close" type="button" data-dialog-action="cancel" aria-label="关闭">×</button>' +
            '</div>' +
            '<div class="mcp-dialog-body">' +
            '<textarea class="mcp-config-textarea" spellcheck="false" placeholder="' + escapeAttr(MCP_EXAMPLE_JSON) + '">' + escapeHtml(isEdit ? server.configJson || '' : '') + '</textarea>' +
            '<div class="mcp-dialog-error" hidden></div>' +
            '<div class="mcp-risk-note">配置前请确认来源，甄别风险。</div>' +
            '</div>' +
            '<div class="mcp-dialog-footer">' +
            '<button class="settings-secondary-btn compact" type="button" data-dialog-action="cancel">取消</button>' +
            '<button class="settings-primary-btn compact" type="button" data-dialog-action="confirm">确认</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        activeDialog = overlay;
        var textarea = overlay.querySelector('.mcp-config-textarea');
        var errorEl = overlay.querySelector('.mcp-dialog-error');
        var confirmBtn = overlay.querySelector('[data-dialog-action="confirm"]');
        var cancelButtons = overlay.querySelectorAll('[data-dialog-action="cancel"]');

        function setDialogError(message) {
            if (!errorEl) return;
            errorEl.hidden = !message;
            errorEl.textContent = message || '';
        }

        Array.prototype.forEach.call(cancelButtons, function (button) {
            button.addEventListener('click', closeActiveDialog);
        });
        overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay) closeActiveDialog();
        });
        confirmBtn.addEventListener('click', async function () {
            setDialogError('');
            confirmBtn.disabled = true;
            confirmBtn.textContent = '检查中…';
            try {
                var url = isEdit
                    ? '/api/mcp/servers/' + encodeURIComponent(server.id)
                    : '/api/mcp/servers';
                var data = await requestJson(url, {
                    method: isEdit ? 'PUT' : 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ json: textarea.value }),
                });
                updateServers(data);
                closeActiveDialog();
                showSettingsStatus(isEdit ? 'MCP Server 已保存' : 'MCP Server 已添加');
            } catch (e) {
                setDialogError(e.message || '配置不可用');
            } finally {
                confirmBtn.disabled = false;
                confirmBtn.textContent = '确认';
            }
        });
        requestAnimationFrame(function () {
            textarea.focus();
        });
    }

    async function openLogsDialog(server) {
        closeActiveDialog();
        var overlay = document.createElement('div');
        overlay.className = 'mcp-dialog-overlay';
        overlay.innerHTML =
            '<div class="mcp-dialog mcp-log-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-log-dialog-title">' +
            '<div class="mcp-dialog-header">' +
            '<div>' +
            '<div class="mcp-dialog-title" id="mcp-log-dialog-title">查看日志</div>' +
            '<div class="mcp-dialog-desc">' + escapeHtml(server.name || server.id) + '</div>' +
            '</div>' +
            '<button class="mcp-dialog-close" type="button" data-dialog-action="cancel" aria-label="关闭">×</button>' +
            '</div>' +
            '<div class="mcp-log-content">正在读取日志…</div>' +
            '<div class="mcp-dialog-footer">' +
            '<button class="settings-secondary-btn compact" type="button" data-dialog-action="cancel">关闭</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        activeDialog = overlay;
        Array.prototype.forEach.call(overlay.querySelectorAll('[data-dialog-action="cancel"]'), function (button) {
            button.addEventListener('click', closeActiveDialog);
        });
        overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay) closeActiveDialog();
        });

        var content = overlay.querySelector('.mcp-log-content');
        try {
            var data = await requestJson('/api/mcp/servers/' + encodeURIComponent(server.id) + '/logs');
            var logs = Array.isArray(data.logs) ? data.logs : [];
            content.innerHTML = logs.length ? logs.map(buildLogHtml).join('') : '<div class="mcp-empty-state">暂无日志</div>';
        } catch (e) {
            content.innerHTML = '<div class="mcp-dialog-error">' + escapeHtml(e.message || '读取日志失败') + '</div>';
        }
    }

    function buildLogHtml(log) {
        return '<div class="mcp-log-entry mcp-log-' + escapeAttr(log.level || 'info') + '">' +
            '<span class="mcp-log-time">' + escapeHtml(formatLogTime(log.timestamp)) + '</span>' +
            '<span class="mcp-log-level">' + escapeHtml(log.level || 'info') + '</span>' +
            '<span class="mcp-log-message">' + escapeHtml(log.message || '') + '</span>' +
            '</div>';
    }

    function formatLogTime(value) {
        if (!value) return '';
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString();
    }

    function closeActiveDialog() {
        if (!activeDialog) return;
        activeDialog.remove();
        activeDialog = null;
    }

    function handleServerListClick(e) {
        var actionTarget = e.target.closest('[data-mcp-action]');
        if (!actionTarget) return;
        var item = actionTarget.closest('.mcp-server-item');
        if (!item) return;
        var serverId = item.dataset.serverId || '';
        var server = findServer(serverId);
        if (!server) return;
        var action = actionTarget.dataset.mcpAction;
        e.stopPropagation();

        if (action === 'menu') {
            setOpenMenuServerId(openMenuServerId === serverId ? '' : serverId);
        } else if (action === 'retry') {
            setOpenMenuServerId('');
            checkServer(serverId, 'MCP Server 已重新检查');
        } else if (action === 'edit') {
            setOpenMenuServerId('');
            openConfigDialog(server);
        } else if (action === 'check') {
            setOpenMenuServerId('');
            checkServer(serverId);
        } else if (action === 'logs') {
            setOpenMenuServerId('');
            openLogsDialog(server);
        } else if (action === 'delete') {
            setOpenMenuServerId('');
            deleteServer(serverId);
        }
    }

    function handleServerListChange(e) {
        var actionTarget = e.target.closest('[data-mcp-action="toggle"]');
        if (!actionTarget) return;
        var item = actionTarget.closest('.mcp-server-item');
        if (!item) return;
        var serverId = item.dataset.serverId || '';
        var enabled = actionTarget.checked;
        setOpenMenuServerId('');
        toggleServer(serverId, enabled);
    }

    function handleDocumentClick(e) {
        if (settingsMcpAddControl && !settingsMcpAddControl.contains(e.target)) {
            setAddMenuOpen(false);
        }
        if (!openMenuServerId) return;
        var openControl = settingsMcpServerList
            ? settingsMcpServerList.querySelector('.mcp-more-control.open')
            : null;
        if (!openControl || !openControl.contains(e.target)) {
            setOpenMenuServerId('');
        }
    }

    function handleEscape() {
        if (activeDialog) {
            closeActiveDialog();
            return true;
        }
        if (addMenuOpen) {
            setAddMenuOpen(false);
            if (settingsMcpAddBtn) settingsMcpAddBtn.focus();
            return true;
        }
        if (openMenuServerId) {
            setOpenMenuServerId('');
            return true;
        }
        return false;
    }

    settingsProviderSubtabs.forEach(function (item) {
        item.addEventListener('click', function () {
            setProviderSettingsTab(item.dataset.providerSettingsTab || 'config');
        });
    });

    if (settingsMcpRefreshBtn) {
        settingsMcpRefreshBtn.addEventListener('click', function () {
            fetchServers(true);
        });
    }
    if (settingsMcpAddBtn) {
        settingsMcpAddBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            setOpenMenuServerId('');
            setAddMenuOpen(!addMenuOpen);
        });
    }
    if (settingsMcpAddMenu) {
        settingsMcpAddMenu.addEventListener('click', function (e) {
            var item = e.target.closest('[data-mcp-add-mode="manual"]');
            if (!item) return;
            e.stopPropagation();
            setAddMenuOpen(false);
            openConfigDialog(null);
        });
    }
    if (settingsMcpServerList) {
        settingsMcpServerList.addEventListener('click', handleServerListClick);
        settingsMcpServerList.addEventListener('change', handleServerListChange);
    }

    renderServers();

    return {
        closeMenus: function () {
            setAddMenuOpen(false);
            setOpenMenuServerId('');
        },
        fetchServers: fetchServers,
        handleDocumentClick: handleDocumentClick,
        handleEscape: handleEscape,
        setProviderSettingsTab: setProviderSettingsTab,
    };
}
