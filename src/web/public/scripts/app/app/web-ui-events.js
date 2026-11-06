// WebUI 实时事件总线（/api/events SSE）。
// 背景：服务端运行在 HTTP/1.1 上，浏览器对同一 Origin 的并发连接数有上限（Chromium 为 6）。
// 若 sidebar / settings / cliRuntime 各自 new EventSource，单页就常驻多条长连接，
// 多开标签页后会耗尽连接池，导致后续 fetch('/api/...') 一直 pending。
// 方案：
// 1. 整页只建立一条 EventSource，按事件类型在页面内分发给各订阅方；
// 2. 支持 Web Locks + BroadcastChannel 时，同源多个标签页中只有持锁的“主标签页”真正建立 SSE，
//    其它标签页通过 BroadcastChannel 接收转发的事件；主标签页关闭后锁释放，由其它标签页自动接任；
// 3. 跟随标签页长时间收不到主标签页消息（例如主标签页被浏览器挂起）时，自建连接兜底；
// 4. 不支持上述 API 时退化为每个标签页一条连接。

const EVENTS_PATH = '/api/events';
const SHARE_NAME = 'anybot-webui-events';
// 服务端约每 30s 推送一次 ping（src/web/events.ts HEARTBEAT_INTERVAL_MS），
// 跟随标签页超过该时长未收到主标签页任何消息时，判定主标签页可能失联
const LEADER_SILENCE_TIMEOUT_MS = 75000;
// 判定失联前先探测一次，避免本标签页刚从冻结中恢复时误判
const LEADER_PROBE_WAIT_MS = 3000;

// 需要分发的服务端事件类型（与 src/web/events.ts 的 WebUiEvent 保持一致；新增事件类型时同步追加）。
// "ready" 用作连接状态信号，不在此列表中分发。
export const WEB_UI_EVENT_TYPES = [
    'sessions_changed',
    'projects_changed',
    'history_cleared',
    'cli_runtime_changed',
    'model_config_changed',
    'ping',
];

/**
 * 创建事件总线。订阅方回调收到 { type, data } 对象，data 为服务端推送的原始 JSON 字符串
 * （与 MessageEvent.data 一致，便于沿用原有解析逻辑）。
 * 连接状态：'idle' | 'open' | 'closed' | 'unsupported'。
 */
