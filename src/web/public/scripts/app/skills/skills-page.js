import { createSkillCard, showSkillsSaveStatus } from './skill-card.js';
import { escapeHtml } from '../utils/html.js';

export function createSkillsPageController(options) {
    const skillsView = options.skillsView;

    var skillsData = null;
    var skillsDataProvider = '';
    var skillsSearchTerm = '';

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
