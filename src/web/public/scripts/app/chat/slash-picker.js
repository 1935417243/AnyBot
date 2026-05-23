import { escapeHtml } from '../utils/html.js';
import {
    getCommandIconHtml,
    getProjectIconHtml,
    getSkillIconHtml,
    normalizeMessageProjects,
    normalizeMessageSkills,
} from './message-selection.js';

export function createSlashPickerController(config) {
    var pickerOpen = false;
    var pickerQuery = '';
    var pickerTokenStart = null;
    var pickerTokenEnd = null;
    var pickerItems = [];
    var filteredItems = [];
    var activeIndex = 0;
    var visualActive = false;
    var isOpening = false;
    var promptSkills = [];
    var promptProjects = [];
    var pendingSkillDeleteIndex = null;
    var pendingProjectDeleteIndex = null;

    function getSelection() {
        return {
            skills: promptSkills.slice(),
            projects: promptProjects.slice(),
        };
    }

    function setSelection(skills, projects) {
        promptSkills = normalizeMessageSkills(skills);
        promptProjects = normalizeMessageProjects(projects);
        pendingSkillDeleteIndex = null;
        pendingProjectDeleteIndex = null;
        renderPromptSelections();
        config.resizeChatInput();
        config.updateSendBtnState();
        config.inputEl.focus();
        if (config.inputEl.setSelectionRange) {
            var end = config.inputEl.value.length;
            config.inputEl.setSelectionRange(end, end);
        }
    }

    function getActiveTrigger() {
        if (typeof config.inputEl.selectionStart !== 'number' || typeof config.inputEl.selectionEnd !== 'number') return null;
        if (config.inputEl.selectionStart !== config.inputEl.selectionEnd) return null;
        var caret = config.inputEl.selectionStart;
        var before = config.inputEl.value.slice(0, caret);
        var match = before.match(/(^|\s)\/([^\s/]*)$/);
        if (!match) return null;
        return {
            start: before.length - match[2].length - 1,
            end: caret,
            query: match[2],
        };
    }

    function isValidTrigger(trigger) {
        if (!trigger) return false;
        return isNaturalLanguageTriggerContext(config.inputEl.value.slice(0, trigger.start));
    }

    function canOpenFromSlash(event) {
        if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false;
        if (config.getCurrentView() !== 'chat') return false;
        if (typeof config.inputEl.selectionStart !== 'number' || config.inputEl.selectionStart !== config.inputEl.selectionEnd) return false;
        var before = config.inputEl.value.slice(0, config.inputEl.selectionStart);
        return isNaturalLanguageTriggerContext(before);
    }

    function isNaturalLanguageTriggerContext(before) {
        if (before === '') return true;
        if (!/\s$/.test(before)) return false;

        var trimmed = before.trim();
        if (!trimmed) return true;
        if (/[`"'([{<>=+*|&;]$/.test(trimmed)) return false;
        if (/(^|[\s/\\])[\w.-]+\/[\w./-]*$/.test(trimmed)) return false;
        if (/^(cd|ls|cat|open|node|npm|pnpm|yarn|git|curl|grep|rg|python|python3|pip|uv|docker|kubectl|ssh|scp)\b/i.test(trimmed)) {
            return false;
        }

        return /[\u4e00-\u9fff]/.test(trimmed) ||
            /[.!?,，。！？；：)]$/.test(trimmed) ||
            trimmed.split(/\s+/).length >= 2;
    }

    function getPickerType(item) {
        if (!item) return 'skill';
        if (item.type === 'project') return 'project';
        if (item.type === 'provider-command') return 'provider-command';
        return 'skill';
    }

    function getEnabledItems() {
        var slashItemsState = config.getSlashItemsState();
        var groups = slashItemsState && Array.isArray(slashItemsState.groups) ? slashItemsState.groups : [];
        var selectedSkillIds = new Set(promptSkills.map(function (skill) { return skill.id; }));
        var selectedProjectIds = new Set(promptProjects.map(function (project) { return project.id; }));
        var currentSessionProjectId = config.getCurrentSessionProjectId();
        if (currentSessionProjectId) selectedProjectIds.add(currentSessionProjectId);
        var nextItems = [];

        groups.forEach(function (group) {
            var groupItems = Array.isArray(group.items) ? group.items : [];
            groupItems.forEach(function (item) {
                if (!item || !item.id || !item.name) return;
                var pickerType = getPickerType(item);
                if (pickerType === 'skill' && (!item.enabled || selectedSkillIds.has(item.id))) return;
                if (pickerType === 'project' && (!item.path || selectedProjectIds.has(item.id))) return;
                nextItems.push(Object.assign({}, item, {
                    pickerType: pickerType,
                    groupTitle: group.title || (pickerType === 'project' ? '项目' : '技能'),
                }));
            });
        });

        return nextItems;
    }

    function filterItems() {
        var term = pickerQuery.toLowerCase().trim();
        var nextFiltered = pickerItems;
        if (term) {
            nextFiltered = nextFiltered.filter(function (item) {
                if (item.pickerType === 'project') return matchesTerm([item.name, item.path], term);
                return matchesTerm([item.name, item.description, item.source], term);
            });
        }
        filteredItems = nextFiltered;
        if (activeIndex >= filteredItems.length) {
            activeIndex = Math.max(0, filteredItems.length - 1);
        }
    }

    function matchesTerm(values, term) {
        return values.some(function (value) {
            var normalized = String(value || '').toLowerCase();
            if (!normalized) return false;
            if (normalized.startsWith(term)) return true;
            return normalized
                .split(/[^a-z0-9\u4e00-\u9fff]+/)
                .filter(Boolean)
                .some(function (part) { return part.startsWith(term); });
        });
    }

    function close(options) {
        options = options || {};
        if (!config.skillPickerEl) return;
        if (options.removeTrigger && pickerTokenStart !== null && pickerTokenEnd !== null) {
            var value = config.inputEl.value;
            var nextValue = value.slice(0, pickerTokenStart) + value.slice(pickerTokenEnd);
            config.inputEl.value = nextValue;
            config.inputEl.setSelectionRange(pickerTokenStart, pickerTokenStart);
            config.resizeChatInput();
            config.updateSendBtnState();
        }
        pickerOpen = false;
        pickerQuery = '';
        pickerTokenStart = null;
        pickerTokenEnd = null;
        filteredItems = [];
        activeIndex = 0;
        visualActive = false;
        config.skillPickerEl.hidden = true;
        config.skillPickerEl.innerHTML = '';
    }

    function syncFromInput() {
        var trigger = getActiveTrigger();
        if (!isValidTrigger(trigger)) {
            if (pickerOpen) close();
            return;
        }
        if (!pickerOpen) {
            open(trigger);
            return;
        }
        updateFromTrigger(trigger);
    }

    function updateFromTrigger(trigger) {
        if (!pickerOpen) return;
        if (!isValidTrigger(trigger)) {
            close();
            return;
        }
        pickerTokenStart = trigger.start;
        pickerTokenEnd = trigger.end;
        pickerQuery = trigger.query;
        activeIndex = 0;
        visualActive = false;
        filterItems();
        renderPicker();
    }

    function moveActive(delta) {
        if (filteredItems.length === 0) return;
        var count = filteredItems.length;
        if (!visualActive) {
            activeIndex = delta > 0 ? 0 : count - 1;
        } else {
            activeIndex = (activeIndex + delta + count) % count;
        }
        visualActive = true;
        updateActiveItem(true);
    }

    function setActiveIndex(index) {
        if (index < 0 || index >= filteredItems.length) return;
        if (activeIndex === index && visualActive) return;
        activeIndex = index;
        visualActive = true;
        updateActiveItem(false);
    }

    function updateActiveItem(scrollIntoView) {
        if (!config.skillPickerEl) return;
        var activeItem = null;
        Array.prototype.forEach.call(config.skillPickerEl.querySelectorAll('.skill-picker-item'), function (item) {
            var isActive = visualActive && Number(item.dataset.index) === activeIndex;
            item.classList.toggle('active', isActive);
            item.setAttribute('aria-selected', isActive ? 'true' : 'false');
            if (isActive) activeItem = item;
        });
        if (scrollIntoView && activeItem) activeItem.scrollIntoView({ block: 'nearest' });
    }

    function renderPromptSelections() {
        if (!config.selectedSkillsEl) return;
        config.selectedSkillsEl.innerHTML = '';
        config.selectedSkillsEl.hidden = promptSkills.length === 0 && promptProjects.length === 0;
        promptSkills.forEach(function (skill, index) {
            config.selectedSkillsEl.appendChild(createSkillChip(skill, index));
        });
        promptProjects.forEach(function (project, index) {
            config.selectedSkillsEl.appendChild(createProjectChip(project, index));
        });
    }

    function createSkillChip(skill, index) {
        var chip = document.createElement('button');
        chip.className = 'selected-skill-chip' + (index === pendingSkillDeleteIndex ? ' pending-delete' : '');
        chip.type = 'button';
        chip.title = '移除技能 ' + skill.name;
        chip.innerHTML =
            getSkillIconHtml('selected-skill-icon') +
            '<span class="selected-skill-name">' + escapeHtml(skill.name) + '</span>' +
            '<span class="selected-skill-remove" aria-hidden="true">×</span>';
        chip.addEventListener('click', function () {
            pendingSkillDeleteIndex = null;
            promptSkills.splice(index, 1);
            handleSelectionChanged();
            config.inputEl.focus();
        });
        return chip;
    }

    function createProjectChip(project, index) {
        var chip = document.createElement('button');
        chip.className = 'selected-skill-chip selected-project-chip' + (index === pendingProjectDeleteIndex ? ' pending-delete' : '');
        chip.type = 'button';
        chip.title = project.path ? ('移除项目 ' + project.name + ' · ' + project.path) : ('移除项目 ' + project.name);
        chip.innerHTML =
            getProjectIconHtml('selected-skill-icon') +
            '<span class="selected-skill-name">' + escapeHtml(project.name) + '</span>' +
            '<span class="selected-skill-remove" aria-hidden="true">×</span>';
        chip.addEventListener('click', function () {
            pendingProjectDeleteIndex = null;
            promptProjects.splice(index, 1);
            handleSelectionChanged();
            config.inputEl.focus();
        });
        return chip;
    }

    function addPromptSkill(skill) {
        if (!skill || !skill.id || !skill.name) return;
        var alreadySelected = promptSkills.some(function (item) {
            return item.id === skill.id;
        });
        if (alreadySelected) return;
        pendingSkillDeleteIndex = null;
        pendingProjectDeleteIndex = null;
        promptSkills.push({
            id: skill.id,
            name: skill.name,
        });
        handleSelectionChanged();
    }

    function addPromptProject(project) {
        if (!project || !project.id || !project.name) return;
        var currentSessionProjectId = config.getCurrentSessionProjectId();
        if (currentSessionProjectId && project.id === currentSessionProjectId) return;
        var alreadySelected = promptProjects.some(function (item) {
            return item.id === project.id;
        });
        if (alreadySelected) return;
        pendingSkillDeleteIndex = null;
        pendingProjectDeleteIndex = null;
        promptProjects.push({
            id: project.id,
            name: project.name,
            path: project.path || '',
        });
        handleSelectionChanged();
    }

    function clearPromptSelections() {
        promptSkills = [];
        promptProjects = [];
        pendingSkillDeleteIndex = null;
        pendingProjectDeleteIndex = null;
        renderPromptSelections();
        config.updateSendBtnState();
    }

    function clearDeleteTarget() {
        if (pendingSkillDeleteIndex === null && pendingProjectDeleteIndex === null) return;
        pendingSkillDeleteIndex = null;
        pendingProjectDeleteIndex = null;
        renderPromptSelections();
    }

    function handlePromptBackspace(event) {
        if (event.key !== 'Backspace') {
            if (event.key.length === 1 || event.key === 'Enter' || event.key === 'Escape') {
                clearDeleteTarget();
            }
            return false;
        }
        if (pickerOpen) return false;
        if (promptSkills.length === 0 && promptProjects.length === 0) return false;
        if (typeof config.inputEl.selectionStart !== 'number' || config.inputEl.selectionStart !== config.inputEl.selectionEnd) return false;
        if (config.inputEl.selectionStart !== 0 || config.inputEl.value.length > 0) {
            clearDeleteTarget();
            return false;
        }

        event.preventDefault();
        if (promptProjects.length > 0) {
            var lastProjectIndex = promptProjects.length - 1;
            if (pendingProjectDeleteIndex === lastProjectIndex) {
                promptProjects.splice(lastProjectIndex, 1);
                pendingProjectDeleteIndex = null;
                handleSelectionChanged();
                return true;
            }
            pendingSkillDeleteIndex = null;
            pendingProjectDeleteIndex = lastProjectIndex;
            config.resetInputHistoryNavigation();
            renderPromptSelections();
            return true;
        }

        var lastIndex = promptSkills.length - 1;
        if (pendingSkillDeleteIndex === lastIndex) {
            promptSkills.splice(lastIndex, 1);
            pendingSkillDeleteIndex = null;
            handleSelectionChanged();
            return true;
        }

        pendingProjectDeleteIndex = null;
        pendingSkillDeleteIndex = lastIndex;
        config.resetInputHistoryNavigation();
        renderPromptSelections();
        return true;
    }

    function commitItem(item) {
        if (!item || pickerTokenStart === null || pickerTokenEnd === null) return;
        var value = config.inputEl.value;
        var nextValue = value.slice(0, pickerTokenStart) + value.slice(pickerTokenEnd);
        config.inputEl.value = nextValue;
        config.inputEl.setSelectionRange(pickerTokenStart, pickerTokenStart);
        config.resizeChatInput();
        if (item.pickerType === 'project') {
            addPromptProject(item);
        } else if (item.pickerType === 'provider-command') {
            config.showError('该命令暂未接入执行逻辑');
        } else {
            addPromptSkill(item);
        }
        close();
        config.inputEl.focus();
    }

    function renderPicker() {
        if (!config.skillPickerEl || !pickerOpen) return;
        filterItems();

        config.skillPickerEl.hidden = false;
        config.skillPickerEl.innerHTML = '';

        var list = document.createElement('div');
        list.className = 'skill-picker-list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', '快捷项列表');

        if (filteredItems.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'skill-picker-empty';
            empty.textContent = pickerItems.length === 0 ? '暂无可用技能、命令或项目' : '没有匹配的快捷项';
            list.appendChild(empty);
        } else {
            renderPickerGroups(list);
        }

        config.skillPickerEl.appendChild(list);
        updateActiveItem(true);
    }

    function renderPickerGroups(list) {
        var indexedItems = filteredItems.map(function (item, index) {
            return { item: item, index: index };
        });
        var groups = [];
        indexedItems.forEach(function (entry) {
            var title = entry.item.groupTitle || (entry.item.pickerType === 'project' ? '项目' : '技能');
            var group = groups.find(function (existing) { return existing.title === title; });
            if (!group) {
                group = { title: title, items: [] };
                groups.push(group);
            }
            group.items.push(entry);
        });

        groups.forEach(function (group) {
            if (group.items.length === 0) return;
            var label = document.createElement('div');
            label.className = 'skill-picker-group-label';
            label.setAttribute('role', 'presentation');
            label.textContent = group.title;
            list.appendChild(label);

            group.items.forEach(function (entry) {
                list.appendChild(createPickerItem(entry.item, entry.index));
            });
        });
    }

    function createPickerItem(item, index) {
        var node = document.createElement('button');
        var isActive = visualActive && index === activeIndex;
        node.className = 'skill-picker-item' + (isActive ? ' active' : '');
        node.type = 'button';
        node.dataset.index = String(index);
        node.setAttribute('role', 'option');
        node.setAttribute('aria-selected', isActive ? 'true' : 'false');

        var iconHtml = item.pickerType === 'project'
            ? getProjectIconHtml('skill-picker-icon project')
            : (item.pickerType === 'provider-command'
                ? getCommandIconHtml('skill-picker-icon')
                : getSkillIconHtml('skill-picker-icon'));
        var detailText = item.pickerType === 'project'
            ? (item.path || item.description || '')
            : (item.description || '');
        node.title = detailText ? (item.name + ' · ' + detailText) : item.name;
        node.innerHTML =
            iconHtml +
            '<span class="skill-picker-copy">' +
            '<span class="skill-picker-name">' + escapeHtml(item.name) + '</span>' +
            '<span class="skill-picker-desc">' + escapeHtml(detailText) + '</span>' +
            '</span>';
        node.addEventListener('mousemove', function () {
            setActiveIndex(index);
        });
        node.addEventListener('mousedown', function (event) {
            event.preventDefault();
        });
        node.addEventListener('click', function () {
            commitItem(item);
        });
        return node;
    }

    async function open(initialTrigger) {
        if (!config.skillPickerEl) return;
        if (isOpening) return;
        var startingTrigger = initialTrigger || getActiveTrigger();
        if (!isValidTrigger(startingTrigger)) return;
        isOpening = true;
        try {
            await config.fetchSlashItemsData();
        } finally {
            isOpening = false;
        }
        var trigger = getActiveTrigger();
        if (!isValidTrigger(trigger)) return;
        pickerItems = getEnabledItems();
        pickerOpen = true;
        pickerTokenStart = trigger.start;
        pickerTokenEnd = trigger.end;
        pickerQuery = trigger.query;
        activeIndex = 0;
        visualActive = false;
        renderPicker();
    }

    function insertSlashTrigger() {
        var caret = config.inputEl.selectionStart;
        var value = config.inputEl.value;
        config.inputEl.value = value.slice(0, caret) + '/' + value.slice(config.inputEl.selectionEnd);
        config.inputEl.setSelectionRange(caret + 1, caret + 1);
        config.resizeChatInput();
        config.updateSendBtnState();
        syncFromInput();
    }

    function handleKeydown(event) {
        if (!pickerOpen) return false;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveActive(1);
            return true;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveActive(-1);
            return true;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            var activeItem = filteredItems[activeIndex];
            if (activeItem) commitItem(activeItem);
            return true;
        }
        if (event.key === 'Tab') {
            event.preventDefault();
            var tabItem = filteredItems[activeIndex];
            if (tabItem) commitItem(tabItem);
            return true;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            close({ removeTrigger: true });
            config.inputEl.focus();
            return true;
        }
        return false;
    }

    function handleSelectionChanged() {
        config.resetInputHistoryNavigation();
        renderPromptSelections();
        config.updateSendBtnState();
    }

    return {
        canOpenFromSlash: canOpenFromSlash,
        clearDeleteTarget: clearDeleteTarget,
        clearPromptSelections: clearPromptSelections,
        close: close,
        getSelection: getSelection,
        handleKeydown: handleKeydown,
        handlePromptBackspace: handlePromptBackspace,
        insertSlashTrigger: insertSlashTrigger,
        isOpen: function () {
            return pickerOpen;
        },
        renderPromptSelections: renderPromptSelections,
        setSelection: setSelection,
        syncFromInput: syncFromInput,
    };
}
