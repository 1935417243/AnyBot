export function createSessionController(config) {
    var currentSessionId = null;
    var currentSessionProjectId = null;
    var currentSessionProvider = null;
    var isTyping = false;
    var isCancellingResponse = false;
    var activeStreamSessionId = null;
    var activeStreamAbortController = null;
    var activeCompactSessionId = null;
    var activeCompactView = null;
    var activeCompactPollTimer = null;
    var currentSessionUpdatedAt = 0;
    var currentNewestMessageId = 0;

    var ensureSessionPromise = null;

    async function createNewChat(projectId, options) {
        options = options || {};
        var targetProjectId = arguments.length > 0 ? projectId : config.getActiveProjectId();
        if (!targetProjectId) targetProjectId = null;
        if (config.getCurrentView() !== 'chat') {
            config.showChatView();
        }
        var providerData = config.getProviderData();
        var currentProviderType = providerData && providerData.current;
        var providerMatches = !currentProviderType || !currentSessionProvider || currentSessionProvider === currentProviderType;
        var isViewingEmptySession = !!currentSessionId && !config.messagesEl.querySelector('.message-row');
        var isSameDraft = !currentSessionId && currentSessionProjectId === targetProjectId;
        var canReuseCurrentContext =
            !options.force &&
            providerMatches &&
            (isSameDraft || (isViewingEmptySession && currentSessionProjectId === targetProjectId));
        if (canReuseCurrentContext) {
            config.setActiveProjectId(targetProjectId);
            if (currentSessionId) {
                config.clearSessionModelSelection(currentSessionId);
                var reusableSummary = config.findSessionSummary(currentSessionId);
                config.updateConversationHeaderTitle(reusableSummary ? reusableSummary.title : '新对话');
                config.revealActiveSessionInSidebar();
            } else {
                config.updateConversationHeaderTitle('新对话');
            }
            config.revealSessionContainer(targetProjectId, { defer: options.deferSidebarReveal });
            config.renderHistory();
            config.renderProjects();
            config.updateSidebarSelection();
            await config.fetchModelConfig(currentSessionProvider);
            config.inputEl.focus();
            return;
        }
        // 丢弃未发送的空会话，避免侧边栏残留「新对话」
        var abandonedEmptySessionId = null;
        if (isViewingEmptySession && currentSessionId) {
            abandonedEmptySessionId = currentSessionId;
            currentSessionId = null;
            try {
                await fetch('/api/sessions/' + abandonedEmptySessionId, { method: 'DELETE' });
                if (config.removeSessionSummary) config.removeSessionSummary(abandonedEmptySessionId);
            } catch (_) {}
        }
        // 草稿模式：只设置前端状态，发送第一条消息时才真正创建会话
        currentSessionId = null;
        currentSessionProjectId = targetProjectId;
        currentSessionProvider = currentProviderType || null;
        config.updateConversationHeaderTitle('新对话');
        currentSessionUpdatedAt = 0;
        currentNewestMessageId = 0;
        config.setActiveProjectId(currentSessionProjectId);
        config.revealSessionContainer(currentSessionProjectId, { defer: options.deferSidebarReveal });
        config.showChatView();
        config.updateContextUsage(null);
        config.resetInputHistoryFromMessages([], false);
        config.showEmptyState();
        config.inputEl.value = '';
        config.clearPromptSkills();
        if (config.clearFileReferences) config.clearFileReferences();
        config.resizeChatInput();
        config.setSendButtonDisabled(true);
        config.inputEl.focus();
        await config.fetchModelConfig(currentSessionProvider);
        await config.fetchSessions();
        config.updateSidebarSelection();
        config.revealActiveSessionInSidebar();
    }

    function ensureSession() {
        if (currentSessionId) return Promise.resolve(currentSessionId);
        if (ensureSessionPromise) return ensureSessionPromise;
        ensureSessionPromise = (async function () {
            try {
                var res = await fetch('/api/sessions', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ projectId: currentSessionProjectId }),
                });
                var data = await res.json();
                if (!res.ok) throw new Error(data.error || '创建会话失败');
                currentSessionId = data.id;
                currentSessionProjectId = data.projectId || null;
                currentSessionProvider = data.provider || null;
                currentSessionUpdatedAt = Number(data.updatedAt || Date.now());
                currentNewestMessageId = 0;
                config.revealSessionContainer(currentSessionProjectId);
                config.updateSidebarSelection();
                await config.fetchSessions();
                return currentSessionId;
            } finally {
                ensureSessionPromise = null;
            }
        })();
        return ensureSessionPromise;
    }

    function stopActiveStreamSubscription() {
        if (activeStreamAbortController) {
            activeStreamAbortController.abort();
            activeStreamAbortController = null;
        }
        activeStreamSessionId = null;
        clearActiveCompact();
        isTyping = false;
        isCancellingResponse = false;
        config.updateSendBtnState();
    }

    async function cancelCurrentResponse() {
        var targetSessionId = activeStreamSessionId || activeCompactSessionId || currentSessionId;
        if (!targetSessionId || isCancellingResponse) return;

        isCancellingResponse = true;
        config.updateSendBtnState();
        try {
            var res = await fetch('/api/sessions/' + targetSessionId + '/messages/cancel', {
                method: 'POST',
            });
            if (!res.ok) {
                var err = await res.json().catch(function () {
                    return {};
                });
                throw new Error(err.error || '中断失败');
            }
            if (activeCompactSessionId === targetSessionId) {
                cancelActiveCompact(targetSessionId, '压缩已停止');
                return;
            }
        } catch (e) {
            isCancellingResponse = false;
            config.updateSendBtnState();
            config.showError(e.message || '中断失败');
        }
    }

    async function resumeActiveStream(sessionId, activeStream) {
        if (!window.ClaudeAgentLoop || !window.ClaudeAgentLoop.resume) return;

        var controller = new AbortController();
        activeStreamAbortController = controller;
        activeStreamSessionId = sessionId;
        isTyping = true;
        isCancellingResponse = false;
        config.updateSendBtnState();

        var agentView = window.ClaudeAgentLoop.createMessage({
            messagesEl: config.messagesEl,
            scrollBottom: config.scrollBottom,
            startedAt: activeStream && activeStream.startedAt,
        });

        try {
            var result = await window.ClaudeAgentLoop.resume({
                sessionId: sessionId,
                view: agentView,
                signal: controller.signal,
                onContextUsage: config.updateContextUsage,
            });

            if (activeStreamSessionId !== sessionId) return;

            if (result && result.inactive) {
                if (agentView.row) agentView.row.remove();
                stopActiveStreamSubscription();
                isTyping = false;
                isCancellingResponse = false;
                config.updateSendBtnState();
                await loadSession(sessionId);
                return;
            }

            await config.fetchSessions();
        } catch (e) {
            if (e.name === 'AbortError') return;
            if (agentView) {
                agentView.handleEvent({
                    type: 'error',
                    error: e.message || '网络错误，请检查连接',
                });
            }
            config.showError(e.message || '网络错误，请检查连接');
        } finally {
            if (activeStreamSessionId === sessionId) {
                activeStreamAbortController = null;
                activeStreamSessionId = null;
                isTyping = false;
                isCancellingResponse = false;
                config.updateSendBtnState();
            }
        }
    }

    function clearActiveCompact(options) {
        options = options || {};
        if (activeCompactPollTimer) {
            clearTimeout(activeCompactPollTimer);
            activeCompactPollTimer = null;
        }
        if (!options.keepView && activeCompactView && activeCompactView.remove) {
            activeCompactView.remove();
        }
        activeCompactSessionId = null;
        activeCompactView = null;
    }

    function beginActiveCompact(sessionId, activeRun, options) {
        options = options || {};
        clearActiveCompact();
        activeCompactSessionId = sessionId;
        isTyping = true;
        isCancellingResponse = false;
        config.updateSendBtnState();

        if (currentSessionId === sessionId && config.getCurrentView() === 'chat' && config.appendContextCompactProgress) {
            activeCompactView = config.appendContextCompactProgress({
                label: '正在压缩上下文',
                startedAt: activeRun && activeRun.startedAt,
            });
        }
        if (options.poll) scheduleActiveCompactPoll(sessionId);
    }

    function startActiveCompact(sessionId, startedAt) {
        beginActiveCompact(sessionId, { startedAt: startedAt || Date.now() });
    }

    function resumeActiveCompact(sessionId, activeRun) {
        beginActiveCompact(sessionId, activeRun, { poll: true });
    }

    function finishActiveCompact(sessionId, result) {
        if (activeCompactSessionId !== sessionId) return false;
        var isCurrent = currentSessionId === sessionId && config.getCurrentView() === 'chat';
        var label = result && result.content || '上下文已压缩';

        if (isCurrent && activeCompactView && activeCompactView.row && activeCompactView.row.isConnected) {
            activeCompactView.complete(label, {
                messageId: result && result.messageId,
            });
        } else if (isCurrent && config.appendContextCompactProgress) {
            var completed = config.appendContextCompactProgress({
                label: '正在压缩上下文',
                startedAt: Date.now(),
            });
            completed.complete(label, {
                messageId: result && result.messageId,
            });
        }

        clearActiveCompact({ keepView: true });
        isTyping = false;
        isCancellingResponse = false;
        config.updateSendBtnState();
        return isCurrent;
    }

    function cancelActiveCompact(sessionId, label) {
        if (activeCompactSessionId !== sessionId) return false;
        if (currentSessionId === sessionId && activeCompactView) {
            activeCompactView.cancel(label || '压缩已停止');
        }
        clearActiveCompact({ keepView: true });
        isTyping = false;
        isCancellingResponse = false;
        config.updateSendBtnState();
        return true;
    }

    function failActiveCompact(sessionId, label) {
        if (activeCompactSessionId !== sessionId) return false;
        if (currentSessionId === sessionId && activeCompactView) {
            activeCompactView.fail(label || '压缩失败');
        }
        clearActiveCompact({ keepView: true });
        isTyping = false;
        isCancellingResponse = false;
        config.updateSendBtnState();
        return true;
    }

    function scheduleActiveCompactPoll(sessionId) {
        if (activeCompactPollTimer) clearTimeout(activeCompactPollTimer);
        activeCompactPollTimer = setTimeout(function () {
            pollActiveCompact(sessionId);
        }, 1200);
    }

    async function pollActiveCompact(sessionId) {
        if (activeCompactSessionId !== sessionId) return;
        try {
            var res = await fetch('/api/sessions/' + sessionId + '?limit=1');
            if (!res.ok) throw new Error('poll failed');
            var data = await res.json();
            if (activeCompactSessionId !== sessionId) return;
            if (data.activeRun && data.activeRun.kind === 'compact') {
                scheduleActiveCompactPoll(sessionId);
                return;
            }
            clearActiveCompact({ keepView: true });
            isTyping = false;
            isCancellingResponse = false;
            config.updateSendBtnState();
            await loadSession(sessionId, { force: true, silent: true });
        } catch (_) {
            if (activeCompactSessionId === sessionId) scheduleActiveCompactPoll(sessionId);
        }
    }

    async function loadSession(id, options) {
        options = options || {};
        if (id === currentSessionId && (activeStreamSessionId === id || activeCompactSessionId === id)) {
            config.inputEl.focus();
            return;
        }
        if (id === currentSessionId && config.getCurrentView() === 'chat' && !options.force) {
            config.inputEl.focus();
            return;
        }

        try {
            stopActiveStreamSubscription();
            var res = await fetch('/api/sessions/' + id + '?limit=' + config.sessionMessagePageSize);
            if (!res.ok) {
                if (!options.silent) config.showError('加载会话失败');
                return;
            }
            var data = await res.json();
            var wasChatView = config.getCurrentView() === 'chat';
            currentSessionId = id;
            currentSessionProjectId = data.projectId || null;
            currentSessionProvider = data.provider || null;
            config.updateConversationHeaderTitle(data.title);
            currentSessionUpdatedAt = Number(data.updatedAt || config.findSessionSummary(id)?.updatedAt || currentSessionUpdatedAt || 0);
            config.setActiveProjectId(data.projectId || null);
            config.resetInputHistoryFromMessages(data.messages || [], !!data.hasMoreMessages);
            if (config.clearFileReferences) config.clearFileReferences();
            config.updateContextUsage(null);
            var didExpandProject = config.expandProject(data.projectId || null);

            if (!wasChatView) config.showChatView();

            currentNewestMessageId = config.renderSessionMessages(data.messages || [], !!data.hasMoreMessages);
            await config.fetchModelConfig(currentSessionProvider);

            if (data.activeRun && data.activeRun.kind === 'compact') {
                resumeActiveCompact(id, data.activeRun);
            } else if (data.activeStream) {
                resumeActiveStream(id, data.activeStream);
            }

            if (wasChatView && didExpandProject) config.renderProjects();
            config.updateSidebarSelection();
            config.inputEl.focus();
        } catch (e) {
            if (!options.silent) config.showError('加载会话失败');
        }
    }

    async function deleteSession(id) {
        try {
            await fetch('/api/sessions/' + id, {method: 'DELETE'});
            if (config.removeSessionSummary) config.removeSessionSummary(id);
            if (currentSessionId === id) {
                currentSessionId = null;
                currentSessionProjectId = null;
                currentSessionProvider = null;
                currentSessionUpdatedAt = 0;
                currentNewestMessageId = 0;
                config.updateConversationHeaderTitle('新对话');
                config.resetInputHistoryFromMessages([], false);
                config.clearPromptSkills();
                if (config.clearFileReferences) config.clearFileReferences();
                config.updateContextUsage(null);
                config.showEmptyState();
            }
            await config.fetchSessions();
        } catch (e) {
            config.showError('删除失败');
        }
    }

    function setActiveStream(controller, sessionId) {
        activeStreamAbortController = controller;
        activeStreamSessionId = sessionId;
    }

    function clearActiveStreamForSession(sessionId) {
        if (activeStreamSessionId === sessionId) {
            activeStreamAbortController = null;
            activeStreamSessionId = null;
        }
    }

    return {
        cancelActiveCompact: cancelActiveCompact,
        cancelCurrentResponse: cancelCurrentResponse,
        clearActiveStreamForSession: clearActiveStreamForSession,
        createNewChat: createNewChat,
        deleteSession: deleteSession,
        ensureSession: ensureSession,
        failActiveCompact: failActiveCompact,
        finishActiveCompact: finishActiveCompact,
        getActiveStreamSessionId: function () {
            return activeStreamSessionId;
        },
        getCurrentNewestMessageId: function () {
            return currentNewestMessageId;
        },
        getCurrentSessionId: function () {
            return currentSessionId;
        },
        getCurrentSessionProjectId: function () {
            return currentSessionProjectId;
        },
        getCurrentSessionProvider: function () {
            return currentSessionProvider;
        },
        getCurrentSessionUpdatedAt: function () {
            return currentSessionUpdatedAt;
        },
        getIsCancellingResponse: function () {
            return isCancellingResponse;
        },
        getIsTyping: function () {
            return isTyping;
        },
        loadSession: loadSession,
        resumeActiveStream: resumeActiveStream,
        setActiveStream: setActiveStream,
        startActiveCompact: startActiveCompact,
        setCancelling: function (value) {
            isCancellingResponse = !!value;
        },
        setCurrentNewestMessageId: function (value) {
            currentNewestMessageId = Number(value || 0);
        },
        setCurrentSessionProvider: function (provider) {
            currentSessionProvider = provider;
        },
        setCurrentSessionUpdatedAt: function (value) {
            currentSessionUpdatedAt = Number(value || 0);
        },
        setTyping: function (value) {
            isTyping = !!value;
        },
        stopActiveStreamSubscription: stopActiveStreamSubscription,
    };
}
