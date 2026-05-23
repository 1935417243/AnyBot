export function createSessionController(config) {
    var currentSessionId = null;
    var currentSessionProjectId = null;
    var currentSessionProvider = null;
    var isTyping = false;
    var isCancellingResponse = false;
    var activeStreamSessionId = null;
    var activeStreamAbortController = null;
    var currentSessionUpdatedAt = 0;
    var currentNewestMessageId = 0;

    async function createNewChat(projectId, options) {
        options = options || {};
        var targetProjectId = arguments.length > 0 ? projectId : config.getActiveProjectId();
        if (!targetProjectId) targetProjectId = null;
        if (config.getCurrentView() !== 'chat') {
            config.showChatView();
        }
        var providerData = config.getProviderData();
        var currentProviderType = providerData && providerData.current;
        var canReuseEmptySession =
            !options.force &&
            currentSessionId &&
            currentSessionProjectId === targetProjectId &&
            (!currentProviderType || currentSessionProvider === currentProviderType) &&
            !config.messagesEl.querySelector('.message-row');
        if (canReuseEmptySession) {
            config.setActiveProjectId(targetProjectId);
            config.clearSessionModelSelection(currentSessionId);
            var reusableSummary = config.findSessionSummary(currentSessionId);
            config.updateConversationHeaderTitle(reusableSummary ? reusableSummary.title : '新对话');
            config.revealSessionContainer(targetProjectId);
            config.renderHistory();
            config.renderProjects();
            config.updateSidebarSelection();
            config.revealActiveSessionInSidebar();
            await config.fetchModelConfig(currentSessionProvider);
            config.inputEl.focus();
            return;
        }
        try {
            var res = await fetch('/api/sessions', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ projectId: targetProjectId }),
            });
            var data = await res.json();
            if (!res.ok) throw new Error(data.error || '创建会话失败');
            currentSessionId = data.id;
            currentSessionProjectId = data.projectId || targetProjectId || null;
            currentSessionProvider = data.provider || null;
            config.updateConversationHeaderTitle(data.title);
            currentSessionUpdatedAt = Number(data.updatedAt || Date.now());
            currentNewestMessageId = 0;
            config.setActiveProjectId(currentSessionProjectId);
            config.revealSessionContainer(currentSessionProjectId);
            config.showChatView();
            config.updateContextUsage(null);
            config.resetInputHistoryFromMessages([], false);
            config.showEmptyState();
            config.inputEl.value = '';
            config.clearPromptSkills();
            config.resizeChatInput();
            config.setSendButtonDisabled(true);
            config.inputEl.focus();
            await config.fetchModelConfig(currentSessionProvider);
            await config.fetchSessions();
            config.updateSidebarSelection();
            config.revealActiveSessionInSidebar();
        } catch (e) {
            config.showError(e.message || '创建会话失败');
        }
    }

    function stopActiveStreamSubscription() {
        if (activeStreamAbortController) {
            activeStreamAbortController.abort();
            activeStreamAbortController = null;
        }
        activeStreamSessionId = null;
        isTyping = false;
        isCancellingResponse = false;
        config.updateSendBtnState();
    }

    async function cancelCurrentResponse() {
        var targetSessionId = activeStreamSessionId || currentSessionId;
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

    async function loadSession(id, options) {
        options = options || {};
        if (id === currentSessionId && activeStreamSessionId === id) {
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
            config.updateContextUsage(null);
            var didExpandProject = config.expandProject(data.projectId || null);

            if (!wasChatView) config.showChatView();

            currentNewestMessageId = config.renderSessionMessages(data.messages || [], !!data.hasMoreMessages);
            await config.fetchModelConfig(currentSessionProvider);

            if (data.activeStream) {
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
            if (currentSessionId === id) {
                currentSessionId = null;
                currentSessionProjectId = null;
                currentSessionProvider = null;
                currentSessionUpdatedAt = 0;
                currentNewestMessageId = 0;
                config.updateConversationHeaderTitle('新对话');
                config.resetInputHistoryFromMessages([], false);
                config.clearPromptSkills();
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
        cancelCurrentResponse: cancelCurrentResponse,
        clearActiveStreamForSession: clearActiveStreamForSession,
        createNewChat: createNewChat,
        deleteSession: deleteSession,
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
