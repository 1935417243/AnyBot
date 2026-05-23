function readStoredSet(key) {
    try {
        return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
    } catch (_) {
        return new Set();
    }
}

function saveStoredSet(key, value) {
    localStorage.setItem(key, JSON.stringify(Array.from(value)));
}

function getSessionSortTime(session) {
    return Number(session.updatedAt || session.createdAt || 0);
}

function sortSessionsByUpdatedAt(list) {
    return list.slice().sort(function (a, b) {
        var timeDiff = getSessionSortTime(b) - getSessionSortTime(a);
        if (timeDiff !== 0) return timeDiff;
        var createdDiff = Number(b.createdAt || 0) - Number(a.createdAt || 0);
        if (createdDiff !== 0) return createdDiff;
        return String(b.id || '').localeCompare(String(a.id || ''));
    });
}

function folderIcon(open) {
    return open
        ? '<svg class="project-icon" viewBox="0 0 16 16" fill="none"><path d="M1.8 5.5h12.4l-1.1 6.3c-.1.7-.7 1.2-1.5 1.2H4.1c-.7 0-1.3-.5-1.5-1.2L1.8 5.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2.4 5.5V3.6c0-.6.5-1.1 1.1-1.1h3l1.4 1.6h4.3c.6 0 1.1.5 1.1 1.1v.3" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>'
        : '<svg class="project-icon" viewBox="0 0 16 16" fill="none"><path d="M2.4 12.7V3.6c0-.6.5-1.1 1.1-1.1h3l1.4 1.6h4.6c.6 0 1.1.5 1.1 1.1v7.5H2.4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
}

function isSameLocalDate(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function formatRelativeAge(timestamp) {
    var value = Number(timestamp || Date.now());
    if (!Number.isFinite(value) || value <= 0) value = Date.now();

    var now = new Date();
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) date = now;

    var minute = 60000;
    var hour = 60 * minute;
    var day = 24 * hour;
    var diff = Math.max(0, now.getTime() - date.getTime());

    if (diff < minute) return '刚刚';
    if (diff < hour) return Math.floor(diff / minute) + '分';
    if (diff < day) return Math.floor(diff / hour) + '时';
    if (isSameLocalDate(date, now)) return '今天';

    var days = Math.floor(diff / day);
    if (days < 7) return Math.max(1, days) + '天';
    if (days < 28) return Math.floor(days / 7) + '周';
    if (days < 365) return Math.min(11, Math.max(1, Math.floor(days / 30))) + '月前';
    return '历史';
}

