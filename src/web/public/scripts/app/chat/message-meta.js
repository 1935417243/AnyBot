const COPY_ICON = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.2" y="3.2" width="7.6" height="9.6" rx="1.6" stroke="currentColor" stroke-width="1.25"/><path d="M3.2 10.8V5a1.8 1.8 0 011.8-1.8h5.8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';
const CHECK_ICON = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.2 8.4l3.1 3.1 6.5-7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function formatMessageTime(timestamp) {
    var date = timestamp ? new Date(Number(timestamp)) : new Date();
    if (Number.isNaN(date.getTime())) date = new Date();
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

export function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    }
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        return Promise.resolve();
    } catch (e) {
        return Promise.reject(e);
    } finally {
        textarea.remove();
    }
}

export function createMessageMetaController(config) {
    function resetCopyButton(copyBtn) {
        copyBtn.classList.remove('copied');
        copyBtn.title = '复制';
        copyBtn.setAttribute('aria-label', '复制消息');
        copyBtn.innerHTML = COPY_ICON;
    }

    function showCopiedState(copyBtn) {
        copyBtn.classList.add('copied');
        copyBtn.title = '已复制';
        copyBtn.setAttribute('aria-label', '已复制');
        copyBtn.innerHTML = CHECK_ICON;
        setTimeout(function () {
            resetCopyButton(copyBtn);
        }, 1200);
    }

    function attachMessageMeta(row, opts) {
        if (!row || row.querySelector('.message-hover-meta')) return;
        opts = opts || {};
        var bubble = row.querySelector('.bubble');
        if (!bubble) return;

        var meta = document.createElement('div');
        meta.className = 'message-hover-meta';

        var time = document.createElement('span');
        time.className = 'message-hover-time';
        time.textContent = formatMessageTime(opts.createdAt);

        var copyBtn = document.createElement('button');
        copyBtn.className = 'message-copy-btn';
        copyBtn.type = 'button';
        copyBtn.title = '复制';
        copyBtn.setAttribute('aria-label', '复制消息');
        copyBtn.innerHTML = COPY_ICON;
        copyBtn.addEventListener('click', function (event) {
            event.stopPropagation();
            var value = typeof opts.copyText === 'function' ? opts.copyText() : opts.copyText;
            copyTextToClipboard(String(value || '')).then(function () {
                showCopiedState(copyBtn);
            }).catch(function () {
                config.showError('复制失败');
            });
        });

        meta.appendChild(time);
        meta.appendChild(copyBtn);
        bubble.appendChild(meta);
    }

    function installGlobal() {
        window.AnyBotMessageMeta = {
            attach: attachMessageMeta,
        };
    }

    return {
        attachMessageMeta: attachMessageMeta,
        installGlobal: installGlobal,
    };
}
