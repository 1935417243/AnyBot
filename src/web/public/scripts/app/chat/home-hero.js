import { escapeHtml } from '../utils/html.js';

var CHECK_ICON = '<svg class="home-project-option-check" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var CHECK_PLACEHOLDER = '<span class="home-project-option-check-placeholder"></span>';
var NO_PROJECT_LABEL = '不在项目中工作';

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

    function buildOption(name, isActive, projectId) {
        var opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'home-project-option' + (isActive ? ' active' : '');
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', isActive ? 'true' : 'false');
        opt.innerHTML =
            (isActive ? CHECK_ICON : CHECK_PLACEHOLDER) +
            '<span class="home-project-option-name">' + escapeHtml(name) + '</span>';
        opt.addEventListener('click', function (e) {
            e.stopPropagation();
            closeDropdown();
            if (options.selectProject) options.selectProject(projectId);
            syncChip();
        });
        return opt;
    }

    function renderDropdown() {
        if (!dropdown) return;
        var projects = getProjects();
        var activeId = getActiveProjectId();
        dropdown.innerHTML = '';
        dropdown.appendChild(buildOption(NO_PROJECT_LABEL, !activeId, null));
        if (projects.length > 0) {
            var divider = document.createElement('div');
            divider.className = 'home-project-divider';
            dropdown.appendChild(divider);
        }
        projects.forEach(function (project) {
            dropdown.appendChild(buildOption(project.name, project.id === activeId, project.id));
        });
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
