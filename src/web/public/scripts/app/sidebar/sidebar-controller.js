function getSessionSortTime(session) {
    return Number(session.updatedAt || session.createdAt || 0);
}

function sortSessionsByUpdatedAt(list) {
    return list.slice().sort(function (a, b) {
        var timeDiff = getSessionSortTime(b) - getSessionSortTime(a);
        if (timeDiff !== 0) return timeDiff;
        var createdDiff = Number(b.createdAt || 0) - Number(a.createdAt || 0);
        if (createdDiff !== 0) return createdDiff;
        return String(b.id || "").localeCompare(String(a.id || ""));
    });
}

function readStoredSet(key) {
    try {
        return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch (_) {
        return new Set();
    }
}

function saveStoredSet(key, value) {
    localStorage.setItem(key, JSON.stringify(Array.from(value)));
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

function formatRelativeAge(ts) {
    var value = Number(ts || Date.now());
    if (!Number.isFinite(value) || value <= 0) value = Date.now();

    var now = new Date();
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) date = now;

    var minute = 60000;
    var hour = 60 * minute;
    var day = 24 * hour;
    var diff = Math.max(0, now.getTime() - date.getTime());

    if (diff < minute) return "刚刚";
    if (diff < hour) return Math.floor(diff / minute) + "分";
    if (diff < day) return Math.floor(diff / hour) + "时";
    if (isSameLocalDate(date, now)) return "今天";

    var days = Math.floor(diff / day);
    if (days < 7) return Math.max(1, days) + "天";
    if (days < 28) return Math.floor(days / 7) + "周";
    if (days < 365) return Math.min(11, Math.max(1, Math.floor(days / 30))) + "月前";
    return "历史";
}

export function createSidebarController(options) {
    var sidebar = options.sidebar;
    var projectToggle = options.projectToggle;
    var projectList = options.projectList;
    var addProjectBtn = options.addProjectBtn;
    var historyToggle = options.historyToggle;
    var historyList = options.historyList;
    var historySessionPreviewLimit = options.historySessionPreviewLimit;
    var projectSessionPreviewLimit = options.projectSessionPreviewLimit;
    var sidebarRefreshIntervalMs = options.sidebarRefreshIntervalMs;
    var currentSessionRefreshIntervalMs = options.currentSessionRefreshIntervalMs;
    var realtimeRefreshDebounceMs = options.realtimeRefreshDebounceMs;
    var realtimeReconnectMs = options.realtimeReconnectMs;

    var activeProjectId = null;
    var sessions = [];
    var projects = [];
    var isProjectsCollapsed = localStorage.getItem("projectsCollapsed") === "true";
    var isHistoryCollapsed = localStorage.getItem("historyCollapsed") === "true";
    var expandedProjectIds = readStoredSet("expandedProjectIds");
    var expandedProjectSessionIds = new Set();
    var isHistorySessionsExpanded = false;
    var isCurrentSessionSyncInFlight = false;
    var sidebarRefreshTimer = null;
    var currentSessionRefreshTimer = null;
    var realtimeEvents = null;
    var realtimeReconnectTimer = null;
    var realtimeRefreshTimer = null;
    var isSidebarRefreshInFlight = false;
    var isRealtimeLifecycleBound = false;
    var sidebarTooltipEl = null;
    var sidebarTooltipTarget = null;

    function ensureSidebarTooltip() {
        if (sidebarTooltipEl) return sidebarTooltipEl;
        sidebarTooltipEl = document.createElement("div");
        sidebarTooltipEl.className = "sidebar-floating-tooltip";
        sidebarTooltipEl.setAttribute("role", "tooltip");
        document.body.appendChild(sidebarTooltipEl);
        return sidebarTooltipEl;
    }

    function updateSidebarTooltipPosition() {
        if (!sidebarTooltipEl || !sidebarTooltipTarget) return;
        var targetRect = sidebarTooltipTarget.getBoundingClientRect();
        var tooltipRect = sidebarTooltipEl.getBoundingClientRect();
        var gap = 8;
        var left = targetRect.right + gap;
        var maxLeft = window.innerWidth - tooltipRect.width - gap;
        var top = targetRect.top + (targetRect.height / 2);
        var minTop = (tooltipRect.height / 2) + gap;
        var maxTop = window.innerHeight - (tooltipRect.height / 2) - gap;

        sidebarTooltipEl.style.left = Math.max(gap, Math.min(left, maxLeft)) + "px";
        sidebarTooltipEl.style.top = Math.max(minTop, Math.min(top, maxTop)) + "px";
    }

    function showSidebarTooltip(target) {
        var text = target.getAttribute("data-tooltip");
        if (!text) return;
        sidebarTooltipTarget = target;
        var tooltip = ensureSidebarTooltip();
        tooltip.textContent = text;
        updateSidebarTooltipPosition();
    }

    function hideSidebarTooltip(target) {
        if (target && sidebarTooltipTarget !== target) return;
        sidebarTooltipTarget = null;
        if (sidebarTooltipEl) {
            sidebarTooltipEl.remove();
            sidebarTooltipEl = null;
        }
    }

    function getSidebarTooltipTarget(target) {
        if (!(target instanceof Element)) return null;
        var tooltipTarget = target.closest("[data-tooltip]");
        if (!tooltipTarget || !sidebar.contains(tooltipTarget)) return null;
        return tooltipTarget;
    }

    function setupTooltips() {
        sidebar.addEventListener("mouseover", function (e) {
            var target = getSidebarTooltipTarget(e.target);
            if (!target) return;
            if (e.relatedTarget instanceof Node && target.contains(e.relatedTarget)) return;
            showSidebarTooltip(target);
        });
        sidebar.addEventListener("mouseout", function (e) {
            var target = getSidebarTooltipTarget(e.target);
            if (!target) return;
            if (e.relatedTarget instanceof Node && target.contains(e.relatedTarget)) return;
            hideSidebarTooltip(target);
        });
        sidebar.addEventListener("focusin", function (e) {
            var target = getSidebarTooltipTarget(e.target);
            if (!target) return;
            showSidebarTooltip(target);
        });
        sidebar.addEventListener("focusout", function (e) {
            var target = getSidebarTooltipTarget(e.target);
            if (!target) return;
            hideSidebarTooltip(target);
        });
        window.addEventListener("resize", updateSidebarTooltipPosition);
        document.addEventListener("scroll", updateSidebarTooltipPosition, true);
    }

    function updateProjectsCollapsedState() {
        sidebar.classList.toggle("projects-collapsed", isProjectsCollapsed);
        projectToggle.setAttribute("aria-expanded", String(!isProjectsCollapsed));
        projectToggle.title = isProjectsCollapsed ? "展开项目列表" : "折叠项目列表";
    }

    function setProjectsCollapsed(collapsed) {
        isProjectsCollapsed = !!collapsed;
        localStorage.setItem("projectsCollapsed", String(isProjectsCollapsed));
        updateProjectsCollapsedState();
    }

    function toggleProjects() {
        setProjectsCollapsed(!isProjectsCollapsed);
    }

    function updateHistoryCollapsedState() {
        sidebar.classList.toggle("history-collapsed", isHistoryCollapsed);
        historyToggle.setAttribute("aria-expanded", String(!isHistoryCollapsed));
        historyToggle.title = isHistoryCollapsed ? "展开对话列表" : "折叠对话列表";
    }

    function setHistoryCollapsed(collapsed) {
        isHistoryCollapsed = !!collapsed;
        localStorage.setItem("historyCollapsed", String(isHistoryCollapsed));
        updateHistoryCollapsedState();
    }

    function toggleHistory() {
        setHistoryCollapsed(!isHistoryCollapsed);
    }

    function createSourceBadge(session) {
        var effectiveSource = (session.source && session.source !== "web") ? session.source : "web";
        var meta = options.getChannelMeta(effectiveSource);
        var badge = document.createElement("span");
        badge.className = "history-item-source " + (meta ? meta.iconClass : "default");
        badge.textContent = meta ? (meta.badge || meta.name || effectiveSource) : effectiveSource;
        return badge;
    }

    function createHistoryItem(session) {
        var item = document.createElement("div");
        item.className = "history-item" + (options.getCurrentView() === "chat" && session.id === options.getCurrentSessionId() ? " active" : "");
        item.dataset.id = session.id;

        var badge = createSourceBadge(session);
        item.appendChild(badge);

        var text = document.createElement("span");
        text.className = "history-item-text";
        text.textContent = session.title;

        var age = document.createElement("span");
        age.className = "history-item-age";
        age.textContent = formatRelativeAge(session.updatedAt || session.createdAt);

        var del = document.createElement("button");
        del.className = "history-item-delete";
        del.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
        del.addEventListener("click", function (e) {
            e.stopPropagation();
            options.deleteSession(session.id);
        });

        item.appendChild(text);
        item.appendChild(age);
        item.appendChild(del);

        item.addEventListener("click", function () {
            options.loadSession(session.id, { force: true });
        });

        return item;
    }

    function renderHistory() {
        historyList.innerHTML = "";
        var globalSessions = sessions.filter(function (session) { return !session.projectId; });
        var sortedGlobalSessions = sortSessionsByUpdatedAt(globalSessions);
        var visibleSessions = isHistorySessionsExpanded
            ? sortedGlobalSessions
            : sortedGlobalSessions.slice(0, historySessionPreviewLimit);
        visibleSessions.forEach(function (session) {
            historyList.appendChild(createHistoryItem(session));
        });

        if (sortedGlobalSessions.length > historySessionPreviewLimit) {
            var moreBtn = document.createElement("button");
            moreBtn.className = "history-sessions-more";
            moreBtn.type = "button";
            moreBtn.setAttribute("aria-expanded", String(isHistorySessionsExpanded));
            moreBtn.textContent = isHistorySessionsExpanded
                ? "收起"
                : "查看更多 " + (sortedGlobalSessions.length - historySessionPreviewLimit) + " 条";
            moreBtn.addEventListener("click", function () {
                isHistorySessionsExpanded = !isHistorySessionsExpanded;
                renderHistory();
            });
            historyList.appendChild(moreBtn);
        }
    }

    function selectProject(projectId) {
        activeProjectId = projectId;
        expandedProjectIds.add(projectId);
        saveStoredSet("expandedProjectIds", expandedProjectIds);
        if (options.getCurrentView() !== "chat") options.showChatView();
        renderProjects();
    }

    function renderProjectSessions(projectId) {
        var list = document.createElement("div");
        list.className = "project-session-list";
        var projectSessions = sortSessionsByUpdatedAt(
            sessions.filter(function (session) { return session.projectId === projectId; })
        );
        if (projectSessions.length === 0) {
            var empty = document.createElement("div");
            empty.className = "project-empty";
            empty.textContent = "暂无对话";
            list.appendChild(empty);
            return list;
        }

        var isShowingAll = expandedProjectSessionIds.has(projectId);
        var visibleSessions = isShowingAll
            ? projectSessions
            : projectSessions.slice(0, projectSessionPreviewLimit);

        visibleSessions.forEach(function (session) {
            var btn = document.createElement("div");
            btn.className = "project-session-item" + (options.getCurrentView() === "chat" && session.id === options.getCurrentSessionId() ? " active" : "");
            btn.setAttribute("role", "button");
            btn.tabIndex = 0;
            btn.dataset.id = session.id;
            btn.innerHTML =
                '<span class="project-session-source"></span>' +
                '<span class="project-session-title"></span>' +
                '<span class="project-session-age"></span>' +
                '<button class="project-session-delete" type="button" title="删除对话" aria-label="删除对话">' +
                '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
                '</button>';
            btn.replaceChild(createSourceBadge(session), btn.querySelector(".project-session-source"));
            btn.querySelector(".project-session-title").textContent = session.title;
            btn.querySelector(".project-session-age").textContent = formatRelativeAge(session.updatedAt || session.createdAt);
            btn.querySelector(".project-session-delete").addEventListener("click", function (e) {
                e.stopPropagation();
                options.deleteSession(session.id);
            });
            btn.addEventListener("click", function (e) {
                e.stopPropagation();
                options.loadSession(session.id, { force: true });
            });
            btn.addEventListener("keydown", function (e) {
                if (e.target !== btn) return;
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                options.loadSession(session.id, { force: true });
            });
            list.appendChild(btn);
        });

        if (projectSessions.length > projectSessionPreviewLimit) {
            var moreBtn = document.createElement("button");
            moreBtn.className = "project-sessions-more";
            moreBtn.type = "button";
            moreBtn.setAttribute("aria-expanded", String(isShowingAll));
            moreBtn.textContent = isShowingAll
                ? "收起"
                : "查看更多 " + (projectSessions.length - projectSessionPreviewLimit) + " 条";
            moreBtn.addEventListener("click", function (e) {
                e.stopPropagation();
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

    function renderProjects() {
        projectList.innerHTML = "";
        projects.forEach(function (project) {
            var isExpanded = expandedProjectIds.has(project.id);
            var row = document.createElement("div");
            row.className = "project-item" + (activeProjectId === project.id ? " active" : "");
            row.setAttribute("role", "button");
            row.tabIndex = 0;
            row.dataset.id = project.id;
            row.setAttribute("aria-expanded", String(isExpanded));
            row.innerHTML =
                folderIcon(isExpanded) +
                '<span class="project-name"></span>' +
                '<button class="project-create-chat" type="button" data-tooltip="新对话" aria-label="在当前项目新建对话">' +
                '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">' +
                '<path d="M6.5 1.5v10M1.5 6.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
                '</svg>' +
                '</button>';
            row.querySelector(".project-name").textContent = project.name;
            row.addEventListener("click", function () {
                if (activeProjectId === project.id) {
                    if (isExpanded) {
                        expandedProjectIds.delete(project.id);
                    } else {
                        expandedProjectIds.add(project.id);
                    }
                    saveStoredSet("expandedProjectIds", expandedProjectIds);
                    renderProjects();
                    return;
                }
                selectProject(project.id);
            });
            row.addEventListener("keydown", function (e) {
                if (e.target !== row) return;
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                row.click();
            });
            row.querySelector(".project-create-chat").addEventListener("click", function (e) {
                e.stopPropagation();
                options.createNewChat(project.id, { force: true });
            });
            projectList.appendChild(row);

            if (!isExpanded) return;

            var details = document.createElement("div");
            details.className = "project-details";
            details.appendChild(renderProjectSessions(project.id));

            projectList.appendChild(details);
        });
    }

    function updateSelection() {
        var isChat = options.getCurrentView() === "chat";
        historyList.querySelectorAll(".history-item").forEach(function (item) {
            item.classList.toggle("active", isChat && item.dataset.id === options.getCurrentSessionId());
        });
        projectList.querySelectorAll(".project-item").forEach(function (item) {
            item.classList.toggle("active", isChat && item.dataset.id === activeProjectId);
        });
        projectList.querySelectorAll(".project-session-item").forEach(function (item) {
            item.classList.toggle("active", isChat && item.dataset.id === options.getCurrentSessionId());
        });
    }

    function expandProject(projectId) {
        if (!projectId || expandedProjectIds.has(projectId)) return false;
        expandedProjectIds.add(projectId);
        saveStoredSet("expandedProjectIds", expandedProjectIds);
        return true;
    }

    function revealSessionContainer(projectId) {
        if (projectId) {
            setProjectsCollapsed(false);
            expandProject(projectId);
        } else {
            setHistoryCollapsed(false);
        }
    }

    function revealActiveSession() {
        if (!options.getCurrentSessionId()) return;
        var container = options.getCurrentSessionProjectId() ? projectList : historyList;
        var items = container.querySelectorAll("[data-id]");
        for (var i = 0; i < items.length; i++) {
            if (items[i].dataset.id === options.getCurrentSessionId()) {
                items[i].scrollIntoView({ block: "nearest" });
                return;
            }
        }
    }

    function findSessionSummary(id) {
        return sessions.find(function (session) { return session.id === id; }) || null;
    }

    async function syncCurrentSessionFromSummary() {
        var currentSessionId = options.getCurrentSessionId();
        if (!currentSessionId || options.getCurrentView() !== "chat") return;
        if (options.getIsTyping() || options.getIsLoadingOlderMessages() || options.getActiveStreamSessionId() === currentSessionId) return;
        if (isCurrentSessionSyncInFlight) return;

        var summary = findSessionSummary(currentSessionId);
        if (!summary) return;

        var summaryUpdatedAt = Number(summary.updatedAt || 0);
        if (!summaryUpdatedAt) return;
        if (!options.getCurrentSessionUpdatedAt()) {
            options.setCurrentSessionUpdatedAt(summaryUpdatedAt);
            return;
        }
        if (summaryUpdatedAt <= options.getCurrentSessionUpdatedAt()) return;

        isCurrentSessionSyncInFlight = true;
        try {
            await options.loadSession(currentSessionId, { force: true, silent: true });
        } finally {
            isCurrentSessionSyncInFlight = false;
        }
    }

    async function pollCurrentSessionMessages() {
        var currentSessionId = options.getCurrentSessionId();
        if (!currentSessionId || options.getCurrentView() !== "chat") return;
        if (document.hidden) return;
        if (options.getIsTyping() || options.getIsLoadingOlderMessages() || options.getActiveStreamSessionId() === currentSessionId) return;
        var sessionId = currentSessionId;

        if (isCurrentSessionSyncInFlight) return;
        try {
            var res = await fetch("/api/sessions/" + sessionId + "?limit=1");
            if (!res.ok) return;
            var data = await res.json();
            if (options.getCurrentSessionId() !== sessionId || options.getCurrentView() !== "chat") return;

            var incomingNewestId = options.getNewestMessageId(data.messages);
            var incomingUpdatedAt = Number(data.updatedAt || findSessionSummary(sessionId)?.updatedAt || 0);
            var hasUnsubscribedStream = !!data.activeStream && options.getActiveStreamSessionId() !== sessionId;
            var hasNewMessage = incomingNewestId > options.getCurrentNewestMessageId();
            var hasNewerTimestamp = incomingUpdatedAt && options.getCurrentSessionUpdatedAt() && incomingUpdatedAt > options.getCurrentSessionUpdatedAt();

            if (hasUnsubscribedStream || hasNewMessage || hasNewerTimestamp) {
                if (isCurrentSessionSyncInFlight) return;
                isCurrentSessionSyncInFlight = true;
                try {
                    await options.loadSession(sessionId, { force: true, silent: true });
                } finally {
                    isCurrentSessionSyncInFlight = false;
                }
                return;
            }

            if (incomingUpdatedAt) {
                options.setCurrentSessionUpdatedAt(Math.max(options.getCurrentSessionUpdatedAt() || 0, incomingUpdatedAt));
            }
            if (incomingNewestId) {
                options.setCurrentNewestMessageId(Math.max(options.getCurrentNewestMessageId() || 0, incomingNewestId));
            }
        } catch (e) {
            console.warn("Failed to sync current session messages:", e);
        }
    }

    async function fetchSessions() {
        try {
            var res = await fetch("/api/sessions");
            sessions = sortSessionsByUpdatedAt(await res.json());
            var currentSessionId = options.getCurrentSessionId();
            var currentSummary = currentSessionId ? findSessionSummary(currentSessionId) : null;
            if (currentSummary) options.updateConversationHeaderTitle(currentSummary.title);
            renderHistory();
            renderProjects();
            await syncCurrentSessionFromSummary();
        } catch (e) {
            console.error("Failed to fetch sessions:", e);
        }
    }

    async function fetchProjects() {
        try {
            var res = await fetch("/api/projects");
            projects = await res.json();
            options.invalidateSlashItemsData();
            renderProjects();
        } catch (e) {
            console.error("Failed to fetch projects:", e);
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
        }, realtimeRefreshDebounceMs);
    }

    function startSidebarAutoRefresh() {
        if (sidebarRefreshTimer) clearInterval(sidebarRefreshTimer);
        sidebarRefreshTimer = setInterval(function () {
            if (document.hidden) return;
            refreshDirectory();
        }, sidebarRefreshIntervalMs);
    }

    function startCurrentSessionAutoRefresh() {
        if (currentSessionRefreshTimer) clearInterval(currentSessionRefreshTimer);
        currentSessionRefreshTimer = setInterval(function () {
            pollCurrentSessionMessages();
        }, currentSessionRefreshIntervalMs);
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
            return JSON.parse(event.data || "{}");
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
        }, realtimeReconnectMs);
    }

    function startRealtimeEvents() {
        if (!window.EventSource) {
            startPollingFallback();
            return;
        }
        if (realtimeEvents) return;

        var source = new EventSource("/api/events");
        realtimeEvents = source;

        source.addEventListener("ready", function () {
            stopPollingFallback();
        });
        source.addEventListener("sessions_changed", handleRealtimeChange);
        source.addEventListener("projects_changed", handleRealtimeChange);
        source.addEventListener("history_cleared", handleRealtimeChange);
        source.onerror = function () {
            closeRealtimeEvents();
            startPollingFallback();
            scheduleRealtimeReconnect();
        };
    }

    function stopRealtimeEvents() {
        closeRealtimeEvents();
        if (realtimeReconnectTimer) clearTimeout(realtimeReconnectTimer);
        if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
        realtimeReconnectTimer = null;
        realtimeRefreshTimer = null;
        stopPollingFallback();
    }

    function bindRealtimeLifecycle() {
        if (isRealtimeLifecycleBound) return;
        isRealtimeLifecycleBound = true;
        document.addEventListener("visibilitychange", function () {
            if (document.hidden) return;
            refreshDirectory();
            pollCurrentSessionMessages();
        });

        window.addEventListener("beforeunload", function () {
            stopRealtimeEvents();
        });
    }

    async function addProject() {
        try {
            if (addProjectBtn) addProjectBtn.disabled = true;
            var res = await fetch("/api/projects/pick", { method: "POST" });
            var data = await res.json();
            if (!res.ok) throw new Error(data.error || "添加项目失败");
            if (data.canceled) return;
            activeProjectId = data.id;
            expandProject(data.id);
            await Promise.all([fetchProjects(), fetchSessions()]);
            selectProject(data.id);
        } catch (e) {
            options.showError(e.message || "添加项目失败");
        } finally {
            if (addProjectBtn) addProjectBtn.disabled = false;
        }
    }

    return {
        addProject: addProject,
        bindRealtimeLifecycle: bindRealtimeLifecycle,
        expandProject: expandProject,
        fetchProjects: fetchProjects,
        fetchSessions: fetchSessions,
        findSessionSummary: findSessionSummary,
        getActiveProjectId: function () {
            return activeProjectId;
        },
        getProjects: function () {
            return projects;
        },
        getSessions: function () {
            return sessions;
        },
        pollCurrentSessionMessages: pollCurrentSessionMessages,
        refreshDirectory: refreshDirectory,
        renderHistory: renderHistory,
        renderProjects: renderProjects,
        revealActiveSession: revealActiveSession,
        revealSessionContainer: revealSessionContainer,
        selectProject: selectProject,
        setActiveProjectId: function (projectId) {
            activeProjectId = projectId || null;
        },
        setHistoryCollapsed: setHistoryCollapsed,
        setProjectsCollapsed: setProjectsCollapsed,
        setupTooltips: setupTooltips,
        startRealtimeEvents: startRealtimeEvents,
        stopRealtimeEvents: stopRealtimeEvents,
        syncCurrentSessionFromSummary: syncCurrentSessionFromSummary,
        toggleHistory: toggleHistory,
        toggleProjects: toggleProjects,
        updateHistoryCollapsedState: updateHistoryCollapsedState,
        updateProjectsCollapsedState: updateProjectsCollapsedState,
        updateSelection: updateSelection,
    };
}
