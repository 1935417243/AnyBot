(function () {
    var LARGE_MESSAGE_PREVIEW_CHARS = 20000;
    var STREAMING_ANSWER_PREVIEW_CHARS = 12000;
    var STREAMING_RENDER_INTERVAL_MS = 90;
    var LONG_SHELL_COMMAND_CHARS = 300;
    var SHELL_COMMAND_SUMMARY_CHARS = 220;

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function formatDuration(ms) {
        if (!ms && ms !== 0) return '';
        var seconds = Math.max(0, Math.round(ms / 1000));
        var mins = Math.floor(seconds / 60);
        var secs = seconds % 60;
        return mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';
    }

    function truncateText(value, maxChars) {
        var text = String(value || '');
        if (text.length <= maxChars) return text;
        return text.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
    }

    function previewStreamingText(value, maxChars, note) {
        var text = String(value || '');
        if (text.length <= maxChars) return text;
        return text.slice(0, maxChars).trimEnd() + '\n\n...[' + note + ']';
    }

    function isLongShellCommand(tool) {
        if (!tool) return false;
        if (tool.commandTruncated) return true;
        return String(tool.summary || '').length > LONG_SHELL_COMMAND_CHARS;
    }

    function shellCommandSummary(command) {
        var text = String(command || '').trim();
        if (!text) return '';
        if (text.length <= SHELL_COMMAND_SUMMARY_CHARS) return text.replace(/\s+/g, ' ');
        var firstLine = text.split(/\r?\n/)[0].trim();
        var basis = firstLine || text.replace(/\s+/g, ' ');
        return truncateText(basis.replace(/\s+/g, ' '), SHELL_COMMAND_SUMMARY_CHARS);
    }

    function renderShellCommand(command) {
        var text = String(command || '');
        if (!text) return '';
        return '<pre><code>$ ' + escapeHtml(text) + '</code></pre>';
    }

    function renderMarkdown(text) {
        if (!text) return '';
        try {
            if (window.AnyBotMarkdown && typeof window.AnyBotMarkdown.render === 'function') {
                return window.AnyBotMarkdown.render(text);
            }
            var html = typeof marked !== 'undefined' ? marked.parse(text) : escapeHtml(text);
            if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
                return window.DOMPurify.sanitize(html, {
                    ADD_ATTR: ['target'],
                    FORBID_TAGS: ['style'],
                    FORBID_ATTR: ['style'],
                });
            }
            return html;
        } catch (_) {
            return escapeHtml(text);
        }
    }

    function enhanceLocalFileLinks(root) {
        if (
            window.AnyBotLocalFiles &&
            typeof window.AnyBotLocalFiles.enhance === 'function'
        ) {
            window.AnyBotLocalFiles.enhance(root);
        }
    }

    function parseSseChunk(buffer, onEvent) {
        var boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
            var raw = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            var eventName = 'message';
            var dataLines = [];
            raw.split('\n').forEach(function (line) {
                if (line.startsWith('event:')) eventName = line.slice(6).trim();
                if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
            });
            if (dataLines.length > 0) {
                try {
                    onEvent(eventName, JSON.parse(dataLines.join('\n')));
                } catch (e) {
                    console.warn('Failed to parse Claude Agent event', e);
                }
            }
            boundary = buffer.indexOf('\n\n');
        }
        return buffer;
    }

    function createMessage(opts) {
        var messagesEl = opts.messagesEl;
        var scrollBottom = opts.scrollBottom || function () {};
        var startedAt = opts.startedAt || Date.now();
        var isPersisted = !!opts.persisted;

        var state = {
            answerText: '',
            processTextSegments: [],
            activeProcessTextSegment: null,
            thinkingSegments: [],
            activeThinkingSegment: null,
            activeActivitySegment: null,
            tools: new Map(),
            tasks: new Map(),
            taskAliases: new Map(),
            readFiles: new Set(),
            searchCount: 0,
            listCount: 0,
            bashCount: 0,
            editCount: 0,
            webCount: 0,
            status: 'running',
            durationMs: Math.max(0, Date.now() - startedAt),
            changeReview: opts.changeReview || null,
            answerIsTruncated: !!opts.contentTruncated,
            answerChars: opts.contentChars || 0,
            fullAnswerLoader: opts.fullContentLoader || null,
        };
        var hasAttachedCompletionMeta = false;
        var scheduledAnswerRender = null;

        var row = document.createElement('div');
        row.className = 'message-row ai';

        var bubble = document.createElement('div');
        bubble.className = 'bubble';

        var avatar = document.createElement('div');
        avatar.className = 'avatar ai-avatar';
        avatar.textContent = 'Ab';

        var content = document.createElement('div');
        content.className = 'message-content claude-agent-message';

        var process = document.createElement('details');
        process.className = 'claude-process not-expandable';
        process.open = false;

        var processSummary = document.createElement('summary');
        processSummary.className = 'claude-process-summary';
        processSummary.setAttribute('aria-disabled', 'true');
        processSummary.innerHTML =
            '<span class="claude-process-title" data-role="title">处理中 ' + formatDuration(state.durationMs) + '</span>' +
            '<span class="claude-process-chevron">›</span>';

        var processBody = document.createElement('div');
        processBody.className = 'claude-process-body';

        var taskSection = document.createElement('div');
        taskSection.className = 'claude-task-section';
        taskSection.style.display = 'none';
        taskSection.innerHTML =
            '<div class="claude-task-section-header">' +
            '<span class="claude-task-section-title">并行任务</span>' +
            '<span class="claude-task-section-meta" data-role="task-section-meta"></span>' +
            '</div>';

        var taskList = document.createElement('div');
        taskList.className = 'claude-task-list';
        taskSection.appendChild(taskList);

        var activityList = document.createElement('div');
        activityList.className = 'claude-activity-list';

        processBody.appendChild(taskSection);
        processBody.appendChild(activityList);
        process.appendChild(processSummary);
        process.appendChild(processBody);

        var finalEl = document.createElement('div');
        finalEl.className = 'claude-final-answer streaming';
        finalEl.innerHTML = isPersisted ? '' :
            '<div class="typing-indicator compact">' +
            '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>' +
            '</div>';

        content.appendChild(process);
        content.appendChild(finalEl);
        bubble.appendChild(avatar);
        bubble.appendChild(content);
        row.appendChild(bubble);
        messagesEl.appendChild(row);
        if (isPersisted) attachCompletionMeta();
        scrollBottom();

        var ticker = isPersisted ? null : setInterval(function () {
            if (state.status !== 'running') {
                clearInterval(ticker);
                return;
            }
            state.durationMs = Date.now() - startedAt;
            updateProcessTitle();
        }, 1000);

        processSummary.addEventListener('click', function (event) {
            if (!hasProcessDetails()) event.preventDefault();
        });

        processSummary.addEventListener('keydown', function (event) {
            if (!hasProcessDetails() && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
            }
        });

        process.addEventListener('toggle', function () {
            if (process.open && !hasProcessDetails()) process.open = false;
        });

        function attachCompletionMeta() {
            if (hasAttachedCompletionMeta) return;
            if (!window.AnyBotMessageMeta || typeof window.AnyBotMessageMeta.attach !== 'function') return;
            hasAttachedCompletionMeta = true;
            window.AnyBotMessageMeta.attach(row, {
                createdAt: opts.createdAt || startedAt,
                copyText: function () { return state.answerText || finalEl.textContent || ''; },
            });
        }

        function updateProcessTitle() {
            var title = processSummary.querySelector('[data-role="title"]');
            var duration = formatDuration(state.durationMs || (Date.now() - startedAt));
            title.textContent = (state.status === 'running' ? '处理中 ' : '已处理 ') + duration;
        }

        function hasProcessDetails() {
            var hasProcessText = state.processTextSegments.some(function (segment) {
                return !!String(segment.text || '').trim();
            });
            var hasThinkingText = state.thinkingSegments.some(function (segment) {
                return !!String(segment.text || '').trim();
            });
            return hasProcessText ||
                hasThinkingText ||
                state.tools.size > 0 ||
                state.tasks.size > 0 ||
                state.readFiles.size > 0 ||
                state.searchCount > 0 ||
                state.listCount > 0 ||
                state.webCount > 0 ||
                state.bashCount > 0 ||
                state.editCount > 0;
        }

        function updateProcessAvailability() {
            var canExpand = hasProcessDetails();
            process.classList.toggle('not-expandable', !canExpand);
            processSummary.setAttribute('aria-disabled', canExpand ? 'false' : 'true');
            if (!canExpand && process.open) process.open = false;
        }

        function openProcessIfAvailable() {
            updateProcessAvailability();
            if (state.status === 'running' && hasProcessDetails()) process.open = true;
        }

        function createActivityStats() {
            return {
                readFiles: new Set(),
                searchCount: 0,
                listCount: 0,
                bashCount: 0,
                editCount: 0,
                webCount: 0,
                taskIds: new Set(),
            };
        }

        function createActivitySummaryElement() {
            var el = document.createElement('details');
            el.className = 'claude-activity-summary claude-thinking-activity-summary';
            el.style.display = 'none';
            el.innerHTML =
                '<summary class="claude-activity-summary-row">' +
                '<span class="claude-activity-icon">›_</span>' +
                '<span data-role="activity-summary"></span>' +
                '<span class="claude-thinking-activity-chevron">›</span>' +
                '</summary>' +
                '<div class="claude-thinking-activity-items" data-role="activity-items"></div>';
            return el;
        }

        function getActivityStats(segment) {
            return segment && segment.stats;
        }

        function recordReadFile(path, segment) {
            if (!path) return;
            state.readFiles.add(path);
            var stats = getActivityStats(segment || state.activeActivitySegment);
            if (stats) stats.readFiles.add(path);
        }

        function recordActivityCount(key, segment) {
            state[key] += 1;
            var stats = getActivityStats(segment || state.activeActivitySegment);
            if (stats) stats[key] += 1;
        }

        function recordTaskActivity(taskId, segment) {
            var stats = getActivityStats(segment || state.activeActivitySegment);
            if (stats && taskId) stats.taskIds.add(taskId);
        }

        function appendSegmentActivityElement(el) {
            var segment = state.activeActivitySegment;
            if (!segment || !segment.activityItemsEl) return null;
            segment.activityItemsEl.appendChild(el);
            return segment;
        }

        function updateActivitySummary(segment) {
            if (arguments.length === 0) segment = state.activeActivitySegment;
            if (!segment || !segment.stats || !segment.summaryEl) {
                updateProcessAvailability();
                return;
            }
            var stats = segment.stats;
            var exploredParts = [];
            var actionParts = [];
            if (stats.readFiles.size > 0) exploredParts.push(stats.readFiles.size + ' 个文件');
            if (stats.searchCount > 0) exploredParts.push(stats.searchCount + ' 次搜索');
            if (stats.listCount > 0) exploredParts.push(stats.listCount + ' 个列表');
            if (stats.webCount > 0) actionParts.push('已搜索网页 ' + stats.webCount + ' 次');
            if (stats.taskIds.size > 0) actionParts.push('已启动 ' + stats.taskIds.size + ' 个并行任务');
            if (stats.bashCount > 0) actionParts.push('已运行 ' + stats.bashCount + ' 条命令');
            if (stats.editCount > 0) actionParts.push('已修改 ' + stats.editCount + ' 个文件');

            if (exploredParts.length === 0 && actionParts.length === 0) {
                segment.summaryEl.style.display = 'none';
                updateProcessAvailability();
                return;
            }

            var parts = [];
            if (exploredParts.length > 0) parts.push('已探索 ' + exploredParts.join('，'));
            parts.push.apply(parts, actionParts);
            segment.summaryEl.style.display = 'block';
            segment.summaryEl.querySelector('[data-role="activity-summary"]').textContent = parts.join('，');
            updateProcessAvailability();
        }

        function renderAnswer() {
            clearScheduledAnswerRender();
            finalEl.classList.remove('streaming');
            var answerText = String(state.answerText || '');
            var isLarge = state.answerIsTruncated || answerText.length > LARGE_MESSAGE_PREVIEW_CHARS;
            var visibleText = isLarge
                ? (state.answerIsTruncated ? answerText : answerText.slice(0, LARGE_MESSAGE_PREVIEW_CHARS) + '\n\n...[内容较长，已折叠]')
                : answerText;
            finalEl.innerHTML = renderMarkdown(visibleText);
            enhanceLocalFileLinks(finalEl);
            finalEl.querySelectorAll('pre code').forEach(function (block) {
                if (typeof hljs !== 'undefined') hljs.highlightElement(block);
            });
            if (isLarge) {
                var expand = document.createElement('button');
                expand.className = 'large-message-expand';
                expand.type = 'button';
                expand.textContent = state.answerChars ? ('展开完整内容（' + state.answerChars + ' 字符）') : '展开完整内容';
                expand.addEventListener('click', async function () {
                    expand.disabled = true;
                    expand.textContent = '加载中...';
                    if (state.answerIsTruncated && state.fullAnswerLoader) {
                        try {
                            state.answerText = await state.fullAnswerLoader();
                            state.answerIsTruncated = false;
                        } catch (_) {
                            expand.disabled = false;
                            expand.textContent = '展开完整内容';
                            return;
                        }
                    }
                    finalEl.innerHTML = renderMarkdown(state.answerText);
                    enhanceLocalFileLinks(finalEl);
                    finalEl.querySelectorAll('pre code').forEach(function (block) {
                        if (typeof hljs !== 'undefined') hljs.highlightElement(block);
                    });
                    renderChangeReview();
                });
                finalEl.appendChild(expand);
            }
            renderChangeReview();
            scrollBottom();
        }

        function renderStreamingAnswer() {
            if (state.status !== 'running') return;
            var answerText = String(state.answerText || '');
            if (!answerText) return;
            var visibleText = previewStreamingText(answerText, STREAMING_ANSWER_PREVIEW_CHARS, '回复较长，完成后显示完整内容');
            finalEl.classList.add('streaming');
            finalEl.innerHTML = renderMarkdown(visibleText);
            enhanceLocalFileLinks(finalEl);
            finalEl.querySelectorAll('pre code').forEach(function (block) {
                if (typeof hljs !== 'undefined') hljs.highlightElement(block);
            });
            scrollBottom();
        }

        function clearScheduledAnswerRender() {
            if (!scheduledAnswerRender) return;
            clearTimeout(scheduledAnswerRender);
            scheduledAnswerRender = null;
        }

        function scheduleStreamingAnswerRender() {
            if (isPersisted) {
                renderStreamingAnswer();
                return;
            }
            if (scheduledAnswerRender) return;
            scheduledAnswerRender = setTimeout(function () {
                scheduledAnswerRender = null;
                renderStreamingAnswer();
            }, STREAMING_RENDER_INTERVAL_MS);
        }

        function scheduleSegmentRender(segment, renderFn) {
            if (isPersisted) {
                renderFn(segment);
                return;
            }
            if (segment.renderTimer) return;
            segment.renderTimer = setTimeout(function () {
                segment.renderTimer = null;
                renderFn(segment);
            }, STREAMING_RENDER_INTERVAL_MS);
        }

        function appendAnswerText(text) {
            if (!text || isPersisted) return;
            state.answerText += text;
            scheduleStreamingAnswerRender();
        }

        function renderChangeReview() {
            if (!state.changeReview || !window.ChangeReview) return;
            var existing = content.querySelector('.change-review-card');
            if (existing) existing.remove();
            var reviewCard = window.ChangeReview.render({
                review: state.changeReview,
                scrollBottom: scrollBottom,
            });
            if (reviewCard) content.appendChild(reviewCard);
        }

        function renderProcessTextSegment(segment) {
            if (!segment.text) {
                segment.el.remove();
                return;
            }
            segment.el.innerHTML = renderMarkdown(segment.text);
            segment.el.querySelectorAll('pre code').forEach(function (block) {
                if (typeof hljs !== 'undefined') hljs.highlightElement(block);
            });
            scrollBottom();
        }

        function appendProcessText(text) {
            if (!text) return;
            state.activeThinkingSegment = null;
            var segment = state.activeProcessTextSegment;
            if (!segment) {
                var el = document.createElement('div');
                el.className = 'claude-process-text';
                segment = { el: el, text: '' };
                state.processTextSegments.push(segment);
                state.activeProcessTextSegment = segment;
                activityList.appendChild(el);
            }
            segment.text += text;
            scheduleSegmentRender(segment, renderProcessTextSegment);
            updateProcessAvailability();
        }

        function renderThinkingSegment(segment) {
            if (!segment.text) {
                segment.el.remove();
                return;
            }
            segment.body.innerHTML = renderMarkdown(segment.text);
            segment.body.querySelectorAll('pre code').forEach(function (block) {
                if (typeof hljs !== 'undefined') hljs.highlightElement(block);
            });
            scrollBottom();
        }

        function appendThinkingText(text) {
            if (!text) return;
            state.activeProcessTextSegment = null;
            var segment = state.activeThinkingSegment;
            if (!segment) {
                var el = document.createElement('div');
                el.className = 'claude-thinking-block';
                var body = document.createElement('div');
                body.className = 'claude-thinking-content';
                var summaryEl = createActivitySummaryElement();
                var activityItemsEl = summaryEl.querySelector('[data-role="activity-items"]');
                el.appendChild(body);
                el.appendChild(summaryEl);
                segment = {
                    el: el,
                    body: body,
                    summaryEl: summaryEl,
                    activityItemsEl: activityItemsEl,
                    stats: createActivityStats(),
                    text: '',
                };
                state.thinkingSegments.push(segment);
                state.activeThinkingSegment = segment;
                state.activeActivitySegment = segment;
                activityList.appendChild(el);
            }
            segment.text += text;
            scheduleSegmentRender(segment, renderThinkingSegment);
            updateProcessAvailability();
        }

        function removeFinalAnswerFromProcessText(finalText) {
            var answerText = String(finalText).trim();
            if (!answerText || state.processTextSegments.length === 0) return;

            var fullText = state.processTextSegments.map(function (segment) {
                return segment.text;
            }).join('');
            var processText = fullText.trimEnd();
            if (answerText.startsWith(processText)) {
                state.processTextSegments.slice().forEach(function (segment) {
                    segment.text = '';
                    renderProcessTextSegment(segment);
                });
                state.processTextSegments = [];
                state.activeProcessTextSegment = null;
                updateProcessAvailability();
                return;
            }
            if (!processText.endsWith(answerText)) return;

            var keepText = processText.slice(0, processText.length - answerText.length).trimEnd();
            var keepLength = keepText.length;
            var offset = 0;

            state.processTextSegments.slice().forEach(function (segment) {
                var nextOffset = offset + segment.text.length;
                if (offset >= keepLength) {
                    segment.text = '';
                } else if (nextOffset > keepLength) {
                    segment.text = segment.text.slice(0, keepLength - offset).trimEnd();
                }
                offset = nextOffset;
                renderProcessTextSegment(segment);
            });

            state.processTextSegments = state.processTextSegments.filter(function (segment) {
                return !!segment.text;
            });
            state.activeProcessTextSegment = null;
            updateProcessAvailability();
        }

        function classifyTool(tool, activitySegment) {
            var name = tool.name || 'Tool';
            var summary = tool.summary || '';
            if (name === 'Read') {
                recordReadFile(summary, activitySegment);
                return 'Read ' + summary;
            }
            if (name === 'Grep') {
                recordActivityCount('searchCount', activitySegment);
                return 'Searched for ' + summary;
            }
            if (name === 'Glob') {
                recordActivityCount('searchCount', activitySegment);
                return 'Searched files ' + summary;
            }
            if (name === 'LS') {
                recordActivityCount('listCount', activitySegment);
                return 'Listed files in ' + (summary || '.');
            }
            if (name === 'Bash') {
                recordActivityCount('bashCount', activitySegment);
                return '已运行 ' + shellCommandSummary(summary);
            }
            if (name === 'Edit' || name === 'MultiEdit' || name === 'Write' || name === 'NotebookEdit') {
                recordActivityCount('editCount', activitySegment);
                recordReadFile(summary, activitySegment);
                return (name === 'Write' ? 'Wrote ' : 'Edited ') + summary;
            }
            if (name === 'WebSearch' || name === 'WebFetch') {
                recordActivityCount('webCount', activitySegment);
                return (name === 'WebFetch' ? 'Fetched ' : 'Searched web ') + summary;
            }
            if (name === 'Agent' || name === 'Task') {
                return '启动子任务 ' + (summary || '');
            }
            if (name === 'TodoWrite') {
                return '更新待办列表';
            }
            return name + (summary ? ' ' + summary : '');
        }

        function formatTaskMetric(task) {
            var parts = [];
            if (task.durationMs || task.durationMs === 0) parts.push(formatDuration(task.durationMs));
            if (task.totalTokens) parts.push(compactTokenCount(task.totalTokens));
            if (task.toolUses) parts.push(task.toolUses + ' tools');
            if (task.lastToolName) parts.push(task.lastToolName);
            return parts.join(' · ');
        }

        function taskStatusText(status) {
            if (status === 'completed') return '已完成';
            if (status === 'failed') return '失败';
            if (status === 'stopped' || status === 'killed') return '已停止';
            if (status === 'pending') return '等待中';
            return '运行中';
        }

        function compactTokenCount(value) {
            var n = Number(value || 0);
            if (!n) return '';
            return n >= 1000 ? (Math.round(n / 100) / 10) + 'k tokens' : n + ' tokens';
        }

        function cleanTaskTitle(value) {
            var text = String(value || '').trim();
            var match = text.match(/^Agent "([^"]+)" completed$/);
            if (match) return match[1];
            return text;
        }

        function updateTaskSection() {
            var tasks = Array.from(state.tasks.values()).filter(function (item) {
                return !item.activitySegment;
            }).map(function (item) { return item.data; });
            if (tasks.length === 0) {
                taskSection.style.display = 'none';
                return;
            }

            var completed = tasks.filter(function (task) { return task.status === 'completed'; }).length;
            var failed = tasks.filter(function (task) { return task.status === 'failed' || task.status === 'killed' || task.status === 'stopped'; }).length;
            var running = Math.max(0, tasks.length - completed - failed);
            var meta = completed + '/' + tasks.length + ' 已完成';
            if (running > 0) meta += ' · ' + running + ' 运行中';
            if (failed > 0) meta += ' · ' + failed + ' 失败';
            taskSection.querySelector('[data-role="task-section-meta"]').textContent = meta;
            taskSection.style.display = 'block';
        }

        function shouldKeepProcessOpenAfterCompletion() {
            return false;
        }

        function appendTaskStep(taskState, text) {
            var value = String(text || '').trim();
            if (!value) return;
            var task = taskState.data;
            var last = task.steps.length > 0 ? task.steps[task.steps.length - 1] : '';
            if (last === value) return;
            task.steps.push(value);
            if (task.steps.length > 40) task.steps.shift();

            var item = document.createElement('div');
            item.className = 'claude-task-step';
            item.textContent = value;
            taskState.body.appendChild(item);
            while (taskState.body.children.length > 40) {
                taskState.body.removeChild(taskState.body.firstChild);
            }
        }

        function updateTaskElement(taskState) {
            var task = taskState.data;
            var status = task.status || 'running';
            taskState.el.classList.remove('running', 'completed', 'failed', 'stopped', 'killed', 'pending');
            taskState.el.classList.add(status);
            var text = cleanTaskTitle(task.summary || task.title || task.description || task.prompt || task.id);
            var metric = formatTaskMetric(task);
            taskState.titleEl.textContent = text || task.id;
            taskState.metaEl.textContent = [taskStatusText(status), metric].filter(Boolean).join(' · ');
            updateTaskSection();
            scrollBottom();
        }

        function resolveTaskId(id) {
            return state.taskAliases.get(id) || id;
        }

        function ensureTask(task) {
            var requestedId = task.id || task.taskId;
            var id = resolveTaskId(requestedId);
            if (!id) return null;
            var existing = state.tasks.get(id);
            if (existing) {
                if (task.toolUseId && !existing.data.toolUseId) existing.data.toolUseId = task.toolUseId;
                return existing;
            }

            if (task.toolUseId) {
                var aliasedId = resolveTaskId(task.toolUseId);
                var aliased = state.tasks.get(aliasedId);
                if (aliased) {
                    if (requestedId && requestedId !== aliasedId) {
                        state.tasks.delete(aliasedId);
                        state.tasks.set(requestedId, aliased);
                        state.taskAliases.set(aliasedId, requestedId);
                        state.taskAliases.set(task.toolUseId, requestedId);
                        aliased.data.id = requestedId;
                        id = requestedId;
                    }
                    aliased.data.toolUseId = task.toolUseId;
                    if (task.title) aliased.data.title = task.title;
                    if (task.description) aliased.data.description = task.description;
                    if (task.prompt) aliased.data.prompt = task.prompt;
                    if (task.status) aliased.data.status = task.status;
                    updateTaskElement(aliased);
                    updateActivitySummary(aliased.activitySegment);
                    updateProcessAvailability();
                    return aliased;
                }
            }

            state.activeProcessTextSegment = null;
            state.activeThinkingSegment = null;
            var el = document.createElement('details');
            el.className = 'claude-activity-item claude-task-item running';
            el.open = !isPersisted;
            var summary = document.createElement('summary');
            summary.className = 'claude-task-summary';
            var statusDot = document.createElement('span');
            statusDot.className = 'claude-task-status-dot';
            var summaryMain = document.createElement('span');
            summaryMain.className = 'claude-task-summary-main';
            var titleEl = document.createElement('span');
            titleEl.className = 'claude-task-title';
            var metaEl = document.createElement('span');
            metaEl.className = 'claude-task-meta';
            var chevron = document.createElement('span');
            chevron.className = 'claude-task-chevron';
            chevron.textContent = '›';
            var body = document.createElement('div');
            body.className = 'claude-task-steps';
            summaryMain.appendChild(titleEl);
            summaryMain.appendChild(metaEl);
            summary.appendChild(statusDot);
            summary.appendChild(summaryMain);
            summary.appendChild(chevron);
            el.appendChild(summary);
            el.appendChild(body);
            var taskState = {
                data: {
                    id: id,
                    toolUseId: task.toolUseId,
                    title: task.title || task.description || '',
                    description: task.description || '',
                    prompt: task.prompt || '',
                    status: task.status || 'running',
                    startedAt: task.startedAt || Date.now(),
                    steps: [],
                },
                el: el,
                titleEl: titleEl,
                metaEl: metaEl,
                body: body,
            };
            state.tasks.set(id, taskState);
            if (task.toolUseId) state.taskAliases.set(task.toolUseId, id);
            var activitySegment = appendSegmentActivityElement(el);
            recordTaskActivity(id, activitySegment);
            if (!activitySegment) taskList.appendChild(el);
            appendTaskStep(taskState, task.description || task.prompt || '');
            taskState.activitySegment = activitySegment;
            updateTaskElement(taskState);
            updateActivitySummary(activitySegment);
            updateProcessAvailability();
            return taskState;
        }

        function updateTask(event) {
            var taskState = ensureTask({
                id: event.taskId,
                toolUseId: event.toolUseId,
                description: event.description || '',
                status: event.status || 'running',
            });
            if (!taskState) return;
            var task = taskState.data;
            if (event.description) task.description = event.description;
            if (event.summary) {
                task.latestSummary = event.summary;
                if (event.status || /^Agent /.test(event.summary)) task.summary = event.summary;
            }
            if (event.lastToolName) task.lastToolName = event.lastToolName;
            if (event.status) task.status = event.status;
            if (event.isBackgrounded || event.isBackgrounded === false) task.isBackgrounded = event.isBackgrounded;
            if (event.error) task.summary = event.error;
            if (event.durationMs || event.durationMs === 0) task.durationMs = event.durationMs;
            if (event.totalTokens) task.totalTokens = event.totalTokens;
            if (event.toolUses) task.toolUses = event.toolUses;
            appendTaskStep(taskState, event.summary || event.description || event.lastToolName || event.error || '');
            updateTaskElement(taskState);
            updateActivitySummary(taskState.activitySegment);
            updateProcessAvailability();
        }

        function finishTask(event) {
            var taskState = ensureTask({
                id: event.taskId,
                toolUseId: event.toolUseId,
                description: event.summary || '',
                status: event.status,
            });
            if (!taskState) return;
            var task = taskState.data;
            task.status = event.status || 'completed';
            if (event.summary) task.summary = event.summary;
            if (event.outputFile) task.outputFile = event.outputFile;
            if (event.durationMs || event.durationMs === 0) task.durationMs = event.durationMs;
            if (event.totalTokens) task.totalTokens = event.totalTokens;
            if (event.toolUses) task.toolUses = event.toolUses;
            appendTaskStep(taskState, event.summary || event.outputFile || task.status);
            updateTaskElement(taskState);
            updateActivitySummary(taskState.activitySegment);
            updateProcessAvailability();
        }

        function ensureTool(tool) {
            var existing = state.tools.get(tool.id);
            if (existing) return existing;

            if (tool.name === 'Agent' || tool.name === 'Task') {
                var taskState = ensureTask({
                    id: tool.id,
                    toolUseId: tool.id,
                    title: tool.summary || tool.title || '子任务',
                    description: tool.summary || tool.title || '',
                    prompt: tool.input || '',
                    status: 'running',
                    startedAt: tool.startedAt,
                });
                existing = {
                    data: tool,
                    el: taskState ? taskState.el : document.createElement('div'),
                    text: tool.summary || tool.title || '',
                    isTaskTool: true,
                    activitySegment: taskState ? taskState.activitySegment : null,
                };
                state.tools.set(tool.id, existing);
                updateActivitySummary(existing.activitySegment);
                return existing;
            }

            var activitySegment = state.activeActivitySegment;
            var lineText = classifyTool(tool, activitySegment);
            var isShell = tool.name === 'Bash';
            var isExpandableShell = isShell && !isLongShellCommand(tool);
            var el = document.createElement(isExpandableShell ? 'details' : 'div');
            el.className = 'claude-activity-item running' + (isShell ? ' shell' : '') + (!isExpandableShell && isShell ? ' shell-compact' : '');
            el.dataset.toolId = tool.id;

            if (isExpandableShell) {
                el.open = false;
                el.innerHTML =
                    '<summary>' +
                    '<span class="claude-activity-text">' + escapeHtml(lineText) + '</span>' +
                    '<span class="claude-activity-chevron">›</span>' +
                    '</summary>' +
                    '<div class="claude-shell-block" data-role="shell"></div>';
            } else {
                el.textContent = lineText;
            }

            var appendedSegment = appendSegmentActivityElement(el);
            if (!appendedSegment) activityList.appendChild(el);
            existing = { data: tool, el: el, text: lineText, activitySegment: appendedSegment };
            state.tools.set(tool.id, existing);
            updateActivitySummary(appendedSegment);
            scrollBottom();
            return existing;
        }

        function renderShell(toolState, event) {
            var shell = toolState.el.querySelector('[data-role="shell"]');
            if (!shell) return;
            var command = toolState.data.summary || '';
            var output = event.output || {};
            var stdout = output.stdout || output.text || '';
            var stderr = output.stderr || '';
            var stdoutTruncated = output.stdoutTruncated || output.textTruncated;
            var status = event.status === 'success' ? '成功' : '失败';
            var body = '';
            body += '<div class="claude-shell-title">Shell</div>';
            if (command) body += renderShellCommand(command);
            if (stdout) {
                body += '<pre><code>' + escapeHtml(stdout) + '</code></pre>';
                if (stdoutTruncated) body += '<div class="claude-inline-diff-note">输出较长，已折叠。</div>';
            } else if (!stderr && event.status === 'success') {
                body += '<div class="claude-shell-empty">无输出</div>';
            }
            if (stderr) {
                body += '<pre class="stderr"><code>' + escapeHtml(stderr) + '</code></pre>';
                if (output.stderrTruncated) body += '<div class="claude-inline-diff-note">错误输出较长，已折叠。</div>';
            }
            if (event.error) {
                body += '<pre class="stderr"><code>' + escapeHtml(event.error) + '</code></pre>';
                if (event.errorTruncated) body += '<div class="claude-inline-diff-note">错误信息较长，已折叠。</div>';
            }
            body += '<div class="claude-shell-status">' + (event.status === 'success' ? '✓ ' : '✕ ') + status + '</div>';
            shell.innerHTML = body;
        }

        function renderDiffs(toolState, diffs) {
            if (!diffs || diffs.length === 0) return;
            diffs.forEach(function (entry) {
                var diff = document.createElement('details');
                diff.className = 'claude-inline-diff';
                if (isBinaryDiffEntry(entry)) {
                    diff.innerHTML =
                        '<summary>资源 ' + escapeHtml(entry.path) + '</summary>' +
                        '<div class="claude-inline-diff-note">媒体或二进制资源已变更，不展示代码 diff。</div>';
                } else {
                    diff.innerHTML =
                        '<summary>Diff ' + escapeHtml(entry.path) + (entry.diffTruncated ? '（摘要）' : '') + '</summary>' +
                        (entry.diffTruncated
                            ? '<div class="claude-inline-diff-note">Diff 较大，过程面板仅展示摘要；完整内容请在最终变更审查中查看。</div>'
                            : '') +
                        '<pre>' + renderDiff(entry.diff) + '</pre>';
                }
                toolState.el.appendChild(diff);
            });
        }

        function isBinaryDiffEntry(entry) {
            if (!entry) return false;
            if (entry.diffType) return entry.diffType === 'binary';
            return /(?:^|\n)(?:Binary files .* differ|GIT binary patch)(?:\n|$)/.test(String(entry.diff || ''));
        }

        function renderDiff(diff) {
            return String(diff || '').split('\n').map(function (line) {
                var cls = 'ctx';
                if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add';
                if (line.startsWith('-') && !line.startsWith('---')) cls = 'del';
                if (line.startsWith('@@')) cls = 'hunk';
                return '<span class="' + cls + '">' + escapeHtml(line || ' ') + '</span>';
            }).join('\n');
        }

        function markTool(event) {
            var toolState = state.tools.get(event.toolId);
            if (!toolState) {
                toolState = ensureTool({
                    id: event.toolId,
                    name: 'Tool',
                    summary: '',
                });
            }
            if (toolState.isTaskTool || toolState.data.name === 'Agent' || toolState.data.name === 'Task') {
                finishTask({
                    taskId: event.toolId,
                    toolUseId: event.toolId,
                    status: event.status === 'success' ? 'completed' : 'failed',
                    summary: event.error || toolState.data.summary || toolState.data.title || '',
                    durationMs: event.durationMs,
                });
                return;
            }
            toolState.el.classList.remove('running');
            toolState.el.classList.toggle('failed', event.status !== 'success');
            if (toolState.data.name === 'Bash') renderShell(toolState, event);
            if (event.error && toolState.data.name !== 'Bash') {
                var err = document.createElement('div');
                err.className = 'claude-activity-error';
                err.textContent = event.error;
                toolState.el.appendChild(err);
            }
            renderDiffs(toolState, event.diffs);
            updateActivitySummary(toolState.activitySegment);
        }

        function completeAnswer(event) {
            removeFinalAnswerFromProcessText(event.content);
            state.answerText = event.content || state.answerText;
            state.changeReview = event.changeReview || state.changeReview;
            if (event.durationMs || event.durationMs === 0) {
                state.durationMs = event.durationMs;
            } else if (state.status === 'running') {
                state.durationMs = Date.now() - startedAt;
            }
            renderAnswer();
            attachCompletionMeta();
            state.status = 'completed';
            updateProcessTitle();
            if (ticker) clearInterval(ticker);
            updateProcessAvailability();
            if (!shouldKeepProcessOpenAfterCompletion()) process.open = false;
        }

        function handleEvent(event) {
            if (!event || !event.type) return;
            if (window.TaskDock) window.TaskDock.handleEvent(event);
            if (event.type === 'agent_status') {
                if (event.durationMs || event.durationMs === 0) {
                    state.durationMs = event.durationMs;
                    updateProcessTitle();
                }
                if (event.status === 'started') {
                    state.status = 'running';
                    updateProcessTitle();
                }
                if (event.status === 'completed') {
                    state.status = 'completed';
                    state.durationMs = event.durationMs || (Date.now() - startedAt);
                    updateProcessTitle();
                    if (ticker) clearInterval(ticker);
                    if (!shouldKeepProcessOpenAfterCompletion()) process.open = false;
                } else if (event.status === 'failed') {
                    state.status = 'completed';
                    state.durationMs = event.durationMs || (Date.now() - startedAt);
                    updateProcessTitle();
                    if (ticker) clearInterval(ticker);
                    if (!shouldKeepProcessOpenAfterCompletion()) process.open = false;
                }
                return;
            }

            if (event.type === 'answer_delta') {
                appendAnswerText(event.text || '');
                return;
            }

            if (event.type === 'process_delta') {
                appendProcessText(event.text || '');
                openProcessIfAvailable();
                return;
            }

            if (event.type === 'thinking_delta') {
                appendThinkingText(event.text || '');
                openProcessIfAvailable();
                return;
            }

            if (event.type === 'task_start') {
                ensureTask(event.task || {});
                openProcessIfAvailable();
                return;
            }

            if (event.type === 'task_progress') {
                updateTask(event);
                openProcessIfAvailable();
                return;
            }

            if (event.type === 'task_end') {
                finishTask(event);
                openProcessIfAvailable();
                return;
            }

            if (event.type === 'result') {
                completeAnswer(event);
                return;
            }

            if (event.type === 'codex_answer_done') {
                completeAnswer(event);
                return;
            }

            if (event.type === 'error') {
                state.answerText = state.answerText || ('处理失败：' + (event.error || '未知错误'));
                renderAnswer();
                attachCompletionMeta();
                state.status = 'completed';
                updateProcessTitle();
                if (ticker) clearInterval(ticker);
                updateProcessAvailability();
                if (!shouldKeepProcessOpenAfterCompletion()) process.open = false;
                return;
            }

            if (event.type === 'cancelled') {
                state.answerText = event.message || '已中断';
                renderAnswer();
                attachCompletionMeta();
                state.status = 'completed';
                updateProcessTitle();
                if (ticker) clearInterval(ticker);
                updateProcessAvailability();
                if (!shouldKeepProcessOpenAfterCompletion()) process.open = false;
                return;
            }

            if (event.type === 'file_change') {
                if (event.event !== 'unlink') recordActivityCount('editCount');
                recordReadFile(event.path);
                updateActivitySummary();
                return;
            }

            if (event.type === 'tool_start') {
                state.activeProcessTextSegment = null;
                state.activeThinkingSegment = null;
                ensureTool(event.tool);
                openProcessIfAvailable();
                return;
            }

            if (event.type === 'tool_progress') {
                state.durationMs = event.elapsedMs || (Date.now() - startedAt);
                updateProcessTitle();
                return;
            }

            if (event.type === 'tool_end') {
                markTool(event);
                scrollBottom();
            }
        }

        return {
            row: row,
            handleEvent: handleEvent,
        };
    }

    function renderPersistedMessage(opts) {
        var view = createMessage({
            messagesEl: opts.messagesEl,
            scrollBottom: opts.scrollBottom,
            persisted: true,
            open: false,
            createdAt: opts.createdAt,
        });
        var loop = opts.loop || {};
        var events = Array.isArray(loop.events) ? loop.events : [];
        events.forEach(function (event) {
            view.handleEvent(event);
        });
        view.handleEvent({
            type: 'result',
            content: opts.content || '',
            changeReview: opts.changeReview || null,
            contentTruncated: !!opts.contentTruncated,
            contentChars: opts.contentChars,
            fullContentLoader: opts.fullContentLoader || null,
        });
        return view;
    }

    async function consumeStreamResponse(res, opts) {
        var inactive = opts.allowInactive && res.status === 404;
        if (inactive) return { fallback: false, inactive: true };

        if (res.status === 409) return { fallback: true };
        if (!res.ok) {
            var err = await res.json().catch(function () { return {}; });
            throw new Error(err.error || '发送失败，请重试');
        }

        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var resultPayload = null;

        while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            buffer = parseSseChunk(buffer, function (_eventName, data) {
                if (data && (data.type === 'result' || data.type === 'codex_answer_done')) {
                    resultPayload = data;
                }
                if (data && data.type === 'context_usage' && data.usage && opts.onContextUsage) {
                    opts.onContextUsage(data.usage);
                } else if (
                    data &&
                    (data.type === 'result' || data.type === 'codex_answer_done') &&
                    data.contextUsage &&
                    opts.onContextUsage
                ) {
                    opts.onContextUsage(data.contextUsage);
                }
                opts.view.handleEvent(data);
            });
        }

        return { fallback: false, inactive: false, result: resultPayload };
    }

    async function stream(opts) {
        var res = await fetch('/api/sessions/' + opts.sessionId + '/messages/stream', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(opts.body),
            signal: opts.signal,
        });
        return consumeStreamResponse(res, opts);
    }

    async function resume(opts) {
        opts.allowInactive = true;
        var res = await fetch('/api/sessions/' + opts.sessionId + '/messages/stream', {
            method: 'GET',
            signal: opts.signal,
        });
        return consumeStreamResponse(res, opts);
    }

    function canStream(providerType) {
        return providerType === 'claude-code' || providerType === 'codex';
    }

    window.ClaudeAgentLoop = {
        canStream: canStream,
        createMessage: createMessage,
        renderPersistedMessage: renderPersistedMessage,
        resume: resume,
        stream: stream,
    };
})();
