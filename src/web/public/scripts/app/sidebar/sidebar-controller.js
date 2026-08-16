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
    var sessionPageSize = options.sessionPageSize || 40;

    var activeProjectId = null;
    var sessions = [];
    var projects = [];
    var allSessionsPage = createSessionPageState();
    var globalSessionPage = createSessionPageState();
    var projectSessionPages = new Map();
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
    var addProjectMenuEl = null;
    var addProjectMenuCleanup = null;
    var cloneProjectOverlayEl = null;

    function createSessionPageState() {
        return {
            cursor: null,
            hasMore: true,
            initialized: false,
            isLoading: false,
        };
    }

    function resetSessionPageState(page) {
        page.cursor = null;
        page.hasMore = true;
        page.initialized = false;
        page.isLoading = false;
    }

    function getProjectSessionPage(projectId) {
        if (!projectSessionPages.has(projectId)) {
            projectSessionPages.set(projectId, createSessionPageState());
        }
        return projectSessionPages.get(projectId);
    }

    function mergeSessions(items) {
        var byId = new Map();
        sessions.forEach(function (session) {
            byId.set(session.id, session);
        });
        items.forEach(function (session) {
            byId.set(session.id, session);
        });
        sessions = sortSessionsByUpdatedAt(Array.from(byId.values()));
    }

    function removeSessionSummary(id) {
        if (!id) return;
        sessions = sessions.filter(function (session) { return session.id !== id; });
        renderHistory();
        renderProjects();
        updateSelection();
    }

    async function fetchSessionPage(params) {
        var query = new URLSearchParams();
        query.set("limit", String(sessionPageSize));
        if (params.cursor) query.set("cursor", params.cursor);
        if (params.scope) query.set("scope", params.scope);
        if (params.projectId) query.set("projectId", params.projectId);

        var res = await fetch("/api/sessions?" + query.toString());
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || "加载会话失败");
        if (Array.isArray(data)) {
            return {
                items: data,
                hasMore: false,
                nextCursor: null,
            };
        }
        return data;
    }

    async function loadSessionPage(page, params) {
        if (page.isLoading) return;
        if (params.append && !page.hasMore) return;

        page.isLoading = true;
        try {
            var data = await fetchSessionPage({
                scope: params.scope || "",
                projectId: params.projectId || "",
                cursor: params.append ? page.cursor : "",
            });
            mergeSessions(data.items || []);
            page.cursor = data.nextCursor || null;
            page.hasMore = !!data.hasMore;
            page.initialized = true;
        } finally {
            page.isLoading = false;
        }
    }

    function loadAllSessionsPage(append) {
        return loadSessionPage(allSessionsPage, { append: !!append });
    }

    function loadGlobalSessionsPage(append) {
        return loadSessionPage(globalSessionPage, { append: !!append, scope: "global" });
    }

    async function loadProjectSessionsPage(projectId, append) {
        var page = getProjectSessionPage(projectId);
        await loadSessionPage(page, { append: !!append, projectId: projectId });
    }

    function ensureProjectSessionsLoaded(projectId) {
        var page = getProjectSessionPage(projectId);
        if (page.initialized || page.isLoading) return;
        page.isLoading = true;
        renderProjects();
        page.isLoading = false;
        loadProjectSessionsPage(projectId, false).then(function () {
            renderProjects();
            updateSelection();
        }).catch(function (e) {
            console.error("Failed to fetch project sessions:", e);
        });
    }

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

        if (sortedGlobalSessions.length > historySessionPreviewLimit || globalSessionPage.hasMore || isHistorySessionsExpanded) {
            var moreBtn = document.createElement("button");
            moreBtn.className = "history-sessions-more";
            moreBtn.type = "button";
            moreBtn.setAttribute("aria-expanded", String(isHistorySessionsExpanded));
            moreBtn.disabled = globalSessionPage.isLoading;
            moreBtn.textContent = globalSessionPage.isLoading
                ? "加载中..."
                : isHistorySessionsExpanded
                    ? (globalSessionPage.hasMore ? "继续加载" : "收起")
                    : "查看更多";
            moreBtn.addEventListener("click", async function () {
                if (!isHistorySessionsExpanded) {
                    isHistorySessionsExpanded = true;
                    renderHistory();
                    return;
                }
                if (globalSessionPage.hasMore) {
                    await loadGlobalSessionsPage(true);
                } else {
                    isHistorySessionsExpanded = false;
                }
                renderHistory();
                await syncCurrentSessionFromSummary();
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
        ensureProjectSessionsLoaded(projectId);
    }

    function toggleProject(projectId) {
        var shouldExpand = !expandedProjectIds.has(projectId);
        activeProjectId = projectId;
        if (shouldExpand) {
            expandedProjectIds.add(projectId);
        } else {
            expandedProjectIds.delete(projectId);
        }
        saveStoredSet("expandedProjectIds", expandedProjectIds);
        if (options.getCurrentView() !== "chat") options.showChatView();
        renderProjects();
        if (shouldExpand) ensureProjectSessionsLoaded(projectId);
    }

    function closeAddProjectMenu() {
        if (addProjectMenuCleanup) addProjectMenuCleanup();
        addProjectMenuCleanup = null;
        if (addProjectMenuEl) {
            addProjectMenuEl.remove();
            addProjectMenuEl = null;
        }
        if (addProjectBtn) addProjectBtn.setAttribute("aria-expanded", "false");
    }

    function positionAddProjectMenu() {
        if (!addProjectMenuEl || !addProjectBtn) return;
        var rect = addProjectBtn.getBoundingClientRect();
        var width = 184;
        var left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
        addProjectMenuEl.style.left = left + "px";
        addProjectMenuEl.style.top = (rect.bottom + 6) + "px";
    }

    function createAddProjectMenuItem(label, detail, iconHtml) {
        var button = document.createElement("button");
        button.className = "project-add-menu-item";
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.innerHTML =
            '<span class="project-add-menu-icon">' + iconHtml + '</span>' +
            '<span class="project-add-menu-text">' +
            '<span class="project-add-menu-title">' + label + '</span>' +
            '<span class="project-add-menu-detail">' + detail + '</span>' +
            '</span>';
        return button;
    }

    function openAddProjectMenu() {
        if (!addProjectBtn) return;
        closeAddProjectMenu();

        var menu = document.createElement("div");
        menu.className = "project-add-menu";
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", "添加项目方式");

        var folderItem = createAddProjectMenuItem(
            "选择本地文件夹",
            "添加已有目录",
            '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.2 12.7V3.6c0-.6.5-1.1 1.1-1.1h3l1.3 1.5h5c.6 0 1.1.5 1.1 1.1v7.6H2.2Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
        );
        var gitItem = createAddProjectMenuItem(
            "从 Git 地址克隆",
            "下载远程仓库",
            '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v7.4M5.4 6.8 8 9.4l2.6-2.6" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11.5v1.2c0 .5.4.9.9.9h8.2c.5 0 .9-.4.9-.9v-1.2" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>'
        );

        folderItem.addEventListener("click", function () {
            closeAddProjectMenu();
            addLocalProject();
        });
        gitItem.addEventListener("click", function () {
            closeAddProjectMenu();
            openCloneProjectDialog();
        });

        menu.appendChild(folderItem);
        menu.appendChild(gitItem);
        document.body.appendChild(menu);
        addProjectMenuEl = menu;
        addProjectBtn.setAttribute("aria-expanded", "true");
        positionAddProjectMenu();
        requestAnimationFrame(function () {
            menu.classList.add("open");
        });

        function onDocumentClick(e) {
            if (!addProjectMenuEl) return;
            if (addProjectMenuEl.contains(e.target)) return;
            if (addProjectBtn && (e.target === addProjectBtn || addProjectBtn.contains(e.target))) return;
            closeAddProjectMenu();
        }

        function onKeydown(e) {
            if (e.key === "Escape") closeAddProjectMenu();
        }

        function onResize() {
            positionAddProjectMenu();
        }

        document.addEventListener("click", onDocumentClick);
        document.addEventListener("keydown", onKeydown);
        window.addEventListener("resize", onResize);
        addProjectMenuCleanup = function () {
            document.removeEventListener("click", onDocumentClick);
            document.removeEventListener("keydown", onKeydown);
            window.removeEventListener("resize", onResize);
        };
    }

    function isHttpsGitUrl(value) {
        return /^https:\/\//i.test(String(value || "").trim());
    }

    function getHttpsGitHost(value) {
        var text = String(value || "").trim();
        if (!isHttpsGitUrl(text)) return "";
        try {
            return new URL(text).host.toLowerCase();
        } catch (_) {
            return "";
        }
    }

    function isSshGitUrl(value) {
        var text = String(value || "").trim();
        return /^ssh:\/\//i.test(text) || /^[^@\s]+@[^:\s]+:.+/.test(text);
    }

    function isSupportedGitUrl(value) {
        return isHttpsGitUrl(value) || isSshGitUrl(value);
    }

    function inferGitProjectName(value) {
        var text = String(value || "").trim();
        if (!text) return "";
        try {
            if (/^https:\/\//i.test(text) || /^ssh:\/\//i.test(text)) {
                var parsed = new URL(text);
                text = parsed.pathname || text;
            } else if (isSshGitUrl(text)) {
                text = text.slice(text.indexOf(":") + 1);
            }
        } catch (_) {}
        text = text.split("?")[0].split("#")[0].replace(/[\\/]+$/, "");
        var name = text.split(/[\\/]/).pop() || "";
        if (/\.git$/i.test(name)) name = name.slice(0, -4);
        try {
            name = decodeURIComponent(name);
        } catch (_) {}
        return name;
    }

    function readJsonResponse(res) {
        return res.json().catch(function () {
            return {};
        });
    }

    function closeCloneProjectDialog() {
        var overlay = cloneProjectOverlayEl;
        if (!overlay) return;
        document.removeEventListener("keydown", overlay._projectCloneKeydown);
        cloneProjectOverlayEl = null;
        overlay.classList.remove("open");
        setTimeout(function () {
            overlay.remove();
        }, 160);
    }

    function openCloneProjectDialog() {
        if (cloneProjectOverlayEl) closeCloneProjectDialog();

        var overlay = document.createElement("div");
        overlay.className = "project-clone-overlay";
        overlay.innerHTML =
            '<form class="project-clone-dialog" role="dialog" aria-modal="true" aria-labelledby="project-clone-title">' +
            '<div class="project-clone-header">' +
            '<div>' +
            '<div class="project-clone-title" id="project-clone-title">从 Git 地址克隆</div>' +
            '<div class="project-clone-subtitle">克隆完成后会自动添加为项目。</div>' +
            '</div>' +
            '<button class="project-clone-close" type="button" data-action="close" aria-label="关闭">×</button>' +
            '</div>' +
            '<div class="project-clone-body">' +
            '<label class="project-clone-field">' +
            '<span>Git 地址</span>' +
            '<input class="project-clone-input" data-field="url" autocomplete="off" spellcheck="false" placeholder="https://github.com/org/repo.git">' +
            '</label>' +
            '<label class="project-clone-field">' +
            '<span>保存目录</span>' +
            '<div class="project-clone-path-row">' +
            '<input class="project-clone-input" data-field="parentPath" readonly placeholder="请选择保存目录">' +
            '<button class="project-clone-secondary compact" type="button" data-action="pick-directory">选择目录</button>' +
            '</div>' +
            '</label>' +
            '<label class="project-clone-field">' +
            '<span>项目名</span>' +
            '<input class="project-clone-input" data-field="projectName" autocomplete="off" spellcheck="false" placeholder="repo">' +
            '</label>' +
            '<div class="project-clone-auth" hidden>' +
            '<label class="project-clone-field">' +
            '<span>用户名（可选）</span>' +
            '<input class="project-clone-input" data-field="username" autocomplete="username" spellcheck="false" placeholder="可不填">' +
            '</label>' +
            '<label class="project-clone-field">' +
            '<span>密码</span>' +
            '<input class="project-clone-input" data-field="password" type="password" autocomplete="current-password" spellcheck="false" placeholder="输入密码">' +
            '</label>' +
            '</div>' +
            '<div class="project-clone-progress" data-field="progress" hidden>' +
            '<div class="project-clone-progress-track" data-field="progressTrack" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="1">' +
            '<div class="project-clone-progress-bar" data-field="progressBar"></div>' +
            '<div class="project-clone-progress-text" data-field="progressText">连接仓库 1%</div>' +
            '</div>' +
            '</div>' +
            '<div class="project-clone-error" data-field="error" hidden></div>' +
            '</div>' +
            '<div class="project-clone-actions">' +
            '<button class="project-clone-secondary" type="button" data-action="cancel">取消</button>' +
            '<button class="project-clone-primary" type="submit" data-action="submit" disabled>克隆并添加</button>' +
            '</div>' +
            '</form>';

        var form = overlay.querySelector(".project-clone-dialog");
        var urlInput = overlay.querySelector('[data-field="url"]');
        var parentInput = overlay.querySelector('[data-field="parentPath"]');
        var projectNameInput = overlay.querySelector('[data-field="projectName"]');
        var usernameInput = overlay.querySelector('[data-field="username"]');
        var passwordInput = overlay.querySelector('[data-field="password"]');
        var authSection = overlay.querySelector(".project-clone-auth");
        var progressEl = overlay.querySelector('[data-field="progress"]');
        var progressTrackEl = overlay.querySelector('[data-field="progressTrack"]');
        var progressBarEl = overlay.querySelector('[data-field="progressBar"]');
        var progressTextEl = overlay.querySelector('[data-field="progressText"]');
        var errorEl = overlay.querySelector('[data-field="error"]');
        var pickDirectoryBtn = overlay.querySelector('[data-action="pick-directory"]');
        var submitBtn = overlay.querySelector('[data-action="submit"]');
        var cancelBtn = overlay.querySelector('[data-action="cancel"]');
        var closeBtn = overlay.querySelector('[data-action="close"]');
        var projectNameTouched = false;
        var parentPathTouched = false;
        var savedCredential = null;
        var currentCredentialHost = "";
        var credentialLookupId = 0;
        var isSubmitting = false;

        function values() {
            return {
                url: urlInput.value.trim(),
                parentPath: parentInput.value.trim(),
                projectName: projectNameInput.value.trim(),
                username: usernameInput.value.trim(),
                password: passwordInput.value,
            };
        }

        function setCloneError(message) {
            errorEl.textContent = message || "";
            errorEl.hidden = !message;
        }

        function getProjectNameError(projectName) {
            if (!projectName) return "请输入项目名";
            if (projectName === "." || projectName === ".." || /[\\/]/.test(projectName)) return "项目名不能包含路径分隔符";
            return "";
        }

        function hasSavedPasswordForCurrentHost(current) {
            var host = getHttpsGitHost(current.url);
            return !!(
                savedCredential &&
                savedCredential.host === host &&
                savedCredential.hasPassword &&
                current.username &&
                current.username === savedCredential.username
            );
        }

        function updateCloneDialogState() {
            var current = values();
            var hasUrl = !!current.url;
            var isHttps = isHttpsGitUrl(current.url);
            var isSsh = isSshGitUrl(current.url);
            var isSupported = isHttps || isSsh;
            var credentialsDisabled = isSubmitting || (hasUrl && !isHttps);
            var projectNameError = getProjectNameError(current.projectName);
            var credentialsComplete = !isHttps ||
                (!current.username && !current.password) ||
                (current.username && current.password) ||
                (!current.username && current.password) ||
                (current.username && !current.password && hasSavedPasswordForCurrentHost(current));

            urlInput.disabled = isSubmitting;
            parentInput.disabled = true;
            projectNameInput.disabled = isSubmitting;
            usernameInput.disabled = credentialsDisabled;
            passwordInput.disabled = credentialsDisabled;
            pickDirectoryBtn.disabled = isSubmitting;
            cancelBtn.disabled = isSubmitting;
            closeBtn.disabled = isSubmitting;
            authSection.hidden = !isHttps;
            progressEl.hidden = !isSubmitting;
            submitBtn.disabled = isSubmitting || !current.url || !isSupported || !current.parentPath || !!projectNameError || !credentialsComplete;
        }

        async function loadSavedCredentialForUrl(url) {
            var host = getHttpsGitHost(url);
            credentialLookupId += 1;
            var requestId = credentialLookupId;

            if (host !== currentCredentialHost) {
                currentCredentialHost = host;
                savedCredential = null;
                usernameInput.value = "";
                passwordInput.value = "";
            }

            if (!host) {
                updateCloneDialogState();
                return;
            }

            try {
                var res = await fetch("/api/projects/git-credential?url=" + encodeURIComponent(url));
                var data = await readJsonResponse(res);
                if (requestId !== credentialLookupId || host !== currentCredentialHost) return;
                if (!res.ok || !data.found || data.host !== host) {
                    savedCredential = null;
                    updateCloneDialogState();
                    return;
                }
                savedCredential = {
                    host: data.host,
                    username: data.username || "",
                    hasPassword: !!data.hasPassword,
                };
                if (savedCredential.username) usernameInput.value = savedCredential.username;
                passwordInput.value = data.password || "";
                updateCloneDialogState();
            } catch (_) {
                if (requestId !== credentialLookupId) return;
                savedCredential = null;
                updateCloneDialogState();
            }
        }

        async function loadDefaultSaveDirectory() {
            try {
                var res = await fetch("/api/projects/default-save-directory");
                var data = await readJsonResponse(res);
                if (!res.ok || parentPathTouched || !data.path) return;
                parentInput.value = data.path;
                updateCloneDialogState();
            } catch (_) {}
        }

        function setCloneLoading(loading) {
            isSubmitting = loading;
            submitBtn.textContent = loading ? "克隆中..." : "克隆并添加";
            if (loading) setCloneProgress(1, "连接仓库");
            updateCloneDialogState();
        }

        function setCloneProgress(percent, message) {
            var value = Math.max(1, Math.min(100, Math.round(Number(percent) || 1)));
            var label = String(message || "克隆中").trim() || "克隆中";
            progressBarEl.style.width = value + "%";
            progressTrackEl.setAttribute("aria-valuenow", String(value));
            progressTextEl.textContent = label + " " + value + "%";
        }

        function handleCloneStreamEvent(event) {
            if (!event || typeof event !== "object") return null;
            if (event.type === "progress") {
                setCloneProgress(event.percent, event.message);
                return null;
            }
            if (event.type === "done") {
                setCloneProgress(100, "完成");
                return event.project || null;
            }
            if (event.type === "error") {
                throw new Error(event.error || "克隆项目失败");
            }
            return null;
        }

        async function cloneProjectWithProgress(payload) {
            var res = await fetch("/api/projects/clone/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                var data = await readJsonResponse(res);
                throw new Error(data.error || "克隆项目失败");
            }
            if (!res.body || !window.TextDecoder) {
                var fallbackData = await readJsonResponse(res);
                if (fallbackData.error) throw new Error(fallbackData.error);
                return fallbackData.project || fallbackData;
            }

            var reader = res.body.getReader();
            var decoder = new TextDecoder("utf-8");
            var buffer = "";
            var project = null;

            while (true) {
                var result = await reader.read();
                if (result.done) break;
                buffer += decoder.decode(result.value, { stream: true });
                var lines = buffer.split("\n");
                buffer = lines.pop() || "";
                lines.forEach(function (line) {
                    var text = line.trim();
                    if (!text) return;
                    var event = JSON.parse(text);
                    var eventProject = handleCloneStreamEvent(event);
                    if (eventProject) project = eventProject;
                });
            }

            buffer += decoder.decode();
            if (buffer.trim()) {
                var event = JSON.parse(buffer.trim());
                var eventProject = handleCloneStreamEvent(event);
                if (eventProject) project = eventProject;
            }

            if (!project) throw new Error("克隆项目失败");
            return project;
        }

        urlInput.addEventListener("input", function () {
            if (!projectNameTouched) {
                var inferred = inferGitProjectName(urlInput.value);
                if (inferred) projectNameInput.value = inferred;
            }
            setCloneError("");
            loadSavedCredentialForUrl(urlInput.value);
            updateCloneDialogState();
        });

        projectNameInput.addEventListener("input", function () {
            projectNameTouched = true;
            setCloneError("");
            updateCloneDialogState();
        });

        usernameInput.addEventListener("input", function () {
            setCloneError("");
            updateCloneDialogState();
        });

        passwordInput.addEventListener("input", function () {
            setCloneError("");
            updateCloneDialogState();
        });

        pickDirectoryBtn.addEventListener("click", async function () {
            setCloneError("");
            pickDirectoryBtn.disabled = true;
            try {
                var res = await fetch("/api/projects/pick-save-directory", { method: "POST" });
                var data = await readJsonResponse(res);
                if (!res.ok) throw new Error(data.error || "选择保存目录失败");
                if (!data.canceled) {
                    parentPathTouched = true;
                    parentInput.value = data.path || "";
                }
            } catch (e) {
                setCloneError(e.message || "选择保存目录失败");
            } finally {
                updateCloneDialogState();
            }
        });

        form.addEventListener("submit", async function (e) {
            e.preventDefault();
            var current = values();
            var projectNameError = getProjectNameError(current.projectName);
            if (!current.url) {
                setCloneError("请输入 Git 地址");
                return;
            }
            if (!current.parentPath) {
                setCloneError("请选择保存目录");
                return;
            }
            if (projectNameError) {
                setCloneError(projectNameError);
                return;
            }
            if (current.username && !current.password && !hasSavedPasswordForCurrentHost(current)) {
                setCloneError("请输入密码");
                return;
            }

            setCloneError("");
            setCloneLoading(true);
            try {
                var payload = {
                    url: current.url,
                    parentPath: current.parentPath,
                    projectName: current.projectName,
                };
                if (isHttpsGitUrl(current.url) && (current.username || current.password)) {
                    if (current.username) payload.username = current.username;
                    if (current.password) payload.password = current.password;
                }
                var data = await cloneProjectWithProgress(payload);
                closeCloneProjectDialog();
                activeProjectId = data.id;
                expandProject(data.id);
                await Promise.all([fetchProjects(), fetchSessions()]);
                selectProject(data.id);
            } catch (error) {
                setCloneError(error.message || "克隆项目失败");
            } finally {
                if (cloneProjectOverlayEl) setCloneLoading(false);
            }
        });

        function requestClose() {
            if (isSubmitting) return;
            closeCloneProjectDialog();
        }

        cancelBtn.addEventListener("click", requestClose);
        closeBtn.addEventListener("click", requestClose);
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) requestClose();
        });

        overlay._projectCloneKeydown = function (e) {
            if (e.key === "Escape") requestClose();
        };
        document.addEventListener("keydown", overlay._projectCloneKeydown);
        document.body.appendChild(overlay);
        cloneProjectOverlayEl = overlay;
        updateCloneDialogState();
        loadDefaultSaveDirectory();
        requestAnimationFrame(function () {
            overlay.classList.add("open");
        });
        setTimeout(function () {
            urlInput.focus();
        }, 0);
    }

    function confirmProjectDelete(project) {
        return new Promise(function (resolve) {
            var existing = document.getElementById("project-delete-confirm-overlay");
            if (existing) existing.remove();

            var overlay = document.createElement("div");
            overlay.className = "project-delete-confirm-overlay";
            overlay.id = "project-delete-confirm-overlay";

            var dialog = document.createElement("div");
            dialog.className = "project-delete-confirm-dialog";
            dialog.setAttribute("role", "dialog");
            dialog.setAttribute("aria-modal", "true");
            dialog.setAttribute("aria-labelledby", "project-delete-confirm-title");

            var header = document.createElement("div");
            header.className = "project-delete-confirm-header";

            var icon = document.createElement("div");
            icon.className = "project-delete-confirm-icon";
            icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M9 6.6v3.6M9 12.6h.01M3.4 14.4h11.2L9 3.6 3.4 14.4Z" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>';

            var title = document.createElement("div");
            title.className = "project-delete-confirm-title";
            title.id = "project-delete-confirm-title";
            title.textContent = "删除项目";

            header.appendChild(icon);
            header.appendChild(title);

            var message = document.createElement("p");
            message.className = "project-delete-confirm-message";
            message.textContent = "将从 AnyBot 移除“" + project.name + "”，并删除该项目内所有对话。";

            var actions = document.createElement("div");
            actions.className = "project-delete-confirm-actions";

            var cancelBtn = document.createElement("button");
            cancelBtn.className = "project-delete-confirm-cancel";
            cancelBtn.type = "button";
            cancelBtn.textContent = "取消";

            var confirmBtn = document.createElement("button");
            confirmBtn.className = "project-delete-confirm-danger";
            confirmBtn.type = "button";
            confirmBtn.textContent = "删除项目";

            actions.appendChild(cancelBtn);
            actions.appendChild(confirmBtn);

            dialog.appendChild(header);
            dialog.appendChild(message);
            dialog.appendChild(actions);
            overlay.appendChild(dialog);

            var closed = false;
            function close(result) {
                if (closed) return;
                closed = true;
                document.removeEventListener("keydown", onKeydown);
                overlay.classList.remove("open");
                setTimeout(function () {
                    overlay.remove();
                }, 160);
                resolve(result);
            }

            function onKeydown(e) {
                if (e.key === "Escape") close(false);
            }

            overlay.addEventListener("click", function (e) {
                if (e.target === overlay) close(false);
            });
            cancelBtn.addEventListener("click", function () {
                close(false);
            });
            confirmBtn.addEventListener("click", function () {
                close(true);
            });
            document.addEventListener("keydown", onKeydown);
            document.body.appendChild(overlay);
            requestAnimationFrame(function () {
                overlay.classList.add("open");
            });
            setTimeout(function () {
                cancelBtn.focus();
            }, 0);
        });
    }

    async function deleteProject(project) {
        if (!project || !project.id) return;
        var confirmed = await confirmProjectDelete(project);
        if (!confirmed) return;

        var currentSessionId = options.getCurrentSessionId();
        var isCurrentProjectSession = currentSessionId && options.getCurrentSessionProjectId() === project.id;

        try {
            var res = await fetch("/api/projects/" + encodeURIComponent(project.id), { method: "DELETE" });
            if (!res.ok) {
                var errData = null;
                try { errData = await res.json(); } catch (parseErr) {}
                throw new Error((errData && errData.error) || "删除项目失败");
            }

            if (activeProjectId === project.id) activeProjectId = null;
            expandedProjectIds.delete(project.id);
            expandedProjectSessionIds.delete(project.id);
            projectSessionPages.delete(project.id);
            saveStoredSet("expandedProjectIds", expandedProjectIds);
            projects = projects.filter(function (item) { return item.id !== project.id; });
            sessions = sessions.filter(function (session) { return session.projectId !== project.id; });
            options.invalidateSlashItemsData();
            renderProjects();

            if (isCurrentProjectSession) {
                await options.deleteSession(currentSessionId);
                return;
            }

            await refreshDirectory();
        } catch (e) {
            options.showError((e && e.message) || "删除项目失败");
        }
    }

    function renderProjectSessions(projectId) {
        var list = document.createElement("div");
        list.className = "project-session-list";
        var page = getProjectSessionPage(projectId);
        var projectSessions = sortSessionsByUpdatedAt(
            sessions.filter(function (session) { return session.projectId === projectId; })
        );
        if (projectSessions.length === 0) {
            var empty = document.createElement("div");
            empty.className = "project-empty";
            empty.textContent = page.isLoading ? "加载中..." : "暂无对话";
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

        if (projectSessions.length > projectSessionPreviewLimit || page.hasMore || isShowingAll) {
            var moreBtn = document.createElement("button");
            moreBtn.className = "project-sessions-more";
            moreBtn.type = "button";
            moreBtn.disabled = page.isLoading;
            moreBtn.setAttribute("aria-expanded", String(isShowingAll));
            moreBtn.textContent = page.isLoading
                ? "加载中..."
                : isShowingAll
                    ? (page.hasMore ? "继续加载" : "收起")
                    : "查看更多";
            moreBtn.addEventListener("click", async function (e) {
                e.stopPropagation();
                if (!isShowingAll) {
                    expandedProjectSessionIds.add(projectId);
                    renderProjects();
                    return;
                }
                if (page.hasMore) {
                    await loadProjectSessionsPage(projectId, true);
                } else {
                    expandedProjectSessionIds.delete(projectId);
                }
                renderProjects();
                updateSelection();
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
                '<button class="project-delete" type="button" title="删除项目" aria-label="删除项目">' +
                '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
                '</button>' +
                '<button class="project-create-chat" type="button" data-tooltip="新对话" aria-label="在当前项目新建对话">' +
                '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">' +
                '<path d="M6.5 1.5v10M1.5 6.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
                '</svg>' +
                '</button>';
            row.querySelector(".project-name").textContent = project.name;
            row.addEventListener("click", function () {
                toggleProject(project.id);
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
            row.querySelector(".project-delete").addEventListener("click", function (e) {
                e.stopPropagation();
                deleteProject(project);
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

    function revealSessionContainer(projectId, options) {
        // defer 时保持侧边栏现状（如首页 chip 切换项目），等发送消息创建会话后再展开
        if (options && options.defer) return;
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
            var hasActiveCompactRun = !!data.activeRun && data.activeRun.kind === "compact";
            var hasNewMessage = incomingNewestId > options.getCurrentNewestMessageId();
            var hasNewerTimestamp = incomingUpdatedAt && options.getCurrentSessionUpdatedAt() && incomingUpdatedAt > options.getCurrentSessionUpdatedAt();

            if (hasUnsubscribedStream || hasActiveCompactRun || hasNewMessage || hasNewerTimestamp) {
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
            sessions = [];
            resetSessionPageState(allSessionsPage);
            resetSessionPageState(globalSessionPage);
            projectSessionPages = new Map();

            var tasks = [
                loadAllSessionsPage(false),
                loadGlobalSessionsPage(false),
            ];
            expandedProjectIds.forEach(function (projectId) {
                tasks.push(loadProjectSessionsPage(projectId, false));
            });
            await Promise.all(tasks);
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
        if (payload.type === "history_cleared") {
            sessions = [];
            resetSessionPageState(allSessionsPage);
            resetSessionPageState(globalSessionPage);
            projectSessionPages = new Map();
            renderHistory();
            renderProjects();
            updateSelection();
            return;
        }
        if (payload.type === "sessions_changed" && payload.reason === "session_deleted") {
            removeSessionSummary(payload.sessionId);
        }
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

        var source = new EventSource(window.withApiToken("/api/events"));
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

    async function addLocalProject() {
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

    function addProject() {
        if (addProjectBtn && addProjectBtn.disabled) return;
        if (addProjectMenuEl) {
            closeAddProjectMenu();
            return;
        }
        openAddProjectMenu();
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
        removeSessionSummary: removeSessionSummary,
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
