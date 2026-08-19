export function createSendMessageController(config) {
    async function sendMessage() {
        try {
            await config.ensureSession();
        } catch (e) {
            config.showError(e.message || '创建会话失败');
            return;
        }
        var outgoing = collectOutgoingMessage();
        if (!outgoing) return;

        if (isCompactCommand(outgoing.text)) {
            await compactContext(outgoing);
            return;
        }

        await sendOutgoingMessage(outgoing);
    }

    async function sendOutgoingMessage(outgoing, options) {
        options = options || {};
        beginOutgoingMessage(outgoing);

        var body = buildMessageRequestBody(outgoing, config.getState().modelConfig, config.getState().effort);
        if (options.providerCommand) {
            body.providerCommand = options.providerCommand;
        }
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

    function sendProviderCommand(commandText) {
        var normalizedCommand = normalizeProviderCommandText(commandText);
        if (!normalizedCommand) return false;
        if (!config.getState().currentSessionId) {
            // 草稿态：先落库再执行命令，保持同步布尔返回契约
            Promise.resolve()
                .then(function () { return config.ensureSession(); })
                .then(function () { sendProviderCommand(normalizedCommand); })
                .catch(function (e) { config.showError(e.message || '创建会话失败'); });
            return true;
        }
        if (isCompactCommand(normalizedCommand)) {
            var compactOutgoing = collectOutgoingMessage({ text: '/compact' });
            if (!compactOutgoing) return true;
            compactContext(compactOutgoing);
            return true;
        }

        var outgoing = collectOutgoingMessage({ text: normalizedCommand });
        if (!outgoing) return true;
        if (outgoing.attachments.length > 0 || outgoing.skills.length > 0 || outgoing.projects.length > 0 || outgoing.fileReferences.length > 0) {
            config.showError('执行命令时不能同时附加文件、技能或项目');
            return true;
        }
        sendOutgoingMessage(outgoing, { providerCommand: normalizedCommand });
        return true;
    }

    async function compactContext(outgoing) {
        if (outgoing.attachments.length > 0 || outgoing.skills.length > 0 || outgoing.projects.length > 0 || outgoing.fileReferences.length > 0) {
            config.showError('压缩上下文时不能同时附加文件、技能或项目');
            return;
        }

        var startedAt = Date.now();
        config.scrollBottom({ force: true });
        if (config.startCompactProgress) config.startCompactProgress(outgoing.sessionId, startedAt);

        config.inputEl.value = '';
        config.clearPromptSkills();
        config.resizeChatInput();
        config.setSendButtonDisabled(true);
        config.setTyping(true);
        config.setCancelling(false);
        config.updateSendBtnState();

        var body = {};
        var modelConfig = config.getState().modelConfig;
        if (modelConfig && modelConfig.currentModel) {
            body.modelId = modelConfig.currentModel;
        }
        var effort = config.getState().effort;
        if (effort) {
            body.effort = effort;
        }

        try {
            var res = await fetch('/api/sessions/' + outgoing.sessionId + '/compact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                var err = await res.json().catch(function () {
                    return {};
                });
                var isCurrentErrorSession = config.getState().currentSessionId === outgoing.sessionId;
                if (err.canceled) {
                    if (config.cancelCompactProgress) {
                        config.cancelCompactProgress(outgoing.sessionId, err.error || '压缩已停止');
                    }
                    return;
                }
                if (isCurrentErrorSession) {
                    if (config.failCompactProgress) {
                        config.failCompactProgress(outgoing.sessionId, err.error || '压缩失败');
                    }
                    config.showError(err.error || '压缩上下文失败，请重试');
                }
                return;
            }

            var data = await res.json();
            var isCurrentSession = config.getState().currentSessionId === outgoing.sessionId;
            if (data.provider && isCurrentSession) config.setCurrentSessionProvider(data.provider);
            if (data.title && isCurrentSession) config.updateConversationHeaderTitle(data.title);
            if (data.contextUsage && isCurrentSession) config.updateContextUsage(data.contextUsage);
            if (config.finishCompactProgress) {
                config.finishCompactProgress(outgoing.sessionId, data);
            }
            await config.fetchSessions();
        } catch (e) {
            if (config.getState().currentSessionId === outgoing.sessionId) {
                if (config.failCompactProgress) config.failCompactProgress(outgoing.sessionId, '压缩失败');
                config.showError(e.message || '压缩上下文失败，请检查连接');
            }
        } finally {
            if (config.getState().currentSessionId === outgoing.sessionId && !config.finishCompactProgress) {
                config.setTyping(false);
                config.setCancelling(false);
                config.updateSendBtnState();
            }
        }
    }

    function isCompactCommand(text) {
        var value = String(text || '').trim().toLowerCase();
        return value === '/compact';
    }

    function normalizeProviderCommandText(text) {
        var value = String(text || '').trim();
        if (!value) return '';
        return value.charAt(0) === '/' ? value : '/' + value;
    }

    function collectOutgoingMessage(options) {
        options = options || {};
        var state = config.getState();
        var text = Object.prototype.hasOwnProperty.call(options, 'text')
            ? String(options.text || '').trim()
            : config.inputEl.value.trim();
        var messageSkills = state.promptSkills.slice();
        var messageProjects = state.promptProjects.slice();
        var messageFileReferences = state.fileReferences.slice();
        var readyAttachments = state.pendingAttachments.filter(function (attachment) {
            return !attachment.uploading && attachment.path;
        });

        if (
            (!text && readyAttachments.length === 0 && messageSkills.length === 0 && messageProjects.length === 0 && messageFileReferences.length === 0) ||
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
            fileReferences: messageFileReferences,
            attachments: readyAttachments,
        };
    }

    function beginOutgoingMessage(outgoing) {
        var attachmentInfos = outgoing.attachments.map(function (attachment) {
            return { name: attachment.name, path: attachment.path };
        });
        var displayText = outgoing.text || (outgoing.attachments.length > 0 ? '[附件]' : '');

        if (config.closeFilePicker) config.closeFilePicker();
        config.inputEl.value = '';
        config.clearPromptSkills();
        if (config.clearFileReferences) config.clearFileReferences();
        config.resizeChatInput();
        config.setSendButtonDisabled(true);
        config.setTyping(true);
        config.setCancelling(false);
        config.updateSendBtnState();

        config.setPendingAttachments([]);
        config.renderAttachmentPreview();
        config.scrollBottom({ force: true });

        config.appendMessage('user', displayText, attachmentInfos, null, {
            createdAt: Date.now(),
            fileReferences: outgoing.fileReferences,
            skills: outgoing.skills,
            projects: outgoing.projects,
        });
        config.rememberSentUserMessage(outgoing.text, outgoing.skills, outgoing.projects, outgoing.fileReferences);
        config.showTyping();
    }

    function buildMessageRequestBody(outgoing, modelConfig, effort) {
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
        if (outgoing.fileReferences.length > 0) {
            body.fileReferences = outgoing.fileReferences.map(function (file) {
                return { name: file.name, path: file.path };
            });
        }
        if (modelConfig && modelConfig.currentModel) {
            body.modelId = modelConfig.currentModel;
        }
        if (effort) {
            body.effort = effort;
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
        sendProviderCommand: sendProviderCommand,
        sendMessage: sendMessage,
    };
}
