import { createSkillCard, showSkillsSaveStatus } from './skill-card.js';
import { escapeHtml } from '../utils/html.js';

export function createSkillsPageController(options) {
    const skillsView = options.skillsView;

    var skillsData = null;
    var skillsDataProvider = '';
    var skillsSearchTerm = '';
    var officialSkillsDownloadActive = false;

    function getActiveSlashProviderType() {
        return options.getActiveSlashProviderType ? options.getActiveSlashProviderType() : '';
    }

    function getProviderQuery(providerType) {
        return options.getProviderQuery ? options.getProviderQuery(providerType) : '';
    }

    function invalidateSlashItemsData(providerType) {
        if (options.invalidateSlashItemsData) options.invalidateSlashItemsData(providerType);
    }

    function showChatView() {
        if (options.showChatView) options.showChatView();
    }

    function showError(message) {
        if (options.showError) options.showError(message);
    }

    function supportsOfficialSkills(providerType) {
        return providerType === 'codex' || providerType === 'claude-code' || providerType === 'claude-agent';
    }

    async function fetchSkills() {
        var providerType = getActiveSlashProviderType();
        try {
            var res = await fetch('/api/skills' + getProviderQuery(providerType));
            skillsData = await res.json();
            skillsDataProvider = providerType;
            invalidateSlashItemsData(providerType);
        } catch (e) {
            console.error('Failed to fetch skills:', e);
            skillsData = { skills: [], sources: [] };
            skillsDataProvider = providerType;
        }
    }

    function renderSkillsView() {
        skillsView.innerHTML = '';
        if (!skillsData) return;

        var page = document.createElement('div');
        page.className = 'skills-page';

        var header = document.createElement('div');
        header.className = 'skills-header';
        header.innerHTML =
            '<div class="skills-header-top">' +
            '<div class="skills-header-icon">' +
            '<svg width="22" height="22" viewBox="0 0 14 14" fill="none"><path d="M7 1L8.5 4.5L12.5 5L9.75 7.5L10.5 11.5L7 9.5L3.5 11.5L4.25 7.5L1.5 5L5.5 4.5L7 1Z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</div>' +
            '<div>' +
            '<div class="skills-header-title">技能管理</div>' +
            '<div class="skills-header-count">' + skillsData.skills.length + ' 个技能可用</div>' +
            '</div>' +
            '</div>';
        page.appendChild(header);

        var toolbar = document.createElement('div');
        toolbar.className = 'skills-toolbar';

        var searchInput = document.createElement('input');
        searchInput.className = 'skills-search';
        searchInput.type = 'text';
        searchInput.placeholder = '搜索技能名称、描述或路径…';
        searchInput.value = skillsSearchTerm;
        searchInput.id = 'skills-search-input';
        searchInput.addEventListener('input', function () {
            skillsSearchTerm = this.value;
            renderSkillsList();
        });

        var refreshBtn = document.createElement('button');
        refreshBtn.className = 'skills-toolbar-btn';
        refreshBtn.title = '刷新';
        refreshBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 7a5.5 5.5 0 0 1 9.35-3.95M12.5 7a5.5 5.5 0 0 1-9.35 3.95" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M10.5 1v2.5H13M3.5 13v-2.5H1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        refreshBtn.addEventListener('click', function () {
            fetchSkills().then(function () {
                renderSkillsView();
                showSkillsSaveStatus('技能列表已刷新');
            });
        });

        var downloadOfficialBtn = null;
        if (supportsOfficialSkills(skillsDataProvider || getActiveSlashProviderType())) {
            downloadOfficialBtn = document.createElement('button');
            downloadOfficialBtn.className = 'skills-toolbar-btn';
            downloadOfficialBtn.title = '下载官方技能';
            downloadOfficialBtn.setAttribute('aria-label', '下载官方技能');
            downloadOfficialBtn.disabled = officialSkillsDownloadActive;
            downloadOfficialBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v7M4.25 5.75L7 8.5l2.75-2.75" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 9.5v1.75a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            downloadOfficialBtn.addEventListener('click', function () {
                openOfficialSkillsDownloadModal(skillsDataProvider || getActiveSlashProviderType());
            });
        }

        var openFolderBtn = document.createElement('button');
        openFolderBtn.className = 'skills-toolbar-btn';
        openFolderBtn.title = '打开文件夹';
        openFolderBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 3.5v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H7L5.5 3.5H2.5a1 1 0 0 0-1 1z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        openFolderBtn.addEventListener('click', function () {
            fetch('/api/skills/open-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: skillsDataProvider || getActiveSlashProviderType() }),
            });
        });

        toolbar.appendChild(searchInput);
        toolbar.appendChild(refreshBtn);
        if (downloadOfficialBtn) toolbar.appendChild(downloadOfficialBtn);
        toolbar.appendChild(openFolderBtn);
        page.appendChild(toolbar);

        var listContainer = document.createElement('div');
        listContainer.className = 'skills-list';
        listContainer.id = 'skills-list-container';
        page.appendChild(listContainer);

        var footer = document.createElement('div');
        footer.className = 'skills-footer';
        footer.innerHTML =
            '<div class="skills-save-status" id="skills-save-status">' +
            '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '所有更改已保存' +
            '</div>' +
            '<div class="skills-footer-actions">' +
            '<button class="skills-footer-btn" id="skills-close-btn">关闭</button>' +
            '</div>';
        page.appendChild(footer);

        skillsView.appendChild(page);

        document.getElementById('skills-close-btn').addEventListener('click', function () {
            showChatView();
        });

        renderSkillsList();
    }

    function renderSkillsList() {
        var container = document.getElementById('skills-list-container');
        if (!container || !skillsData) return;
        container.innerHTML = '';

        var term = skillsSearchTerm.toLowerCase().trim();
        var filtered = skillsData.skills;
        if (term) {
            filtered = filtered.filter(function (s) {
                return s.name.toLowerCase().indexOf(term) !== -1 ||
                    s.description.toLowerCase().indexOf(term) !== -1 ||
                    s.fullPath.toLowerCase().indexOf(term) !== -1;
            });
        }

        if (filtered.length === 0) {
            container.innerHTML =
                '<div class="skills-empty">' +
                '<div class="skills-empty-icon">' +
                '<svg width="20" height="20" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 9.5L12.5 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
                '</div>' +
                '<div class="skills-empty-text">' + (term ? '没有找到匹配的技能' : '暂无可用技能') + '</div>' +
                '</div>';
            return;
        }

        var grouped = {};
        filtered.forEach(function (s) {
            if (!grouped[s.source]) grouped[s.source] = [];
            grouped[s.source].push(s);
        });

        Object.keys(grouped).forEach(function (source) {
            var items = grouped[source];
            var group = document.createElement('div');
            group.className = 'skills-group';

            var label = document.createElement('div');
            label.className = 'skills-group-label';
            label.innerHTML = escapeHtml(source) + ' <span class="skills-group-badge">' + items.length + '</span>';
            group.appendChild(label);

            items.forEach(function (skill) {
                group.appendChild(createSkillCardElement(skill));
            });

            container.appendChild(group);
        });
    }

    function createSkillCardElement(skill) {
        return createSkillCard(skill, {
            getProviderType: function () {
                return skillsDataProvider || getActiveSlashProviderType();
            },
            getProviderQuery: getProviderQuery,
            invalidateSlashItemsData: invalidateSlashItemsData,
            showError: showError,
            showSaveStatus: showSkillsSaveStatus,
            onDeleted: function (deletedSkill, providerType) {
                if (skillsData) {
                    skillsData.skills = skillsData.skills.filter(function (s) { return s.id !== deletedSkill.id; });
                }
                invalidateSlashItemsData(providerType);
                var countEl = document.querySelector('.skills-header-count');
                if (countEl && skillsData) countEl.textContent = skillsData.skills.length + ' 个技能可用';
                showSkillsSaveStatus('已删除: ' + deletedSkill.name);
            },
        });
    }

    function closeOfficialSkillsDownloadModal(overlay) {
        if (officialSkillsDownloadActive) return;
        overlay.classList.remove('open');
        setTimeout(function () {
            overlay.remove();
        }, 160);
    }

    function openOfficialSkillsDownloadModal(providerType) {
        if (officialSkillsDownloadActive || !supportsOfficialSkills(providerType)) return;

        var existing = document.getElementById('official-skills-download-overlay');
        if (existing) {
            existing.classList.add('open');
            return;
        }

        var overlay = document.createElement('div');
        overlay.className = 'skills-download-overlay open';
        overlay.id = 'official-skills-download-overlay';
        overlay._officialSkillsProvider = providerType;
        overlay._officialSkills = [];
        overlay._officialSkillsSearchTerm = '';
        overlay.innerHTML =
            '<div class="skills-download-modal" role="dialog" aria-modal="true" aria-labelledby="official-skills-download-title">' +
            '<div class="skills-download-header">' +
            '<div class="skills-download-icon">' +
            '<svg width="18" height="18" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v7M4.25 5.75L7 8.5l2.75-2.75" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 9.5v1.75a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</div>' +
            '<div>' +
            '<div class="skills-download-title" id="official-skills-download-title" data-role="source-name">官方技能包</div>' +
            '<div class="skills-download-subtitle" data-role="target">正在读取安装目录...</div>' +
            '</div>' +
            '</div>' +
            '<div class="skills-download-list-view" data-role="list-view">' +
            '<input class="skills-download-search" type="text" placeholder="搜索官方技能..." data-role="search">' +
            '<div class="skills-official-list" data-role="official-list">' +
            '<div class="skills-download-loading">正在加载官方技能...</div>' +
            '</div>' +
            '</div>' +
            '<div class="skills-download-actions">' +
            '<button class="skills-footer-btn" type="button" data-role="close">关闭</button>' +
            '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        overlay.querySelector('[data-role="close"]').addEventListener('click', function () {
            closeOfficialSkillsDownloadModal(overlay);
        });
        overlay.querySelector('[data-role="search"]').addEventListener('input', function () {
            overlay._officialSkillsSearchTerm = this.value || '';
            renderOfficialSkillsList(overlay, { preserveScroll: true });
        });
        fetchOfficialSkillsList(providerType, overlay);
    }

    function setDownloadToolbarButtonsDisabled(disabled) {
        var buttons = skillsView.querySelectorAll('.skills-toolbar-btn[aria-label="下载官方技能"]');
        buttons.forEach(function (button) {
            button.disabled = disabled;
        });
    }

    function setOfficialSkillsListLoading(overlay, message) {
        var listEl = overlay.querySelector('[data-role="official-list"]');
        if (!listEl) return;
        listEl.innerHTML = '<div class="skills-download-loading">' + escapeHtml(message || '正在加载官方技能...') + '</div>';
    }

    function getOfficialSkillsListScrollTop(overlay) {
        var listEl = overlay.querySelector('[data-role="official-list"]');
        return listEl ? listEl.scrollTop : 0;
    }

    function restoreOfficialSkillsListScrollTop(overlay, scrollTop) {
        var listEl = overlay.querySelector('[data-role="official-list"]');
        if (!listEl || scrollTop == null) return;
        listEl.scrollTop = Math.max(0, Math.min(Number(scrollTop) || 0, listEl.scrollHeight));
    }

    async function fetchOfficialSkillsList(providerType, overlay, options) {
        options = options || {};
        var hasExistingList = Array.isArray(overlay._officialSkills) && overlay._officialSkills.length > 0;
        if (!options.silent || !hasExistingList) {
            setOfficialSkillsListLoading(overlay, '正在加载官方技能...');
        }
        try {
            var res = await fetch('/api/skills/official' + getProviderQuery(providerType));
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok) throw new Error(data.error || '读取官方技能列表失败');
            var previousScrollTop = getOfficialSkillsListScrollTop(overlay);
            overlay._officialSkills = Array.isArray(data.skills) ? data.skills : [];
            overlay._officialSkillsTargetDir = data.targetDir || '';
            var titleEl = overlay.querySelector('[data-role="source-name"]');
            if (titleEl) titleEl.textContent = data.sourceName || '官方技能包';
            var targetEl = overlay.querySelector('[data-role="target"]');
            if (targetEl) targetEl.textContent = data.targetDir ? '安装到 ' + data.targetDir : '技能目录';
            renderOfficialSkillsList(overlay, { preserveScroll: options.preserveScroll });
            if (options.preserveScroll) restoreOfficialSkillsListScrollTop(overlay, previousScrollTop);
        } catch (e) {
            var message = e && e.message ? e.message : '读取官方技能列表失败';
            if (!options.silent || !hasExistingList) {
                setOfficialSkillsListLoading(overlay, message);
            }
            if (!options.silent || !hasExistingList) showError(message);
        }
    }

    function isOfficialSkillConflict(skill) {
        return skill && skill.localStatus === 'other';
    }

    function getOfficialSkillActionLabel(skill) {
        if (isOfficialSkillConflict(skill)) return '不可安装';
        return skill && skill.installed ? '重新下载' : '下载';
    }

    function getOfficialSkillDetailUrl(skill) {
        if (skill && skill.url) return skill.url;
        return 'https://github.com/anthropics/skills/tree/main/skills/' + encodeURIComponent(skill && skill.name ? skill.name : '');
    }

    function renderOfficialSkillsList(overlay, options) {
        options = options || {};
        var listEl = overlay.querySelector('[data-role="official-list"]');
        if (!listEl) return;
        var previousScrollTop = options.preserveScroll ? listEl.scrollTop : null;
        var skills = Array.isArray(overlay._officialSkills) ? overlay._officialSkills : [];
        skills = skills.slice().sort(function (left, right) {
            var rank = { missing: 0, directory: 1, other: 2 };
            var leftRank = rank[left.localStatus] == null ? 3 : rank[left.localStatus];
            var rightRank = rank[right.localStatus] == null ? 3 : rank[right.localStatus];
            if (leftRank !== rightRank) return leftRank - rightRank;
            return String(left.name || '').localeCompare(String(right.name || ''));
        });
        var term = String(overlay._officialSkillsSearchTerm || '').toLowerCase().trim();
        var filtered = term
            ? skills.filter(function (skill) { return String(skill.name || '').toLowerCase().indexOf(term) !== -1; })
            : skills;

        listEl.innerHTML = '';
        if (filtered.length === 0) {
            listEl.innerHTML = '<div class="skills-download-loading">' + (term ? '没有找到匹配的官方技能' : '暂无官方技能') + '</div>';
            return;
        }

        filtered.forEach(function (skill) {
            var row = document.createElement('div');
            var conflict = isOfficialSkillConflict(skill);
            row.className = 'skills-official-item' + (skill.installed ? ' installed' : '') + (conflict ? ' conflict' : '');

            var info = document.createElement('div');
            info.className = 'skills-official-info';
            info.innerHTML =
                '<div class="skills-official-name-row">' +
                '<span class="skills-official-name">' + escapeHtml(skill.name || '') + '</span>' +
                '<span class="skills-official-status">' + escapeHtml(conflict ? '路径冲突' : (skill.installed ? '已安装' : '未安装')) + '</span>' +
                '</div>' +
                '<a class="skills-official-detail" href="' + escapeHtml(getOfficialSkillDetailUrl(skill)) + '" target="_blank" rel="noopener noreferrer">查看详情</a>';

            var action = document.createElement('button');
            var isActiveDownload = overlay._activeOfficialSkillName === skill.name && officialSkillsDownloadActive;
            action.className = 'skills-official-action' + (isActiveDownload ? ' running' : '');
            action.type = 'button';
            if (isActiveDownload) {
                var progress = Math.max(0, Math.min(100, Number(overlay._officialSkillProgress || 0)));
                action.style.setProperty('--download-progress', progress.toFixed(1) + '%');
                action.innerHTML =
                    '<span class="skills-official-action-label">' +
                    escapeHtml((skill.installed ? '重新下载中 ' : '下载中 ') + progress.toFixed(0) + '%') +
                    '</span>';
            } else {
                action.textContent = getOfficialSkillActionLabel(skill);
            }
            action.disabled = officialSkillsDownloadActive || conflict;
            action.addEventListener('click', function () {
                downloadOfficialSkills(overlay._officialSkillsProvider, overlay, skill);
            });

            row.appendChild(info);
            row.appendChild(action);
            listEl.appendChild(row);
        });
        if (options.preserveScroll) restoreOfficialSkillsListScrollTop(overlay, previousScrollTop);
    }

    function markOfficialSkillsInstalled(overlay, event) {
        var names = {};
        ['installed', 'reinstalled'].forEach(function (key) {
            if (!Array.isArray(event[key])) return;
            event[key].forEach(function (name) {
                names[String(name)] = true;
            });
        });
        if (Object.keys(names).length === 0 || !Array.isArray(overlay._officialSkills)) return false;

        var changed = false;
        overlay._officialSkills = overlay._officialSkills.map(function (skill) {
            if (!skill || !names[String(skill.name || '')]) return skill;
            changed = true;
            var next = Object.assign({}, skill);
            next.installed = true;
            next.localStatus = 'directory';
            return next;
        });
        return changed;
    }

    function normalizeDownloadEvent(raw) {
        return raw && typeof raw === 'object' ? raw : {};
    }

    function renderOfficialSkillsDownloadProgress(overlay, rawEvent) {
        var event = normalizeDownloadEvent(rawEvent);
        var percent = Number(event.percent);
        if (!Number.isFinite(percent)) percent = event.phase === 'discovering' ? 8 : 0;
        percent = Math.max(0, Math.min(100, percent));
        if (officialSkillsDownloadActive && event.phase !== 'failed') {
            percent = Math.max(percent, Number(overlay._officialSkillProgress || 0));
        }
        overlay._officialSkillProgress = percent;

        if (officialSkillsDownloadActive) renderOfficialSkillsList(overlay, { preserveScroll: true });

        if (event.phase === 'completed' || event.phase === 'failed') {
            var previousScrollTop = getOfficialSkillsListScrollTop(overlay);
            if (event.phase === 'completed') markOfficialSkillsInstalled(overlay, event);
            officialSkillsDownloadActive = false;
            setDownloadToolbarButtonsDisabled(false);
            renderOfficialSkillsList(overlay, { preserveScroll: true });
            restoreOfficialSkillsListScrollTop(overlay, previousScrollTop);
            if (event.phase === 'completed') {
            } else if (!overlay._downloadFailureReported) {
                overlay._downloadFailureReported = true;
                showError(event.message || '下载官方技能失败');
            }
            if (!overlay._skillsRefreshedAfterDownload && Number(event.total || 0) > 0 && event.phase === 'completed') {
                overlay._skillsRefreshedAfterDownload = true;
                fetchSkills().then(function () {
                    renderSkillsView();
                    return fetchOfficialSkillsList(overlay._officialSkillsProvider, overlay, {
                        silent: true,
                        preserveScroll: true,
                    });
                });
            }
        }
    }

    function renderOfficialSkillsDownloadFailure(overlay, message) {
        renderOfficialSkillsDownloadProgress(overlay, {
            phase: 'failed',
            message: message || '下载官方技能失败',
            percent: 100,
            completed: 0,
            total: 0,
            installed: [],
            reinstalled: [],
            skipped: [],
            failed: [{ name: 'official-skills', error: message || '下载官方技能失败' }],
        });
    }

    function handleDownloadStreamLine(line, overlay) {
        if (!line.trim()) return;
        try {
            renderOfficialSkillsDownloadProgress(overlay, JSON.parse(line));
        } catch (e) {
            console.error('Failed to parse official skills download event:', e);
        }
    }

    async function downloadOfficialSkills(providerType, overlay, skill) {
        if (!skill || !skill.name || officialSkillsDownloadActive) return;
        overlay._activeOfficialSkillName = skill.name;
        overlay._activeOfficialSkillAction = skill.installed ? 'redownload' : 'download';
        overlay._officialSkillProgress = 0;
        overlay._downloadFailureReported = false;
        overlay._skillsRefreshedAfterDownload = false;
        officialSkillsDownloadActive = true;
        setDownloadToolbarButtonsDisabled(true);
        renderOfficialSkillsList(overlay, { preserveScroll: true });

        try {
            var res = await fetch('/api/skills/download-official', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: providerType, skills: [skill.name] }),
            });
            if (!res.ok) {
                var errorData = await res.json().catch(function () { return {}; });
                throw new Error(errorData.error || '下载官方技能失败');
            }
            if (!res.body || !window.TextDecoder) {
                throw new Error('当前浏览器不支持下载进度流');
            }

            var reader = res.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';
            while (true) {
                var chunk = await reader.read();
                if (chunk.done) break;
                buffer += decoder.decode(chunk.value, { stream: true });
                var lines = buffer.split('\n');
                buffer = lines.pop() || '';
                lines.forEach(function (line) {
                    handleDownloadStreamLine(line, overlay);
                });
            }
            buffer += decoder.decode();
            handleDownloadStreamLine(buffer, overlay);
        } catch (e) {
            var message = e && e.message ? e.message : '下载官方技能失败';
            officialSkillsDownloadActive = false;
            setDownloadToolbarButtonsDisabled(false);
            renderOfficialSkillsList(overlay, { preserveScroll: true });
            renderOfficialSkillsDownloadFailure(overlay, message);
            showError(message);
        }
    }

    function handleKeydown(e) {
        if (e.key !== '/' && !(e.metaKey && e.key === 'f') && !(e.ctrlKey && e.key === 'f')) return false;
        var searchEl = document.getElementById('skills-search-input');
        if (!searchEl || document.activeElement === searchEl) return false;
        e.preventDefault();
        searchEl.focus();
        return true;
    }

    return {
        fetchSkills: fetchSkills,
        handleKeydown: handleKeydown,
        render: renderSkillsView,
    };
}