export function createSidebarController(config) {
    var sessions = [];
    var projects = [];
    var activeProjectId = null;
    var isProjectsCollapsed = localStorage.getItem('projectsCollapsed') === 'true';
    var isHistoryCollapsed = localStorage.getItem('historyCollapsed') === 'true';
    var expandedProjectIds = readStoredSet('expandedProjectIds');
    var expandedProjectSessionIds = new Set();
    var isHistorySessionsExpanded = false;
    var sidebarRefreshTimer = null;
    var currentSessionRefreshTimer = null;
    var realtimeEvents = null;
    var realtimeReconnectTimer = null;
    var realtimeRefreshTimer = null;
    var isSidebarRefreshInFlight = false;

    function getSessions() {
        return sessions.slice();
    }

    function getProjects() {
        return projects.slice();
    }

    function getActiveProjectId() {
        return activeProjectId;
    }

    function setActiveProjectId(projectId) {
        activeProjectId = projectId || null;
    }

    function updateProjectsCollapsedState() {
        config.sidebar.classList.toggle('projects-collapsed', isProjectsCollapsed);
        config.projectToggle.setAttribute('aria-expanded', String(!isProjectsCollapsed));
        config.projectToggle.title = isProjectsCollapsed ? '展开项目列表' : '折叠项目列表';
    }

    function toggleProjects() {
        isProjectsCollapsed = !isProjectsCollapsed;
        localStorage.setItem('projectsCollapsed', String(isProjectsCollapsed));
        updateProjectsCollapsedState();
    }

    function updateHistoryCollapsedState() {
        config.sidebar.classList.toggle('history-collapsed', isHistoryCollapsed);
        config.historyToggle.setAttribute('aria-expanded', String(!isHistoryCollapsed));
        config.historyToggle.title = isHistoryCollapsed ? '展开对话列表' : '折叠对话列表';
    }

    function toggleHistory() {
        isHistoryCollapsed = !isHistoryCollapsed;
        localStorage.setItem('historyCollapsed', String(isHistoryCollapsed));
        updateHistoryCollapsedState();
    }

    function createSourceBadge(session) {
        var effectiveSource = (session.source && session.source !== 'web') ? session.source : 'web';
        var meta = config.getChannelMeta(effectiveSource);
        var badge = document.createElement('span');
        badge.className = 'history-item-source ' + (meta ? meta.iconClass : 'default');
        badge.textContent = meta ? meta.badge : effectiveSource;
        return badge;
    }

    function createHistoryItem(session) {
        var item = document.createElement('div');
        item.className = 'history-item' + (config.getCurrentView() === 'chat' && session.id === config.getCurrentSessionId() ? ' active' : '');
        item.dataset.id = session.id;

        item.appendChild(createSourceBadge(session));

        var text = document.createElement('span');
        text.className = 'history-item-text';
        text.textContent = session.title;

        var age = document.createElement('span');
        age.className = 'history-item-age';
        age.textContent = formatRelativeAge(session.updatedAt || session.createdAt);

        var del = document.createElement('button');
        del.className = 'history-item-delete';
        del.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
        del.addEventListener('click', function (event) {
            event.stopPropagation();
            config.deleteSession(session.id);
        });

        item.appendChild(text);
        item.appendChild(age);
        item.appendChild(del);

        item.addEventListener('click', function () {
            config.loadSession(session.id, { force: true });
        });

        return item;
    }

    function renderHistory() {
        config.historyList.innerHTML = '';
        var globalSessions = sessions.filter(function (session) { return !session.projectId; });
        var sortedGlobalSessions = sortSessionsByUpdatedAt(globalSessions);
        var visibleSessions = isHistorySessionsExpanded
            ? sortedGlobalSessions
            : sortedGlobalSessions.slice(0, config.historyPreviewLimit);
        visibleSessions.forEach(function (session) {
            config.historyList.appendChild(createHistoryItem(session));
        });

        if (sortedGlobalSessions.length > config.historyPreviewLimit) {
            var moreBtn = document.createElement('button');
            moreBtn.className = 'history-sessions-more';
            moreBtn.type = 'button';
            moreBtn.setAttribute('aria-expanded', String(isHistorySessionsExpanded));
            moreBtn.textContent = isHistorySessionsExpanded
                ? '收起'
                : '查看更多 ' + (sortedGlobalSessions.length - config.historyPreviewLimit) + ' 条';
            moreBtn.addEventListener('click', function () {
                isHistorySessionsExpanded = !isHistorySessionsExpanded;
                renderHistory();
            });
            config.historyList.appendChild(moreBtn);
        }
    }

    function selectProject(projectId) {
        activeProjectId = projectId;
        expandedProjectIds.add(projectId);
        saveStoredSet('expandedProjectIds', expandedProjectIds);
        if (config.getCurrentView() !== 'chat') config.showChatView();
        renderProjects();
    }

    function renderProjectSessions(projectId) {
        var list = document.createElement('div');
        list.className = 'project-session-list';
        var projectSessions = sortSessionsByUpdatedAt(
            sessions.filter(function (session) { return session.projectId === projectId; })
        );
        if (projectSessions.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'project-empty';
            empty.textContent = '暂无对话';
            list.appendChild(empty);
            return list;
        }

        var isShowingAll = expandedProjectSessionIds.has(projectId);
        var visibleSessions = isShowingAll
            ? projectSessions
            : projectSessions.slice(0, config.projectSessionPreviewLimit);

        visibleSessions.forEach(function (session) {
            list.appendChild(createProjectSessionItem(session));
        });

        if (projectSessions.length > config.projectSessionPreviewLimit) {
            var moreBtn = document.createElement('button');
            moreBtn.className = 'project-sessions-more';
            moreBtn.type = 'button';
            moreBtn.setAttribute('aria-expanded', String(isShowingAll));
            moreBtn.textContent = isShowingAll
                ? '收起'
                : '查看更多 ' + (projectSessions.length - config.projectSessionPreviewLimit) + ' 条';
            moreBtn.addEventListener('click', function (event) {
                event.stopPropagation();
                if (isShowingAll) {
                    expandedProjectSessionIds.delete(projectId);
                } else {
                    expandedProjectSessionIds.add(projectId);
                }
                renderProjects();
            });
            list.appendChild(moreBtn);
        }

        return list;
    }

    function createProjectSessionItem(session) {
        var btn = document.createElement('div');
        btn.className = 'project-session-item' + (config.getCurrentView() === 'chat' && session.id === config.getCurrentSessionId() ? ' active' : '');
        btn.setAttribute('role', 'button');
        btn.tabIndex = 0;
        btn.dataset.id = session.id;
        btn.innerHTML =
            '<span class="project-session-source"></span>' +
            '<span class="project-session-title"></span>' +
            '<span class="project-session-age"></span>' +
            '<button class="project-session-delete" type="button" title="删除对话" aria-label="删除对话">' +
            '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
            '</button>';
        btn.replaceChild(createSourceBadge(session), btn.querySelector('.project-session-source'));
        btn.querySelector('.project-session-title').textContent = session.title;
        btn.querySelector('.project-session-age').textContent = formatRelativeAge(session.updatedAt || session.createdAt);
        btn.querySelector('.project-session-delete').addEventListener('click', function (event) {
            event.stopPropagation();
            config.deleteSession(session.id);
        });
        btn.addEventListener('click', function (event) {
            event.stopPropagation();
            config.loadSession(session.id, { force: true });
        });
        btn.addEventListener('keydown', function (event) {
            if (event.target !== btn) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            config.loadSession(session.id, { force: true });
        });
        return btn;
    }

    function renderProjects() {
        config.projectList.innerHTML = '';
        projects.forEach(function (project) {
            renderProject(project);
        });
    }

    function renderProject(project) {
        var isExpanded = expandedProjectIds.has(project.id);
        var row = document.createElement('div');
        row.className = 'project-item' + (activeProjectId === project.id ? ' active' : '');
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.dataset.id = project.id;
        row.setAttribute('aria-expanded', String(isExpanded));
        row.innerHTML =
            folderIcon(isExpanded) +
            '<span class="project-name"></span>' +
            '<button class="project-create-chat" type="button" data-tooltip="新对话" aria-label="在当前项目新建对话">' +
            '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">' +
            '<path d="M6.5 1.5v10M1.5 6.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
            '</svg>' +
            '</button>';
        row.querySelector('.project-name').textContent = project.name;
        row.addEventListener('click', function () {
            if (activeProjectId === project.id) {
                if (isExpanded) {
                    expandedProjectIds.delete(project.id);
                } else {
                    expandedProjectIds.add(project.id);
                }
                saveStoredSet('expandedProjectIds', expandedProjectIds);
                renderProjects();
                return;
            }
            selectProject(project.id);
        });
        row.addEventListener('keydown', function (event) {
            if (event.target !== row) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            row.click();
        });
        row.querySelector('.project-create-chat').addEventListener('click', function (event) {
            event.stopPropagation();
            config.createNewChat(project.id, { force: true });
        });
        config.projectList.appendChild(row);

        if (!isExpanded) return;

        var details = document.createElement('div');
        details.className = 'project-details';
        details.appendChild(renderProjectSessions(project.id));
        config.projectList.appendChild(details);
    }

    function updateSelection() {
        var isChat = config.getCurrentView() === 'chat';
        config.historyList.querySelectorAll('.history-item').forEach(function (item) {
            item.classList.toggle('active', isChat && item.dataset.id === config.getCurrentSessionId());
        });
        config.projectList.querySelectorAll('.project-item').forEach(function (item) {
            item.classList.toggle('active', isChat && item.dataset.id === activeProjectId);
        });
        config.projectList.querySelectorAll('.project-session-item').forEach(function (item) {
            item.classList.toggle('active', isChat && item.dataset.id === config.getCurrentSessionId());
        });
    }

    function revealSessionContainer(projectId) {
        if (projectId) {
            isProjectsCollapsed = false;
            localStorage.setItem('projectsCollapsed', 'false');
            expandedProjectIds.add(projectId);
            saveStoredSet('expandedProjectIds', expandedProjectIds);
            updateProjectsCollapsedState();
        } else {
            isHistoryCollapsed = false;
            localStorage.setItem('historyCollapsed', 'false');
            updateHistoryCollapsedState();
        }
    }

    function revealActiveSession() {
        if (!config.getCurrentSessionId()) return;
        var container = config.getCurrentSessionProjectId() ? config.projectList : config.historyList;
        var items = container.querySelectorAll('[data-id]');
        for (var i = 0; i < items.length; i++) {
            if (items[i].dataset.id === config.getCurrentSessionId()) {
                items[i].scrollIntoView({ block: 'nearest' });
                return;
            }
        }
    }

    function findSessionSummary(id) {
        return sessions.find(function (session) { return session.id === id; }) || null;
    }

    function ensureProjectExpanded(projectId) {
        if (!projectId || expandedProjectIds.has(projectId)) return false;
        expandedProjectIds.add(projectId);
        saveStoredSet('expandedProjectIds', expandedProjectIds);
        return true;
    }

    async function syncCurrentSessionFromSummary() {
        var currentSessionId = config.getCurrentSessionId();
        if (!currentSessionId || config.getCurrentView() !== 'chat') return;
        if (config.getIsTyping() || config.getIsLoadingOlderMessages() || config.getActiveStreamSessionId() === currentSessionId) return;
        if (config.getIsCurrentSessionSyncInFlight()) return;

        var summary = findSessionSummary(currentSessionId);
        if (!summary) return;

        var summaryUpdatedAt = Number(summary.updatedAt || 0);
        if (!summaryUpdatedAt) return;
        if (!config.getCurrentSessionUpdatedAt()) {
            config.setCurrentSessionUpdatedAt(summaryUpdatedAt);
            return;
        }
        if (summaryUpdatedAt <= config.getCurrentSessionUpdatedAt()) return;

        config.setCurrentSessionSyncInFlight(true);
        try {
            await config.loadSession(currentSessionId, { force: true, silent: true });
        } finally {
            config.setCurrentSessionSyncInFlight(false);
        }
    }

    async function pollCurrentSessionMessages() {
        var currentSessionId = config.getCurrentSessionId();
        if (!currentSessionId || config.getCurrentView() !== 'chat') return;
        if (document.hidden) return;
        if (config.getIsTyping() || config.getIsLoadingOlderMessages() || config.getActiveStreamSessionId() === currentSessionId) return;
        if (config.getIsCurrentSessionSyncInFlight()) return;

        var sessionId = currentSessionId;
        try {
            var res = await fetch('/api/sessions/' + sessionId + '?limit=1');
            if (!res.ok) return;
            var data = await res.json();
            if (config.getCurrentSessionId() !== sessionId || config.getCurrentView() !== 'chat') return;

            var incomingNewestId = config.getNewestMessageId(data.messages);
            var incomingUpdatedAt = Number(data.updatedAt || (findSessionSummary(sessionId) || {}).updatedAt || 0);
            var hasUnsubscribedStream = !!data.activeStream && config.getActiveStreamSessionId() !== sessionId;
            var hasNewMessage = incomingNewestId > config.getCurrentNewestMessageId();
            var hasNewerTimestamp = incomingUpdatedAt && config.getCurrentSessionUpdatedAt() && incomingUpdatedAt > config.getCurrentSessionUpdatedAt();

            if (hasUnsubscribedStream || hasNewMessage || hasNewerTimestamp) {
                if (config.getIsCurrentSessionSyncInFlight()) return;
                config.setCurrentSessionSyncInFlight(true);
                try {
                    await config.loadSession(sessionId, { force: true, silent: true });
                } finally {
                    config.setCurrentSessionSyncInFlight(false);
                }
                return;
            }

            if (incomingUpdatedAt) config.setCurrentSessionUpdatedAt(Math.max(config.getCurrentSessionUpdatedAt() || 0, incomingUpdatedAt));
            if (incomingNewestId) config.setCurrentNewestMessageId(Math.max(config.getCurrentNewestMessageId() || 0, incomingNewestId));
        } catch (e) {
            console.warn('Failed to sync current session messages:', e);
        }
    }

    async function fetchSessions() {
        try {
            var res = await fetch('/api/sessions');
            sessions = sortSessionsByUpdatedAt(await res.json());
            var currentSummary = config.getCurrentSessionId() ? findSessionSummary(config.getCurrentSessionId()) : null;
            if (currentSummary) config.updateConversationHeaderTitle(currentSummary.title);
            renderHistory();
            renderProjects();
            await syncCurrentSessionFromSummary();
        } catch (e) {
            console.error('Failed to fetch sessions:', e);
        }
    }

    async function fetchProjects() {
        try {
            var res = await fetch('/api/projects');
            projects = await res.json();
            config.invalidateSlashItemsData();
            renderProjects();
        } catch (e) {
            console.error('Failed to fetch projects:', e);
        }
    }

    async function refreshDirectory() {
        if (isSidebarRefreshInFlight) return;
        isSidebarRefreshInFlight = true;
        try {
            await Promise.all([fetchProjects(), fetchSessions()]);
            updateSelection();
        } finally {
            isSidebarRefreshInFlight = false;
        }
    }

    function scheduleRealtimeRefresh() {
        if (document.hidden) return;
        clearTimeout(realtimeRefreshTimer);
        realtimeRefreshTimer = setTimeout(function () {
            refreshDirectory();
        }, config.realtimeRefreshDebounceMs);
    }

    function startSidebarAutoRefresh() {
        if (sidebarRefreshTimer) clearInterval(sidebarRefreshTimer);
        sidebarRefreshTimer = setInterval(function () {
            if (document.hidden) return;
            refreshDirectory();
        }, config.sidebarRefreshIntervalMs);
    }

    function startCurrentSessionAutoRefresh() {
        if (currentSessionRefreshTimer) clearInterval(currentSessionRefreshTimer);
        currentSessionRefreshTimer = setInterval(function () {
            pollCurrentSessionMessages();
        }, config.currentSessionRefreshIntervalMs);
    }

    function stopSidebarAutoRefresh() {
        if (sidebarRefreshTimer) {
            clearInterval(sidebarRefreshTimer);
            sidebarRefreshTimer = null;
        }
    }

    function stopCurrentSessionAutoRefresh() {
        if (currentSessionRefreshTimer) {
            clearInterval(currentSessionRefreshTimer);
            currentSessionRefreshTimer = null;
        }
    }

    function startPollingFallback() {
        startSidebarAutoRefresh();
        startCurrentSessionAutoRefresh();
    }

    function stopPollingFallback() {
        stopSidebarAutoRefresh();
        stopCurrentSessionAutoRefresh();
    }

    function parseRealtimeEvent(event) {
        try {
            return JSON.parse(event.data || '{}');
        } catch (_) {
            return null;
        }
    }

    function handleRealtimeChange(event) {
        var payload = parseRealtimeEvent(event);
        if (!payload) return;
        scheduleRealtimeRefresh();
    }

    function closeRealtimeEvents() {
        if (realtimeEvents) {
            realtimeEvents.close();
            realtimeEvents = null;
        }
    }

    function scheduleRealtimeReconnect() {
        if (realtimeReconnectTimer) return;
        realtimeReconnectTimer = setTimeout(function () {
            realtimeReconnectTimer = null;
            startRealtimeEvents();
        }, config.realtimeReconnectMs);
    }

    function startRealtimeEvents() {
        if (!window.EventSource) {
            startPollingFallback();
            return;
        }
        if (realtimeEvents) return;

        var source = new EventSource('/api/events');
        realtimeEvents = source;

        source.addEventListener('ready', function () {
            stopPollingFallback();
        });
        source.addEventListener('sessions_changed', handleRealtimeChange);
        source.addEventListener('projects_changed', handleRealtimeChange);
        source.addEventListener('history_cleared', handleRealtimeChange);
        source.onerror = function () {
            closeRealtimeEvents();
            startPollingFallback();
            scheduleRealtimeReconnect();
        };
    }

    function handleVisibilityChange() {
        if (document.hidden) return;
        refreshDirectory();
        pollCurrentSessionMessages();
    }

    function disposeRealtime() {
        closeRealtimeEvents();
        if (realtimeReconnectTimer) clearTimeout(realtimeReconnectTimer);
        if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
        stopPollingFallback();
    }

    async function addProject() {
        try {
            config.addProjectBtn.disabled = true;
            var res = await fetch('/api/projects/pick', { method: 'POST' });
            var data = await res.json();
            if (!res.ok) throw new Error(data.error || '添加项目失败');
            if (data.canceled) return;
            activeProjectId = data.id;
            expandedProjectIds.add(data.id);
            saveStoredSet('expandedProjectIds', expandedProjectIds);
            await Promise.all([fetchProjects(), fetchSessions()]);
            selectProject(data.id);
        } catch (e) {
            config.showError(e.message || '添加项目失败');
        } finally {
            config.addProjectBtn.disabled = false;
        }
    }

    return {
        addProject: addProject,
        disposeRealtime: disposeRealtime,
        ensureProjectExpanded: ensureProjectExpanded,
        fetchProjects: fetchProjects,
        fetchSessions: fetchSessions,
        findSessionSummary: findSessionSummary,
        getActiveProjectId: getActiveProjectId,
        getProjects: getProjects,
        getSessions: getSessions,
        handleVisibilityChange: handleVisibilityChange,
        pollCurrentSessionMessages: pollCurrentSessionMessages,
        refreshDirectory: refreshDirectory,
        renderHistory: renderHistory,
        renderProjects: renderProjects,
        revealActiveSession: revealActiveSession,
        revealSessionContainer: revealSessionContainer,
        selectProject: selectProject,
        setActiveProjectId: setActiveProjectId,
        startRealtimeEvents: startRealtimeEvents,
        toggleHistory: toggleHistory,
        toggleProjects: toggleProjects,
        updateHistoryCollapsedState: updateHistoryCollapsedState,
        updateProjectsCollapsedState: updateProjectsCollapsedState,
        updateSelection: updateSelection,
    };
}
