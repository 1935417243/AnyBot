export function createInputHistoryController(config) {
    var items = [];
    var cursor = null;
    var draft = '';
    var draftSkills = [];
    var draftProjects = [];
    var oldestFetchedMessageId = null;
    var hasMore = false;
    var fetchPromise = null;
    var navigationPromise = null;
    var navigationVersion = 0;

    function getOldestMessageId(messages) {
        return (messages || []).reduce(function (oldest, message) {
            var id = Number(message && message.id || 0);
            if (!id) return oldest;
            return oldest === null || id < oldest ? id : oldest;
        }, null);
    }

    function resetNavigation() {
        cursor = null;
        draft = '';
        draftSkills = [];
        draftProjects = [];
        navigationPromise = null;
        navigationVersion += 1;
    }

    function getHistoryVisibleContent(content, skills, projects) {
        var value = String(content || '').trim();
        return config.isSelectionOnlyFallback(value, skills, projects) ? '' : value;
    }

    function createItem(message) {
        if (!message || message.role !== 'user') return null;
        var meta = config.parseMessageMetadata(message.metadata);
        var skills = config.normalizeMessageSkills(meta.skills);
        var projects = config.normalizeMessageProjects(meta.projects);
        var content = getHistoryVisibleContent(message.content, skills, projects);
        if ((!content && skills.length === 0 && projects.length === 0) || (content === '[附件]' && skills.length === 0 && projects.length === 0)) return null;
        return {
            id: Number(message.id || 0) || null,
            content: content,
            skills: skills,
            projects: projects,
            contentTruncated: !!message.contentTruncated,
        };
    }

    function mergeMessages(messages, placement) {
        var seenIds = new Set(items
            .map(function (item) { return item.id; })
            .filter(function (id) { return id !== null; }));
        var nextItems = [];
        (messages || []).forEach(function (message) {
            var item = createItem(message);
            if (!item) return;
            if (item.id !== null && seenIds.has(item.id)) return;
            if (item.id !== null) seenIds.add(item.id);
            nextItems.push(item);
        });
        if (nextItems.length === 0) return 0;

        if (placement === 'prepend') {
            items = nextItems.concat(items);
            if (cursor !== null) cursor += nextItems.length;
        } else {
            items = items.concat(nextItems);
        }
        return nextItems.length;
    }

    function resetFromMessages(messages, hasMoreMessages) {
        items = [];
        oldestFetchedMessageId = getOldestMessageId(messages);
        hasMore = !!hasMoreMessages;
        resetNavigation();
        mergeMessages(messages, 'append');
    }

    function prependMessages(messages, hasMoreMessages) {
        var addedCount = mergeMessages(messages, 'prepend');
        var oldestId = getOldestMessageId(messages);
        if (oldestId !== null) oldestFetchedMessageId = oldestId;
        hasMore = !!hasMoreMessages;
        return addedCount;
    }

    function rememberSentUserMessage(text, skills, projects) {
        var content = String(text || '').trim();
        var itemSkills = config.normalizeMessageSkills(skills);
        var itemProjects = config.normalizeMessageProjects(projects);
        if (!content && itemSkills.length === 0 && itemProjects.length === 0) return;
        items.push({
            id: null,
            content: content,
            skills: itemSkills,
            projects: itemProjects,
            contentTruncated: false,
        });
        resetNavigation();
    }

    function isCaretOnFirstLine() {
        var inputEl = config.inputEl;
        if (typeof inputEl.selectionStart !== 'number' || typeof inputEl.selectionEnd !== 'number') return true;
        if (inputEl.selectionStart !== inputEl.selectionEnd) return false;
        return inputEl.value.slice(0, inputEl.selectionStart).indexOf('\n') === -1;
    }

    function isCaretOnLastLine() {
        var inputEl = config.inputEl;
        if (typeof inputEl.selectionStart !== 'number' || typeof inputEl.selectionEnd !== 'number') return true;
        if (inputEl.selectionStart !== inputEl.selectionEnd) return false;
        return inputEl.value.slice(inputEl.selectionEnd).indexOf('\n') === -1;
    }

    function shouldHandleKey(event, direction) {
        if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false;
        if (direction < 0) return isCaretOnFirstLine();
        return cursor !== null && isCaretOnLastLine();
    }

    async function fetchOlderPage() {
        var currentSessionId = config.getCurrentSessionId();
        if (!currentSessionId || !hasMore) return 0;
        if (fetchPromise) return fetchPromise;

        fetchPromise = (async function () {
            var addedTotal = 0;
            while (config.getCurrentSessionId() && hasMore && addedTotal === 0) {
                var beforeId = oldestFetchedMessageId || config.getOldestRenderedMessageId();
                if (!beforeId) break;
                var requestSessionId = config.getCurrentSessionId();
                var res = await fetch('/api/sessions/' + requestSessionId + '/messages?before=' + encodeURIComponent(beforeId) + '&limit=' + config.pageSize);
                if (!res.ok) throw new Error('加载历史输入失败');
                var data = await res.json();
                if (config.getCurrentSessionId() !== requestSessionId) return addedTotal;
                if (!data.messages || data.messages.length === 0) {
                    hasMore = false;
                    break;
                }
                addedTotal += prependMessages(data.messages, data.hasMoreMessages);
            }
            return addedTotal;
        })().finally(function () {
            fetchPromise = null;
        });

        return fetchPromise;
    }

    async function getItemContent(item) {
        var currentSessionId = config.getCurrentSessionId();
        if (!item || !item.contentTruncated || !item.id || !currentSessionId) {
            return item ? item.content : '';
        }
        try {
            var requestSessionId = currentSessionId;
            var res = await fetch('/api/sessions/' + requestSessionId + '/messages/' + encodeURIComponent(item.id) + '/content');
            if (!res.ok) return item.content;
            var data = await res.json();
            if (config.getCurrentSessionId() !== requestSessionId || typeof data.content !== 'string') return item.content;
            item.content = getHistoryVisibleContent(data.content, item.skills, item.projects);
            item.contentTruncated = false;
        } catch (_) {
        }
        return item.content;
    }

    async function applyIndex(index, expectedNavigationVersion) {
        var item = items[index];
        if (!item) return false;
        var content = await getItemContent(item);
        if (expectedNavigationVersion !== navigationVersion) return false;
        cursor = index;
        config.applyDraft(content, item.skills, item.projects);
        return true;
    }

    async function navigate(direction) {
        if (navigationPromise) return;
        var expectedNavigationVersion = navigationVersion;
        navigationPromise = (async function () {
            if (!config.getCurrentSessionId()) return;

            if (direction < 0) {
                if (cursor === null) {
                    var promptSelection = config.getPromptSelection();
                    draft = config.inputEl.value;
                    draftSkills = promptSelection.skills.slice();
                    draftProjects = promptSelection.projects.slice();
                }
                if (items.length === 0) await fetchOlderPage();

                var targetIndex = -1;
                if (cursor === null) {
                    targetIndex = items.length - 1;
                } else if (cursor > 0) {
                    targetIndex = cursor - 1;
                } else {
                    var previousIndex = cursor;
                    var addedCount = await fetchOlderPage();
                    targetIndex = addedCount > 0 ? previousIndex + addedCount - 1 : 0;
                }

                if (targetIndex >= 0) await applyIndex(targetIndex, expectedNavigationVersion);
                return;
            }

            if (cursor === null) return;
            if (cursor < items.length - 1) {
                await applyIndex(cursor + 1, expectedNavigationVersion);
                return;
            }

            if (expectedNavigationVersion !== navigationVersion) return;
            cursor = null;
            config.applyDraft(draft, draftSkills, draftProjects);
            draft = '';
            draftSkills = [];
            draftProjects = [];
        })().catch(function (error) {
            console.warn('Failed to navigate input history:', error);
        }).finally(function () {
            navigationPromise = null;
        });
    }

    return {
        navigate: navigate,
        prependMessages: prependMessages,
        rememberSentUserMessage: rememberSentUserMessage,
        resetFromMessages: resetFromMessages,
        resetNavigation: resetNavigation,
        shouldHandleKey: shouldHandleKey,
    };
}
