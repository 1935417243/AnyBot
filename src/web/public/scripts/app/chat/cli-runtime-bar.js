// 聊天页内置 CLI 组件提示条：当前 provider 的组件未就绪时，在输入框上方显示
// 内联提示（仿 task-dock 的插入位置），支持就地发起下载并展示进度，就绪后自动隐藏。
export function createCliRuntimeBar(options) {
    options = options || {};
    var inputArea = options.inputArea;
    var inputWrapper = inputArea ? inputArea.querySelector('.input-wrapper') : null;
    var store = options.cliRuntimeStore;
    // 返回当前生效的 provider（modelConfig.provider，与发送请求所用一致）
    var getCurrentProvider = options.getCurrentProvider || function () { return null; };

    var PROVIDER_LABELS = {
        'codex': 'Codex',
        'claude-code': 'Claude Code',
    };

    var bar = document.createElement('div');
    bar.className = 'cli-runtime-bar';
    bar.hidden = true;

    if (inputArea && inputWrapper) {
        inputArea.insertBefore(bar, inputWrapper);
    }

    function formatSize(bytes) {
        var value = Number(bytes || 0);
        if (!Number.isFinite(value) || value <= 0) return '';
        var mb = value / (1024 * 1024);
        return (mb >= 100 ? String(Math.round(mb)) : mb.toFixed(1)) + ' MB';
    }

    function makeTextSpan(text) {
        var span = document.createElement('span');
        span.className = 'cli-runtime-bar-text';
        span.textContent = text;
        return span;
    }

    function render() {
        bar.innerHTML = '';
        var provider = getCurrentProvider();
        var label = PROVIDER_LABELS[provider];
        var status = provider && store ? store.get(provider) : null;
        // 非内置组件 provider 或已就绪时不显示
        if (!label || !status || status.phase === 'ready') {
            bar.hidden = true;
            return;
        }
        bar.hidden = false;

        if (status.phase === 'downloading' || status.phase === 'verifying') {
            var percent = status.phase === 'verifying'
                ? 100
                : Math.max(0, Math.min(100, Number(status.percent || 0)));
            bar.appendChild(makeTextSpan(
                status.phase === 'verifying'
                    ? label + ' 内置组件校验中…'
                    : label + ' 内置组件下载中 ' + percent.toFixed(1) + '%',
            ));
            return;
        }

        if (status.phase === 'error') {
            bar.appendChild(makeTextSpan(label + ' 内置组件下载失败' + (status.message ? '：' + status.message : '')));
        } else if (!status.supported) {
            bar.appendChild(makeTextSpan(label + ' 内置组件暂不支持当前平台自动下载，请在设置页配置外部 CLI'));
            return;
        } else {
            var sizeText = formatSize(status.sizeBytes);
            bar.appendChild(makeTextSpan(label + ' 内置组件尚未下载' + (sizeText ? '（约 ' + sizeText + '）' : '')));
        }

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cli-runtime-bar-btn';
        btn.textContent = status.phase === 'error' ? '重试下载' : '立即下载';
        btn.addEventListener('click', function () {
            if (store) store.startDownload(provider);
        });
        bar.appendChild(btn);
    }

    if (store) {
        store.subscribe(render);
    }

    return {
        render: render,
    };
}
