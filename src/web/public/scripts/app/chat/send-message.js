export function createSendMessageController(config) {
    async function sendMessage() {
        var outgoing = collectOutgoingMessage();
        if (!outgoing) return;

        beginOutgoingMessage(outgoing);

        var body = buildMessageRequestBody(outgoing, config.getState().modelConfig);
        var agentView = null;

        try {
            if (canUseClaudeAgentLoop()) {
                config.removeTyping();
                agentView = window.ClaudeAgentLoop.createMessage({
                    messagesEl: config.messagesEl,
                    scrollBottom: config.scrollBottom,
                });

                var streamController = new AbortController();
                config.setActiveStream(streamController, outgoing.sessionId);
                var streamResult = await window.ClaudeAgentLoop.stream({
                    sessionId: outgoing.sessionId,
                    body: body,
                    view: agentView,
                    signal: streamController.signal,
                    onContextUsage: config.updateContextUsage,
                });
                config.clearActiveStreamForSession(outgoing.sessionId);

                if (!streamResult.fallback) {
                    applyStreamResult(streamResult);
                    await config.fetchSessions();
                    config.setTyping(false);
                    config.setCancelling(false);
                    config.updateSendBtnState();
                    return;
                }

                if (agentView && agentView.row) agentView.row.remove();
                agentView = null;
                config.showTyping();
            }

            var res = await fetch('/api/sessions/' + outgoing.sessionId + '/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            config.removeTyping();

            if (!res.ok) {
                var err = await res.json().catch(function () {
                    return {};
                });
                config.showError(err.error || '发送失败，请重试');
                config.setTyping(false);
                config.setCancelling(false);
                return;
            }

            var data = await res.json();
            if (data.provider) config.setCurrentSessionProvider(data.provider);
            if (data.title) config.updateConversationHeaderTitle(data.title);
            if (data.contextUsage) config.updateContextUsage(data.contextUsage);
            config.appendMessage('ai', data.content, null, data.changeReview, { createdAt: Date.now() });

            await config.fetchSessions();
        } catch (e) {
            config.removeTyping();
            config.clearActiveStreamForSession(outgoing.sessionId);
            if (e.name === 'AbortError') {
                // 切换会话时只断开本页订阅，不取消后台任务。
            } else if (agentView) {
                agentView.handleEvent({
                    type: 'error',
                    error: e.message || '网络错误，请检查连接',
                });
                config.showError(e.message || '网络错误，请检查连接');
            } else {
                config.showError(e.message || '网络错误，请检查连接');
            }
        }

        config.setTyping(false);
        config.setCancelling(false);
        config.updateSendBtnState();
    }

    function collectOutgoingMessage() {
        var state = config.getState();
        var text = config.inputEl.value.trim();
        var messageSkills = state.promptSkills.slice();
        var messageProjects = state.promptProjects.slice();
        var readyAttachments = state.pendingAttachments.filter(function (attachment) {
            return !attachment.uploading && attachment.path;
        });

        if (
            (!text && readyAttachments.length === 0 && messageSkills.length === 0 && messageProjects.length === 0) ||
            state.isTyping ||
            !state.currentSessionId
        ) {
            return null;
        }

        return {
            sessionId: state.currentSessionId,
            text: text,
            skills: messageSkills,
            projects: messageProjects,
            attachments: readyAttachments,
        };
    }

    function beginOutgoingMessage(outgoing) {
        var attachmentInfos = outgoing.attachments.map(function (attachment) {
            return { name: attachment.name, path: attachment.path };
        });
        var displayText = outgoing.text || (outgoing.attachments.length > 0 ? '[附件]' : '');

        config.inputEl.value = '';
        config.clearPromptSkills();
        config.resizeChatInput();
        config.setSendButtonDisabled(true);
        config.setTyping(true);
        config.setCancelling(false);
        config.updateSendBtnState();

        config.setPendingAttachments([]);
        config.renderAttachmentPreview();

        config.appendMessage('user', displayText, attachmentInfos, null, {
            createdAt: Date.now(),
            skills: outgoing.skills,
            projects: outgoing.projects,
        });
        config.rememberSentUserMessage(outgoing.text, outgoing.skills, outgoing.projects);
        config.showTyping();
    }

    function buildMessageRequestBody(outgoing, modelConfig) {
        var body = { content: outgoing.text };
        if (outgoing.skills.length > 0) {
            body.skills = outgoing.skills.map(function (skill) {
                return { id: skill.id, name: skill.name };
            });
        }
        if (outgoing.projects.length > 0) {
            body.projects = outgoing.projects.map(function (project) {
                return { id: project.id, name: project.name, path: project.path };
            });
        }
        if (modelConfig && modelConfig.currentModel) {
            body.modelId = modelConfig.currentModel;
        }
        if (outgoing.attachments.length > 0) {
            body.attachments = outgoing.attachments.map(function (attachment) {
                return { path: attachment.path, name: attachment.name };
            });
        }
        return body;
    }

    function canUseClaudeAgentLoop() {
        var state = config.getState();
        return !!(
            window.ClaudeAgentLoop &&
            window.ClaudeAgentLoop.canStream(state.currentSessionProvider || (state.providerData && state.providerData.current))
        );
    }

    function applyStreamResult(streamResult) {
        if (streamResult.result && streamResult.result.provider) {
            config.setCurrentSessionProvider(streamResult.result.provider);
        }
        if (streamResult.result && streamResult.result.title) {
            config.updateConversationHeaderTitle(streamResult.result.title);
        }
    }

    return {
        sendMessage: sendMessage,
    };
}
