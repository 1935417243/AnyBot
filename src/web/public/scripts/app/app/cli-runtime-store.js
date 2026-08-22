// 内置 CLI 组件（Claude Code / Codex）下载状态共享 store。
// 设置页状态条与聊天页提示条共用：状态来自 GET /api/cli-runtime/status，
// 下载进度走 POST /api/cli-runtime/download 的 NDJSON 流（模式参照 skills-page.js），
// 终态由 SSE 事件 cli_runtime_changed 触发全量刷新。
export function createCliRuntimeStore(options) {
    options = options || {};
    var showError = options.showError || function () {};

    // provider -> 后端 CliRuntimeStatus { provider, phase, percent, version, sizeBytes, source, message, supported }
    var statuses = {};
    // 订阅者（状态变化时通知，供各视图就地刷新）
    var listeners = [];
    // 本页面内正在进行下载的 provider，防止重复触发
    var downloading = {};

    function notify() {
        listeners.forEach(function (fn) {
            try {
                fn();
            } catch (e) {
                console.error('cli-runtime store listener failed:', e);
            }
        });
    }

    function subscribe(fn) {
        listeners.push(fn);
        return function () {
            var index = listeners.indexOf(fn);
            if (index >= 0) listeners.splice(index, 1);
        };
    }

    function get(provider) {
        return statuses[provider] || null;
    }

    // 非内置组件 provider 没有状态记录，视为可用，不影响发送
    function isReady(provider) {
        var status = get(provider);
        if (!status) return true;
        return status.phase === 'ready';
    }

    function applyStatus(status) {
        if (!status || !status.provider) return;
        statuses[status.provider] = status;
    }

    // 全量拉取组件状态
    async function refresh() {
        try {
            var res = await fetch('/api/cli-runtime/status');
            if (!res.ok) return;
            var data = await res.json();
            var runtimes = Array.isArray(data.runtimes) ? data.runtimes : [];
            runtimes.forEach(applyStatus);
            notify();
        } catch (e) {
            console.error('Failed to fetch cli-runtime status:', e);
        }
    }

    function handleDownloadLine(line) {
        if (!line || !line.trim()) return;
        try {
            applyStatus(JSON.parse(line));
        } catch (e) {
            console.error('Failed to parse cli-runtime download event:', e);
        }
    }

    // 触发下载并消费 NDJSON 进度流；并发调用只会订阅已有下载（后端去重），这里仅防止本页重复发请求
    async function startDownload(provider) {
        if (!provider || downloading[provider]) return;
        downloading[provider] = true;
        notify();
        try {
            var res = await fetch('/api/cli-runtime/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: provider }),
            });
            if (!res.ok) {
                var errorData = await res.json().catch(function () { return {}; });
                throw new Error(errorData.error || '组件下载失败');
            }
            if (!res.body || !window.TextDecoder) {
                throw new Error('当前浏览器不支持下载进度流');
            }
            var reader = res.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';
            while (true) {
                var chunk = await reader.read();
                if (chunk.done) break;
                buffer += decoder.decode(chunk.value, { stream: true });
                var lines = buffer.split('\n');
                buffer = lines.pop() || '';
                lines.forEach(handleDownloadLine);
                notify();
            }
            buffer += decoder.decode();
            handleDownloadLine(buffer);
            notify();
        } catch (e) {
            showError(e && e.message ? e.message : '组件下载失败');
        } finally {
            downloading[provider] = false;
            // 终态后全量刷新一次，确保 ready/error 状态与后端一致
            await refresh();
        }
    }

    // 订阅 SSE：其他入口触发的下载到达终态时同步刷新
    function bindEvents() {
        if (!window.EventSource) return;
        var url = window.withApiToken ? window.withApiToken('/api/events') : '/api/events';
        var source = new EventSource(url);
        source.addEventListener('cli_runtime_changed', function () {
            refresh();
        });
        source.onerror = function () {
            source.close();
        };
    }

    return {
        bindEvents: bindEvents,
        get: get,
        isDownloading: function (provider) { return !!downloading[provider]; },
        isReady: isReady,
        refresh: refresh,
        startDownload: startDownload,
        subscribe: subscribe,
    };
}
