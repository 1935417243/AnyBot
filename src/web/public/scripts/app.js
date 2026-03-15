    function copyCode(btn) {
        var code = btn.closest('pre').querySelector('code');
        var text = code.textContent || code.innerText;
        navigator.clipboard.writeText(text).then(function () {
            btn.textContent = '已复制';
            setTimeout(function () {
                btn.textContent = '复制';
            }, 1500);
        });
    }

    (function () {
        const messagesEl = document.getElementById('messages');
        const inputEl = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        const historyList = document.getElementById('history-list');
        const newChatBtn = document.getElementById('new-chat-btn');

        const modelSwitcher = document.getElementById('model-switcher');
        const modelBadge = document.getElementById('model-badge');
        const modelDropdown = document.getElementById('model-dropdown');
        const currentModelNameEl = document.getElementById('current-model-name');

        const providerSwitcher = document.getElementById('provider-switcher');
        const providerBadge = document.getElementById('provider-badge');
        const providerDropdown = document.getElementById('provider-dropdown');
        const currentProviderNameEl = document.getElementById('current-provider-name');

        let currentSessionId = null;
        let isTyping = false;
        let sessions = [];
        let modelConfig = null;
        let providerData = null;

        // 附件相关
        const fileInput = document.getElementById('file-input');
        const attachBtn = document.getElementById('attach-btn');
        const attachmentPreview = document.getElementById('attachment-preview');
        const dropOverlay = document.getElementById('drop-overlay');
        let pendingAttachments = []; // { path, name, size, isImage, localUrl? }

        const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif', '.heic', '.heif', '.avif'];

        function getFileTypeClass(name) {
            var ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
            if (['.doc', '.docx', '.txt', '.rtf'].includes(ext)) return 'file-type-doc';
            if (['.xls', '.xlsx', '.csv'].includes(ext)) return 'file-type-sheet';
            if (ext === '.pdf') return 'file-type-pdf';
            if (['.js', '.ts', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.sh', '.sql'].includes(ext)) return 'file-type-code';
            return 'file-type-other';
        }

        function getFileExt(name) {
            var ext = (name.match(/\.[^.]+$/) || [''])[0].replace('.', '').toUpperCase();
            return ext.slice(0, 4) || 'FILE';
        }

        function formatSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        function updateSendBtnState() {
            sendBtn.disabled = (inputEl.value.trim() === '' && pendingAttachments.length === 0) || isTyping;
        }

        function renderAttachmentPreview() {
            if (pendingAttachments.length === 0) {
                attachmentPreview.style.display = 'none';
                attachmentPreview.innerHTML = '';
                return;
            }
            attachmentPreview.style.display = 'flex';
            attachmentPreview.innerHTML = '';
            pendingAttachments.forEach(function (att, idx) {
                var item = document.createElement('div');
                item.className = 'attachment-item' + (att.uploading ? ' uploading' : '');

                if (att.isImage && att.localUrl) {
                    var thumb = document.createElement('img');
                    thumb.className = 'attachment-item-thumb';
                    thumb.src = att.localUrl;
                    thumb.alt = att.name;
                    item.appendChild(thumb);
                } else {
                    var icon = document.createElement('div');
                    icon.className = 'attachment-item-icon ' + getFileTypeClass(att.name);
                    icon.textContent = getFileExt(att.name);
                    item.appendChild(icon);
                }

                var info = document.createElement('div');
                info.className = 'attachment-item-info';
                info.innerHTML = '<div class="attachment-item-name">' + escapeHtml(att.name) + '</div>' +
                    '<div class="attachment-item-size">' + formatSize(att.size) + '</div>';
                item.appendChild(info);

                if (!att.uploading) {
                    var removeBtn = document.createElement('button');
                    removeBtn.className = 'attachment-item-remove';
                    removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
                    removeBtn.addEventListener('click', function () {
                        pendingAttachments.splice(idx, 1);
                        renderAttachmentPreview();
                        updateSendBtnState();
                    });
                    item.appendChild(removeBtn);
                }

                attachmentPreview.appendChild(item);
            });
        }

        async function uploadFile(file) {
            var isImage = IMAGE_EXTS.some(function (ext) {
                return file.name.toLowerCase().endsWith(ext);
            });
            var localUrl = isImage ? URL.createObjectURL(file) : null;
            var tempAtt = { name: file.name, size: file.size, isImage: isImage, localUrl: localUrl, uploading: true, path: '' };
            pendingAttachments.push(tempAtt);
            renderAttachmentPreview();
            updateSendBtnState();

            try {
                var formData = new FormData();
                formData.append('file', file);
                var res = await fetch('/api/upload', { method: 'POST', body: formData });
                if (!res.ok) throw new Error('上传失败');
                var data = await res.json();
                tempAtt.path = data.path;
                tempAtt.uploading = false;
                renderAttachmentPreview();
                updateSendBtnState();
            } catch (e) {
                var idx = pendingAttachments.indexOf(tempAtt);
                if (idx !== -1) pendingAttachments.splice(idx, 1);
                renderAttachmentPreview();
                updateSendBtnState();
                showError('文件上传失败: ' + (e.message || '未知错误'));
            }
        }

        async function uploadFiles(files) {
            for (var i = 0; i < files.length; i++) {
                await uploadFile(files[i]);
            }
        }

        inputEl.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 160) + 'px';
            updateSendBtnState();
        });

        inputEl.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!sendBtn.disabled) sendMessage();
            }
        });

        sendBtn.addEventListener('click', sendMessage);
        newChatBtn.addEventListener('click', createNewChat);

        // 附件按钮 - 点击触发文件选择
        attachBtn.addEventListener('click', function () {
            fileInput.click();
        });

        fileInput.addEventListener('change', function () {
            if (this.files && this.files.length > 0) {
                uploadFiles(this.files);
            }
            this.value = ''; // 重置以便重新选择同一文件
        });

        // 粘贴图片
        inputEl.addEventListener('paste', function (e) {
            var items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            var files = [];
            for (var i = 0; i < items.length; i++) {
                if (items[i].kind === 'file') {
                    var file = items[i].getAsFile();
                    if (file) files.push(file);
                }
            }
            if (files.length > 0) {
                e.preventDefault();
                uploadFiles(files);
            }
        });

        // 拖拽文件
        var dragCounter = 0;
        var chatViewEl = document.getElementById('chat-view');

        chatViewEl.addEventListener('dragenter', function (e) {
            e.preventDefault();
            dragCounter++;
            dropOverlay.style.display = 'flex';
        });

        chatViewEl.addEventListener('dragleave', function (e) {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                dropOverlay.style.display = 'none';
            }
        });

        chatViewEl.addEventListener('dragover', function (e) {
            e.preventDefault();
        });

        chatViewEl.addEventListener('drop', function (e) {
            e.preventDefault();
            dragCounter = 0;
            dropOverlay.style.display = 'none';
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                uploadFiles(e.dataTransfer.files);
            }
        });

        function escapeHtml(s) {
            return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        if (typeof marked !== 'undefined') {
            var markedRenderer = new marked.Renderer();
            markedRenderer.code = function (obj) {
                var code = (typeof obj === 'string') ? obj : (obj.text || '');
                var lang = (typeof obj === 'string') ? '' : (obj.lang || '');
                var headerHtml = '<div class="code-header"><span class="code-lang">' + escapeHtml(lang || 'text') + '</span><button class="code-copy" onclick="copyCode(this)">复制</button></div>';
                if (lang && typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
                    try {
                        var highlighted = hljs.highlight(code, {language: lang}).value;
                        return '<pre>' + headerHtml + '<code class="hljs language-' + escapeHtml(lang) + '">' + highlighted + '</code></pre>';
                    } catch (_) {
                    }
                }
                return '<pre>' + headerHtml + '<code class="hljs">' + escapeHtml(code) + '</code></pre>';
            };

            marked.setOptions({
                renderer: markedRenderer,
                gfm: true,
                breaks: true,
            });
        }

        function scrollBottom() {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        function clearEmpty() {
            var empty = document.getElementById('empty-state');
            if (empty) empty.remove();
        }

        function showEmptyState() {
            messagesEl.innerHTML =
                '<div id="empty-state">' +
                '<div class="empty-icon">Ab</div>' +
                '<div class="empty-title">AnyBot 已就绪</div>' +
                '<div class="empty-sub">发送消息，开始你的对话</div>' +
                '</div>';
        }

        function appendMessage(role, text, attachmentNames) {
            clearEmpty();
            var row = document.createElement('div');
            row.className = 'message-row ' + role;

            if (role === 'ai') {
                var bubble = document.createElement('div');
                bubble.className = 'bubble';

                var avatar = document.createElement('div');
                avatar.className = 'avatar ai-avatar';
                avatar.textContent = 'Ab';

                var content = document.createElement('div');
                content.className = 'message-content';
                try {
                    content.innerHTML = marked.parse(text);
                } catch (e) {
                    content.textContent = text;
                }

                bubble.appendChild(avatar);
                bubble.appendChild(content);
                row.appendChild(bubble);
            } else {
                var bubble = document.createElement('div');
                bubble.className = 'bubble';

                var content = document.createElement('div');
                content.className = 'message-content';
                content.textContent = text;

                // 显示附件标签
                if (attachmentNames && attachmentNames.length > 0) {
                    var attDiv = document.createElement('div');
                    attDiv.className = 'message-attachments';
                    attachmentNames.forEach(function (name) {
                        var tag = document.createElement('span');
                        tag.className = 'message-attachment-tag';
                        tag.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M14 8.5l-5.5 5.5a3.5 3.5 0 01-5-5L9 3.5a2 2 0 013 3L6.5 12a.5.5 0 01-.7-.7L11 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> ' + escapeHtml(name);
                        attDiv.appendChild(tag);
                    });
                    content.appendChild(attDiv);
                }

                bubble.appendChild(content);
                row.appendChild(bubble);
            }

            messagesEl.appendChild(row);
            scrollBottom();
            return row;
        }

        function showTyping() {
            clearEmpty();
            var row = document.createElement('div');
            row.className = 'message-row ai';
            row.id = 'typing-row';
            row.innerHTML =
                '<div class="bubble">' +
                '<div class="avatar ai-avatar">Ab</div>' +
                '<div class="message-content">' +
                '<div class="typing-indicator">' +
                '<div class="typing-dot"></div>' +
                '<div class="typing-dot"></div>' +
                '<div class="typing-dot"></div>' +
                '</div>' +
                '</div>' +
                '</div>';
            messagesEl.appendChild(row);
            scrollBottom();
        }

        function removeTyping() {
            var t = document.getElementById('typing-row');
            if (t) t.remove();
        }

        function showError(msg) {
            var toast = document.createElement('div');
            toast.className = 'error-toast';
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(function () {
                toast.remove();
            }, 4000);
        }

        function groupSessionsByDate(list) {
            var now = new Date();
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            var yesterday = today - 86400000;
            var weekAgo = today - 7 * 86400000;

            var groups = {'今天': [], '昨天': [], '上周': [], '更早': []};

            list.forEach(function (s) {
                var t = s.updatedAt || s.createdAt;
                if (t >= today) groups['今天'].push(s);
                else if (t >= yesterday) groups['昨天'].push(s);
                else if (t >= weekAgo) groups['上周'].push(s);
                else groups['更早'].push(s);
            });

            return groups;
        }

        function renderHistory() {
            historyList.innerHTML = '';
            var groups = groupSessionsByDate(sessions);

            Object.keys(groups).forEach(function (label) {
                var items = groups[label];
                if (items.length === 0) return;

                var group = document.createElement('div');
                group.className = 'history-group';

                var groupLabel = document.createElement('div');
                groupLabel.className = 'history-group-label';
                groupLabel.textContent = label;
                group.appendChild(groupLabel);

                items.forEach(function (s) {
                    var item = document.createElement('div');
                    item.className = 'history-item' + (currentView === 'chat' && s.id === currentSessionId ? ' active' : '');
                    item.dataset.id = s.id;

                    var effectiveSource = (s.source && s.source !== 'web') ? s.source : 'web';
                    var meta = CHANNEL_META[effectiveSource];
                    var badge = document.createElement('span');
                    badge.className = 'history-item-source ' + (meta ? meta.iconClass : 'default');
                    badge.textContent = meta ? meta.badge : effectiveSource;
                    item.appendChild(badge);

                    var text = document.createElement('span');
                    text.className = 'history-item-text';
                    text.textContent = s.title;

                    var del = document.createElement('button');
                    del.className = 'history-item-delete';
                    del.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
                    del.addEventListener('click', function (e) {
                        e.stopPropagation();
                        deleteSession(s.id);
                    });

                    item.appendChild(text);
                    item.appendChild(del);

                    item.addEventListener('click', function () {
                        loadSession(s.id);
                    });

                    group.appendChild(item);
                });

                historyList.appendChild(group);
            });
        }

        async function fetchSessions() {
            try {
                var res = await fetch('/api/sessions');
                sessions = await res.json();
                renderHistory();
            } catch (e) {
                console.error('Failed to fetch sessions:', e);
            }
        }

        async function createNewChat() {
            if (currentView !== 'chat') {
                showChatView();
            }
            if (currentSessionId && !document.querySelector('#messages .message-row')) {
                inputEl.focus();
                return;
            }
            try {
                var res = await fetch('/api/sessions', {method: 'POST'});
                var data = await res.json();
                currentSessionId = data.id;
                showChatView();
                showEmptyState();
                inputEl.value = '';
                inputEl.style.height = 'auto';
                sendBtn.disabled = true;
                inputEl.focus();
                await fetchSessions();
            } catch (e) {
                showError('创建会话失败');
            }
        }

        async function loadSession(id) {
            try {
                var res = await fetch('/api/sessions/' + id);
                if (!res.ok) {
                    showError('加载会话失败');
                    return;
                }
                var data = await res.json();
                currentSessionId = id;

                showChatView();

                messagesEl.innerHTML = '';
                if (data.messages.length === 0) {
                    showEmptyState();
                } else {
                    data.messages.forEach(function (m) {
                        var attNames = null;
                        if (m.metadata) {
                            try {
                                var meta = JSON.parse(m.metadata);
                                if (meta.attachments && meta.attachments.length > 0) {
                                    attNames = meta.attachments;
                                }
                            } catch (_) {}
                        }
                        appendMessage(m.role === 'user' ? 'user' : 'ai', m.content, attNames);
                    });
                }

                renderHistory();
                inputEl.focus();
            } catch (e) {
                showError('加载会话失败');
            }
        }

        async function deleteSession(id) {
            try {
                await fetch('/api/sessions/' + id, {method: 'DELETE'});
                if (currentSessionId === id) {
                    currentSessionId = null;
                    showEmptyState();
                }
                await fetchSessions();
            } catch (e) {
                showError('删除失败');
            }
        }

        async function sendMessage() {
            var text = inputEl.value.trim();
            // 收集已上传完成的附件
            var readyAttachments = pendingAttachments.filter(function (a) { return !a.uploading && a.path; });
            if ((!text && readyAttachments.length === 0) || isTyping || !currentSessionId) return;

            // 收集附件名用于显示
            var attachmentNames = readyAttachments.map(function (a) { return a.name; });

            inputEl.value = '';
            inputEl.style.height = 'auto';
            sendBtn.disabled = true;
            isTyping = true;

            // 清空附件预览
            pendingAttachments = [];
            renderAttachmentPreview();

            appendMessage('user', text || '[附件]', attachmentNames);
            showTyping();

            // 构建请求体
            var body = { content: text };
            if (readyAttachments.length > 0) {
                body.attachments = readyAttachments.map(function (a) {
                    return { path: a.path, name: a.name };
                });
            }

            try {
                var res = await fetch('/api/sessions/' + currentSessionId + '/messages', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(body),
                });

                removeTyping();

                if (!res.ok) {
                    var err = await res.json().catch(function () {
                        return {};
                    });
                    showError(err.error || '发送失败，请重试');
                    isTyping = false;
                    return;
                }

                var data = await res.json();
                appendMessage('ai', data.content);

                await fetchSessions();
            } catch (e) {
                removeTyping();
                showError('网络错误，请检查连接');
            }

            isTyping = false;
            updateSendBtnState();
        }

        async function fetchModelConfig() {
            try {
                var res = await fetch('/api/model-config');
                modelConfig = await res.json();
                currentModelNameEl.textContent = modelConfig.currentModel;
                renderModelDropdown();
            } catch (e) {
                currentModelNameEl.textContent = 'error';
                console.error('Failed to fetch model config:', e);
            }
        }

        function renderModelDropdown() {
            if (!modelConfig) return;
            modelDropdown.innerHTML = '';
            modelConfig.models.forEach(function (m) {
                var opt = document.createElement('div');
                opt.className = 'model-option' + (m.id === modelConfig.currentModel ? ' active' : '');
                opt.innerHTML =
                    '<div class="model-option-name">' +
                    (m.id === modelConfig.currentModel
                        ? '<svg class="model-option-check" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                        : '<span style="width:14px;display:inline-block"></span>') +
                    escapeHtml(m.id) +
                    '</div>' +
                    '<div class="model-option-desc">' + escapeHtml(m.description) + '</div>';
                opt.addEventListener('click', function (e) {
                    e.stopPropagation();
                    switchModel(m.id);
                });
                modelDropdown.appendChild(opt);
            });
        }

        async function switchModel(modelId) {
            if (!modelConfig || modelId === modelConfig.currentModel) {
                modelSwitcher.classList.remove('open');
                return;
            }
            try {
                var res = await fetch('/api/model-config', {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({modelId: modelId}),
                });
                if (!res.ok) {
                    var err = await res.json().catch(function () {
                        return {};
                    });
                    showError(err.error || '切换模型失败');
                    return;
                }
                modelConfig = await res.json();
                currentModelNameEl.textContent = modelConfig.currentModel;
                renderModelDropdown();
                modelSwitcher.classList.remove('open');
            } catch (e) {
                showError('切换模型失败');
            }
        }

        modelBadge.addEventListener('click', function (e) {
            e.stopPropagation();
            providerSwitcher.classList.remove('open');
            modelSwitcher.classList.toggle('open');
        });

        async function fetchProviders() {
            try {
                var res = await fetch('/api/providers');
                providerData = await res.json();
                currentProviderNameEl.textContent = providerData.current;
                renderProviderDropdown();
            } catch (e) {
                currentProviderNameEl.textContent = 'error';
                console.error('Failed to fetch providers:', e);
            }
        }

        function renderProviderDropdown() {
            if (!providerData) return;
            providerDropdown.innerHTML = '';
            providerData.providers.forEach(function (p) {
                var opt = document.createElement('div');
                opt.className = 'provider-option' + (p.type === providerData.current ? ' active' : '');
                opt.innerHTML =
                    '<div class="provider-option-name">' +
                    (p.type === providerData.current
                        ? '<svg class="model-option-check" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                        : '<span style="width:14px;display:inline-block"></span>') +
                    escapeHtml(p.displayName) +
                    '</div>';
                opt.addEventListener('click', function (e) {
                    e.stopPropagation();
                    switchProviderTo(p.type);
                });
                providerDropdown.appendChild(opt);
            });
        }

        async function switchProviderTo(providerType) {
            if (!providerData || providerType === providerData.current) {
                providerSwitcher.classList.remove('open');
                return;
            }
            try {
                var res = await fetch('/api/providers/current', {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({provider: providerType}),
                });
                if (!res.ok) {
                    var err = await res.json().catch(function () { return {}; });
                    showError(err.error || '切换 Provider 失败');
                    return;
                }
                modelConfig = await res.json();
                providerData.current = providerType;
                currentProviderNameEl.textContent = providerType;
                currentModelNameEl.textContent = modelConfig.currentModel;
                renderProviderDropdown();
                renderModelDropdown();
                providerSwitcher.classList.remove('open');
            } catch (e) {
                showError('切换 Provider 失败');
            }
        }

        providerBadge.addEventListener('click', function (e) {
            e.stopPropagation();
            modelSwitcher.classList.remove('open');
            providerSwitcher.classList.toggle('open');
        });

        document.addEventListener('click', function (e) {
            if (!modelSwitcher.contains(e.target)) {
                modelSwitcher.classList.remove('open');
            }
            if (!providerSwitcher.contains(e.target)) {
                providerSwitcher.classList.remove('open');
            }
        });

        const chatView = document.getElementById('chat-view');
        const channelView = document.getElementById('channel-view');
        const skillsView = document.getElementById('skills-view');
        const proxyView = document.getElementById('proxy-view');
        const channelsBtn = document.getElementById('channels-btn');
        const skillsBtn = document.getElementById('skills-btn');
        const proxyBtn = document.getElementById('proxy-btn');

        const CHANNEL_META = {
            web: {name: '本地', icon: '本', iconClass: 'web', badge: '本地'},
            feishu: {name: '飞书', icon: '飞', iconClass: 'feishu', badge: '飞书'},
            qqbot: {name: 'QQ', icon: 'Q', iconClass: 'qq', badge: 'QQ'},
            dingtalk: {name: '钉钉', icon: '钉', iconClass: 'dingtalk', badge: '钉钉'},
            telegram: {name: 'Telegram', icon: 'T', iconClass: 'telegram', badge: 'TG'},
            discord: {name: 'Discord', icon: 'D', iconClass: 'discord', badge: 'DC'},
        };

        function getChannelMeta(type) {
            return CHANNEL_META[type] || {name: type, icon: type.charAt(0).toUpperCase(), iconClass: 'default'};
        }

        var channelsData = null;
        var skillsData = null;
        var currentView = 'chat';

        function hideAllViews() {
            chatView.style.display = 'none';
            channelView.style.display = 'none';
            skillsView.style.display = 'none';
            proxyView.style.display = 'none';
            newChatBtn.classList.remove('active');
            channelsBtn.classList.remove('active');
            skillsBtn.classList.remove('active');
            proxyBtn.classList.remove('active');
        }

        function showChatView() {
            hideAllViews();
            currentView = 'chat';
            chatView.style.display = 'flex';
            newChatBtn.classList.add('active');
            renderHistory();
        }

        function showChannelsPage() {
            hideAllViews();
            currentView = 'channels';
            channelView.style.display = 'flex';
            channelsBtn.classList.add('active');
            renderHistory();
            renderAllChannels();
        }

        function showSkillsPage() {
            hideAllViews();
            currentView = 'skills';
            skillsView.style.display = 'flex';
            skillsBtn.classList.add('active');
            renderHistory();
            renderSkillsView();
        }

        channelsBtn.addEventListener('click', function () {
            if (currentView === 'channels') return;
            if (!channelsData) {
                fetchChannels().then(function () {
                    showChannelsPage();
                });
            } else {
                showChannelsPage();
            }
        });

        skillsBtn.addEventListener('click', function () {
            if (currentView === 'skills') return;
            fetchSkills().then(function () {
                showSkillsPage();
            });
        });

        proxyBtn.addEventListener('click', function () {
            if (currentView === 'proxy') return;
            showProxyPage();
        });

        function showProxyPage() {
            hideAllViews();
            currentView = 'proxy';
            proxyView.style.display = 'flex';
            proxyBtn.classList.add('active');
            renderHistory();
            renderProxyView();
        }

        var proxyConfig = null;

        async function fetchProxyConfig() {
            try {
                var res = await fetch('/api/proxy');
                proxyConfig = await res.json();
            } catch (e) {
                console.error('Failed to fetch proxy config:', e);
            }
        }

        function renderProxyView() {
            proxyView.innerHTML = '';

            var page = document.createElement('div');
            page.className = 'proxy-page';

            var header = document.createElement('div');
            header.className = 'proxy-page-header';
            header.innerHTML =
                '<div class="proxy-page-header-top">' +
                '<div class="proxy-page-header-icon">' +
                '<svg width="20" height="20" viewBox="0 0 14 14" fill="none"><path d="M7 1C4.24 1 2 3.24 2 6c0 1.86 1.02 3.49 2.53 4.35L4 12.5h6l-.53-2.15C10.98 9.49 12 7.86 12 6c0-2.76-2.24-5-5-5z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="6" r="1.5" stroke="currentColor" stroke-width="1.1"/></svg>' +
                '</div>' +
                '<div>' +
                '<div class="proxy-page-title">代理设置</div>' +
                '<div class="proxy-page-subtitle">配置网络代理，让所有请求通过代理服务器</div>' +
                '</div>' +
                '</div>';
            page.appendChild(header);

            var cfg = proxyConfig || { enabled: false, protocol: 'http', host: '127.0.0.1', port: 7890 };

            var card = document.createElement('div');
            card.className = 'proxy-card';

            var hasAuth = !!(cfg.username || cfg.password);

            card.innerHTML =
                '<div class="proxy-card-title">' +
                '<span>代理配置</span>' +
                '</div>' +
                '<div class="proxy-toggle-row">' +
                '<div>' +
                '<div class="proxy-toggle-label">启用代理</div>' +
                '<div class="proxy-toggle-hint">开启后所有出站请求都会通过代理</div>' +
                '</div>' +
                '<label class="proxy-toggle">' +
                '<input type="checkbox" id="proxy-enabled" ' + (cfg.enabled ? 'checked' : '') + '>' +
                '<span class="proxy-toggle-slider"></span>' +
                '</label>' +
                '</div>' +
                '<div style="height:18px"></div>' +
                '<div class="proxy-row">' +
                '<div class="proxy-field">' +
                '<label class="proxy-field-label">协议</label>' +
                '<select class="proxy-field-select" id="proxy-protocol">' +
                '<option value="http"' + (cfg.protocol === 'http' ? ' selected' : '') + '>HTTP</option>' +
                '<option value="socks5"' + (cfg.protocol === 'socks5' ? ' selected' : '') + '>SOCKS5</option>' +
                '</select>' +
                '</div>' +
                '<div class="proxy-field">' +
                '<label class="proxy-field-label">地址</label>' +
                '<input class="proxy-field-input" id="proxy-host" type="text" value="' + escapeHtml(cfg.host || '') + '" placeholder="127.0.0.1" spellcheck="false">' +
                '</div>' +
                '<div class="proxy-field port">' +
                '<label class="proxy-field-label">端口</label>' +
                '<input class="proxy-field-input" id="proxy-port" type="number" value="' + (cfg.port || '') + '" placeholder="7890" min="1" max="65535">' +
                '</div>' +
                '</div>' +
                '<button class="proxy-auth-toggle" id="proxy-auth-toggle">' + (hasAuth ? '隐藏认证' : '认证（可选）') + '</button>' +
                '<div class="proxy-auth-fields' + (hasAuth ? ' show' : '') + '" id="proxy-auth-fields">' +
                '<div class="proxy-row">' +
                '<div class="proxy-field">' +
                '<label class="proxy-field-label">用户名</label>' +
                '<input class="proxy-field-input" id="proxy-username" type="text" value="' + escapeHtml(cfg.username || '') + '" placeholder="留空则不使用认证" spellcheck="false">' +
                '</div>' +
                '<div class="proxy-field">' +
                '<label class="proxy-field-label">密码</label>' +
                '<input class="proxy-field-input" id="proxy-password" type="password" value="' + escapeHtml(cfg.password || '') + '" placeholder="留空则不使用认证">' +
                '</div>' +
                '</div>' +
                '</div>' +
                '<div class="proxy-actions">' +
                '<button class="proxy-save-btn" id="proxy-save-btn">保存</button>' +
                '<button class="proxy-test-btn" id="proxy-test-btn">测试连接</button>' +
                '</div>' +
                '<div class="proxy-status" id="proxy-status"></div>';

            page.appendChild(card);

            var tipsCard = document.createElement('div');
            tipsCard.className = 'proxy-card';
            tipsCard.innerHTML =
                '<div class="proxy-card-title">常见代理软件端口</div>' +
                '<div style="font-size:12px;color:var(--text-muted);line-height:2">' +
                'Clash / ClashX — HTTP <code style="color:var(--text);background:var(--bg);padding:2px 6px;border-radius:4px;font-family:JetBrains Mono,monospace">7890</code> · SOCKS5 <code style="color:var(--text);background:var(--bg);padding:2px 6px;border-radius:4px;font-family:JetBrains Mono,monospace">7891</code><br>' +
                'V2rayN — HTTP <code style="color:var(--text);background:var(--bg);padding:2px 6px;border-radius:4px;font-family:JetBrains Mono,monospace">10809</code> · SOCKS5 <code style="color:var(--text);background:var(--bg);padding:2px 6px;border-radius:4px;font-family:JetBrains Mono,monospace">10808</code><br>' +
                'Shadowsocks — HTTP <code style="color:var(--text);background:var(--bg);padding:2px 6px;border-radius:4px;font-family:JetBrains Mono,monospace">1082</code><br>' +
                'Surge — HTTP <code style="color:var(--text);background:var(--bg);padding:2px 6px;border-radius:4px;font-family:JetBrains Mono,monospace">6152</code> · SOCKS5 <code style="color:var(--text);background:var(--bg);padding:2px 6px;border-radius:4px;font-family:JetBrains Mono,monospace">6153</code>' +
                '</div>';
            page.appendChild(tipsCard);

            proxyView.appendChild(page);

            document.getElementById('proxy-auth-toggle').addEventListener('click', function () {
                var fields = document.getElementById('proxy-auth-fields');
                var showing = fields.classList.toggle('show');
                this.textContent = showing ? '隐藏认证' : '认证（可选）';
            });

            document.getElementById('proxy-save-btn').addEventListener('click', saveProxyConfig);
            document.getElementById('proxy-test-btn').addEventListener('click', testProxyConnection);
        }

        async function saveProxyConfig() {
            var saveBtn = document.getElementById('proxy-save-btn');
            var statusEl = document.getElementById('proxy-status');
            saveBtn.disabled = true;
            saveBtn.textContent = '保存中…';

            var body = {
                enabled: document.getElementById('proxy-enabled').checked,
                protocol: document.getElementById('proxy-protocol').value,
                host: document.getElementById('proxy-host').value.trim(),
                port: parseInt(document.getElementById('proxy-port').value, 10) || 0,
                username: document.getElementById('proxy-username').value,
                password: document.getElementById('proxy-password').value,
            };

            try {
                var res = await fetch('/api/proxy', {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(body)
                });

                if (!res.ok) {
                    var err = await res.json();
                    throw new Error(err.error || '保存失败');
                }

                proxyConfig = await res.json();
                statusEl.className = 'proxy-status show ' + (body.enabled ? 'success' : 'info');
                statusEl.textContent = body.enabled ? '代理已保存并启用' : '代理配置已保存（未启用）';
            } catch (e) {
                statusEl.className = 'proxy-status show error';
                statusEl.textContent = e.message || '保存失败';
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = '保存';
            }
        }

        async function testProxyConnection() {
            var testBtn = document.getElementById('proxy-test-btn');
            var statusEl = document.getElementById('proxy-status');
            testBtn.disabled = true;
            testBtn.textContent = '测试中…';
            statusEl.className = 'proxy-status show info';
            statusEl.textContent = '正在测试代理连接…';

            var body = {
                protocol: document.getElementById('proxy-protocol').value,
                host: document.getElementById('proxy-host').value.trim(),
                port: parseInt(document.getElementById('proxy-port').value, 10) || 0,
                username: document.getElementById('proxy-username').value,
                password: document.getElementById('proxy-password').value,
            };

            try {
                var res = await fetch('/api/proxy/test', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(body)
                });
                var data = await res.json();

                if (data.ok) {
                    statusEl.className = 'proxy-status show success';
                    statusEl.textContent = '连接成功，延迟 ' + data.latency + 'ms';
                } else {
                    statusEl.className = 'proxy-status show error';
                    statusEl.textContent = '连接失败: ' + (data.error || '未知错误');
                }
            } catch (e) {
                statusEl.className = 'proxy-status show error';
                statusEl.textContent = '测试请求失败: ' + (e.message || '网络错误');
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = '测试连接';
            }
        }

        async function fetchChannels() {
            try {
                var res = await fetch('/api/channels');
                channelsData = await res.json();
            } catch (e) {
                console.error('Failed to fetch channels:', e);
            }
        }

        var openDrawerType = null;

        function renderAllChannels() {
            channelView.innerHTML = '';
            if (!channelsData || !channelsData.registered) return;

            var page = document.createElement('div');
            page.className = 'channel-page';

            var header = document.createElement('div');
            header.className = 'channel-page-header';
            header.innerHTML =
                '<div class="channel-page-header-top">' +
                '<div class="channel-page-header-icon">' +
                '<svg width="20" height="20" viewBox="0 0 14 14" fill="none"><path d="M1.5 5h11M1.5 9h11M5 1.5l-1.5 11M10.5 1.5L9 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
                '</div>' +
                '<div>' +
                '<div class="channel-page-title">频道管理</div>' +
                '<div class="channel-page-subtitle">点击频道进行配置</div>' +
                '</div>' +
                '</div>';
            page.appendChild(header);

            var list = document.createElement('div');
            list.className = 'channel-list';

            channelsData.registered.forEach(function (type) {
                var cfg = (channelsData.config && channelsData.config[type]) || {};
                var meta = getChannelMeta(type);
                var isOn = !!cfg.enabled;

                var item = document.createElement('div');
                item.className = 'channel-item';
                item.dataset.type = type;
                item.innerHTML =
                    '<div class="channel-item-icon ' + meta.iconClass + '">' + escapeHtml(meta.icon) + '</div>' +
                    '<div class="channel-item-info">' +
                    '<div class="channel-item-name">' + escapeHtml(meta.name) + '</div>' +
                    '<div class="channel-item-status ' + (isOn ? 'on' : '') + '">' + (isOn ? '已启用' : '未启用') + '</div>' +
                    '</div>' +
                    '<svg class="channel-item-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

                item.addEventListener('click', function () {
                    openChannelDrawer(type);
                });
                list.appendChild(item);
            });

            page.appendChild(list);

            var overlay = document.createElement('div');
            overlay.className = 'channel-drawer-overlay';
            overlay.id = 'channel-drawer-overlay';
            overlay.addEventListener('click', closeChannelDrawer);

            var drawer = document.createElement('div');
            drawer.className = 'channel-drawer';
            drawer.id = 'channel-drawer';

            page.appendChild(overlay);
            page.appendChild(drawer);
            channelView.appendChild(page);
        }

        function openChannelDrawer(type) {
            openDrawerType = type;
            var cfg = (channelsData.config && channelsData.config[type]) || {};
            var meta = getChannelMeta(type);
            var isOn = !!cfg.enabled;

            document.querySelectorAll('.channel-item').forEach(function (el) {
                el.classList.toggle('active', el.dataset.type === type);
            });

            var drawer = document.getElementById('channel-drawer');
            var fieldsHtml = '';
            if (type === 'telegram') {
                fieldsHtml =
                    '<div class="channel-drawer-field">' +
                    '<label class="channel-drawer-field-label">Bot Token</label>' +
                    '<input class="channel-drawer-input" id="ch-token-' + type + '" type="password" value="' + escapeHtml(cfg.token || '') + '" placeholder="从 @BotFather 获取的 Token" spellcheck="false">' +
                    '</div>';
            } else {
                fieldsHtml =
                    '<div class="channel-drawer-field">' +
                    '<label class="channel-drawer-field-label">App ID</label>' +
                    '<input class="channel-drawer-input" id="ch-appid-' + type + '" value="' + escapeHtml(cfg.appId || '') + '" placeholder="输入 App ID" spellcheck="false">' +
                    '</div>' +
                    '<div class="channel-drawer-field">' +
                    '<label class="channel-drawer-field-label">App Secret</label>' +
                    '<input class="channel-drawer-input" id="ch-secret-' + type + '" type="password" value="' + escapeHtml(cfg.appSecret || '') + '" placeholder="输入 App Secret" spellcheck="false">' +
                    '</div>';
            }
            fieldsHtml +=
                '<div class="channel-drawer-field">' +
                '<label class="channel-drawer-field-label">Owner Chat ID <span style="font-weight:400;color:var(--text-dim)">(私聊机器人后自动填入)</span></label>' +
                '<input class="channel-drawer-input" id="ch-owner-' + type + '" value="' + escapeHtml(cfg.ownerChatId || '') + '" placeholder="私聊机器人一次即可自动记录" spellcheck="false">' +
                '</div>';

            drawer.innerHTML =
                '<div class="channel-drawer-header">' +
                '<div class="channel-drawer-icon ' + meta.iconClass + '">' + escapeHtml(meta.icon) + '</div>' +
                '<span class="channel-drawer-title">' + escapeHtml(meta.name) + '</span>' +
                '<button class="channel-drawer-close" id="drawer-close-btn">' +
                '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
                '</button>' +
                '</div>' +
                '<div class="channel-drawer-body">' +
                '<div class="channel-drawer-row">' +
                '<span class="channel-drawer-row-label">启用频道</span>' +
                '<button class="channel-toggle ' + (isOn ? 'on' : '') + '" id="ch-toggle-' + type + '"></button>' +
                '</div>' +
                '<div class="channel-drawer-fields">' + fieldsHtml + '</div>' +
                '</div>' +
                '<div class="channel-drawer-footer">' +
                '<button class="channel-drawer-save" id="ch-save-' + type + '">保存</button>' +
                '<span class="channel-save-ok" id="save-ok-' + type + '">' +
                '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '已保存' +
                '</span>' +
                '</div>';

            document.getElementById('drawer-close-btn').addEventListener('click', closeChannelDrawer);
            document.getElementById('ch-toggle-' + type).addEventListener('click', function () {
                this.classList.toggle('on');
            });
            document.getElementById('ch-save-' + type).addEventListener('click', function () {
                saveChannel(type);
            });

            requestAnimationFrame(function () {
                document.getElementById('channel-drawer-overlay').classList.add('open');
                drawer.classList.add('open');
            });
        }

        function closeChannelDrawer() {
            var drawer = document.getElementById('channel-drawer');
            var overlay = document.getElementById('channel-drawer-overlay');
            if (drawer) drawer.classList.remove('open');
            if (overlay) overlay.classList.remove('open');
            document.querySelectorAll('.channel-item').forEach(function (el) {
                el.classList.remove('active');
            });
            openDrawerType = null;
        }

        async function saveChannel(type) {
            var toggle = document.getElementById('ch-toggle-' + type);
            var saveBtn = document.getElementById('ch-save-' + type);

            var payload = { enabled: toggle.classList.contains('on') };

            if (type === 'telegram') {
                var tokenInput = document.getElementById('ch-token-' + type);
                payload.token = tokenInput.value.trim();
            } else {
                var appIdInput = document.getElementById('ch-appid-' + type);
                var appSecretInput = document.getElementById('ch-secret-' + type);
                payload.appId = appIdInput.value.trim();
                payload.appSecret = appSecretInput.value.trim();
            }
            var ownerInput = document.getElementById('ch-owner-' + type);
            if (ownerInput) {
                payload.ownerChatId = ownerInput.value.trim();
            }

            saveBtn.disabled = true;
            saveBtn.textContent = '保存中…';

            try {
                var res = await fetch('/api/channels/' + type, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload),
                });

                if (!res.ok) {
                    var err = await res.json().catch(function () {
                        return {};
                    });
                    showError(err.error || '保存失败');
                    return;
                }

                var updatedConfig = await res.json();
                if (channelsData) {
                    channelsData.config = updatedConfig;
                }

                var okEl = document.getElementById('save-ok-' + type);
                okEl.classList.add('show');
                setTimeout(function () {
                    okEl.classList.remove('show');
                }, 2000);

                var statusEl = document.querySelector('.channel-item[data-type="' + type + '"] .channel-item-status');
                if (statusEl) {
                    var nowOn = toggle.classList.contains('on');
                    statusEl.textContent = nowOn ? '已启用' : '未启用';
                    statusEl.className = 'channel-item-status' + (nowOn ? ' on' : '');
                }
            } catch (e) {
                showError('保存频道配置失败');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = '保存';
            }
        }

        async function fetchSkills() {
            try {
                var res = await fetch('/api/skills');
                skillsData = await res.json();
            } catch (e) {
                console.error('Failed to fetch skills:', e);
                skillsData = { skills: [], sources: [] };
            }
        }

        var skillsSearchTerm = '';

        function renderSkillsView() {
            skillsView.innerHTML = '';
            if (!skillsData) return;

            var page = document.createElement('div');
            page.className = 'skills-page';

            var header = document.createElement('div');
            header.className = 'skills-header';
            header.innerHTML =
                '<div class="skills-header-top">' +
                '<div class="skills-header-icon">' +
                '<svg width="22" height="22" viewBox="0 0 14 14" fill="none"><path d="M7 1L8.5 4.5L12.5 5L9.75 7.5L10.5 11.5L7 9.5L3.5 11.5L4.25 7.5L1.5 5L5.5 4.5L7 1Z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '</div>' +
                '<div>' +
                '<div class="skills-header-title">技能管理</div>' +
                '<div class="skills-header-count">' + skillsData.skills.length + ' 个技能可用</div>' +
                '</div>' +
                '</div>';
            page.appendChild(header);

            var toolbar = document.createElement('div');
            toolbar.className = 'skills-toolbar';

            var searchInput = document.createElement('input');
            searchInput.className = 'skills-search';
            searchInput.type = 'text';
            searchInput.placeholder = '搜索技能名称、描述或路径…';
            searchInput.value = skillsSearchTerm;
            searchInput.id = 'skills-search-input';
            searchInput.addEventListener('input', function () {
                skillsSearchTerm = this.value;
                renderSkillsList();
            });

            var refreshBtn = document.createElement('button');
            refreshBtn.className = 'skills-toolbar-btn';
            refreshBtn.title = '刷新';
            refreshBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 7a5.5 5.5 0 0 1 9.35-3.95M12.5 7a5.5 5.5 0 0 1-9.35 3.95" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M10.5 1v2.5H13M3.5 13v-2.5H1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            refreshBtn.addEventListener('click', function () {
                fetchSkills().then(function () {
                    renderSkillsView();
                    showSaveStatus('技能列表已刷新');
                });
            });

            var openFolderBtn = document.createElement('button');
            openFolderBtn.className = 'skills-toolbar-btn';
            openFolderBtn.title = '打开文件夹';
            openFolderBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 3.5v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H7L5.5 3.5H2.5a1 1 0 0 0-1 1z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            openFolderBtn.addEventListener('click', function () {
                fetch('/api/skills/open-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                });
            });

            toolbar.appendChild(searchInput);
            toolbar.appendChild(refreshBtn);
            toolbar.appendChild(openFolderBtn);
            page.appendChild(toolbar);

            var listContainer = document.createElement('div');
            listContainer.className = 'skills-list';
            listContainer.id = 'skills-list-container';
            page.appendChild(listContainer);

            var footer = document.createElement('div');
            footer.className = 'skills-footer';
            footer.innerHTML =
                '<div class="skills-save-status" id="skills-save-status">' +
                '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '所有更改已保存' +
                '</div>' +
                '<div class="skills-footer-actions">' +
                '<button class="skills-footer-btn" id="skills-close-btn">关闭</button>' +
                '</div>';
            page.appendChild(footer);

            skillsView.appendChild(page);

            document.getElementById('skills-close-btn').addEventListener('click', function () {
                showChatView();
            });

            renderSkillsList();
        }

        function renderSkillsList() {
            var container = document.getElementById('skills-list-container');
            if (!container || !skillsData) return;
            container.innerHTML = '';

            var term = skillsSearchTerm.toLowerCase().trim();
            var filtered = skillsData.skills;
            if (term) {
                filtered = filtered.filter(function (s) {
                    return s.name.toLowerCase().indexOf(term) !== -1 ||
                        s.description.toLowerCase().indexOf(term) !== -1 ||
                        s.fullPath.toLowerCase().indexOf(term) !== -1;
                });
            }

            if (filtered.length === 0) {
                container.innerHTML =
                    '<div class="skills-empty">' +
                    '<div class="skills-empty-icon">' +
                    '<svg width="20" height="20" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 9.5L12.5 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
                    '</div>' +
                    '<div class="skills-empty-text">' + (term ? '没有找到匹配的技能' : '暂无可用技能') + '</div>' +
                    '</div>';
                return;
            }

            var grouped = {};
            filtered.forEach(function (s) {
                if (!grouped[s.source]) grouped[s.source] = [];
                grouped[s.source].push(s);
            });

            Object.keys(grouped).forEach(function (source) {
                var items = grouped[source];
                var group = document.createElement('div');
                group.className = 'skills-group';

                var label = document.createElement('div');
                label.className = 'skills-group-label';
                label.innerHTML = escapeHtml(source) + ' <span class="skills-group-badge">' + items.length + '</span>';
                group.appendChild(label);

                items.forEach(function (skill) {
                    group.appendChild(createSkillCard(skill));
                });

                container.appendChild(group);
            });
        }

        function createSkillCard(skill) {
            var card = document.createElement('div');
            card.className = 'skill-card';
            card.dataset.skillId = skill.id;

            var top = document.createElement('div');
            top.className = 'skill-card-top';

            var info = document.createElement('div');
            info.className = 'skill-card-info';
            info.innerHTML =
                '<div class="skill-card-name">' + escapeHtml(skill.name) + '</div>' +
                '<div class="skill-card-desc">' + escapeHtml(skill.description || '暂无描述') + '</div>';

            var actions = document.createElement('div');
            actions.className = 'skill-card-actions';

            var toggle = document.createElement('button');
            toggle.className = 'skill-toggle' + (skill.enabled ? ' on' : '');
            toggle.title = skill.enabled ? '点击禁用' : '点击启用';
            toggle.addEventListener('click', function () {
                var newState = !toggle.classList.contains('on');
                toggle.classList.toggle('on');
                toggle.title = newState ? '点击禁用' : '点击启用';
                skill.enabled = newState;
                fetch('/api/skills/' + encodeURIComponent(skill.id) + '/toggle', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: newState }),
                }).then(function () {
                    showSaveStatus(newState ? '已启用: ' + skill.name : '已禁用: ' + skill.name);
                }).catch(function () {
                    showError('切换技能状态失败');
                });
            });

            var openBtn = document.createElement('button');
            openBtn.className = 'skill-open-btn';
            openBtn.title = '打开文件夹';
            openBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 3v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H6L4.5 3H2a1 1 0 0 0-1 1z" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            openBtn.addEventListener('click', function () {
                fetch('/api/skills/open-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: skill.fullPath }),
                });
            });

            var delBtn = document.createElement('button');
            delBtn.className = 'skill-delete-btn';
            delBtn.title = '删除技能';
            delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M3 3v7a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V3" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            delBtn.addEventListener('click', function () {
                if (!confirm('确定要删除技能 "' + skill.name + '" 吗？此操作不可撤销。')) return;
                fetch('/api/skills/' + encodeURIComponent(skill.id), {
                    method: 'DELETE',
                }).then(function (res) {
                    if (res.ok) {
                        card.style.transition = 'opacity 0.2s, transform 0.2s';
                        card.style.opacity = '0';
                        card.style.transform = 'translateX(10px)';
                        setTimeout(function () {
                            card.remove();
                            skillsData.skills = skillsData.skills.filter(function (s) { return s.id !== skill.id; });
                            var countEl = document.querySelector('.skills-header-count');
                            if (countEl) countEl.textContent = skillsData.skills.length + ' 个技能可用';
                            showSaveStatus('已删除: ' + skill.name);
                        }, 200);
                    } else {
                        showError('删除技能失败');
                    }
                }).catch(function () {
                    showError('删除技能失败');
                });
            });

            actions.appendChild(toggle);
            actions.appendChild(openBtn);
            actions.appendChild(delBtn);
            top.appendChild(info);
            top.appendChild(actions);
            card.appendChild(top);

            var expand = document.createElement('div');
            expand.className = 'skill-card-expand';

            var expandBtn = document.createElement('button');
            expandBtn.className = 'skill-expand-btn';
            expandBtn.innerHTML = '查看详情 <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

            var detail = document.createElement('div');
            detail.className = 'skill-detail';
            detail.innerHTML =
                '<div class="skill-detail-path">📁 ' + escapeHtml(skill.fullPath) + '</div>' +
                '<div class="skill-detail-content">' + escapeHtml(skill.content) + '</div>';

            expandBtn.addEventListener('click', function () {
                var isOpen = detail.classList.contains('show');
                detail.classList.toggle('show');
                expandBtn.classList.toggle('open');
                expandBtn.innerHTML = (isOpen ? '查看详情' : '收起详情') +
                    ' <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            });

            expand.appendChild(expandBtn);
            expand.appendChild(detail);
            card.appendChild(expand);

            return card;
        }

        function showSaveStatus(msg) {
            var el = document.getElementById('skills-save-status');
            if (!el) return;
            el.innerHTML =
                '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> ' +
                escapeHtml(msg);
            el.style.opacity = '1';
            clearTimeout(el._timer);
            el._timer = setTimeout(function () {
                el.innerHTML =
                    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> 所有更改已保存';
            }, 3000);
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && openDrawerType) {
                closeChannelDrawer();
                return;
            }
            if (currentView !== 'skills') return;
            if (e.key === '/' || (e.metaKey && e.key === 'f') || (e.ctrlKey && e.key === 'f')) {
                var searchEl = document.getElementById('skills-search-input');
                if (searchEl && document.activeElement !== searchEl) {
                    e.preventDefault();
                    searchEl.focus();
                }
            }
        });

        async function init() {
            await Promise.all([fetchSessions(), fetchModelConfig(), fetchProviders(), fetchProxyConfig()]);
            if (sessions.length > 0) {
                await loadSession(sessions[0].id);
            } else {
                await createNewChat();
            }
            inputEl.focus();
        }

        init();
    })();
