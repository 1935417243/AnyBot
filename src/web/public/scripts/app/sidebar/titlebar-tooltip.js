// 鼠标在按钮上停留多久后展示提示
var SHOW_DELAY_MS = 300;
// 提示刚隐藏的这段时间内移到相邻按钮时立即展示，不再重新等待
var WARM_SWITCH_MS = 300;
// 提示与按钮之间、提示与窗口左边缘之间的间距
var TOOLTIP_GAP = 6;

// 窗口左上角标题条按钮的悬停提示：在按钮下方展示功能名与快捷键键帽，替代原生 title 提示。
// 按钮通过 data-titlebar-tooltip 声明功能名，data-titlebar-shortcut 声明以空格分隔的按键（如「⌘ K」）
export function initTitlebarTooltip(strip) {
    if (!strip) return;

    // 提示浮层元素，首次展示时创建并挂在标题条内，与按钮共用 offset 坐标系，不受页面 zoom 影响
    var tooltipEl = null;
    // 当前悬停（等待展示或已展示）的按钮
    var currentTarget = null;
    // 延迟展示定时器
    var showTimer = null;
    // 提示最近一次隐藏的时间戳，用于相邻按钮之间快速切换
    var lastHiddenAt = 0;
    // 刚按下过的按钮：鼠标离开前不再展示，避免点击后提示文案与按钮新状态不一致
    var suppressedTarget = null;

    // 创建提示浮层；按钮自身已有 aria-label，浮层只做视觉展示
    function ensureTooltip() {
        if (tooltipEl) return tooltipEl;
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'titlebar-tooltip';
        tooltipEl.setAttribute('aria-hidden', 'true');
        strip.appendChild(tooltipEl);
        return tooltipEl;
    }

    // 取事件节点所属的提示按钮，标题条以外的节点返回 null
    function getTarget(node) {
        if (!(node instanceof Element)) return null;
        var target = node.closest('[data-titlebar-tooltip]');
        return target && strip.contains(target) ? target : null;
    }

    // 按按钮当前的 data 属性渲染功能名与快捷键键帽
    function render(target) {
        tooltipEl.innerHTML = '';
        var labelEl = document.createElement('span');
        labelEl.className = 'titlebar-tooltip-label';
        labelEl.textContent = target.getAttribute('data-titlebar-tooltip') || '';
        tooltipEl.appendChild(labelEl);
        var keys = (target.getAttribute('data-titlebar-shortcut') || '').split(' ').filter(Boolean);
        if (!keys.length) return;
        var keysEl = document.createElement('span');
        keysEl.className = 'titlebar-tooltip-keys';
        keys.forEach(function (key) {
            var keyEl = document.createElement('kbd');
            keyEl.className = 'titlebar-tooltip-key';
            keyEl.textContent = key;
            keysEl.appendChild(keyEl);
        });
        tooltipEl.appendChild(keysEl);
    }

    // 水平居中于按钮下方，并保证不超出窗口左边缘
    function position(target) {
        var left = target.offsetLeft + (target.offsetWidth - tooltipEl.offsetWidth) / 2;
        var minLeft = TOOLTIP_GAP - strip.offsetLeft;
        tooltipEl.style.left = Math.max(minLeft, left) + 'px';
        tooltipEl.style.top = (target.offsetTop + target.offsetHeight + TOOLTIP_GAP) + 'px';
    }

    // 立即展示按钮的提示
    function show(target) {
        ensureTooltip();
        render(target);
        position(target);
        tooltipEl.classList.add('visible');
    }

    // 隐藏提示并取消待展示的定时器
    function hide() {
        clearTimeout(showTimer);
        showTimer = null;
        currentTarget = null;
        if (tooltipEl && tooltipEl.classList.contains('visible')) {
            tooltipEl.classList.remove('visible');
            lastHiddenAt = Date.now();
        }
    }

    // 使用 pointer 事件而非 mouse 事件：置灰的前进/后退按钮也需要展示提示
    strip.addEventListener('pointerover', function (e) {
        var target = getTarget(e.target);
        if (!target || target === currentTarget || target === suppressedTarget) return;
        hide();
        currentTarget = target;
        if (Date.now() - lastHiddenAt < WARM_SWITCH_MS) {
            show(target);
            return;
        }
        showTimer = setTimeout(function () {
            showTimer = null;
            show(target);
        }, SHOW_DELAY_MS);
    });

    strip.addEventListener('pointerout', function (e) {
        var target = getTarget(e.target);
        if (!target) return;
        if (e.relatedTarget instanceof Node && target.contains(e.relatedTarget)) return;
        if (target === suppressedTarget) suppressedTarget = null;
        if (target === currentTarget) hide();
    });

    strip.addEventListener('pointerdown', function (e) {
        var target = getTarget(e.target);
        if (!target) return;
        suppressedTarget = target;
        hide();
    });

    window.addEventListener('blur', hide);
}
