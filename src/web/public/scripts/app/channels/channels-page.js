import { escapeHtml } from '../utils/html.js';

export function createChannelsPageController(options) {
    const channelView = options.channelView;

    var channelsData = null;
    var openDrawerType = null;
    var weixinLoginPollTimer = null;

    function getChannelMeta(type) {
        if (options.getChannelMeta) return options.getChannelMeta(type);
        return {name: type, icon: type.charAt(0).toUpperCase(), iconClass: 'default'};
    }

    function showError(message) {
        if (options.showError) options.showError(message);
    }

    async function fetchChannels() {
        try {
            var res = await fetch('/api/channels');
            // 校验响应状态，失败时保留旧数据
            if (!res.ok) throw new Error('HTTP ' + res.status);
            channelsData = await res.json();
        } catch (e) {
            console.error('Failed to fetch channels:', e);
        }
    }

    function hasChannelsData() {
        return !!channelsData;
    }

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
        } else if (type === 'weixin') {
            fieldsHtml =
                '<div class="channel-drawer-field">' +
                '<label class="channel-drawer-field-label">Bot Token</label>' +
                '<input class="channel-drawer-input" id="ch-token-' + type + '" type="password" value="' + escapeHtml(cfg.token || '') + '" placeholder="输入或扫码后自动填入" spellcheck="false">' +
                '</div>' +
                '<div class="channel-drawer-field">' +
                '<label class="channel-drawer-field-label">Account ID</label>' +
                '<input class="channel-drawer-input" id="ch-account-' + type + '" value="' + escapeHtml(cfg.accountId || '') + '" placeholder="输入或扫码后自动填入" spellcheck="false">' +
                '</div>';
        } else if (type === 'dingtalk') {
            fieldsHtml =
                '<div class="channel-drawer-field">' +
                '<label class="channel-drawer-field-label">Client ID / AppKey</label>' +
                '<input class="channel-drawer-input" id="ch-appid-' + type + '" value="' + escapeHtml(cfg.appId || '') + '" placeholder="输入钉钉应用 Client ID / AppKey" spellcheck="false">' +
                '</div>' +
                '<div class="channel-drawer-field">' +
                '<label class="channel-drawer-field-label">Client Secret / AppSecret</label>' +
                '<input class="channel-drawer-input" id="ch-secret-' + type + '" type="password" value="' + escapeHtml(cfg.appSecret || '') + '" placeholder="输入钉钉应用 Client Secret / AppSecret" spellcheck="false">' +
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
            '<label class="channel-drawer-field-label">' + (type === 'dingtalk' ? 'Owner User ID' : 'Owner Chat ID') + '</label>' +
            '<input class="channel-drawer-input auto-filled" id="ch-owner-' + type + '" value="' + escapeHtml(cfg.ownerChatId || '') + '" spellcheck="false" readonly>' +
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
            if (type === 'weixin' && this.classList.contains('on')) {
                var tokenInput = document.getElementById('ch-token-' + type);
                var accountInput = document.getElementById('ch-account-' + type);
                var hasToken = tokenInput && tokenInput.value.trim();
                var hasAccount = accountInput && accountInput.value.trim();
                if (!hasToken || !hasAccount) {
                    openWeixinLoginModal({
                        state: 'pending',
                        message: '正在生成微信登录二维码…'
                    });
                    startWeixinLoginPolling(true);
                    fetch('/api/channels/weixin/login', {method: 'POST'}).catch(function (e) {
                        console.error('Failed to start weixin login:', e);
                    });
                }
            }
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
        } else if (type === 'weixin') {
            var wxTokenInput = document.getElementById('ch-token-' + type);
            var accountInput = document.getElementById('ch-account-' + type);
            var currentWeixinCfg = (channelsData && channelsData.config && channelsData.config.weixin) || {};
            payload.token = wxTokenInput.value.trim();
            payload.accountId = accountInput.value.trim();
            payload.baseUrl = currentWeixinCfg.baseUrl || 'https://ilinkai.weixin.qq.com';
            payload.botAgent = currentWeixinCfg.botAgent || 'AnyBot/0.1.0';
            payload.botType = currentWeixinCfg.botType || '3';
        } else if (type === 'dingtalk') {
            var dtAppIdInput = document.getElementById('ch-appid-' + type);
            var dtAppSecretInput = document.getElementById('ch-secret-' + type);
            payload.appId = dtAppIdInput.value.trim();
            payload.appSecret = dtAppSecretInput.value.trim();
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

    function isWeixinBound() {
        var cfg = (channelsData && channelsData.config && channelsData.config.weixin) || {};
        return !!(cfg.token && cfg.accountId);
    }

    function syncWeixinDrawerFields() {
        var cfg = (channelsData && channelsData.config && channelsData.config.weixin) || {};
        var tokenInput = document.getElementById('ch-token-weixin');
        var accountInput = document.getElementById('ch-account-weixin');
        var ownerInput = document.getElementById('ch-owner-weixin');
        var toggle = document.getElementById('ch-toggle-weixin');

        if (tokenInput) tokenInput.value = cfg.token || '';
        if (accountInput) accountInput.value = cfg.accountId || '';
        if (ownerInput) ownerInput.value = cfg.ownerChatId || '';
        if (toggle) toggle.classList.toggle('on', !!cfg.enabled);

        var statusEl = document.querySelector('.channel-item[data-type="weixin"] .channel-item-status');
        if (statusEl) {
            statusEl.textContent = cfg.enabled ? '已启用' : '未启用';
            statusEl.className = 'channel-item-status' + (cfg.enabled ? ' on' : '');
        }
    }

    function openWeixinLoginModal(status) {
        var existing = document.getElementById('weixin-login-overlay');
        if (existing) {
            updateWeixinLoginModal(status || {});
            return;
        }

        var overlay = document.createElement('div');
        overlay.className = 'weixin-login-overlay open';
        overlay.id = 'weixin-login-overlay';
        overlay.innerHTML =
            '<div class="weixin-login-modal">' +
            '<button class="weixin-login-close" id="weixin-login-close" aria-label="关闭">' +
            '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
            '</button>' +
            '<div class="weixin-login-icon">微</div>' +
            '<div class="weixin-login-title">微信扫码绑定</div>' +
            '<div class="weixin-login-subtitle" id="weixin-login-message">正在生成微信登录二维码…</div>' +
            '<div class="weixin-login-qr-frame">' +
            '<img class="weixin-login-qr" id="weixin-login-qr" alt="微信登录二维码">' +
            '<div class="weixin-login-placeholder" id="weixin-login-placeholder">等待二维码</div>' +
            '</div>' +
            '<a class="weixin-login-link" id="weixin-login-link" href="#" target="_blank" rel="noreferrer">打开二维码链接</a>' +
            '</div>';
        document.body.appendChild(overlay);
        document.getElementById('weixin-login-close').addEventListener('click', closeWeixinLoginModal);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeWeixinLoginModal();
        });
        updateWeixinLoginModal(status || {});
    }

    function closeWeixinLoginModal() {
        if (weixinLoginPollTimer) {
            clearInterval(weixinLoginPollTimer);
            weixinLoginPollTimer = null;
        }
        var overlay = document.getElementById('weixin-login-overlay');
        if (!overlay) return;
        overlay.classList.remove('open');
        setTimeout(function () { overlay.remove(); }, 180);
    }

    function updateWeixinLoginModal(status) {
        var overlay = document.getElementById('weixin-login-overlay');
        if (!overlay) return;
        var messageEl = document.getElementById('weixin-login-message');
        var imgEl = document.getElementById('weixin-login-qr');
        var placeholderEl = document.getElementById('weixin-login-placeholder');
        var linkEl = document.getElementById('weixin-login-link');
        var message = status.message || '正在生成微信登录二维码…';
        if (status.state === 'confirmed') message = '微信绑定成功';
        if (status.state === 'failed') message = status.message || '微信绑定失败';
        messageEl.textContent = message;

        if (status.qrcodeDataUrl) {
            imgEl.src = status.qrcodeDataUrl;
            imgEl.style.display = 'block';
            placeholderEl.style.display = 'none';
        } else {
            imgEl.style.display = 'none';
            placeholderEl.style.display = 'flex';
        }

        if (status.qrcodeUrl) {
            linkEl.href = status.qrcodeUrl;
            linkEl.style.display = 'inline-flex';
        } else {
            linkEl.style.display = 'none';
        }
    }

    function startWeixinLoginPolling(showModal) {
        if (weixinLoginPollTimer) clearInterval(weixinLoginPollTimer);
        pollWeixinLoginStatus(showModal);
        weixinLoginPollTimer = setInterval(function () {
            pollWeixinLoginStatus(showModal);
        }, 1500);
    }

    async function pollWeixinLoginStatus(showModal) {
        try {
            await fetchChannels();
            if (isWeixinBound()) {
                syncWeixinDrawerFields();
                closeWeixinLoginModal();
                return;
            }

            var res = await fetch('/api/channels/weixin/login-status');
            if (!res.ok) return;
            var status = await res.json();
            var shouldShow = showModal || ['pending', 'scanned', 'waiting_code'].indexOf(status.state) >= 0;
            if (!shouldShow || status.state === 'idle') return;
            openWeixinLoginModal(status);
            if (status.state === 'confirmed') {
                if (weixinLoginPollTimer) {
                    clearInterval(weixinLoginPollTimer);
                    weixinLoginPollTimer = null;
                }
                await fetchChannels();
                syncWeixinDrawerFields();
                closeWeixinLoginModal();
            }
            if (status.state === 'failed' && weixinLoginPollTimer) {
                clearInterval(weixinLoginPollTimer);
                weixinLoginPollTimer = null;
            }
        } catch (e) {
            console.error('Failed to fetch weixin login status:', e);
        }
    }

    function handleEscape() {
        if (!openDrawerType) return false;
        closeChannelDrawer();
        return true;
    }

    return {
        fetchChannels: fetchChannels,
        handleEscape: handleEscape,
        hasChannelsData: hasChannelsData,
        render: renderAllChannels,
    };
}
