import { isMacPlatform } from '../utils/platform.js';

// 最多保留的历史记录条数，超出后丢弃最早的记录
var MAX_HISTORY_ENTRIES = 50;

// 生成历史记录的比较键：会话按会话 ID，未发送的新对话按所属项目，其它页面按视图名
function getEntryKey(entry) {
    if (!entry) return '';
    if (entry.view !== 'chat') return entry.view;
    if (entry.sessionId) return 'chat:' + entry.sessionId;
    return 'draft:' + (entry.projectId || '');
}

// 窗口左上角前进/后退：在内存中按访问顺序记录会话与页面，点击按钮或快捷键时按记录回放
export function createNavigationHistory(options) {
    var documentRef = options.documentRef || document;
    var backBtn = options.backBtn;
    var forwardBtn = options.forwardBtn;
    // 按访问顺序保存的位置记录：{ view, sessionId?, projectId? }
    var entries = [];
    // 当前所在记录的下标，-1 表示尚无记录
    var index = -1;
    // 是否正在执行前进/后退，避免连续触发时并发回放
    var isNavigating = false;
    // 是否使用 macOS 快捷键（⌘[ / ⌘]），否则使用 Alt+← / Alt+→
    var isMac = isMacPlatform(documentRef);

    // 是否存在可后退的记录
    function canGoBack() {
        return index > 0;
    }

    // 是否存在可前进的记录
    function canGoForward() {
        return index >= 0 && index < entries.length - 1;
    }

    // 同步前进/后退按钮的可用状态
    function render() {
        if (backBtn) backBtn.disabled = !canGoBack();
        if (forwardBtn) forwardBtn.disabled = !canGoForward();
    }

    // 记录当前位置；与当前记录相同时忽略，否则丢弃前进分支后追加。
    // replaceDraft 为 true 且当前记录是未发送的新对话时，直接用当前位置覆盖（草稿发送后变成正式会话）
    function record(recordOptions) {
        recordOptions = recordOptions || {};
        var entry = options.getLocation ? options.getLocation() : null;
        if (!entry) return;
        var current = entries[index];
        if (current && getEntryKey(current) === getEntryKey(entry)) return;
        if (recordOptions.replaceDraft && current && current.view === 'chat' && !current.sessionId) {
            entries[index] = entry;
            render();
            return;
        }
        entries = entries.slice(0, index + 1);
        entries.push(entry);
        if (entries.length > MAX_HISTORY_ENTRIES) {
            entries = entries.slice(entries.length - MAX_HISTORY_ENTRIES);
        }
        index = entries.length - 1;
        render();
    }

    // 按步长回放历史记录；目标打开失败（如会话已被删除）时移除该记录并继续同方向查找
    async function go(step) {
        if (isNavigating || !options.navigate) return;
        isNavigating = true;
        try {
            var target = index + step;
            while (target >= 0 && target < entries.length) {
                var originEntry = entries[index];
                var entry = entries[target];
                index = target;
                render();
                var ok = false;
                try {
                    ok = await options.navigate(entry);
                } catch (_) {
                    ok = false;
                }
                // 回放期间用户已跳转到别处，以用户操作为准
                if (entries[index] !== entry) return;
                if (ok) return;
                // 回放期间记录可能被 removeSession 重排，按对象定位而不是沿用旧下标
                var failedPos = entries.indexOf(entry);
                if (failedPos >= 0) entries.splice(failedPos, 1);
                index = entries.indexOf(originEntry);
                if (index < 0) {
                    index = Math.min(Math.max(failedPos, 0), entries.length - 1);
                    return;
                }
                target = index + step;
            }
        } finally {
            isNavigating = false;
            render();
        }
    }

    // 后退到上一条记录
    function back() {
        return go(-1);
    }

    // 前进到下一条记录
    function forward() {
        return go(1);
    }

    // 会话删除后移除其历史记录（当前所在记录保留，回放时会自动跳过），并合并删除后相邻的重复记录
    function removeSession(sessionId) {
        if (!sessionId) return;
        var current = entries[index];
        var next = [];
        entries.forEach(function (entry) {
            if (entry !== current && entry.sessionId === sessionId) return;
            var last = next[next.length - 1];
            if (last && getEntryKey(last) === getEntryKey(entry)) {
                if (entry === current) next[next.length - 1] = entry;
                return;
            }
            next.push(entry);
        });
        entries = next;
        index = entries.indexOf(current);
        render();
    }

    // 快捷键：macOS 为 ⌘[ / ⌘]，其它平台为 Alt+← / Alt+→
    function handleKeydown(e) {
        if (e.defaultPrevented || e.isComposing) return;
        var direction = 0;
        if (isMac) {
            if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
            if (e.code === 'BracketLeft') direction = -1;
            else if (e.code === 'BracketRight') direction = 1;
        } else {
            if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
            if (e.key === 'ArrowLeft') direction = -1;
            else if (e.key === 'ArrowRight') direction = 1;
        }
        if (!direction) return;
        e.preventDefault();
        go(direction);
    }

    // 绑定按钮点击、快捷键，并写入带快捷键的按钮提示
    function bind() {
        var backHint = isMac ? '后退（⌘[）' : '后退（Alt+←）';
        var forwardHint = isMac ? '前进（⌘]）' : '前进（Alt+→）';
        if (backBtn) {
            backBtn.title = backHint;
            backBtn.addEventListener('click', back);
        }
        if (forwardBtn) {
            forwardBtn.title = forwardHint;
            forwardBtn.addEventListener('click', forward);
        }
        documentRef.addEventListener('keydown', handleKeydown);
        documentRef.addEventListener('mousedown', handleMouseButton);
        documentRef.addEventListener('mouseup', handleMouseButton);
        render();
    }

    // 鼠标侧键：button 3 后退、button 4 前进。按下和抬起都阻止默认行为，
    // 否则网页端浏览器会执行自身的页面后退而直接离开应用；只在抬起时触发一次导航
    function handleMouseButton(e) {
        if (e.button !== 3 && e.button !== 4) return;
        e.preventDefault();
        if (e.type === 'mouseup') go(e.button === 3 ? -1 : 1);
    }

    return {
        back: back,
        bind: bind,
        forward: forward,
        record: record,
        removeSession: removeSession,
    };
}
