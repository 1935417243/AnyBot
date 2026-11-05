/**
 * 输入框上方的提问卡片容器：Agent 等待回答时卡片固定在这里，回答结束后由消息视图移回消息流。
 */
export function createUserQuestionDock(options) {
    var inputArea = options.inputArea;
    var inputWrapper = inputArea ? inputArea.querySelector('.input-wrapper') : null;

    var container = document.createElement('div');
    container.className = 'user-question-dock';
    container.hidden = true;

    if (inputArea && inputWrapper) {
        inputArea.insertBefore(container, inputWrapper);
    }

    // 没有卡片时隐藏容器，避免输入框上方留白
    function syncVisibility() {
        container.hidden = container.childElementCount === 0;
    }

    // 挂载等待回答的卡片；每次挂载都贴回输入框正上方，避免被其它后插入的提示条隔开
    function mount(el) {
        if (!el) return;
        if (inputArea && inputWrapper && container.nextSibling !== inputWrapper) {
            inputArea.insertBefore(container, inputWrapper);
        }
        container.appendChild(el);
        syncVisibility();
    }

    // 卸下卡片（回答结束后移回消息流）
    function unmount(el) {
        if (el && el.parentNode === container) container.removeChild(el);
        syncVisibility();
    }

    // 切换或离开会话时清空，防止残留其它会话的提问
    function reset() {
        container.innerHTML = '';
        syncVisibility();
    }

    return {
        mount: mount,
        unmount: unmount,
        reset: reset,
    };
}
