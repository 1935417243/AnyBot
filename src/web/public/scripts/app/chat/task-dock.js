const STATE_GLYPHS = {
    pending: '○',
    run: '●',
    done: '✓',
    fail: '✗',
};

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatRunningClock(startedAt) {
    var sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    return Math.floor(sec / 60) + ':' + pad2(sec % 60);
}

function formatDoneSeconds(durationMs) {
    return Math.max(0, Math.round(durationMs / 1000)) + 's';
}

function normalizeTaskState(status) {
    if (status === 'completed') return 'done';
    if (status === 'failed' || status === 'killed' || status === 'stopped') return 'fail';
    if (status === 'pending') return 'pending';
    return 'run';
}

function taskStateText(status) {
    if (status === 'completed') return '完成';
    if (status === 'failed') return '失败';
    if (status === 'stopped' || status === 'killed') return '已停止';
    if (status === 'pending') return '等待中';
    return '运行中';
}

function normalizeTodoState(status) {
    if (status === 'in_progress') return 'run';
    if (status === 'completed' || status === 'done') return 'done';
    return 'pending';
}

export function createTaskDock(options) {
    var inputArea = options.inputArea;
    var inputWrapper = inputArea ? inputArea.querySelector('.input-wrapper') : null;

    var tasks = new Map();
    var taskAliases = new Map();
    var taskToolIds = new Set();
    var todos = [];
    var openPanel = null;
    var ticker = null;

    var bar = document.createElement('div');
    bar.className = 'task-dock-bar';
    bar.hidden = true;

    var panel = document.createElement('div');
    panel.className = 'task-dock';
    panel.hidden = true;

    if (inputArea && inputWrapper) {
        inputArea.insertBefore(bar, inputWrapper);
        inputArea.appendChild(panel);
    }

    document.addEventListener('mousedown', function (event) {
        if (!openPanel) return;
        if (panel.contains(event.target) || bar.contains(event.target)) return;
        openPanel = null;
        render();
    }, true);

    function aliasTask(a, b) {
        if (!a || !b) return;
        taskAliases.set(a, b);
        taskAliases.set(b, a);
    }

    function resolveTaskId(id) {
        return taskAliases.get(id) || id;
    }

    function ensureTask(task) {
        var id = resolveTaskId(task.id || task.taskId || task.toolUseId);
        if (!id) return;
        var existing = tasks.get(id);
        if (!existing && task.toolUseId) {
            var toolId = resolveTaskId(task.toolUseId);
            existing = tasks.get(toolId);
            if (existing) {
                aliasTask(id, toolId);
                tasks.delete(toolId);
                tasks.set(id, existing);
            }
        }
        if (task.toolUseId) aliasTask(id, task.toolUseId);
        if (existing) {
            if (task.description) existing.description = task.description;
            if (task.taskType) existing.taskType = task.taskType;
            if (task.prompt) existing.prompt = task.prompt;
            return;
        }
        tasks.set(id, {
            id: id,
            description: task.description || '',
            taskType: task.taskType || '',
            prompt: task.prompt || '',
            summary: '',
            startedAt: task.startedAt || Date.now(),
            durationMs: null,
            status: task.status || 'running',
        });
    }

    function updateTask(event) {
        var id = resolveTaskId(event.taskId);
        var task = tasks.get(id);
        if (!task) return;
        if (event.description) task.description = event.description;
        if (event.summary) task.summary = event.summary;
        if (event.status) task.status = event.status;
        if (event.durationMs || event.durationMs === 0) task.durationMs = event.durationMs;
    }

    function finishTask(event) {
        var id = resolveTaskId(event.taskId);
        var task = tasks.get(id);
        if (!task) return;
        task.status = event.status || 'completed';
        if (event.summary) task.summary = event.summary;
        if (event.durationMs || event.durationMs === 0) task.durationMs = event.durationMs;
    }

    function hasRunningTask() {
        var running = false;
        tasks.forEach(function (task) {
            if (task.status === 'running' || task.status === 'pending') running = true;
        });
        return running;
    }

    function syncTicker() {
        var needTicker = openPanel === 'tasks' && hasRunningTask();
        if (needTicker && !ticker) {
            ticker = setInterval(function () {
                renderPanel();
            }, 1000);
        } else if (!needTicker && ticker) {
            clearInterval(ticker);
            ticker = null;
        }
    }

    function handleEvent(event) {
        if (!event || !event.type) return;
        if (event.type === 'task_start') {
            ensureTask(event.task || {});
        } else if (event.type === 'task_progress') {
            updateTask(event);
        } else if (event.type === 'task_end') {
            finishTask(event);
        } else if (event.type === 'tool_start' && event.tool &&
            (event.tool.name === 'Agent' || event.tool.name === 'Task')) {
            taskToolIds.add(event.tool.id);
            ensureTask({
                id: event.tool.id,
                toolUseId: event.tool.id,
                description: event.tool.summary || event.tool.title || '',
                startedAt: event.tool.startedAt,
                status: 'running',
            });
        } else if (event.type === 'tool_end' && taskToolIds.has(event.toolId)) {
            finishTask({
                taskId: event.toolId,
                status: event.status === 'failed' ? 'failed' : 'completed',
                durationMs: event.durationMs,
            });
        } else if (event.type === 'todo_update') {
            todos = Array.isArray(event.todos) ? event.todos : [];
        } else if (event.type === 'result' || event.type === 'codex_answer_done' ||
            event.type === 'error' || event.type === 'cancelled' || event.type === 'done') {
            tasks.forEach(function (task) {
                if (task.status === 'running' || task.status === 'pending') task.status = 'stopped';
            });
        } else {
            return;
        }
        render();
    }

    function reset() {
        tasks.clear();
        taskAliases.clear();
        taskToolIds.clear();
        todos = [];
        openPanel = null;
        if (ticker) {
            clearInterval(ticker);
            ticker = null;
        }
        render();
    }

    function togglePanel(name) {
        openPanel = openPanel === name ? null : name;
        render();
    }

    var ICONS = {
        tasks:
            '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
            '<path d="M7 1.5l1.4 3.9 3.9 1.4-3.9 1.4L7 12.1l-1.4-3.9-3.9-1.4 3.9-1.4L7 1.5z" fill="currentColor"/>' +
            '</svg>',
        todos:
            '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
            '<path d="M2 3.5h5M2 7h4M2 10.5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
            '<path d="M8 10.2l1.6 1.6L13 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>',
    };

    function makePill(label, panelName) {
        var pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'task-dock-pill' + (openPanel === panelName ? ' active' : '');
        pill.setAttribute('aria-pressed', openPanel === panelName ? 'true' : 'false');
        pill.innerHTML = ICONS[panelName] || '';
        var text = document.createElement('span');
        text.textContent = label;
        pill.appendChild(text);
        pill.addEventListener('click', function () {
            togglePanel(panelName);
        });
        return pill;
    }

    function renderBar() {
        bar.innerHTML = '';
        if (tasks.size === 0 && todos.length === 0) {
            bar.hidden = true;
            return;
        }
        bar.hidden = false;
        if (tasks.size > 0) {
            bar.appendChild(makePill('子 Agent (' + tasks.size + ')', 'tasks'));
        }
        if (todos.length > 0) {
            var done = todos.filter(function (todo) {
                return normalizeTodoState(todo.status) === 'done';
            }).length;
            bar.appendChild(makePill('待办 (' + done + '/' + todos.length + ')', 'todos'));
        }
    }

    function makeGlyph(state) {
        var glyph = document.createElement('span');
        glyph.className = 'td-glyph s-' + state;
        glyph.textContent = STATE_GLYPHS[state] || STATE_GLYPHS.pending;
        return glyph;
    }

    function taskTimingText(task) {
        if (task.status === 'running' || task.status === 'pending') {
            return '运行中 · ' + formatRunningClock(task.startedAt);
        }
        var text = taskStateText(task.status);
        if (task.durationMs || task.durationMs === 0) {
            text += ' · ' + formatDoneSeconds(task.durationMs);
        }
        return text;
    }

    function renderTasksPanel() {
        var running = 0;
        tasks.forEach(function (task) {
            if (task.status === 'running' || task.status === 'pending') running += 1;
        });
        var header = document.createElement('div');
        header.className = 'task-dock-head';
        header.textContent = '子 Agent · ' + running + ' 运行中';
        panel.appendChild(header);

        var body = document.createElement('div');
        body.className = 'task-dock-body';
        tasks.forEach(function (task) {
            var state = normalizeTaskState(task.status);
            var row = document.createElement('div');
            row.className = 'td-row ' + state;
            row.appendChild(makeGlyph(state));

            var name = document.createElement('span');
            name.className = 'td-name';
            name.textContent = task.summary || task.description || task.prompt || task.id;
            name.title = name.textContent;
            row.appendChild(name);

            if (task.taskType) {
                var badge = document.createElement('span');
                badge.className = 'td-badge';
                badge.textContent = task.taskType;
                row.appendChild(badge);
            }

            var time = document.createElement('span');
            time.className = 'td-time';
            time.textContent = taskTimingText(task);
            row.appendChild(time);

            body.appendChild(row);
        });
        panel.appendChild(body);
    }

    function renderTodosPanel() {
        var done = todos.filter(function (todo) {
            return normalizeTodoState(todo.status) === 'done';
        }).length;
        var header = document.createElement('div');
        header.className = 'task-dock-head';
        header.textContent = '待办 · ' + done + '/' + todos.length;
        panel.appendChild(header);

        var body = document.createElement('div');
        body.className = 'task-dock-body';
        todos.forEach(function (todo) {
            var state = normalizeTodoState(todo.status);
            var row = document.createElement('div');
            row.className = 'td-row ' + state;
            row.appendChild(makeGlyph(state));

            var name = document.createElement('span');
            name.className = 'td-name';
            name.textContent = todo.content || '';
            name.title = name.textContent;
            row.appendChild(name);

            body.appendChild(row);
        });
        panel.appendChild(body);
    }

    function renderPanel() {
        panel.innerHTML = '';
        if (openPanel === 'tasks' && tasks.size === 0) openPanel = null;
        if (openPanel === 'todos' && todos.length === 0) openPanel = null;
        if (!openPanel) {
            panel.hidden = true;
            return;
        }
        panel.hidden = false;
        if (openPanel === 'tasks') renderTasksPanel();
        else renderTodosPanel();
    }

    function render() {
        renderBar();
        renderPanel();
        syncTicker();
    }

    render();

    return {
        handleEvent: handleEvent,
        reset: reset,
    };
}
