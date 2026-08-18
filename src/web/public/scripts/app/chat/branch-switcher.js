var BRANCH_NAME_MAX_CHARS = 10;
var SEARCH_MIN_BRANCHES = 8;

var CHECK_ICON = '<svg class="branch-option-check" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var CHECK_PLACEHOLDER = '<span class="branch-option-check-placeholder"></span>';

function truncateBranchName(name) {
    var text = String(name || '');
    return text.length > BRANCH_NAME_MAX_CHARS ? text.slice(0, BRANCH_NAME_MAX_CHARS) + '…' : text;
}

export function createBranchSwitcher(options) {
    var switcher = options.switcher;
    var badge = options.badge;
    var nameEl = options.nameEl;
    var dropdown = options.dropdown;
    var current = '';
    var branches = [];
    var switching = false;
    var refreshSeq = 0;
    var filterText = '';
    var searchInput = null;
    var listEl = null;

    function setVisible(visible) {
        if (switcher) switcher.style.display = visible ? '' : 'none';
        if (!visible) setOpen(false);
    }

    function render() {
        if (nameEl) nameEl.textContent = truncateBranchName(current);
        if (badge) badge.title = '当前分支：' + (current || '未知');
        renderDropdown();
    }

    function renderBranchList() {
        if (!listEl) return;
        listEl.innerHTML = '';
        var keyword = filterText.trim().toLowerCase();
        var visible = keyword
            ? branches.filter(function (branch) {
                return branch.toLowerCase().indexOf(keyword) !== -1;
            })
            : branches;
        if (visible.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'branch-empty';
            empty.textContent = '无匹配分支';
            listEl.appendChild(empty);
            return;
        }
        visible.forEach(function (branch) {
            var isActive = branch === current;
            var opt = document.createElement('button');
            opt.type = 'button';
            opt.className = 'branch-option' + (isActive ? ' active' : '');
            opt.setAttribute('role', 'option');
            opt.setAttribute('aria-selected', isActive ? 'true' : 'false');
            opt.innerHTML =
                (isActive ? CHECK_ICON : CHECK_PLACEHOLDER) +
                '<span class="branch-option-name"></span>';
            opt.querySelector('.branch-option-name').textContent = branch;
            opt.title = branch;
            opt.addEventListener('click', function (e) {
                e.stopPropagation();
                selectBranch(branch);
            });
            listEl.appendChild(opt);
        });
    }

    function renderDropdown() {
        if (!dropdown) return;
        dropdown.innerHTML = '';
        searchInput = null;
        listEl = null;
        if (branches.length > SEARCH_MIN_BRANCHES) {
            var searchWrap = document.createElement('div');
            searchWrap.className = 'branch-search';
            searchInput = document.createElement('input');
            searchInput.className = 'branch-search-input';
            searchInput.type = 'text';
            searchInput.placeholder = '搜索分支…';
            searchInput.value = filterText;
            searchInput.addEventListener('input', function () {
                filterText = searchInput.value;
                renderBranchList();
            });
            searchInput.addEventListener('click', function (e) {
                e.stopPropagation();
            });
            searchWrap.appendChild(searchInput);
            dropdown.appendChild(searchWrap);
        }
        listEl = document.createElement('div');
        listEl.className = 'branch-list';
        dropdown.appendChild(listEl);
        renderBranchList();
    }

    function setOpen(isOpen) {
        if (!switcher || !badge) return;
        if (isOpen) {
            filterText = '';
            renderDropdown();
            if (searchInput) {
                setTimeout(function () {
                    if (searchInput) searchInput.focus();
                }, 0);
            }
        }
        switcher.classList.toggle('open', isOpen);
        badge.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    function buildQuery() {
        var sessionId = options.getCurrentSessionId ? options.getCurrentSessionId() : null;
        if (sessionId) return 'sessionId=' + encodeURIComponent(sessionId);
        var projectId = options.getActiveProjectId ? options.getActiveProjectId() : null;
        if (projectId) return 'projectId=' + encodeURIComponent(projectId);
        return '';
    }

    async function refresh() {
        var seq = ++refreshSeq;
        try {
            var query = buildQuery();
            var res = await fetch('/api/git/branches' + (query ? '?' + query : ''));
            if (seq !== refreshSeq) return;
            if (!res.ok) {
                setVisible(false);
                return;
            }
            var info = await res.json();
            if (seq !== refreshSeq) return;
            if (!info || !info.isGitRepo) {
                setVisible(false);
                return;
            }
            current = info.current || '';
            branches = Array.isArray(info.branches) ? info.branches : [];
            setVisible(true);
            render();
        } catch (_) {
            if (seq !== refreshSeq) return;
            setVisible(false);
        }
    }

    async function selectBranch(branch) {
        if (switching) return;
        if (branch === current) {
            setOpen(false);
            return;
        }
        var seq = refreshSeq;
        switching = true;
        try {
            var query = buildQuery();
            var body = { branch: branch };
            if (query.startsWith('sessionId=')) body.sessionId = decodeURIComponent(query.slice(10));
            else if (query.startsWith('projectId=')) body.projectId = decodeURIComponent(query.slice(10));
            var res = await fetch('/api/git/checkout', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body),
            });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok) {
                if (options.onError) options.onError(data.error || '切换分支失败');
                return;
            }
            if (seq !== refreshSeq) return;
            current = data.current || branch;
            render();
            setOpen(false);
        } catch (e) {
            if (options.onError) options.onError('切换分支失败');
        } finally {
            switching = false;
        }
    }

    if (badge) {
        badge.addEventListener('click', function (e) {
            e.stopPropagation();
            setOpen(!(switcher && switcher.classList.contains('open')));
        });
    }

    setVisible(false);

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
        refresh: refresh,
    };
}
