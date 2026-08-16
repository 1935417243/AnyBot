var PERMISSION_MODES = [
    { id: 'read-only', name: '只读', description: '只能读取文件，适合查看和问答' },
    { id: 'workspace-write', name: '工作区可写', description: '允许修改当前工作区文件，推荐日常开发使用' },
    { id: 'danger-full-access', name: '完全访问', description: '允许访问和修改更多本机文件，仅在信任任务时使用', danger: true },
];

var DEFAULT_MODE = 'workspace-write';

var CHECK_ICON = '<svg class="permission-option-check" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var CHECK_PLACEHOLDER = '<span class="permission-option-check-placeholder"></span>';

export function createPermissionMode(options) {
    var switcher = options.switcher;
    var badge = options.badge;
    var nameEl = options.nameEl;
    var dropdown = options.dropdown;
    var currentMode = DEFAULT_MODE;

    function findMode(id) {
        for (var i = 0; i < PERMISSION_MODES.length; i++) {
            if (PERMISSION_MODES[i].id === id) return PERMISSION_MODES[i];
        }
        return null;
    }

    function render() {
        var mode = findMode(currentMode) || findMode(DEFAULT_MODE);
        if (nameEl) nameEl.textContent = mode.name;
        if (badge) badge.title = '权限模式：' + mode.name;
        renderDropdown();
    }

    function renderDropdown() {
        if (!dropdown) return;
        dropdown.innerHTML = '';
        PERMISSION_MODES.forEach(function (mode) {
            var isActive = mode.id === currentMode;
            var opt = document.createElement('button');
            opt.type = 'button';
            opt.className = 'permission-option' + (isActive ? ' active' : '') + (mode.danger ? ' is-danger' : '');
            opt.setAttribute('role', 'option');
            opt.setAttribute('aria-selected', isActive ? 'true' : 'false');
            opt.innerHTML =
                '<div class="permission-option-title">' +
                (isActive ? CHECK_ICON : CHECK_PLACEHOLDER) +
                '<span>' + mode.name + '</span>' +
                '</div>' +
                '<div class="permission-option-desc">' + mode.description + '</div>';
            opt.addEventListener('click', function (e) {
                e.stopPropagation();
                selectMode(mode.id);
            });
            dropdown.appendChild(opt);
        });
    }

    function setOpen(isOpen) {
        if (!switcher || !badge) return;
        switcher.classList.toggle('open', isOpen);
        badge.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    async function fetchConfig() {
        try {
            var res = await fetch('/api/sandbox-config');
            if (!res.ok) return;
            var data = await res.json();
            if (data && findMode(data.defaultSandbox)) {
                currentMode = data.defaultSandbox;
                render();
            }
        } catch (e) {
            console.error('Failed to fetch sandbox config:', e);
        }
    }

    async function selectMode(id) {
        if (!findMode(id)) return;
        if (id === currentMode) {
            setOpen(false);
            return;
        }
        try {
            var res = await fetch('/api/sandbox-config', {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({defaultSandbox: id}),
            });
            if (!res.ok) {
                var err = await res.json().catch(function () { return {}; });
                if (options.onError) options.onError(err.error || '保存权限配置失败');
                return;
            }
            var data = await res.json();
            currentMode = findMode(data.defaultSandbox) ? data.defaultSandbox : id;
            render();
            setOpen(false);
            if (options.onChanged) options.onChanged(currentMode);
        } catch (e) {
            if (options.onError) options.onError('保存权限配置失败');
        }
    }

    if (badge) {
        badge.addEventListener('click', function (e) {
            e.stopPropagation();
            setOpen(!(switcher && switcher.classList.contains('open')));
        });
    }

    render();

    return {
        handleDocumentClick: function (e) {
            if (switcher && !switcher.contains(e.target)) setOpen(false);
        },
        handleEscape: function () {
            if (switcher && switcher.classList.contains('open')) {
                setOpen(false);
                if (badge) badge.focus();
                return true;
            }
            return false;
        },
        refresh: fetchConfig,
        setMode: function (id) {
            if (findMode(id) && id !== currentMode) {
                currentMode = id;
                render();
            }
        },
    };
}
