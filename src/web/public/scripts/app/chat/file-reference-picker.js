import { escapeHtml } from '../utils/html.js';
import { getFileIconHtml, normalizeMessageFileReferences } from './message-selection.js';

const MAX_VISIBLE_FILES = 120;

function matchesTerm(values, term) {
    return values.some(function (value) {
        var normalized = String(value || '').toLowerCase();
        if (!normalized) return false;
        if (normalized.indexOf(term) !== -1) return true;
        return normalized
            .split(/[^a-z0-9\u4e00-\u9fff]+/)
            .filter(Boolean)
            .some(function (part) { return part.startsWith(term); });
    });
}

function normalizeFiles(files) {
    return normalizeMessageFileReferences(files);
}

export function createFileReferencePickerController(config) {
    var pickerOpen = false;
    var pickerQuery = '';
    var pickerTokenStart = null;
    var pickerTokenEnd = null;
    var pickerFiles = [];
    var filteredFiles = [];
    var selectedFiles = [];
    var activeIndex = 0;
    var visualActive = false;
    var loading = false;
    var requestId = 0;
    var pendingFileDeleteIndex = null;

    function getSelection() {
        return selectedFiles.slice();
    }

    function setSelection(files) {
        selectedFiles = normalizeMessageFileReferences(files);
        pendingFileDeleteIndex = null;
        renderSelectedFiles();
        config.resizeChatInput();
        config.updateSendBtnState();
        config.inputEl.focus();
    }

    function getActiveTrigger() {
        if (typeof config.inputEl.selectionStart !== 'number' || typeof config.inputEl.selectionEnd !== 'number') return null;
        if (config.inputEl.selectionStart !== config.inputEl.selectionEnd) return null;
        var caret = config.inputEl.selectionStart;
        var before = config.inputEl.value.slice(0, caret);
        var match = before.match(/(^|\s)@([^\s@]*)$/);
        if (!match) return null;
        return {
            start: before.length - match[2].length - 1,
            end: caret,
            query: match[2],
        };
    }

    function isValidTrigger(trigger) {
        if (!trigger) return false;
        return config.getCurrentView() === 'chat';
    }

    function close() {
        requestId++;
        pickerOpen = false;
        pickerQuery = '';
        pickerTokenStart = null;
        pickerTokenEnd = null;
        filteredFiles = [];
        activeIndex = 0;
        visualActive = false;
        loading = false;
        if (config.filePickerEl) {
            config.filePickerEl.hidden = true;
            config.filePickerEl.innerHTML = '';
        }
    }

    function clearSelection() {
        selectedFiles = [];
        pendingFileDeleteIndex = null;
        renderSelectedFiles();
        config.updateSendBtnState();
    }

    function clearDeleteTarget() {
        if (pendingFileDeleteIndex === null) return;
        pendingFileDeleteIndex = null;
        renderSelectedFiles();
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
        visualActive = true;
        filterFiles();
        renderPicker();
    }

    function filterFiles() {
        var term = pickerQuery.toLowerCase().trim();
        var selectedPaths = new Set(selectedFiles.map(function (file) { return file.path; }));
        var nextFiltered = pickerFiles.filter(function (file) {
            return !selectedPaths.has(file.path);
        });
        if (term) {
            nextFiltered = nextFiltered.filter(function (file) {
                return matchesTerm([file.path, file.name], term);
            });
        }
        filteredFiles = nextFiltered.slice(0, MAX_VISIBLE_FILES);
        if (activeIndex >= filteredFiles.length) {
            activeIndex = Math.max(0, filteredFiles.length - 1);
        }
    }

    async function fetchFiles() {
        var sessionId = config.getCurrentSessionId();
        if (!sessionId) return [];
        try {
            var res = await fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/files/mentions');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            return normalizeFiles(data && data.files);
        } catch (error) {
            console.warn('Failed to fetch @ file list:', error);
            return [];
        }
    }

    async function open(initialTrigger) {
        if (!config.filePickerEl) return;
        var startingTrigger = initialTrigger || getActiveTrigger();
        if (!isValidTrigger(startingTrigger)) return;

        var currentRequestId = requestId + 1;
        requestId = currentRequestId;
        pickerOpen = true;
        pickerTokenStart = startingTrigger.start;
        pickerTokenEnd = startingTrigger.end;
        pickerQuery = startingTrigger.query;
        pickerFiles = [];
        filteredFiles = [];
        activeIndex = 0;
        visualActive = false;
        loading = true;
        renderPicker();

        var files = await fetchFiles();
        if (requestId !== currentRequestId) return;

        loading = false;
        var trigger = getActiveTrigger();
        if (!isValidTrigger(trigger)) {
            close();
            return;
        }

        pickerFiles = files;
        if (pickerFiles.length === 0) {
            close();
            return;
        }

        pickerTokenStart = trigger.start;
        pickerTokenEnd = trigger.end;
        pickerQuery = trigger.query;
        activeIndex = 0;
        visualActive = true;
        filterFiles();
        renderPicker();
    }

    function moveActive(delta) {
        if (loading || filteredFiles.length === 0) return;
        var count = filteredFiles.length;
        if (!visualActive) {
            activeIndex = delta > 0 ? 0 : count - 1;
        } else {
            activeIndex = (activeIndex + delta + count) % count;
        }
        visualActive = true;
        updateActiveItem(true);
    }

    function setActiveIndex(index) {
        if (index < 0 || index >= filteredFiles.length) return;
        if (activeIndex === index && visualActive) return;
        activeIndex = index;
        visualActive = true;
        updateActiveItem(false);
    }

    function updateActiveItem(scrollIntoView) {
        if (!config.filePickerEl) return;
        var activeItem = null;
        Array.prototype.forEach.call(config.filePickerEl.querySelectorAll('.skill-picker-item'), function (item) {
            var isActive = visualActive && Number(item.dataset.index) === activeIndex;
            item.classList.toggle('active', isActive);
            item.setAttribute('aria-selected', isActive ? 'true' : 'false');
            if (isActive) activeItem = item;
        });
        if (scrollIntoView && activeItem) activeItem.scrollIntoView({ block: 'nearest' });
    }

    function renderSelectedFiles() {
        if (!config.selectedFilesEl) return;
        config.selectedFilesEl.innerHTML = '';
        config.selectedFilesEl.hidden = selectedFiles.length === 0;
        selectedFiles.forEach(function (file, index) {
            config.selectedFilesEl.appendChild(createSelectedFileChip(file, index));
        });
    }

    function createSelectedFileChip(file, index) {
        var chip = document.createElement('button');
        chip.className = 'selected-skill-chip selected-file-chip' + (index === pendingFileDeleteIndex ? ' pending-delete' : '');
        chip.type = 'button';
        chip.title = '移除文件 ' + file.path;
        chip.innerHTML =
            getFileIconHtml('selected-skill-icon') +
            '<span class="selected-skill-name">' + escapeHtml(file.name || file.path) + '</span>' +
            '<span class="selected-skill-remove" aria-hidden="true">×</span>';
        chip.addEventListener('click', function () {
            pendingFileDeleteIndex = null;
            selectedFiles.splice(index, 1);
            renderSelectedFiles();
            config.updateSendBtnState();
            config.inputEl.focus();
        });
        return chip;
    }

    function addSelectedFile(file) {
        if (!file || !file.path) return;
        var alreadySelected = selectedFiles.some(function (item) {
            return item.path === file.path;
        });
        if (alreadySelected) return;
        pendingFileDeleteIndex = null;
        selectedFiles.push({
            name: file.name || file.path,
            path: file.path,
        });
        renderSelectedFiles();
        config.updateSendBtnState();
    }

    function commitItem(file) {
        if (!file || pickerTokenStart === null || pickerTokenEnd === null) return;
        var value = config.inputEl.value;
        var nextValue = value.slice(0, pickerTokenStart) + value.slice(pickerTokenEnd);
        var cursor = pickerTokenStart;
        config.inputEl.value = nextValue;
        config.inputEl.setSelectionRange(cursor, cursor);
        config.resizeChatInput();
        addSelectedFile(file);
        close();
        config.inputEl.focus();
    }

    function renderPicker() {
        if (!config.filePickerEl || !pickerOpen) return;

        config.filePickerEl.hidden = false;
        config.filePickerEl.innerHTML = '';

        var list = document.createElement('div');
        list.className = 'skill-picker-list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', '文件列表');

        if (loading) {
            var loadingNode = document.createElement('div');
            loadingNode.className = 'skill-picker-empty';
            loadingNode.textContent = '正在加载文件...';
            list.appendChild(loadingNode);
        } else if (filteredFiles.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'skill-picker-empty';
            empty.textContent = pickerFiles.length === 0 ? '暂无可引用文件' : '没有匹配的文件';
            list.appendChild(empty);
        } else {
            renderFileList(list);
        }

        config.filePickerEl.appendChild(list);
        updateActiveItem(true);
    }

    function renderFileList(list) {
        var label = document.createElement('div');
        label.className = 'skill-picker-group-label';
        label.setAttribute('role', 'presentation');
        label.textContent = '文件';
        list.appendChild(label);

        filteredFiles.forEach(function (file, index) {
            list.appendChild(createPickerItem(file, index));
        });
    }

    function createPickerItem(file, index) {
        var node = document.createElement('button');
        var isActive = visualActive && index === activeIndex;
        node.className = 'skill-picker-item file-picker-item';
        if (isActive) node.className += ' active';
        node.type = 'button';
        node.dataset.index = String(index);
        node.setAttribute('role', 'option');
        node.setAttribute('aria-selected', isActive ? 'true' : 'false');
        node.title = file.path;
        node.innerHTML =
            getFileIconHtml('skill-picker-icon') +
            '<span class="skill-picker-copy">' +
            '<span class="skill-picker-name">' + escapeHtml(file.name) + '</span>' +
            '<span class="skill-picker-desc">' + escapeHtml(file.path) + '</span>' +
            '</span>';
        node.addEventListener('mousemove', function () {
            setActiveIndex(index);
        });
        node.addEventListener('mousedown', function (event) {
            event.preventDefault();
        });
        node.addEventListener('click', function () {
            commitItem(file);
        });
        return node;
    }

    function handleSelectedFileDelete(event) {
        if (event.key !== 'Backspace' && event.key !== 'Delete') {
            if (event.key.length === 1 || event.key === 'Enter' || event.key === 'Escape') {
                clearDeleteTarget();
            }
            return false;
        }
        if (pickerOpen || selectedFiles.length === 0) return false;
        if (typeof config.inputEl.selectionStart !== 'number' || config.inputEl.selectionStart !== config.inputEl.selectionEnd) return false;
        if (config.inputEl.selectionStart !== 0 || config.inputEl.value.length > 0) {
            clearDeleteTarget();
            return false;
        }

        event.preventDefault();
        var lastIndex = selectedFiles.length - 1;
        if (pendingFileDeleteIndex === lastIndex) {
            selectedFiles.splice(lastIndex, 1);
            pendingFileDeleteIndex = null;
            renderSelectedFiles();
            config.updateSendBtnState();
            return true;
        }

        pendingFileDeleteIndex = lastIndex;
        renderSelectedFiles();
        return true;
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
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            config.inputEl.focus();
            return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
            var activeItem = loading ? null : filteredFiles[activeIndex];
            event.preventDefault();
            if (activeItem) commitItem(activeItem);
            return true;
        }
        return false;
    }

    return {
        clearSelection: clearSelection,
        clearDeleteTarget: clearDeleteTarget,
        close: close,
        getSelection: getSelection,
        handleKeydown: handleKeydown,
        handleSelectedFileDelete: handleSelectedFileDelete,
        isOpen: function () {
            return pickerOpen;
        },
        setSelection: setSelection,
        syncFromInput: syncFromInput,
    };
}