export function createWebUiEventBus(options) {
    options = options || {};
    var win = options.windowRef || window;
    var reconnectMs = options.reconnectMs || 3000;

    var handlers = {};
    var statusListeners = [];
    var status = 'idle';
    var source = null;
    var reconnectTimer = null;
    var running = false;
    // 调用过 start() 且未显式 stop()：用于页面从 bfcache 恢复时自动重启
    var startRequested = false;
    var lifecycleBound = false;

    // 多标签页共享（Web Locks 仅在安全上下文可用，127.0.0.1 / localhost 属于安全上下文）
    var canShare = !!(
        win.BroadcastChannel
        && win.AbortController
        && win.navigator
        && win.navigator.locks
        && typeof win.navigator.locks.request === 'function'
    );
    var channel = null;
    var isLeader = false;
    var releaseLeaderLock = null;
    var lockAbortController = null;
    // 跟随标签页因主标签页失联而自建的兜底连接
    var fallbackActive = false;
    var lastLeaderMessageAt = 0;
    var watchdogTimer = null;
    var probeTimer = null;

    function isSupported() {
        return !!win.EventSource;
    }

    function getEventsUrl() {
        return typeof win.withApiToken === 'function' ? win.withApiToken(EVENTS_PATH) : EVENTS_PATH;
    }

    function on(type, fn) {
        if (!type || typeof fn !== 'function') return function () {};
        if (!handlers[type]) handlers[type] = [];
        handlers[type].push(fn);
        return function () {
            var list = handlers[type];
            if (!list) return;
            var index = list.indexOf(fn);
            if (index >= 0) list.splice(index, 1);
        };
    }

    function onStatus(fn) {
        if (typeof fn !== 'function') return function () {};
        statusListeners.push(fn);
        return function () {
            var index = statusListeners.indexOf(fn);
            if (index >= 0) statusListeners.splice(index, 1);
        };
    }

    function getStatus() {
        return status;
    }

    function dispatch(type, data) {
        var list = handlers[type];
        if (!list || !list.length) return;
        var event = { type: type, data: data };
        list.slice().forEach(function (fn) {
            try {
                fn(event);
            } catch (e) {
                console.error('web-ui event handler failed:', type, e);
            }
        });
    }

    function setStatus(next) {
        if (status === next) return;
        status = next;
        statusListeners.slice().forEach(function (fn) {
            try {
                fn(next);
            } catch (e) {
                console.error('web-ui event status listener failed:', e);
            }
        });
    }

    function postToChannel(message) {
        if (!channel) return;
        try {
            channel.postMessage(message);
        } catch (e) {
            console.error('web-ui event broadcast failed:', e);
        }
    }

    function shouldOwnSource() {
        return running && (!canShare || isLeader || fallbackActive);
    }

    function clearReconnectTimer() {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    function closeSource() {
        if (!source) return;
        source.close();
        source = null;
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            openSource();
        }, reconnectMs);
    }

    function handleSourceLost() {
        closeSource();
        setStatus('closed');
        if (isLeader) postToChannel({ kind: 'status', status: 'closed' });
        scheduleReconnect();
    }

    function openSource() {
        if (source || !shouldOwnSource()) return;
        clearReconnectTimer();
        var es;
        try {
            es = new win.EventSource(getEventsUrl());
        } catch (e) {
            console.error('Failed to open /api/events:', e);
            handleSourceLost();
            return;
        }
        source = es;
        es.addEventListener('ready', function () {
            if (source !== es) return;
            setStatus('open');
            if (isLeader) postToChannel({ kind: 'status', status: 'open' });
        });
        WEB_UI_EVENT_TYPES.forEach(function (type) {
            es.addEventListener(type, function (event) {
                if (source !== es) return;
                var data = event && typeof event.data === 'string' ? event.data : '';
                if (isLeader) postToChannel({ kind: 'event', type: type, data: data });
                dispatch(type, data);
            });
        });
        es.onerror = function () {
            if (source !== es) return;
            handleSourceLost();
        };
    }

    function stopFallback() {
        if (!fallbackActive) return;
        fallbackActive = false;
        closeSource();
        clearReconnectTimer();
    }

    function clearWatchdog() {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        if (probeTimer) clearTimeout(probeTimer);
        watchdogTimer = null;
        probeTimer = null;
    }

    function armWatchdog() {
        if (watchdogTimer || probeTimer) return;
        if (!running || isLeader || fallbackActive || !channel) return;
        var elapsed = Date.now() - lastLeaderMessageAt;
        var delay = Math.max(1000, LEADER_SILENCE_TIMEOUT_MS - elapsed);
        watchdogTimer = setTimeout(checkLeaderAlive, delay);
    }

    function checkLeaderAlive() {
        watchdogTimer = null;
        if (!running || isLeader || fallbackActive) return;
        if (Date.now() - lastLeaderMessageAt < LEADER_SILENCE_TIMEOUT_MS) {
            armWatchdog();
            return;
        }
        var probeStartedAt = Date.now();
        postToChannel({ kind: 'status-request' });
        probeTimer = setTimeout(function () {
            probeTimer = null;
            if (!running || isLeader || fallbackActive) return;
            if (lastLeaderMessageAt >= probeStartedAt) {
                armWatchdog();
                return;
            }
            // 主标签页失联：本标签页自建连接兜底，等主标签页恢复消息或本页拿到锁
            fallbackActive = true;
            openSource();
        }, LEADER_PROBE_WAIT_MS);
    }

    function handleChannelMessage(e) {
        var msg = e && e.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.kind === 'status-request') {
            if (isLeader && (status === 'open' || status === 'closed')) {
                postToChannel({ kind: 'status', status: status });
            }
            return;
        }
        // 主标签页自身就是事件源，忽略其它来源的转发
        if (isLeader) return;
        lastLeaderMessageAt = Date.now();
        // 主标签页已恢复，关闭本页兜底连接以释放连接数
        if (fallbackActive) stopFallback();
        armWatchdog();
        if (msg.kind === 'status') {
            if (msg.status === 'open' || msg.status === 'closed') setStatus(msg.status);
            return;
        }
        if (msg.kind === 'event' && typeof msg.type === 'string') {
            dispatch(msg.type, typeof msg.data === 'string' ? msg.data : '');
        }
    }

    function becomeLeader() {
        isLeader = true;
        fallbackActive = false;
        clearWatchdog();
        if (source) {
            // 兜底连接直接沿用为主连接
            if (status === 'open') postToChannel({ kind: 'status', status: 'open' });
            return;
        }
        openSource();
    }

    function requestLeadership() {
        if (!canShare || lockAbortController) return;
        var controller = new win.AbortController();
        lockAbortController = controller;
        win.navigator.locks.request(SHARE_NAME, { signal: controller.signal }, function () {
            // 返回非 Promise 值会立即释放锁
            if (!running || lockAbortController !== controller) return;
            return new Promise(function (resolve) {
                releaseLeaderLock = resolve;
                becomeLeader();
            });
        }).catch(function (error) {
            // stop() 中 abort 尚未拿到的锁请求会以 AbortError 拒绝，属于预期
            if (error && error.name === 'AbortError') return;
            console.error('web-ui event leader lock failed:', error);
            // 锁不可用时退化为本页独立连接
            if (running && lockAbortController === controller) {
                lockAbortController = null;
                canShare = false;
                fallbackActive = false;
                clearWatchdog();
                openSource();
            }
        });
    }

    function teardown() {
        if (!running) return;
        running = false;
        var wasLeader = isLeader;
        clearWatchdog();
        clearReconnectTimer();
        closeSource();
        fallbackActive = false;
        // 通知其它标签页：主连接即将断开（其拿到锁后会重新建立并广播 open）
        if (wasLeader) postToChannel({ kind: 'status', status: 'closed' });
        isLeader = false;
        if (releaseLeaderLock) {
            releaseLeaderLock();
            releaseLeaderLock = null;
        }
        if (lockAbortController) {
            lockAbortController.abort();
            lockAbortController = null;
        }
        if (channel) {
            channel.onmessage = null;
            channel.close();
            channel = null;
        }
        // 页面卸载/进入 bfcache 时不再通知订阅方
        status = 'idle';
    }

    function bindLifecycle() {
        if (lifecycleBound) return;
        lifecycleBound = true;
        // 使用 pagehide 而不是 beforeunload：既覆盖关闭/刷新，也不影响 bfcache
        win.addEventListener('pagehide', function () {
            teardown();
        });
        win.addEventListener('pageshow', function (event) {
            if (event && event.persisted && startRequested) start();
        });
    }

    function start() {
        startRequested = true;
        if (running) return;
        if (!isSupported()) {
            setStatus('unsupported');
            return;
        }
        running = true;
        bindLifecycle();
        if (!canShare) {
            openSource();
            return;
        }
        try {
            channel = new win.BroadcastChannel(SHARE_NAME);
        } catch (e) {
            console.error('web-ui event BroadcastChannel unavailable:', e);
            channel = null;
            canShare = false;
            openSource();
            return;
        }
        channel.onmessage = handleChannelMessage;
        lastLeaderMessageAt = Date.now();
        requestLeadership();
        // 若已有主标签页，请求其当前连接状态
        postToChannel({ kind: 'status-request' });
        armWatchdog();
    }

    function stop() {
        startRequested = false;
        teardown();
    }

    return {
        getStatus: getStatus,
        isSupported: isSupported,
        on: on,
        onStatus: onStatus,
        start: start,
        stop: stop,
    };
}
