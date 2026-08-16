const DEFAULT_PLACEHOLDERS = [
    'Enter 发送 · Shift+Enter 换行',
    '输入 @ 引用项目文件',
    '输入 / 使用技能或项目',
    '按 ↑ / ↓ 切换历史消息',
    '可粘贴图片或拖拽文件',
];

const DEFAULT_PLACEHOLDER_INTERVAL_MS = 10000;
const DEFAULT_MAX_INPUT_HEIGHT = 160;

const SEND_BUTTON_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 7h10M7.5 2.5L12 7l-4.5 4.5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const STOP_BUTTON_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.4" fill="white"/></svg>';

export function createChatInputUiController(options) {
    const inputEl = options.inputEl;
    const sendBtn = options.sendBtn;
    const placeholders = options.placeholders || DEFAULT_PLACEHOLDERS;
    const placeholderIntervalMs = options.placeholderIntervalMs || DEFAULT_PLACEHOLDER_INTERVAL_MS;
    const maxInputHeight = options.maxInputHeight || DEFAULT_MAX_INPUT_HEIGHT;

    var placeholderIndex = 0;
    var placeholderTimer = null;

    function getPromptSelection() {
        if (!options.getPromptSelection) return { skills: [], projects: [] };
        return options.getPromptSelection() || { skills: [], projects: [] };
    }

    function getPendingAttachments() {
        if (!options.getPendingAttachments) return [];
        return options.getPendingAttachments() || [];
    }

    function updateSendBtnState() {
        var isRunning = !!(options.getIsTyping && options.getIsTyping());
        var isCancelling = !!(options.getIsCancellingResponse && options.getIsCancellingResponse());
        var promptSelection = getPromptSelection();
        var skills = promptSelection.skills || [];
        var projects = promptSelection.projects || [];
        var files = promptSelection.files || [];

        sendBtn.classList.toggle('is-stop', isRunning);
        sendBtn.innerHTML = isRunning ? STOP_BUTTON_ICON : SEND_BUTTON_ICON;
        sendBtn.title = isRunning ? (isCancelling ? '正在中断' : '中断') : '发送';
        sendBtn.setAttribute('aria-label', sendBtn.title);
        sendBtn.disabled = isRunning
            ? isCancelling
            : (
                inputEl.value.trim() === '' &&
                getPendingAttachments().length === 0 &&
                skills.length === 0 &&
                projects.length === 0 &&
                files.length === 0
            );
    }

    function resizeChatInput() {
        if (inputEl.value === '') {
            inputEl.style.height = '';
            inputEl.style.overflowY = 'hidden';
            return;
        }
        inputEl.style.height = 'auto';
        inputEl.style.overflowY = inputEl.scrollHeight > maxInputHeight ? 'auto' : 'hidden';
        inputEl.style.height = Math.min(inputEl.scrollHeight, maxInputHeight) + 'px';
    }

    function updatePlaceholder() {
        inputEl.placeholder = placeholders[placeholderIndex];
    }

    function startPlaceholderRotation() {
        if (placeholderTimer) return;
        updatePlaceholder();
        placeholderTimer = setInterval(function () {
            placeholderIndex = (placeholderIndex + 1) % placeholders.length;
            updatePlaceholder();
        }, placeholderIntervalMs);
    }

    function stopPlaceholderRotation() {
        if (!placeholderTimer) return;
        clearInterval(placeholderTimer);
        placeholderTimer = null;
    }

    return {
        resizeChatInput: resizeChatInput,
        startPlaceholderRotation: startPlaceholderRotation,
        stopPlaceholderRotation: stopPlaceholderRotation,
        updatePlaceholder: updatePlaceholder,
        updateSendBtnState: updateSendBtnState,
    };
}
