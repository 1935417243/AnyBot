import { escapeHtml } from '../utils/html.js';

var CHECK_ICON = '<svg class="home-project-option-check" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var CHECK_PLACEHOLDER = '<span class="home-project-option-check-placeholder"></span>';
var FOLDER_ICON = '<svg class="home-project-option-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.2 12.7V3.6c0-.6.5-1.1 1.1-1.1h3l1.3 1.5h5c.6 0 1.1.5 1.1 1.1v7.6H2.2Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>';
var NO_PROJECT_ICON = '<svg class="home-project-option-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4A1.5 1.5 0 0 1 4 2.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7.4l-2.7 2.3V11H4A1.5 1.5 0 0 1 2.5 9.5V4Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>';
var NO_PROJECT_LABEL = '不在项目中工作';
var OPEN_FOLDER_LABEL = '打开文件夹';

export function createHomeHero(options) {
    var picker = options.picker;
    var chip = options.chip;
    var chipNameEl = options.chipNameEl;
    var dropdown = options.dropdown;

    function getProjects() {
        return options.getProjects ? (options.getProjects() || []) : [];
    }

    function getActiveProjectId() {
        return options.getActiveProjectId ? options.getActiveProjectId() : null;
    }

    function getActiveProject() {
        var id = getActiveProjectId();
        if (!id) return null;
        var projects = getProjects();
        for (var i = 0; i < projects.length; i++) {
            if (projects[i].id === id) return projects[i];
        }
        return null;
    }

    function closeDropdown() {
        if (dropdown) dropdown.hidden = true;
        if (chip) chip.setAttribute('aria-expanded', 'false');
    }

    function syncChip() {
        var project = getActiveProject();
        if (!picker) return;
        if (!project && getProjects().length === 0) {
            picker.hidden = true;
            closeDropdown();
            return;
        }
        picker.hidden = false;
        if (chipNameEl) chipNameEl.textContent = project ? project.name : NO_PROJECT_LABEL;
        if (chip) chip.title = project ? (project.path || project.name) : NO_PROJECT_LABEL;
    }

    // inactiveIconHtml：未选中时左侧插槽展示的图标（缺省为空占位，保持与勾选项对齐）
    function buildOption(name, isActive, projectId, inactiveIconHtml) {
        var opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'home-project-option' + (isActive ? ' active' : '');
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', isActive ? 'true' : 'false');
        opt.innerHTML =
            (isActive ? CHECK_ICON : (inactiveIconHtml || CHECK_PLACEHOLDER)) +
            '<span class="home-project-option-name">' + escapeHtml(name) + '</span>';
        opt.addEventListener('click', function (e) {
            e.stopPropagation();
            closeDropdown();
            if (options.selectProject) options.selectProject(projectId);
            syncChip();
        });
        return opt;
    }

    // 构建动作项（如图标 + "打开文件夹"），与可选项的区别是左侧展示动作图标而非勾选态
    function buildActionOption(name, iconHtml, onClick) {
        var opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'home-project-option';
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', 'false');
        opt.innerHTML =
            iconHtml +
            '<span class="home-project-option-name">' + escapeHtml(name) + '</span>';
        opt.addEventListener('click', function (e) {
            e.stopPropagation();
            closeDropdown();
            if (onClick) onClick();
        });
        return opt;
    }

    // 点击"打开文件夹"：执行外部注入的选目录逻辑，异常统一走 onError 提示
    async function handleOpenFolder() {
        if (!options.openFolder) return;
        try {
            await options.openFolder();
        } catch (e) {
            if (options.onError) options.onError((e && e.message) || '添加项目失败');
        }
        syncChip();
    }

    function renderDropdown() {
        if (!dropdown) return;
        var projects = getProjects();
        var activeId = getActiveProjectId();
        dropdown.innerHTML = '';
        projects.forEach(function (project) {
            dropdown.appendChild(buildOption(project.name, project.id === activeId, project.id));
        });
        if (projects.length > 0) {
            var divider = document.createElement('div');
            divider.className = 'home-project-divider';
            dropdown.appendChild(divider);
        }
        dropdown.appendChild(buildOption(NO_PROJECT_LABEL, !activeId, null, NO_PROJECT_ICON));
        if (options.openFolder) {
            dropdown.appendChild(buildActionOption(OPEN_FOLDER_LABEL, FOLDER_ICON, handleOpenFolder));
        }
    }

    function toggleDropdown() {
        if (!dropdown) return;
        if (dropdown.hidden) {
            renderDropdown();
            dropdown.hidden = false;
            if (chip) chip.setAttribute('aria-expanded', 'true');
        } else {
            closeDropdown();
        }
    }

    if (chip) {
        chip.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleDropdown();
        });
    }

    return {
        closeDropdown: closeDropdown,
        handleDocumentClick: function (e) {
            if (picker && !picker.contains(e.target)) closeDropdown();
        },
        handleEscape: function () {
            if (dropdown && !dropdown.hidden) {
                closeDropdown();
                if (chip) chip.focus();
                return true;
            }
            return false;
        },
        syncChip: syncChip,
    };
}
