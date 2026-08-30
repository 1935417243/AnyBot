// 侧边栏折叠/展开开关：维护 sidebarCollapsed 状态，同步 body class 与按钮图标、无障碍属性
export function initSidebarToggle(button) {
    if (!button) return;

    // 当前折叠状态：true 表示侧边栏已收起
    var sidebarCollapsed = false;

    // 采集按钮命中区域的位置、拖拽属性和实际 DOM 目标，用于定位 macOS 桌面端点击丢失。
    function getDiagnosticSnapshot(event) {
        var rect = button.getBoundingClientRect();
        var strip = document.getElementById("titlebar-strip");
        var centerX = rect.left + rect.width / 2;
        var centerY = rect.top + rect.height / 2;
        var hitTarget = document.elementFromPoint(centerX, centerY);
        var snapshot = {
            bodyClass: document.body.className,
            buttonRect: {
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            },
            buttonAppRegion: window.getComputedStyle(button).getPropertyValue("-webkit-app-region"),
            stripAppRegion: strip ? window.getComputedStyle(strip).getPropertyValue("-webkit-app-region") : "missing",
            centerHitTarget: hitTarget ? hitTarget.tagName.toLowerCase() + (hitTarget.id ? "#" + hitTarget.id : "") : "none",
            collapsed: sidebarCollapsed
        };
        if (event) {
            snapshot.eventTarget = event.target && event.target.tagName
                ? event.target.tagName.toLowerCase() + (event.target.id ? "#" + event.target.id : "")
                : "unknown";
            snapshot.eventPoint = {
                x: Math.round(event.clientX),
                y: Math.round(event.clientY)
            };
        }
        return snapshot;
    }

    // 使用单行 JSON 输出诊断信息，桌面主进程会将该前缀日志转存到 desktop.log。
    function writeDiagnosticLog(stage, event) {
        console.info("[sidebar-toggle] " + stage + " " + JSON.stringify(getDiagnosticSnapshot(event)));
    }

    function render() {
        document.body.classList.toggle("sidebar-collapsed", sidebarCollapsed);
        button.setAttribute("aria-expanded", String(!sidebarCollapsed));
        var label = sidebarCollapsed ? "展开侧边栏" : "收起侧边栏";
        button.setAttribute("aria-label", label);
        button.title = label;
    }

    button.addEventListener("pointerdown", function (event) {
        writeDiagnosticLog("button-pointerdown", event);
    });

    button.addEventListener("mousedown", function (event) {
        writeDiagnosticLog("button-mousedown", event);
    });

    button.addEventListener("click", function (event) {
        writeDiagnosticLog("button-click-before-render", event);
        sidebarCollapsed = !sidebarCollapsed;
        render();
        writeDiagnosticLog("button-click-after-render", event);
    });

    // 捕获按钮矩形内落到其它 DOM 元素的指针事件，用于识别页面覆盖层。
    document.addEventListener("pointerdown", function (event) {
        var rect = button.getBoundingClientRect();
        var isInsideButton = event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= rect.top && event.clientY <= rect.bottom;
        if (isInsideButton && event.target !== button && !button.contains(event.target)) {
            writeDiagnosticLog("button-area-hit-other-target", event);
        }
    }, true);

    render();

    window.addEventListener("load", function () {
        writeDiagnosticLog("initialized");
        window.setTimeout(function () {
            writeDiagnosticLog("post-platform-class");
        }, 250);
    }, { once: true });
}
